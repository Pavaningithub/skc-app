import { useState, useEffect, useRef, useMemo } from 'react';
import { Plus, Save, X, Search, TrendingUp, TrendingDown, Minus as FlatIcon } from 'lucide-react';
import toast from 'react-hot-toast';
import { rawMaterialCostSheetService } from '../../lib/services';
import type { RawMaterialCostSheet, RawMaterialRow, BatchColumn } from '../../lib/types';

// ── helpers ────────────────────────────────────────────────────────────────
function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

const EMPTY_SHEET: RawMaterialCostSheet = {
  materials: [],
  batches: [],
  cells: {},
  updatedAt: '',
};

// ── component ──────────────────────────────────────────────────────────────
export default function RawMaterialCostsPage() {
  const [sheet, setSheet] = useState<RawMaterialCostSheet>(EMPTY_SHEET);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [search, setSearch] = useState('');

  // new batch form
  const [showAddBatch, setShowAddBatch] = useState(false);
  const [newBatch, setNewBatch] = useState({ batchNumber: '', date: new Date().toISOString().slice(0, 10) });

  // new material form
  const [showAddMaterial, setShowAddMaterial] = useState(false);
  const [newMaterial, setNewMaterial] = useState({ nameEn: '', nameKn: '', unit: 'gram' as RawMaterialRow['unit'] });

  // inline cell editing
  const [editingCell, setEditingCell] = useState<string | null>(null); // `matId__batchId`
  const [cellDraft, setCellDraft] = useState('');
  const cellInputRef = useRef<HTMLInputElement>(null);

  const tableRef = useRef<HTMLDivElement>(null);

  // Load from Firestore on mount, then subscribe
  useEffect(() => {
    rawMaterialCostSheetService.get().then(s => { if (s) setSheet(s); });
    const unsub = rawMaterialCostSheetService.subscribe(s => {
      setSheet(s);
      setDirty(false);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (editingCell && cellInputRef.current) cellInputRef.current.focus();
  }, [editingCell]);

  async function saveSheet(s: RawMaterialCostSheet) {
    setSaving(true);
    try {
      await rawMaterialCostSheetService.save(s);
      setDirty(false);
      toast.success('Saved');
    } catch { toast.error('Save failed'); }
    finally { setSaving(false); }
  }

  function mutate(updater: (s: RawMaterialCostSheet) => RawMaterialCostSheet) {
    setSheet(prev => {
      const next = updater(prev);
      setDirty(true);
      return next;
    });
  }

  // ── Add batch column ──
  function addBatch() {
    if (!newBatch.batchNumber.trim()) return toast.error('Enter a batch number');
    if (!newBatch.date) return toast.error('Pick a date');
    const col: BatchColumn = { id: uid(), batchNumber: newBatch.batchNumber.trim(), date: newBatch.date };
    mutate(s => ({ ...s, batches: [...s.batches, col] }));
    setNewBatch({ batchNumber: '', date: new Date().toISOString().slice(0, 10) });
    setShowAddBatch(false);
  }

  function removeBatch(batchId: string) {
    if (!confirm('Remove this batch column?')) return;
    mutate(s => {
      const cells = { ...s.cells };
      Object.keys(cells).forEach(k => { if (k.endsWith('__' + batchId)) delete cells[k]; });
      return { ...s, batches: s.batches.filter(b => b.id !== batchId), cells };
    });
  }

  // ── Add material row ──
  function addMaterial() {
    if (!newMaterial.nameEn.trim()) return toast.error('Enter English name');
    const row: RawMaterialRow = { id: uid(), nameEn: newMaterial.nameEn.trim(), nameKn: newMaterial.nameKn.trim(), unit: newMaterial.unit };
    mutate(s => ({ ...s, materials: [...s.materials, row] }));
    setNewMaterial({ nameEn: '', nameKn: '', unit: 'gram' });
    setShowAddMaterial(false);
  }

  function removeMaterial(matId: string) {
    if (!confirm('Remove this raw material row?')) return;
    mutate(s => {
      const cells = { ...s.cells };
      Object.keys(cells).forEach(k => { if (k.startsWith(matId + '__')) delete cells[k]; });
      return { ...s, materials: s.materials.filter(m => m.id !== matId), cells };
    });
  }

  // ── Cell edit ──
  function startEdit(matId: string, batchId: string) {
    const key = `${matId}__${batchId}`;
    setEditingCell(key);
    setCellDraft(String(sheet.cells[key] ?? ''));
  }

  function commitEdit() {
    if (!editingCell) return;
    const val = parseFloat(cellDraft);
    mutate(s => ({
      ...s,
      cells: {
        ...s.cells,
        ...(isNaN(val) ? {} : { [editingCell]: val }),
        ...(!cellDraft.trim() ? { [editingCell]: 0 } : {}),
      },
    }));
    setEditingCell(null);
  }

  // ── Delta indicator (vs previous batch) ──
  function getDelta(matId: string, batchIdx: number): 'up' | 'down' | 'same' | 'new' {
    if (batchIdx === 0) return 'new';
    const cur = sheet.cells[`${matId}__${sheet.batches[batchIdx].id}`];
    const prev = sheet.cells[`${matId}__${sheet.batches[batchIdx - 1].id}`];
    if (cur == null || prev == null || cur === 0 || prev === 0) return 'new';
    if (cur > prev) return 'up';
    if (cur < prev) return 'down';
    return 'same';
  }

  // ── Filtered materials ──
  const filteredMaterials = useMemo(() =>
    sheet.materials.filter(m =>
      !search ||
      m.nameEn.toLowerCase().includes(search.toLowerCase()) ||
      m.nameKn.includes(search)
    ), [sheet.materials, search]);

  return (
    <div className="flex flex-col h-full">
      {/* ── Toolbar ── */}
      <div className="flex-shrink-0 px-4 pt-4 pb-3 flex items-center justify-between gap-3 flex-wrap border-b border-gray-100 bg-white">
        <div>
          <h1 className="text-lg font-bold text-gray-800">📦 Raw Material Costs</h1>
          <p className="text-xs text-gray-400 mt-0.5">Track cost per batch — green = cheaper, red = costlier</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search material…"
              className="pl-8 pr-3 py-2 border border-gray-200 rounded-xl text-sm outline-none focus:border-orange-400 w-44"
            />
          </div>
          <button onClick={() => setShowAddMaterial(true)}
            className="flex items-center gap-1.5 text-sm bg-gray-100 text-gray-700 px-3 py-2 rounded-xl hover:bg-gray-200 font-medium">
            <Plus className="w-3.5 h-3.5" /> Add Material
          </button>
          <button onClick={() => setShowAddBatch(true)}
            className="flex items-center gap-1.5 text-sm bg-orange-500 text-white px-3 py-2 rounded-xl hover:bg-orange-600 font-medium">
            <Plus className="w-3.5 h-3.5" /> Add Batch
          </button>
          {dirty && (
            <button onClick={() => saveSheet(sheet)} disabled={saving}
              className="flex items-center gap-1.5 text-sm bg-green-500 text-white px-3 py-2 rounded-xl hover:bg-green-600 font-medium disabled:opacity-50">
              <Save className="w-3.5 h-3.5" /> {saving ? 'Saving…' : 'Save'}
            </button>
          )}
        </div>
      </div>

      {/* ── Add Batch form ── */}
      {showAddBatch && (
        <div className="flex-shrink-0 px-4 py-3 bg-orange-50 border-b border-orange-100 flex items-center gap-3 flex-wrap">
          <input
            value={newBatch.batchNumber}
            onChange={e => setNewBatch(p => ({ ...p, batchNumber: e.target.value }))}
            placeholder="Batch number e.g. B-042"
            className="border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-orange-400 w-44"
            onKeyDown={e => e.key === 'Enter' && addBatch()}
            autoFocus
          />
          <input type="date" value={newBatch.date}
            onChange={e => setNewBatch(p => ({ ...p, date: e.target.value }))}
            className="border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-orange-400"
          />
          <button onClick={addBatch} className="bg-orange-500 text-white px-4 py-2 rounded-xl text-sm font-semibold">Add</button>
          <button onClick={() => setShowAddBatch(false)} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* ── Add Material form ── */}
      {showAddMaterial && (
        <div className="flex-shrink-0 px-4 py-3 bg-blue-50 border-b border-blue-100 flex items-center gap-3 flex-wrap">
          <input
            value={newMaterial.nameEn}
            onChange={e => setNewMaterial(p => ({ ...p, nameEn: e.target.value }))}
            placeholder="Name in English *"
            className="border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-orange-400 w-44"
            autoFocus
          />
          <input
            value={newMaterial.nameKn}
            onChange={e => setNewMaterial(p => ({ ...p, nameKn: e.target.value }))}
            placeholder="ಕನ್ನಡದಲ್ಲಿ ಹೆಸರು"
            className="border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-orange-400 w-44"
          />
          <select value={newMaterial.unit} onChange={e => setNewMaterial(p => ({ ...p, unit: e.target.value as RawMaterialRow['unit'] }))}
            className="border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-orange-400 bg-white">
            <option value="gram">per kg</option>
            <option value="kg">per kg (kg)</option>
            <option value="piece">per piece</option>
          </select>
          <button onClick={addMaterial} className="bg-blue-500 text-white px-4 py-2 rounded-xl text-sm font-semibold">Add</button>
          <button onClick={() => setShowAddMaterial(false)} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* ── Spreadsheet ── */}
      {sheet.materials.length === 0 && sheet.batches.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-gray-400 gap-3 p-8">
          <p className="text-4xl">📋</p>
          <p className="font-medium text-gray-600">No data yet</p>
          <p className="text-sm text-center">Start by clicking <strong>Add Material</strong> to add raw material rows, then <strong>Add Batch</strong> to add batch columns.</p>
        </div>
      ) : (
        <div ref={tableRef} className="flex-1 overflow-auto">
          <table className="border-collapse text-sm min-w-full">
            <thead>
              <tr className="bg-gray-50">
                {/* Frozen header: Material name */}
                <th className="sticky left-0 z-20 bg-gray-100 border border-gray-200 px-3 py-2.5 text-left font-semibold text-gray-700 min-w-[180px] whitespace-nowrap">
                  Raw Material
                </th>
                <th className="sticky left-[180px] z-20 bg-gray-100 border border-gray-200 px-3 py-2.5 text-left font-semibold text-gray-500 text-xs min-w-[60px] whitespace-nowrap">
                  Unit
                </th>
                {sheet.batches.map((batch, bIdx) => (
                  <th key={batch.id} className="border border-gray-200 px-3 py-2.5 text-center bg-gray-50 min-w-[110px]">
                    <div className="flex items-center justify-between gap-1">
                      <div className="text-left">
                        <p className="font-semibold text-gray-700 text-xs">{batch.batchNumber}</p>
                        <p className="text-gray-400 text-xs font-normal">
                          {new Date(batch.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' })}
                        </p>
                      </div>
                      {bIdx === sheet.batches.length - 1 && (
                        <button onClick={() => removeBatch(batch.id)} className="text-gray-300 hover:text-red-400 ml-1">
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredMaterials.map(mat => (
                <tr key={mat.id} className="hover:bg-orange-50/30 group">
                  {/* Frozen material name */}
                  <td className="sticky left-0 z-10 bg-white border border-gray-200 px-3 py-2 min-w-[180px]">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-gray-800 text-sm">{mat.nameEn}</p>
                        {mat.nameKn && <p className="text-xs text-gray-400">{mat.nameKn}</p>}
                      </div>
                      <button onClick={() => removeMaterial(mat.id)}
                        className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 transition-opacity ml-1">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  </td>
                  {/* Unit label */}
                  <td className="sticky left-[180px] z-10 bg-white border border-gray-200 px-3 py-2 text-xs text-gray-400 min-w-[60px] whitespace-nowrap">
                    {mat.unit === 'piece' ? '/pc' : '/kg'}
                  </td>
                  {/* Cost cells */}
                  {sheet.batches.map((batch, bIdx) => {
                    const key = `${mat.id}__${batch.id}`;
                    const val = sheet.cells[key];
                    const delta = getDelta(mat.id, bIdx);
                    const isEditing = editingCell === key;

                    return (
                      <td key={batch.id}
                        className={`border border-gray-200 px-1 py-1 text-center min-w-[110px] cursor-pointer
                          ${delta === 'up' ? 'bg-red-50' : delta === 'down' ? 'bg-green-50' : ''}`}
                        onClick={() => !isEditing && startEdit(mat.id, batch.id)}>
                        {isEditing ? (
                          <input
                            ref={cellInputRef}
                            type="number" step="0.01" min="0"
                            value={cellDraft}
                            onChange={e => setCellDraft(e.target.value)}
                            onBlur={commitEdit}
                            onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Tab') commitEdit(); if (e.key === 'Escape') setEditingCell(null); }}
                            className="w-full text-center border border-orange-400 rounded px-1 py-0.5 text-sm outline-none"
                          />
                        ) : (
                          <div className="flex items-center justify-center gap-1">
                            {val != null && val > 0 ? (
                              <>
                                <span className="font-medium text-gray-800">₹{val.toLocaleString('en-IN')}</span>
                                {delta === 'up' && <TrendingUp className="w-3 h-3 text-red-500" />}
                                {delta === 'down' && <TrendingDown className="w-3 h-3 text-green-600" />}
                                {delta === 'same' && <FlatIcon className="w-3 h-3 text-gray-400" />}
                              </>
                            ) : (
                              <span className="text-gray-300 text-xs">tap to enter</span>
                            )}
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {filteredMaterials.length === 0 && (
                <tr>
                  <td colSpan={2 + sheet.batches.length} className="text-center text-gray-400 py-8 text-sm">
                    No materials match your search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Legend */}
      <div className="flex-shrink-0 px-4 py-2 border-t border-gray-100 flex items-center gap-4 text-xs text-gray-500 bg-white flex-wrap">
        <span className="flex items-center gap-1"><TrendingDown className="w-3.5 h-3.5 text-green-600" /> Cost decreased (green)</span>
        <span className="flex items-center gap-1"><TrendingUp className="w-3.5 h-3.5 text-red-500" /> Cost increased (red)</span>
        <span className="flex items-center gap-1"><FlatIcon className="w-3.5 h-3.5 text-gray-400" /> No change</span>
        <span className="ml-auto text-gray-300">Click any cell to edit · Costs in ₹/kg or ₹/piece</span>
      </div>
    </div>
  );
}

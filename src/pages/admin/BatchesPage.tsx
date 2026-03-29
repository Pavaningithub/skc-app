import { useState, useMemo } from 'react';
import { Plus, Trash2, ChevronDown, ChevronUp, Pencil, PackagePlus } from 'lucide-react';
import toast from 'react-hot-toast';
import Portal from '../../components/Portal';
import { batchesService, rawMaterialsService, productsService, expensesService, stockService } from '../../lib/services';
import { useRealtimeCollection } from '../../lib/useRealtimeCollection';
import { generateBatchNumber, formatCurrency, formatDate } from '../../lib/utils';
import type { Batch, RawMaterial, Product } from '../../lib/types';

const EMPTY_BATCH_FORM = {
  productId: '',
  date: new Date().toISOString().slice(0, 10),
  quantityProduced: 0,
  ingredients: [] as { rawMaterialId: string; quantityUsed: number }[],
  otherExpenses: [] as { label: string; amount: number }[],
  notes: '',
};

export default function BatchesPage() {
  const [batches, batchLoading] = useRealtimeCollection<Batch>(batchesService.subscribe.bind(batchesService));
  const [rawMaterials, rmLoading] = useRealtimeCollection<RawMaterial>(rawMaterialsService.subscribe.bind(rawMaterialsService));
  const [products, prodLoading] = useRealtimeCollection<Product>(productsService.subscribe.bind(productsService));
  const loading = batchLoading || rmLoading || prodLoading;

  const [showForm, setShowForm]     = useState(false);
  const [showRMForm, setShowRMForm] = useState(false);
  const [expanded, setExpanded]     = useState<string | null>(null);
  const [saving, setSaving]         = useState(false);

  // Batch form — used for both add and edit
  const [editingBatchId, setEditingBatchId] = useState<string | null>(null);
  const [batchForm, setBatchForm] = useState(EMPTY_BATCH_FORM);

  // Raw material form — used for both add and edit
  const [editingRMId, setEditingRMId] = useState<string | null>(null);
  const [rmForm, setRmForm] = useState({
    name: '', unit: 'gram' as 'gram' | 'kg' | 'piece',
    currentStock: 0, costPerUnit: 0, lowStockThreshold: 500,
  });

  // Group batches by month
  const batchesByMonth = useMemo(() => {
    const groups: Record<string, Batch[]> = {};
    for (const b of batches) {
      const key = b.date.slice(0, 7); // "YYYY-MM"
      if (!groups[key]) groups[key] = [];
      groups[key].push(b);
    }
    return Object.entries(groups).sort((a, b) => b[0].localeCompare(a[0]));
  }, [batches]);

  function openAddBatch() {
    setEditingBatchId(null);
    setBatchForm({ ...EMPTY_BATCH_FORM, productId: products[0]?.id ?? '' });
    setShowForm(true);
  }

  function openEditBatch(batch: Batch) {
    setEditingBatchId(batch.id);
    setBatchForm({
      productId: batch.productId,
      date: batch.date.slice(0, 10),
      quantityProduced: batch.quantityProduced,
      ingredients: batch.ingredientsUsed.map(i => ({ rawMaterialId: i.rawMaterialId, quantityUsed: i.quantityUsed })),
      otherExpenses: batch.otherExpenses ?? [],
      notes: batch.notes ?? '',
    });
    setShowForm(true);
  }

  async function handleSaveBatch() {
    const product = products.find(p => p.id === batchForm.productId);
    if (!product) return toast.error('Select a product');
    if (batchForm.quantityProduced <= 0) return toast.error('Quantity produced required');
    setSaving(true);
    try {
      const ingredients = batchForm.ingredients.map(i => {
        const rm = rawMaterials.find(r => r.id === i.rawMaterialId)!;
        return {
          rawMaterialId: i.rawMaterialId,
          rawMaterialName: rm?.name || '',
          quantityUsed: Number(i.quantityUsed),
          costPerGram: rm?.costPerUnit || 0,
        };
      });
      const ingredientCost = ingredients.reduce((s, i) => s + i.quantityUsed * i.costPerGram, 0);
      const otherCost = batchForm.otherExpenses.reduce((s, e) => s + e.amount, 0);
      const totalCost = ingredientCost + otherCost;
      const qty = Number(batchForm.quantityProduced);

      const batchData: Omit<Batch, 'id'> = {
        batchNumber: editingBatchId
          ? (batches.find(b => b.id === editingBatchId)?.batchNumber ?? generateBatchNumber())
          : generateBatchNumber(),
        productId: batchForm.productId,
        productName: product.name,
        date: new Date(batchForm.date).toISOString(),
        ingredientsUsed: ingredients,
        otherExpenses: batchForm.otherExpenses,
        quantityProduced: qty,
        totalCost,
        costPerGram: qty > 0 ? totalCost / qty : 0,
        notes: batchForm.notes,
        createdAt: editingBatchId
          ? (batches.find(b => b.id === editingBatchId)?.createdAt ?? new Date().toISOString())
          : new Date().toISOString(),
      };

      if (editingBatchId) {
        await batchesService.update(editingBatchId, batchData);
        toast.success('Batch updated');
      } else {
        await batchesService.add(batchData);
        // Auto-add produced qty to stock
        await stockService.deduct(batchForm.productId, -qty, { productName: product.name, unit: product.unit });
        toast.success(`Batch recorded · ${qty}g added to stock ✅`);
        // Log other expenses
        for (const e of batchForm.otherExpenses) {
          if (e.amount > 0) {
            await expensesService.add({
              category: 'other',
              description: `[Batch] ${e.label}`,
              amount: e.amount,
              date: new Date(batchForm.date).toISOString(),
              createdAt: new Date().toISOString(),
            });
          }
        }
      }
      setShowForm(false);
    } finally { setSaving(false); }
  }

  async function handleDeleteBatch(id: string) {
    if (!confirm('Delete this batch? This will NOT reverse stock changes.')) return;
    await batchesService.delete(id);
    toast.success('Batch deleted');
  }

  function openAddRM() {
    setEditingRMId(null);
    setRmForm({ name: '', unit: 'gram', currentStock: 0, costPerUnit: 0, lowStockThreshold: 500 });
    setShowRMForm(true);
  }

  function openEditRM(rm: RawMaterial) {
    setEditingRMId(rm.id);
    setRmForm({ name: rm.name, unit: rm.unit as any, currentStock: rm.currentStock, costPerUnit: rm.costPerUnit, lowStockThreshold: rm.lowStockThreshold });
    setShowRMForm(true);
  }

  async function handleSaveRM() {
    if (!rmForm.name.trim()) return toast.error('Name required');
    setSaving(true);
    try {
      if (editingRMId) {
        await rawMaterialsService.update(editingRMId, { ...rmForm, updatedAt: new Date().toISOString() });
        toast.success('Raw material updated');
      } else {
        await rawMaterialsService.add({ ...rmForm, updatedAt: new Date().toISOString() });
        toast.success('Raw material added');
      }
      setShowRMForm(false);
    } finally { setSaving(false); }
  }

  async function handleDeleteRM(id: string) {
    if (!confirm('Delete this raw material?')) return;
    await rawMaterialsService.delete(id);
    toast.success('Deleted');
  }

  function addIngredient() {
    if (!rawMaterials.length) return toast.error('Add raw materials first');
    setBatchForm(f => ({ ...f, ingredients: [...f.ingredients, { rawMaterialId: rawMaterials[0].id, quantityUsed: 0 }] }));
  }

  function addOtherExpense() {
    setBatchForm(f => ({ ...f, otherExpenses: [...f.otherExpenses, { label: '', amount: 0 }] }));
  }

  // ── Computed totals for current batch form ────────────────────────────────
  const formIngredientCost = batchForm.ingredients.reduce((s, i) => {
    const rm = rawMaterials.find(r => r.id === i.rawMaterialId);
    return s + (Number(i.quantityUsed) * (rm?.costPerUnit ?? 0));
  }, 0);
  const formOtherCost  = batchForm.otherExpenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const formTotalCost  = formIngredientCost + formOtherCost;
  const formQty        = Number(batchForm.quantityProduced) || 0;
  const formCostPerGram = formQty > 0 ? formTotalCost / formQty : 0;

  return (
    <div className="p-4 md:p-6 space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Production Batches</h1>
          <p className="text-sm text-gray-500">{batches.length} batches recorded</p>
        </div>
        <div className="flex gap-2">
          <button onClick={openAddRM}
            className="border border-orange-200 text-orange-600 px-3 py-2 rounded-xl text-sm font-medium hover:bg-orange-50">
            + Raw Material
          </button>
          <button onClick={openAddBatch}
            className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-xl text-sm font-semibold">
            <Plus className="w-4 h-4" /> New Batch
          </button>
        </div>
      </div>

      {/* Raw Materials list */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <h2 className="font-semibold text-gray-700 mb-3 text-sm">Raw Materials</h2>
        {rawMaterials.length === 0 ? (
          <p className="text-sm text-gray-400">No raw materials added yet</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {rawMaterials.map(rm => (
              <div key={rm.id} className="bg-orange-50 rounded-lg p-2.5 flex items-start justify-between gap-1">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{rm.name}</p>
                  <p className="text-xs text-orange-600">{rm.currentStock}{rm.unit === 'piece' ? ' pcs' : 'g'} · ₹{rm.costPerUnit}/{rm.unit}</p>
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  <button onClick={() => openEditRM(rm)} className="p-1 hover:bg-orange-100 rounded">
                    <Pencil className="w-3 h-3 text-orange-400" />
                  </button>
                  <button onClick={() => handleDeleteRM(rm.id)} className="p-1 hover:bg-red-50 rounded">
                    <Trash2 className="w-3 h-3 text-red-400" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Batches grouped by month */}
      {loading ? (
        <div className="flex justify-center py-8">
          <div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : batches.length === 0 ? (
        <div className="text-center py-10 text-gray-400">No batches recorded yet</div>
      ) : (
        <div className="space-y-6">
          {batchesByMonth.map(([monthKey, monthBatches]) => {
            const [year, month] = monthKey.split('-');
            const label = new Date(Number(year), Number(month) - 1).toLocaleString('default', { month: 'long', year: 'numeric' });
            const monthTotal = monthBatches.reduce((s, b) => s + b.totalCost, 0);
            const monthQty   = monthBatches.reduce((s, b) => s + b.quantityProduced, 0);
            return (
              <div key={monthKey}>
                {/* Month header */}
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-bold text-gray-600 uppercase tracking-wide">{label}</h3>
                  <span className="text-xs text-gray-500">{monthBatches.length} batches · {monthQty}g · {formatCurrency(monthTotal)}</span>
                </div>
                {/* Table */}
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  {/* Table header */}
                  <div className="hidden sm:grid grid-cols-[1fr_120px_100px_100px_80px_80px] gap-2 px-4 py-2 bg-gray-50 border-b border-gray-100 text-xs font-semibold text-gray-500 uppercase">
                    <span>Batch / Product</span>
                    <span>Date</span>
                    <span className="text-right">Qty</span>
                    <span className="text-right">Total Cost</span>
                    <span className="text-right">₹/g</span>
                    <span className="text-right">Actions</span>
                  </div>
                  {monthBatches.map((batch, idx) => (
                    <div key={batch.id} className={idx > 0 ? 'border-t border-gray-100' : ''}>
                      {/* Row */}
                      <div className="grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_120px_100px_100px_80px_80px] gap-2 px-4 py-3 hover:bg-gray-50 items-center">
                        <div>
                          <p className="font-semibold text-gray-800 text-sm">{batch.productName}</p>
                          <p className="text-xs text-gray-400">{batch.batchNumber}</p>
                        </div>
                        <span className="text-sm text-gray-600 hidden sm:block">{formatDate(batch.date)}</span>
                        <span className="text-sm text-gray-700 text-right hidden sm:block font-medium">{batch.quantityProduced}g</span>
                        <span className="text-sm text-orange-600 text-right hidden sm:block font-semibold">{formatCurrency(batch.totalCost)}</span>
                        <span className="text-xs text-gray-500 text-right hidden sm:block">₹{batch.costPerGram.toFixed(3)}</span>
                        <div className="flex gap-1 justify-end">
                          <button onClick={() => setExpanded(expanded === batch.id ? null : batch.id)}
                            className="p-1.5 hover:bg-gray-100 rounded-lg" title="View details">
                            {expanded === batch.id ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                          </button>
                          <button onClick={() => openEditBatch(batch)}
                            className="p-1.5 hover:bg-blue-50 rounded-lg" title="Edit">
                            <Pencil className="w-4 h-4 text-blue-400" />
                          </button>
                          <button onClick={() => handleDeleteBatch(batch.id)}
                            className="p-1.5 hover:bg-red-50 rounded-lg" title="Delete">
                            <Trash2 className="w-4 h-4 text-red-400" />
                          </button>
                        </div>
                      </div>
                      {/* Mobile summary row */}
                      <div className="sm:hidden flex justify-between px-4 pb-2 text-xs text-gray-500">
                        <span>{formatDate(batch.date)}</span>
                        <span>{batch.quantityProduced}g</span>
                        <span className="text-orange-600 font-semibold">{formatCurrency(batch.totalCost)}</span>
                        <span>₹{batch.costPerGram.toFixed(3)}/g</span>
                      </div>
                      {/* Expanded details */}
                      {expanded === batch.id && (
                        <div className="border-t border-gray-100 bg-gray-50 px-4 py-3 space-y-1.5">
                          {batch.ingredientsUsed.length > 0 && (
                            <>
                              <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Ingredients</p>
                              {batch.ingredientsUsed.map((ing, i) => (
                                <div key={i} className="flex justify-between text-sm">
                                  <span className="text-gray-700">{ing.rawMaterialName}</span>
                                  <span className="text-gray-500">{ing.quantityUsed}g · {formatCurrency(ing.quantityUsed * ing.costPerGram)}</span>
                                </div>
                              ))}
                            </>
                          )}
                          {(batch.otherExpenses ?? []).map((e, i) => (
                            <div key={i} className="flex justify-between text-sm">
                              <span className="text-gray-700">{e.label}</span>
                              <span className="text-gray-500">{formatCurrency(e.amount)}</span>
                            </div>
                          ))}
                          <div className="border-t border-gray-200 pt-1.5 flex justify-between font-semibold text-sm">
                            <span>Total Cost</span>
                            <span className="text-orange-600">{formatCurrency(batch.totalCost)}</span>
                          </div>
                          {batch.notes && <p className="text-xs text-gray-400 italic">Note: {batch.notes}</p>}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Batch Form Modal ─────────────────────────────────────────────── */}
      {showForm && (
        <Portal>
          <div className="fixed inset-0 bg-black/50 z-50 flex items-end justify-center sm:items-center sm:p-4">
            <div className="bg-white rounded-t-3xl sm:rounded-2xl w-full max-w-xl flex flex-col" style={{ maxHeight: '92dvh' }}>
              <div className="border-b border-gray-100 px-5 py-4 flex items-center justify-between flex-shrink-0">
                <h2 className="font-bold text-gray-800">{editingBatchId ? 'Edit Batch' : 'Record Production Batch'}</h2>
                <button onClick={() => setShowForm(false)} className="text-gray-400 text-xl">×</button>
              </div>
              <div className="overflow-y-auto flex-1 p-5 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Product</label>
                    <select value={batchForm.productId}
                      onChange={e => setBatchForm(f => ({ ...f, productId: e.target.value }))}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-orange-400 bg-white">
                      <option value="">— Select —</option>
                      {products.filter(p => p.isActive).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                    <input type="date" value={batchForm.date}
                      onChange={e => setBatchForm(f => ({ ...f, date: e.target.value }))}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-orange-400" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Quantity Produced (grams)</label>
                  <input type="number" min="0" value={batchForm.quantityProduced || ''}
                    onChange={e => setBatchForm(f => ({ ...f, quantityProduced: parseFloat(e.target.value) || 0 }))}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-orange-400" />
                </div>

                {/* Ingredients */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-medium text-gray-700">Ingredients Used</label>
                    <button onClick={addIngredient}
                      className="text-xs text-orange-500 border border-orange-200 px-2 py-1 rounded-lg hover:bg-orange-50">+ Add</button>
                  </div>
                  {batchForm.ingredients.map((ing, i) => (
                    <div key={i} className="flex gap-2 mb-2">
                      <select value={ing.rawMaterialId}
                        onChange={e => {
                          const u = [...batchForm.ingredients]; u[i].rawMaterialId = e.target.value;
                          setBatchForm(f => ({ ...f, ingredients: u }));
                        }}
                        className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-orange-400 bg-white">
                        {rawMaterials.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                      </select>
                      <input type="number" min="0" placeholder="grams" value={ing.quantityUsed || ''}
                        onChange={e => {
                          const u = [...batchForm.ingredients]; u[i].quantityUsed = parseFloat(e.target.value) || 0;
                          setBatchForm(f => ({ ...f, ingredients: u }));
                        }}
                        className="w-24 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-orange-400" />
                      <button onClick={() => setBatchForm(f => ({ ...f, ingredients: f.ingredients.filter((_, j) => j !== i) }))}
                        className="p-2 hover:bg-red-50 rounded-lg"><Trash2 className="w-4 h-4 text-red-400" /></button>
                    </div>
                  ))}
                </div>

                {/* Other Expenses */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-medium text-gray-700">Other Expenses</label>
                    <button onClick={addOtherExpense}
                      className="text-xs text-orange-500 border border-orange-200 px-2 py-1 rounded-lg hover:bg-orange-50">+ Add</button>
                  </div>
                  {batchForm.otherExpenses.map((exp, i) => (
                    <div key={i} className="flex gap-2 mb-2">
                      <input type="text" placeholder="Label (e.g. Gas)" value={exp.label}
                        onChange={e => {
                          const u = [...batchForm.otherExpenses]; u[i].label = e.target.value;
                          setBatchForm(f => ({ ...f, otherExpenses: u }));
                        }}
                        className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-orange-400" />
                      <input type="number" min="0" placeholder="₹" value={exp.amount || ''}
                        onChange={e => {
                          const u = [...batchForm.otherExpenses]; u[i].amount = parseFloat(e.target.value) || 0;
                          setBatchForm(f => ({ ...f, otherExpenses: u }));
                        }}
                        className="w-24 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-orange-400" />
                      <button onClick={() => setBatchForm(f => ({ ...f, otherExpenses: f.otherExpenses.filter((_, j) => j !== i) }))}
                        className="p-2 hover:bg-red-50 rounded-lg"><Trash2 className="w-4 h-4 text-red-400" /></button>
                    </div>
                  ))}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                  <textarea value={batchForm.notes} onChange={e => setBatchForm(f => ({ ...f, notes: e.target.value }))}
                    rows={2} className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-orange-400 resize-none" />
                </div>

                {/* Live cost summary */}
                {(formIngredientCost > 0 || formOtherCost > 0) && (
                  <div className="bg-orange-50 rounded-xl p-3 space-y-1 text-sm">
                    <div className="flex justify-between text-gray-600"><span>Ingredient cost</span><span>{formatCurrency(formIngredientCost)}</span></div>
                    <div className="flex justify-between text-gray-600"><span>Other expenses</span><span>{formatCurrency(formOtherCost)}</span></div>
                    <div className="flex justify-between font-bold text-orange-700 border-t border-orange-200 pt-1"><span>Total cost</span><span>{formatCurrency(formTotalCost)}</span></div>
                    {formQty > 0 && <div className="flex justify-between text-xs text-gray-500"><span>Cost per gram</span><span>₹{formCostPerGram.toFixed(4)}/g</span></div>}
                  </div>
                )}
              </div>
              <div className="border-t border-gray-100 p-5 flex gap-3 flex-shrink-0">
                <button onClick={() => setShowForm(false)}
                  className="flex-1 border border-gray-200 text-gray-600 py-3 rounded-xl text-sm">Cancel</button>
                <button onClick={handleSaveBatch} disabled={saving}
                  className="flex-1 bg-orange-500 hover:bg-orange-600 text-white py-3 rounded-xl text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2">
                  {saving ? 'Saving…' : editingBatchId ? 'Save Changes' : <><PackagePlus className="w-4 h-4" /> Record & Add to Stock</>}
                </button>
              </div>
            </div>
          </div>
        </Portal>
      )}

      {/* ── Raw Material Form Modal ──────────────────────────────────────── */}
      {showRMForm && (
        <Portal>
          <div className="fixed inset-0 bg-black/50 z-50 flex items-end justify-center sm:items-center sm:p-4">
            <div className="bg-white rounded-t-3xl sm:rounded-2xl w-full max-w-md flex flex-col" style={{ maxHeight: '92dvh' }}>
              <div className="flex-shrink-0 border-b border-gray-100 px-5 py-4 flex items-center justify-between">
                <h2 className="font-bold text-gray-800">{editingRMId ? 'Edit Raw Material' : 'Add Raw Material'}</h2>
                <button onClick={() => setShowRMForm(false)} className="text-gray-400 text-xl">×</button>
              </div>
              <div className="overflow-y-auto flex-1 p-5 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                  <input type="text" value={rmForm.name} onChange={e => setRmForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. Peanuts, Dry Red Chilli"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-orange-400" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Unit</label>
                    <select value={rmForm.unit} onChange={e => setRmForm(f => ({ ...f, unit: e.target.value as any }))}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-orange-400 bg-white">
                      <option value="gram">Gram</option>
                      <option value="kg">Kilogram</option>
                      <option value="piece">Piece</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Cost per unit (₹)</label>
                    <input type="number" min="0" step="0.01" value={rmForm.costPerUnit || ''}
                      onChange={e => setRmForm(f => ({ ...f, costPerUnit: parseFloat(e.target.value) || 0 }))}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-orange-400" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Current Stock</label>
                    <input type="number" min="0" value={rmForm.currentStock || ''}
                      onChange={e => setRmForm(f => ({ ...f, currentStock: parseFloat(e.target.value) || 0 }))}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-orange-400" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Low Stock Alert</label>
                    <input type="number" min="0" value={rmForm.lowStockThreshold || ''}
                      onChange={e => setRmForm(f => ({ ...f, lowStockThreshold: parseFloat(e.target.value) || 0 }))}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-orange-400" />
                  </div>
                </div>
              </div>
              <div className="flex-shrink-0 px-5 py-4 border-t border-gray-100 flex gap-3">
                <button onClick={() => setShowRMForm(false)}
                  className="flex-1 border border-gray-200 text-gray-600 py-2.5 rounded-xl text-sm">Cancel</button>
                <button onClick={handleSaveRM} disabled={saving}
                  className="flex-1 bg-orange-500 hover:bg-orange-600 text-white py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50">
                  {saving ? 'Saving…' : editingRMId ? 'Save Changes' : 'Add'}
                </button>
              </div>
            </div>
          </div>
        </Portal>
      )}
    </div>
  );
}

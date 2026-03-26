import { useState } from 'react';
import { Plus, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import toast from 'react-hot-toast';
import Portal from '../../components/Portal';
import { batchesService, rawMaterialsService, productsService, expensesService } from '../../lib/services';
import { useRealtimeCollection } from '../../lib/useRealtimeCollection';
import { generateBatchNumber, formatCurrency, formatDate } from '../../lib/utils';
import type { Batch, RawMaterial, Product } from '../../lib/types';

export default function BatchesPage() {
  const [batches, batchLoading] = useRealtimeCollection<Batch>(batchesService.subscribe.bind(batchesService));
  const [rawMaterials, rmLoading] = useRealtimeCollection<RawMaterial>(rawMaterialsService.subscribe.bind(rawMaterialsService));
  const [products, prodLoading] = useRealtimeCollection<Product>(productsService.subscribe.bind(productsService));
  const loading = batchLoading || rmLoading || prodLoading;
  const [showForm, setShowForm] = useState(false);
  const [showRMForm, setShowRMForm] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [batchForm, setBatchForm] = useState({
    productId: '',
    date: new Date().toISOString().slice(0, 10),
    quantityProduced: 0,
    ingredients: [] as { rawMaterialId: string; quantityUsed: number }[],
    otherExpenses: [] as { label: string; amount: number }[],
    notes: '',
  });

  const [rmForm, setRmForm] = useState({
    name: '', unit: 'gram' as 'gram' | 'kg' | 'piece',
    currentStock: 0, costPerUnit: 0, lowStockThreshold: 500,
  });

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

      const batch: Omit<Batch, 'id'> = {
        batchNumber: generateBatchNumber(),
        productId: batchForm.productId,
        productName: product.name,
        date: new Date(batchForm.date).toISOString(),
        ingredientsUsed: ingredients,
        otherExpenses: batchForm.otherExpenses,
        quantityProduced: qty,
        totalCost,
        costPerGram: qty > 0 ? totalCost / qty : 0,
        notes: batchForm.notes,
        createdAt: new Date().toISOString(),
      };

      await batchesService.add(batch);

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

      toast.success('Batch recorded');
      setShowForm(false);
    } finally { setSaving(false); }
  }

  async function handleSaveRM() {
    if (!rmForm.name.trim()) return toast.error('Name required');
    setSaving(true);
    try {
      await rawMaterialsService.add({ ...rmForm, updatedAt: new Date().toISOString() });
      toast.success('Raw material added');
      setShowRMForm(false);
      setRmForm({ name: '', unit: 'gram', currentStock: 0, costPerUnit: 0, lowStockThreshold: 500 });
    } finally { setSaving(false); }
  }

  function addIngredient() {
    if (!rawMaterials.length) return toast.error('Add raw materials first');
    setBatchForm(f => ({
      ...f,
      ingredients: [...f.ingredients, { rawMaterialId: rawMaterials[0].id, quantityUsed: 0 }],
    }));
  }

  function addOtherExpense() {
    setBatchForm(f => ({
      ...f,
      otherExpenses: [...f.otherExpenses, { label: '', amount: 0 }],
    }));
  }

  return (
    <div className="p-4 md:p-6 space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 font-display">Production Batches</h1>
          <p className="text-sm text-gray-500">{batches.length} batches recorded</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowRMForm(true)}
            className="border border-orange-200 text-orange-600 px-3 py-2 rounded-xl text-sm font-medium hover:bg-orange-50">
            + Raw Material
          </button>
          <button onClick={() => setShowForm(true)}
            className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-colors">
            <Plus className="w-4 h-4" /> New Batch
          </button>
        </div>
      </div>

      {/* Raw Materials List */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <h2 className="font-semibold text-gray-700 mb-3 text-sm">Raw Materials in Stock</h2>
        {rawMaterials.length === 0 ? (
          <p className="text-sm text-gray-400">No raw materials added yet</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {rawMaterials.map(rm => (
              <div key={rm.id} className="bg-orange-50 rounded-lg p-2.5">
                <p className="text-sm font-medium text-gray-800">{rm.name}</p>
                <p className="text-xs text-orange-600">{rm.currentStock}{rm.unit === 'piece' ? ' pcs' : 'g'} · ₹{rm.costPerUnit}/{rm.unit}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Batches */}
      {loading ? (
        <div className="flex justify-center py-8">
          <div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="space-y-2">
          {batches.length === 0 && (
            <div className="text-center py-10 text-gray-400">No batches recorded yet</div>
          )}
          {batches.map(batch => (
            <div key={batch.id} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <button
                onClick={() => setExpanded(expanded === batch.id ? null : batch.id)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors">
                <div className="text-left">
                  <p className="font-semibold text-gray-800">{batch.batchNumber}</p>
                  <p className="text-xs text-gray-500">{batch.productName} · {formatDate(batch.date)}</p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <p className="text-sm font-bold text-gray-800">{batch.quantityProduced}g produced</p>
                    <p className="text-xs text-orange-600">Cost: {formatCurrency(batch.totalCost)}</p>
                  </div>
                  {expanded === batch.id ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                </div>
              </button>
              {expanded === batch.id && (
                <div className="border-t border-gray-100 px-4 py-3 bg-gray-50 space-y-2">
                  <p className="text-xs font-semibold text-gray-500 uppercase">Ingredients Used</p>
                  {batch.ingredientsUsed.map((ing, i) => (
                    <div key={i} className="flex justify-between text-sm">
                      <span className="text-gray-700">{ing.rawMaterialName}</span>
                      <span className="text-gray-600">{ing.quantityUsed}g · ₹{(ing.quantityUsed * ing.costPerGram).toFixed(2)}</span>
                    </div>
                  ))}
                  {batch.otherExpenses.map((e, i) => (
                    <div key={i} className="flex justify-between text-sm">
                      <span className="text-gray-700">{e.label}</span>
                      <span className="text-gray-600">{formatCurrency(e.amount)}</span>
                    </div>
                  ))}
                  <div className="border-t border-gray-200 pt-2 flex justify-between font-semibold text-sm">
                    <span>Total Cost</span><span className="text-orange-600">{formatCurrency(batch.totalCost)}</span>
                  </div>
                  <p className="text-xs text-gray-500">Cost per gram: ₹{batch.costPerGram.toFixed(4)}</p>
                  {batch.notes && <p className="text-xs text-gray-500">Note: {batch.notes}</p>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* New Batch Modal */}
      {showForm && (
        <Portal>
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end justify-center sm:items-center sm:p-4">
          <div className="bg-white rounded-t-3xl sm:rounded-2xl w-full max-w-xl flex flex-col" style={{ maxHeight: '92dvh' }}>
            <div className="border-b border-gray-100 px-5 py-4 flex items-center justify-between flex-shrink-0">
              <h2 className="font-bold text-gray-800">Record Production Batch</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 text-xl">×</button>
            </div>
            <div className="overflow-y-auto flex-1 p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Product</label>
                  <select value={batchForm.productId}
                    onChange={e => setBatchForm(f => ({ ...f, productId: e.target.value }))}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-orange-400 bg-white">
                    {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Production Date</label>
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
                    className="text-xs text-orange-500 border border-orange-200 px-2 py-1 rounded-lg hover:bg-orange-50">
                    + Add
                  </button>
                </div>
                {batchForm.ingredients.map((ing, i) => (
                  <div key={i} className="flex gap-2 mb-2">
                    <select value={ing.rawMaterialId}
                      onChange={e => {
                        const updated = [...batchForm.ingredients];
                        updated[i].rawMaterialId = e.target.value;
                        setBatchForm(f => ({ ...f, ingredients: updated }));
                      }}
                      className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-orange-400 bg-white">
                      {rawMaterials.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                    <input type="number" min="0" placeholder="grams" value={ing.quantityUsed || ''}
                      onChange={e => {
                        const updated = [...batchForm.ingredients];
                        updated[i].quantityUsed = parseFloat(e.target.value) || 0;
                        setBatchForm(f => ({ ...f, ingredients: updated }));
                      }}
                      className="w-24 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-orange-400" />
                    <button onClick={() => setBatchForm(f => ({ ...f, ingredients: f.ingredients.filter((_, j) => j !== i) }))}
                      className="p-2 hover:bg-red-50 rounded-lg">
                      <Trash2 className="w-4 h-4 text-red-400" />
                    </button>
                  </div>
                ))}
              </div>

              {/* Other Expenses */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-gray-700">Other Batch Expenses</label>
                  <button onClick={addOtherExpense}
                    className="text-xs text-orange-500 border border-orange-200 px-2 py-1 rounded-lg hover:bg-orange-50">
                    + Add
                  </button>
                </div>
                {batchForm.otherExpenses.map((exp, i) => (
                  <div key={i} className="flex gap-2 mb-2">
                    <input type="text" placeholder="Label (e.g. Gas)" value={exp.label}
                      onChange={e => {
                        const updated = [...batchForm.otherExpenses];
                        updated[i].label = e.target.value;
                        setBatchForm(f => ({ ...f, otherExpenses: updated }));
                      }}
                      className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-orange-400" />
                    <input type="number" min="0" placeholder="₹" value={exp.amount || ''}
                      onChange={e => {
                        const updated = [...batchForm.otherExpenses];
                        updated[i].amount = parseFloat(e.target.value) || 0;
                        setBatchForm(f => ({ ...f, otherExpenses: updated }));
                      }}
                      className="w-24 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-orange-400" />
                    <button onClick={() => setBatchForm(f => ({ ...f, otherExpenses: f.otherExpenses.filter((_, j) => j !== i) }))}
                      className="p-2 hover:bg-red-50 rounded-lg">
                      <Trash2 className="w-4 h-4 text-red-400" />
                    </button>
                  </div>
                ))}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea value={batchForm.notes} onChange={e => setBatchForm(f => ({ ...f, notes: e.target.value }))}
                  rows={2} className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-orange-400 resize-none" />
              </div>
            </div>
            <div className="border-t border-gray-100 p-5 flex gap-3 flex-shrink-0">
              <button onClick={() => setShowForm(false)}
                className="flex-1 border border-gray-200 text-gray-600 py-3 rounded-xl text-sm">Cancel</button>
              <button onClick={handleSaveBatch} disabled={saving}
                className="flex-1 bg-orange-500 hover:bg-orange-600 text-white py-3 rounded-xl text-sm font-semibold disabled:opacity-50">
                {saving ? 'Saving…' : 'Record Batch'}
              </button>
            </div>
          </div>
        </div>
        </Portal>
      )}

      {/* Raw Material Modal */}
      {showRMForm && (
        <Portal>
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end justify-center sm:items-center sm:p-4">
          <div className="bg-white rounded-t-3xl sm:rounded-2xl w-full max-w-md flex flex-col" style={{ maxHeight: '92dvh' }}>
            <div className="flex-shrink-0 border-b border-gray-100 px-5 py-4 flex items-center justify-between">
              <h2 className="font-bold text-gray-800">Add Raw Material</h2>
              <button onClick={() => setShowRMForm(false)} className="text-gray-400 text-xl">×</button>
            </div>
            <div className="overflow-y-auto flex-1 p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                <input type="text" value={rmForm.name} onChange={e => setRmForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Coconut, Chilli"
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
                {saving ? 'Saving…' : 'Add'}
              </button>
            </div>
          </div>
        </div>
        </Portal>
      )}
    </div>
  );
}

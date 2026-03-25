import { useEffect, useState } from 'react';
import { Plus, Pencil, AlertTriangle, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import Portal from '../../components/Portal';
import { stockService, productsService } from '../../lib/services';
import type { StockItem, Product } from '../../lib/types';
import type { Unit } from '../../lib/constants';

export default function StockPage() {
  const [stock, setStock] = useState<StockItem[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState<StockItem | null>(null);
  const [form, setForm] = useState({
    productId: '', quantityAvailable: 0, lowStockThreshold: 500,
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const [s, p] = await Promise.all([stockService.getAll(), productsService.getAll()]);
      setStock(s);
      setProducts(p);
    } finally { setLoading(false); }
  }

  function openAdd() {
    setEditItem(null);
    setForm({ productId: products[0]?.id || '', quantityAvailable: 0, lowStockThreshold: 500 });
    setShowForm(true);
  }

  function openEdit(item: StockItem) {
    setEditItem(item);
    setForm({ productId: item.productId, quantityAvailable: item.quantityAvailable, lowStockThreshold: item.lowStockThreshold });
    setShowForm(true);
  }

  async function handleSave() {
    const product = products.find(p => p.id === form.productId);
    if (!product) return toast.error('Select a product');
    setSaving(true);
    try {
      await stockService.upsert({
        id: editItem?.id,
        productId: form.productId,
        productName: product.name,
        unit: product.unit as Unit,
        quantityAvailable: Number(form.quantityAvailable),
        lowStockThreshold: Number(form.lowStockThreshold),
        updatedAt: new Date().toISOString(),
      });
      toast.success('Stock updated');
      setShowForm(false);
      load();
    } finally { setSaving(false); }
  }

  const isLow = (item: StockItem) => item.quantityAvailable <= item.lowStockThreshold;

  const formatQty = (item: StockItem) => {
    if (item.unit === 'piece') return `${item.quantityAvailable} pcs`;
    if (item.quantityAvailable >= 1000) return `${(item.quantityAvailable / 1000).toFixed(2)} kg`;
    return `${item.quantityAvailable} g`;
  };

  return (
    <div className="p-4 md:p-6 space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 font-display">Stock Management</h1>
          <p className="text-sm text-gray-500">{stock.filter(s => isLow(s)).length} low stock alerts</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="p-2.5 border border-gray-200 rounded-xl hover:bg-gray-50">
            <RefreshCw className="w-4 h-4 text-gray-500" />
          </button>
          <button onClick={openAdd}
            className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-colors">
            <Plus className="w-4 h-4" /> Add Stock
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="grid gap-3">
          {stock.length === 0 && (
            <div className="text-center py-12 text-gray-400">
              <p className="text-lg">No stock entries yet</p>
              <p className="text-sm">Add stock for your products</p>
            </div>
          )}
          {stock.map(item => (
            <div key={item.id}
              className={`bg-white rounded-xl border p-4 flex items-center gap-4
                ${isLow(item) ? 'border-red-200 bg-red-50/30' : 'border-gray-200'}`}>
              {isLow(item) && (
                <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-800">{item.productName}</p>
                <p className="text-xs text-gray-500">Low stock alert at: {item.lowStockThreshold}{item.unit === 'piece' ? ' pcs' : 'g'}</p>
              </div>
              <div className="text-right">
                <p className={`text-xl font-bold ${isLow(item) ? 'text-red-600' : 'text-green-600'}`}>
                  {formatQty(item)}
                </p>
                <p className="text-xs text-gray-400">available</p>
              </div>
              <button onClick={() => openEdit(item)} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
                <Pencil className="w-4 h-4 text-blue-500" />
              </button>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <Portal>
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end justify-center sm:items-center sm:p-4">
          <div className="bg-white rounded-t-3xl sm:rounded-2xl w-full max-w-md flex flex-col" style={{ maxHeight: '92dvh' }}>
            <div className="flex-shrink-0 border-b border-gray-100 px-5 py-4 flex items-center justify-between">
              <h2 className="font-bold text-gray-800">{editItem ? 'Update Stock' : 'Add Stock Entry'}</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>
            <div className="overflow-y-auto flex-1 p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Product</label>
                <select
                  value={form.productId} onChange={e => setForm(f => ({ ...f, productId: e.target.value }))}
                  disabled={!!editItem}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-orange-400 bg-white"
                >
                  {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Available Quantity (in grams / pieces)
                </label>
                <input
                  type="number" min="0" value={form.quantityAvailable || ''}
                  onChange={e => setForm(f => ({ ...f, quantityAvailable: parseFloat(e.target.value) || 0 }))}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-orange-400"
                />
                <p className="text-xs text-gray-400 mt-1">Enter in grams (e.g. 1kg = 1000g) or pieces</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Low Stock Alert Threshold (grams / pieces)
                </label>
                <input
                  type="number" min="0" value={form.lowStockThreshold || ''}
                  onChange={e => setForm(f => ({ ...f, lowStockThreshold: parseFloat(e.target.value) || 0 }))}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-orange-400"
                />
              </div>
            </div>
            <div className="flex-shrink-0 px-5 py-4 border-t border-gray-100 flex gap-3">
              <button onClick={() => setShowForm(false)}
                className="flex-1 border border-gray-200 text-gray-600 py-2.5 rounded-xl text-sm font-medium">Cancel</button>
              <button onClick={handleSave} disabled={saving}
                className="flex-1 bg-orange-500 hover:bg-orange-600 text-white py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50">
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
        </Portal>
      )}
    </div>
  );
}

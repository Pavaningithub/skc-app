import { useState, useMemo } from 'react';
import { Plus, Pencil, Trash2, ToggleLeft, ToggleRight, Search, ArrowUpDown, Filter, TrendingUp, AlertTriangle, CheckCircle2, X, ChevronDown, ChevronUp } from 'lucide-react';
import toast from 'react-hot-toast';
import Portal from '../../components/Portal';
import { productsService, ordersService } from '../../lib/services';
import { useRealtimeCollection } from '../../lib/useRealtimeCollection';
import { formatCurrency } from '../../lib/utils';
import { UNIT_LABELS } from '../../lib/constants';
import type { Product, Order } from '../../lib/types';
import type { Unit } from '../../lib/constants';



const CATEGORIES = ['Chutney Powder', 'Masala', 'Health Mix', 'Spices', 'Pickles','Sweets ', 'Other'];

type ProdSort = 'name_asc' | 'price_asc' | 'price_desc' | 'category';
type ActiveFilter = 'all' | 'active' | 'inactive';

const PROD_SORT_LABELS: Record<ProdSort, string> = {
  name_asc:    'Name A–Z',
  price_asc:   'Price low–high',
  price_desc:  'Price high–low',
  category:    'By category',
};

const emptyForm: Omit<Product, 'id' | 'createdAt' | 'updatedAt'> = {
  name: '', nameKannada: '', description: '', unit: 'gram', pricePerUnit: 0,
  minOrderQty: 0, category: 'Other', isActive: true,
  isOnDemand: false, isPopular: false, allowCustomization: false, customizationHint: '', sortOrder: 0,
  hasGarlicOption: false,
};

export default function Products() {
  const [products, loading] = useRealtimeCollection(productsService.subscribe.bind(productsService));
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState<string>('all');
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>('all');
  const [onDemandOnly, setOnDemandOnly] = useState(false);
  const [garlicOnly, setGarlicOnly] = useState(false);
  const [sortKey, setSortKey] = useState<ProdSort>('name_asc');

  function openAdd() { setForm({ ...emptyForm }); setEditId(null); setShowForm(true); }
  function openEdit(p: Product) {
    setForm({
      name: p.name, nameKannada: p.nameKannada || '', description: p.description,
      unit: p.unit, pricePerUnit: p.pricePerUnit, minOrderQty: p.minOrderQty ?? 100,
      category: p.category, isActive: p.isActive, isOnDemand: p.isOnDemand ?? false,
      isPopular: p.isPopular ?? false,
      allowCustomization: p.allowCustomization ?? false,
      customizationHint: p.customizationHint || '', sortOrder: p.sortOrder ?? 0,
      hasGarlicOption: p.hasGarlicOption ?? false,
    });
    setEditId(p.id); setShowForm(true);
  }

  async function handleSave() {
    if (!form.name.trim()) return toast.error('Product name is required');
    if (form.pricePerUnit <= 0) return toast.error('Price must be greater than 0');
    setSaving(true);
    try {
      if (editId) {
        await productsService.update(editId, form);
        toast.success('Product updated');
      } else {
        await productsService.add(form as Omit<Product, 'id'>);
        toast.success('Product added');
      }
      setShowForm(false);
    } finally { setSaving(false); }
  }

  async function toggleActive(p: Product) {
    await productsService.update(p.id, { isActive: !p.isActive });
    toast.success(`${p.name} ${p.isActive ? 'deactivated' : 'activated'}`);
  }

  async function handleDelete(p: Product) {
    if (!confirm(`Delete "${p.name}"? This cannot be undone.`)) return;
    await productsService.delete(p.id);
    toast.success('Product deleted');
  }

  const filtered = useMemo(() => {
    let result = products.filter((p: Product) => {
      const matchSearch = p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.category.toLowerCase().includes(search.toLowerCase());
      const matchCat = catFilter === 'all' || p.category === catFilter;
      const matchActive = activeFilter === 'all' || (activeFilter === 'active' ? p.isActive : !p.isActive);
      const matchDemand = !onDemandOnly || p.isOnDemand;
      const matchGarlic = !garlicOnly || !!p.hasGarlicOption;
      return matchSearch && matchCat && matchActive && matchDemand && matchGarlic;
    });
    result = [...result].sort((a: Product, b: Product) => {
      switch (sortKey) {
        case 'price_asc':  return a.pricePerUnit - b.pricePerUnit;
        case 'price_desc': return b.pricePerUnit - a.pricePerUnit;
        case 'category':   return a.category.localeCompare(b.category) || a.name.localeCompare(b.name);
        default:           return a.name.localeCompare(b.name);
      }
    });
    return result;
  }, [products, search, catFilter, activeFilter, onDemandOnly, garlicOnly, sortKey]);

  const priceLabel = (unit: Unit) => {
    if (unit === 'gram') return '/ gram';
    if (unit === 'kg') return '/ kg';
    return '/ piece';
  };

  return (
    <div className="p-4 md:p-6 space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 font-display">Products</h1>
          <p className="text-sm text-gray-500">{filtered.length !== products.length ? `${filtered.length} of ${products.length}` : `${products.length}`} products</p>
        </div>
        <button onClick={openAdd}
          className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-colors">
          <Plus className="w-4 h-4" /> Add Product
        </button>
      </div>

      {/* Price Insights Panel */}
      <PriceInsightsPanel products={products} />

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text" placeholder="Search products…" value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm outline-none focus:border-orange-400 bg-white"
        />
      </div>

      {/* Filter + Sort row */}
      <div className="flex gap-2 flex-wrap items-center">
        {/* Category filter */}
        <div className="flex items-center gap-1.5">
          <Filter className="w-3.5 h-3.5 text-gray-400" />
          <select value={catFilter} onChange={e => setCatFilter(e.target.value)}
            className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-orange-400 bg-white">
            <option value="all">All categories</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        {/* Active filter */}
        <div className="flex gap-1">
          {(['all', 'active', 'inactive'] as ActiveFilter[]).map(f => (
            <button key={f} onClick={() => setActiveFilter(f)}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors
                ${activeFilter === f ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'}`}>
              {f === 'all' ? 'All' : f === 'active' ? '✅ Active' : '⏸ Inactive'}
            </button>
          ))}
        </div>
        {/* On-demand toggle */}
        <button onClick={() => setOnDemandOnly(v => !v)}
          className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors
            ${onDemandOnly ? 'bg-orange-100 text-orange-700 border-orange-300' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'}`}>
          🔥 On-demand only
        </button>
        {/* Garlic variants toggle */}
        <button onClick={() => setGarlicOnly(v => !v)}
          className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors
            ${garlicOnly ? 'bg-amber-100 text-amber-700 border-amber-300' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'}`}>
          🧄 Garlic variants
        </button>
        {/* Sort */}
        <div className="flex items-center gap-1.5 ml-auto">
          <ArrowUpDown className="w-3.5 h-3.5 text-gray-400" />
          <select value={sortKey} onChange={e => setSortKey(e.target.value as ProdSort)}
            className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-orange-400 bg-white">
            {(Object.entries(PROD_SORT_LABELS) as [ProdSort, string][]).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Product List */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="grid gap-3">
          {filtered.length === 0 && (
            <div className="text-center py-12 text-gray-400">
              <p className="text-lg">No products found</p>
              <p className="text-sm">Add your first product above</p>
            </div>
          )}
          {filtered.map(p => (
            <div key={p.id}
              className={`bg-white rounded-xl border p-4 flex flex-col gap-2 transition-all
                ${p.isActive ? 'border-gray-200' : 'border-gray-100 opacity-60'}`}>
              {/* Top: name + badges + description */}
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-semibold text-gray-800">{p.name}</h3>
                  <span className="text-xs bg-orange-50 text-orange-600 px-2 py-0.5 rounded-full">{p.category}</span>
                  {p.hasGarlicOption && <span className="text-xs bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full">🧄 Garlic variant</span>}
                  {p.isOnDemand && <span className="text-xs bg-orange-50 text-orange-500 px-2 py-0.5 rounded-full">🔥 On-demand</span>}
                  {!p.isActive && <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">Inactive</span>}
                </div>
                {p.description && <p className="text-sm text-gray-500 mt-0.5">{p.description}</p>}
              </div>
              {/* Bottom: price left, actions right */}
              <div className="flex items-center justify-between gap-2 pt-1 border-t border-gray-50">
                <p className="text-sm font-bold text-orange-600">
                  {formatCurrency(p.pricePerUnit)} {priceLabel(p.unit)}
                  <span className="text-xs font-normal text-gray-400 ml-1">({UNIT_LABELS[p.unit]})</span>
                </p>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => toggleActive(p)}
                    className="p-2 rounded-lg hover:bg-gray-100 transition-colors" title={p.isActive ? 'Deactivate' : 'Activate'}>
                    {p.isActive
                      ? <ToggleRight className="w-5 h-5 text-green-500" />
                      : <ToggleLeft className="w-5 h-5 text-gray-400" />
                    }
                  </button>
                  <button onClick={() => openEdit(p)}
                    className="p-2 rounded-lg hover:bg-blue-50 transition-colors">
                    <Pencil className="w-4 h-4 text-blue-500" />
                  </button>
                  <button onClick={() => handleDelete(p)}
                    className="p-2 rounded-lg hover:bg-red-50 transition-colors">
                    <Trash2 className="w-4 h-4 text-red-500" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add / Edit Modal */}
      {showForm && (
        <Portal>
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end justify-center sm:items-center sm:p-4">
          <div className="bg-white rounded-t-3xl sm:rounded-2xl w-full max-w-md max-h-[92vh] flex flex-col" style={{ maxHeight: '92dvh' }}>
            {/* Header */}
            <div className="flex-shrink-0 bg-white border-b border-gray-100 px-5 py-4 flex items-center justify-between rounded-t-3xl sm:rounded-t-2xl">
              <h2 className="font-bold text-gray-800">{editId ? 'Edit Product' : 'Add Product'}</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
            </div>

            {/* Scrollable body */}
            <div className="overflow-y-auto flex-1 p-5 space-y-4">

              {/* Name */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Product Name *</label>
                <input
                  type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Coconut Chutney Powder"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-orange-400"
                />
              </div>

              {/* Kannada name */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name in Kannada <span className="text-gray-400 font-normal">(optional)</span></label>
                <input
                  type="text" value={form.nameKannada || ''} onChange={e => setForm(f => ({ ...f, nameKannada: e.target.value }))}
                  placeholder="ಕನ್ನಡದಲ್ಲಿ ಹೆಸರು"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-orange-400"
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea
                  value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Short description for customers…" rows={2}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-orange-400 resize-none"
                />
              </div>

              {/* Unit + Price */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Unit *</label>
                  <select
                    value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value as Unit }))}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-orange-400 bg-white"
                  >
                    {Object.entries(UNIT_LABELS).map(([val, label]) => (
                      <option key={val} value={val}>{label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Price (₹) per {form.unit} *</label>
                  <input
                    type="number" min="0" step="0.01" value={form.pricePerUnit || ''}
                    onChange={e => setForm(f => ({ ...f, pricePerUnit: parseFloat(e.target.value) || 0 }))}
                    placeholder="0.00"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-orange-400"
                  />
                </div>
              </div>

              {/* Min Order Qty */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Minimum Order Quantity
                  <span className="text-gray-400 font-normal ml-1">
                    ({form.unit === 'piece' ? 'pieces' : form.unit === 'kg' ? 'kg — e.g. 0.25 for 250g' : 'grams'}) — 0 means no minimum
                  </span>
                </label>
                <input
                  type="number" min="0" step={form.unit === 'piece' ? 1 : form.unit === 'kg' ? 0.25 : 50}
                  value={form.minOrderQty || ''}
                  onChange={e => setForm(f => ({ ...f, minOrderQty: parseFloat(e.target.value) || 0 }))}
                  placeholder={form.unit === 'kg' ? '0.25' : '0'}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-orange-400"
                />
                {form.unit === 'kg' && form.minOrderQty > 0 && (
                  <p className="text-xs text-orange-500 mt-1">= {form.minOrderQty < 1 ? `${Math.round(form.minOrderQty * 1000)}g` : `${form.minOrderQty}kg`} minimum order</p>
                )}
              </div>

              {/* Category */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                <select
                  value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-orange-400 bg-white"
                >
                  {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>

              {/* Toggles */}
              <div className="space-y-3 pt-1">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={form.isActive}
                    onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))}
                    className="w-4 h-4 accent-orange-500" />
                  <span className="text-sm text-gray-700">Active <span className="text-gray-400">(visible to customers)</span></span>
                </label>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={form.isOnDemand ?? false}
                    onChange={e => setForm(f => ({ ...f, isOnDemand: e.target.checked }))}
                    className="w-4 h-4 accent-orange-500" />
                  <span className="text-sm text-gray-700">🔥 Made Fresh on Order <span className="text-gray-400">(prepared after order is placed)</span></span>
                </label>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={form.isPopular ?? false}
                    onChange={e => setForm(f => ({ ...f, isPopular: e.target.checked }))}
                    className="w-4 h-4 accent-orange-500" />
                  <span className="text-sm text-gray-700">⭐ Popular at SKC <span className="text-gray-400">(shows first in Popular sort)</span></span>
                </label>
              </div>

              {/* Garlic option */}
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" checked={(form as any).hasGarlicOption ?? false}
                  onChange={e => setForm(f => ({ ...f, hasGarlicOption: e.target.checked } as any))}
                  className="w-4 h-4 accent-orange-500" />
                <span className="text-sm text-gray-700">🧄 Garlic option <span className="text-gray-400">(customer picks With / Without Garlic)</span></span>
              </label>
            </div>

            {/* Footer buttons */}
            <div className="flex-shrink-0 px-5 py-4 border-t border-gray-100 flex gap-3">
              <button onClick={() => setShowForm(false)}
                className="flex-1 border border-gray-200 text-gray-600 py-2.5 rounded-xl text-sm font-medium hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={handleSave} disabled={saving}
                className="flex-1 bg-orange-500 hover:bg-orange-600 text-white py-2.5 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50">
                {saving ? 'Saving…' : (editId ? 'Save Changes' : 'Add Product')}
              </button>
            </div>
          </div>
        </div>
        </Portal>
      )}
    </div>
  );
}

// ─── Price Insights Panel ─────────────────────────────────────────────────────
const SIX_MONTHS_MS = 6 * 30 * 24 * 60 * 60 * 1000;

type Insight = {
  product: Product;
  ordersLast6m: number;
  totalQty: number;
  suggestedIncrease: number;    // % e.g. 3
  editedIncrease: number;       // what admin typed
  lastOrderDate: string | null;
  action: 'increase' | 'inactive_suggest' | 'ok';
};

function PriceInsightsPanel({ products }: { products: Product[] }) {
  const [open, setOpen] = useState(false);
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [edits, setEdits] = useState<Record<string, number>>({});
  const [applying, setApplying] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  async function load() {
    if (orders !== null) { setOpen(true); return; }
    setLoading(true);
    try {
      const all = await ordersService.getAll();
      setOrders(all.filter(o => o.status !== 'cancelled'));
      setOpen(true);
    } finally { setLoading(false); }
  }

  const insights = useMemo<Insight[]>(() => {
    if (!orders) return [];
    const now = Date.now();
    const cutoff = new Date(now - SIX_MONTHS_MS).toISOString();

    return products
      .filter(p => p.category.trim() !== 'Sweets' && p.isActive) // exclude festival sweets
      .map(p => {
        const productOrders = orders.filter(o =>
          o.items.some(i => i.productId === p.id)
        );
        const recent = productOrders.filter(o => o.createdAt >= cutoff);
        const ordersLast6m = recent.length;
        const totalQty = recent.flatMap(o => o.items.filter(i => i.productId === p.id))
          .reduce((s, i) => s + i.quantity, 0);

        const lastOrderDate = productOrders.length > 0
          ? productOrders.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0].createdAt
          : null;

        let suggestedIncrease = 0;
        let action: Insight['action'] = 'ok';

        if (ordersLast6m === 0) {
          action = 'inactive_suggest';
        } else if (ordersLast6m >= 15) {
          suggestedIncrease = 5; action = 'increase';   // very high demand
        } else if (ordersLast6m >= 8) {
          suggestedIncrease = 3; action = 'increase';   // good demand
        } else if (ordersLast6m >= 3) {
          suggestedIncrease = 2; action = 'increase';   // moderate
        }

        return {
          product: p, ordersLast6m, totalQty,
          suggestedIncrease, editedIncrease: edits[p.id] ?? suggestedIncrease,
          lastOrderDate, action,
        };
      })
      .filter(ins => ins.action !== 'ok' && !dismissed.has(ins.product.id))
      .sort((a, b) => {
        // inactive first, then by order count desc
        if (a.action === 'inactive_suggest' && b.action !== 'inactive_suggest') return -1;
        if (a.action !== 'inactive_suggest' && b.action === 'inactive_suggest') return 1;
        return b.ordersLast6m - a.ordersLast6m;
      });
  }, [orders, products, edits, dismissed]);

  async function applyIncrease(ins: Insight) {
    const pct = ins.editedIncrease;
    if (pct <= 0 || pct > 30) return toast.error('Enter a % between 1 and 30');
    setApplying(ins.product.id);
    try {
      const newPrice = parseFloat((ins.product.pricePerUnit * (1 + pct / 100)).toFixed(4));
      await productsService.update(ins.product.id, { pricePerUnit: newPrice });
      toast.success(`${ins.product.name} price updated to ₹${newPrice} (+${pct}%)`);
      setDismissed(d => new Set([...d, ins.product.id]));
    } finally { setApplying(null); }
  }

  async function markInactive(productId: string) {
    await productsService.update(productId, { isActive: false });
    toast.success('Product marked inactive');
    setDismissed(d => new Set([...d, productId]));
  }

  const increaseCount = insights.filter(i => i.action === 'increase').length;
  const inactiveCount = insights.filter(i => i.action === 'inactive_suggest').length;

  return (
    <div className="rounded-xl border overflow-hidden"
      style={{ borderColor: '#f0d9c8', background: '#fff' }}>
      {/* Header — always visible */}
      <button
        onClick={open ? () => setOpen(false) : load}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-orange-50/50 transition-colors">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-orange-500" />
          <span className="text-sm font-semibold text-gray-800">Price & Activity Insights</span>
          {!loading && orders !== null && (increaseCount > 0 || inactiveCount > 0) && (
            <span className="flex items-center gap-1.5 ml-1">
              {increaseCount > 0 && (
                <span className="text-xs font-bold px-2 py-0.5 rounded-full"
                  style={{ background: '#fff3e0', color: '#e65100' }}>
                  {increaseCount} price {increaseCount === 1 ? 'suggestion' : 'suggestions'}
                </span>
              )}
              {inactiveCount > 0 && (
                <span className="text-xs font-bold px-2 py-0.5 rounded-full"
                  style={{ background: '#fce4ec', color: '#c62828' }}>
                  {inactiveCount} low-activity
                </span>
              )}
            </span>
          )}
          {loading && <div className="w-3.5 h-3.5 border-2 border-orange-400 border-t-transparent rounded-full animate-spin ml-1" />}
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
      </button>

      {open && (
        <div className="border-t" style={{ borderColor: '#f0d9c8' }}>
          {insights.length === 0 ? (
            <p className="text-sm text-gray-400 px-4 py-4 text-center">
              {orders === null ? 'Loading…' : '✅ All active products look healthy — no suggestions right now.'}
            </p>
          ) : (
            <div className="divide-y divide-orange-50">
              {insights.map(ins => (
                <div key={ins.product.id} className="px-4 py-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm text-gray-800 truncate">{ins.product.name}</span>
                        {ins.action === 'inactive_suggest' ? (
                          <span className="text-xs font-bold px-2 py-0.5 rounded-full flex-shrink-0"
                            style={{ background: '#fce4ec', color: '#c62828' }}>
                            ⚠️ No orders in 6 months
                          </span>
                        ) : (
                          <span className="text-xs font-bold px-2 py-0.5 rounded-full flex-shrink-0"
                            style={{ background: '#e8f5e9', color: '#2e7d32' }}>
                            🔥 {ins.ordersLast6m} orders in 6 months
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">
                        Current: <strong>{formatCurrency(ins.product.pricePerUnit)}/{ins.product.unit}</strong>
                        {ins.lastOrderDate && ` · Last order: ${new Date(ins.lastOrderDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`}
                        {ins.totalQty > 0 && ` · ${ins.totalQty}${ins.product.unit === 'piece' ? ' pcs' : 'g'} sold`}
                      </p>
                    </div>
                    <button onClick={() => setDismissed(d => new Set([...d, ins.product.id]))}
                      className="p-1 hover:bg-gray-100 rounded-lg flex-shrink-0" title="Dismiss">
                      <X className="w-3.5 h-3.5 text-gray-400" />
                    </button>
                  </div>

                  {ins.action === 'increase' && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="flex items-center gap-1.5 bg-orange-50 rounded-xl px-3 py-2 flex-1 min-w-0">
                        <TrendingUp className="w-3.5 h-3.5 text-orange-500 flex-shrink-0" />
                        <span className="text-xs text-gray-600 flex-shrink-0">Suggest increase:</span>
                        <input
                          type="number" min={1} max={30} step={0.5}
                          value={edits[ins.product.id] ?? ins.suggestedIncrease}
                          onChange={e => setEdits(prev => ({ ...prev, [ins.product.id]: parseFloat(e.target.value) || 0 }))}
                          className="w-14 text-center border border-orange-300 rounded-lg px-1.5 py-1 text-xs font-bold outline-none focus:ring-2 focus:ring-orange-300"
                        />
                        <span className="text-xs text-gray-600 flex-shrink-0">%</span>
                        {(() => {
                          const pct = edits[ins.product.id] ?? ins.suggestedIncrease;
                          const newPrice = parseFloat((ins.product.pricePerUnit * (1 + pct / 100)).toFixed(4));
                          return <span className="text-xs text-green-700 font-semibold flex-shrink-0">→ ₹{newPrice}</span>;
                        })()}
                      </div>
                      <button
                        onClick={() => applyIncrease(ins)}
                        disabled={applying === ins.product.id}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-white disabled:opacity-50 flex-shrink-0"
                        style={{ background: '#c8821a' }}>
                        {applying === ins.product.id
                          ? <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          : <CheckCircle2 className="w-3.5 h-3.5" />}
                        Apply
                      </button>
                    </div>
                  )}

                  {ins.action === 'inactive_suggest' && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-xs text-gray-500 flex-1">
                        No orders since {ins.lastOrderDate
                          ? new Date(ins.lastOrderDate).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
                          : 'ever'}. Consider deactivating to keep the store focused.
                      </p>
                      <button
                        onClick={() => markInactive(ins.product.id)}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border flex-shrink-0"
                        style={{ borderColor: '#ef9a9a', color: '#c62828', background: '#fff5f5' }}>
                        <AlertTriangle className="w-3.5 h-3.5" />
                        Mark Inactive
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="px-4 py-2 text-xs text-gray-400 border-t" style={{ borderColor: '#f5f0ec' }}>
            ℹ️ Suggestions exclude Sweets / festival items. Dismissed items reappear on next refresh.
          </div>
        </div>
      )}
    </div>
  );
}

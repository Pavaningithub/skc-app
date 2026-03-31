import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus, Minus, Trash2, LogOut, ShoppingBag, Package,
  Check, RefreshCw, UserPlus, ChevronDown, ChevronUp,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { productsService, ordersService, agentsService, stockService } from '../../lib/services';
import { generateOrderNumber } from '../../lib/utils';
import type { Product, OrderItem, Order } from '../../lib/types';
import { getAgentSession, clearAgentSession } from './AgentLogin';

// ─── Types ────────────────────────────────────────────────────────────────────
interface AgentCartItem extends OrderItem {
  markupPerUnit: number;  // ₹ above SKC price per unit
  sellingPrice: number;   // pricePerUnit + markupPerUnit
}

interface AgentCustomer {
  id: string;
  name: string;
  place: string;
  notes: string;
  useCustomMarkup: boolean;
  customMarkupPercent: number;
  cart: AgentCartItem[];
  collapsed: boolean;
}

type MarkupMode = 'rupees' | 'percent';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function uid(): string { return Math.random().toString(36).slice(2, 9); }

function formatQty(qty: number, unit: string): string {
  if (unit === 'piece') return `${qty} pc${qty !== 1 ? 's' : ''}`;
  if (unit === 'kg') return qty < 1 ? `${Math.round(qty * 1000)} g` : `${qty} kg`;
  return qty >= 1000 ? `${qty / 1000} kg` : `${qty} g`;
}

function qtyStep(unit: string): number {
  return unit === 'piece' ? 1 : unit === 'kg' ? 0.25 : 50;
}

function defaultMinQty(p: Product): number {
  if (p.minOrderQty && p.minOrderQty > 0) return p.minOrderQty;
  return p.unit === 'piece' ? 1 : p.unit === 'kg' ? 0.5 : 250;
}

function computeMarkupRs(product: Product, mode: MarkupMode, value: number): number {
  if (!value || value <= 0) return 0;
  if (mode === 'rupees') return value;
  return Math.round(product.pricePerUnit * value / 100);
}

function cartSkcTotal(cart: AgentCartItem[]): number {
  return cart.reduce((s, i) => s + i.totalPrice, 0);
}
function cartMarginTotal(cart: AgentCartItem[]): number {
  return cart.reduce((s, i) => s + i.markupPerUnit * i.quantity, 0);
}
function cartCustomerTotal(cart: AgentCartItem[]): number {
  return cart.reduce((s, i) => s + i.sellingPrice * i.quantity, 0);
}

function newCustomer(): AgentCustomer {
  return {
    id: uid(), name: '', place: '', notes: '',
    useCustomMarkup: false, customMarkupPercent: 0,
    cart: [], collapsed: false,
  };
}

// ─── Component ────────────────────────────────────────────────────────────────────
export default function AgentConsole() {
  const navigate = useNavigate();
  const agentSession = getAgentSession();

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Global markup ──────────────────────────────────────────────────────────
  // If admin has locked a markup, use that; otherwise fall back to agent's saved preference
  const adminLocked = !!(agentSession?.adminMarkupValue && agentSession.adminMarkupValue > 0);
  const [globalMarkupMode, setGlobalMarkupMode] = useState<MarkupMode>(
    adminLocked
      ? (agentSession?.adminMarkupType ?? 'percent')
      : (agentSession?.savedMarkupType ?? 'percent'),
  );
  const [globalMarkupValue, setGlobalMarkupValue] = useState<number>(
    adminLocked
      ? (agentSession?.adminMarkupValue ?? 0)
      : (agentSession?.savedMarkupValue ?? 0),
  );
  const [savingMarkup, setSavingMarkup] = useState(false);
  const [markupSaved, setMarkupSaved] = useState(false);

  // ── Multi-customer ────────────────────────────────────────────────────
  const [customers, setCustomers] = useState<AgentCustomer[]>([newCustomer()]);
  // Per-customer add-product UI: cid → { productId, qty }
  const [addState, setAddState] = useState<Record<string, { productId: string; qty: number }>>({});

  // ── Recent Orders ──────────────────────────────────────────────────────
  const [showOrders, setShowOrders] = useState(false);
  const [recentOrders, setRecentOrders] = useState<Order[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);

  // ── Saving ────────────────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const [savingProgress, setSavingProgress] = useState('');

  // ─── Subscribe to live product list ───────────────────────────────────────
  useEffect(() => {
    if (!agentSession) { navigate('/agent/login'); return; }
    const unsub = productsService.subscribe(p => {
      setProducts(p.filter(x => x.isActive));
      setLoading(false);
    });
    return () => unsub();
  }, []);

  // ─── Per-customer markup calc ──────────────────────────────────────────────
  const markupForProduct = useCallback((product: Product, cust: AgentCustomer): number => {
    if (cust.useCustomMarkup && cust.customMarkupPercent > 0) {
      return Math.round(product.pricePerUnit * cust.customMarkupPercent / 100);
    }
    return computeMarkupRs(product, globalMarkupMode, globalMarkupValue);
  }, [globalMarkupMode, globalMarkupValue]);

  // ─── Customer CRUD ────────────────────────────────────────────────────────
  function addCustomer() {
    setCustomers(prev => [...prev, newCustomer()]);
  }

  function removeCustomer(cid: string) {
    setCustomers(prev => prev.filter(c => c.id !== cid));
  }

  function updateCustomer(cid: string, updates: Partial<AgentCustomer>) {
    setCustomers(prev => prev.map(c => c.id === cid ? { ...c, ...updates } : c));
  }

  // ─── Cart CRUD per customer ───────────────────────────────────────────────
  function addToCart(cid: string) {
    const state = addState[cid];
    const productId = state?.productId || (products.length > 0 ? products[0].id : '');
    if (!productId) return;
    const product = products.find(p => p.id === productId);
    if (!product) return;
    const qty = Number(state?.qty ?? defaultMinQty(product));
    if (!qty || qty <= 0) { toast.error('Enter a valid quantity'); return; }
    const minQ = defaultMinQty(product);
    if (qty < minQ) { toast.error(`Minimum order is ${formatQty(minQ, product.unit)}`); return; }

    setCustomers(prev => prev.map(c => {
      if (c.id !== cid) return c;
      const markup = markupForProduct(product, c);
      const existing = c.cart.findIndex(i => i.productId === product.id);
      if (existing >= 0) {
        const newCart = c.cart.map((item, i) => {
          if (i !== existing) return item;
          const newQty = item.quantity + qty;
          return { ...item, quantity: newQty, totalPrice: newQty * item.pricePerUnit,
            // preserve per-unit sellingPrice/markup — only qty changes
            sellingPrice: item.sellingPrice, markupPerUnit: item.markupPerUnit };
        });
        return { ...c, cart: newCart };
      }
      const newItem: AgentCartItem = {
        productId: product.id, productName: product.name,
        unit: product.unit, quantity: qty,
        pricePerUnit: product.pricePerUnit, totalPrice: qty * product.pricePerUnit,
        isOnDemand: product.isOnDemand,
        agentMarkup: markup, markupPerUnit: markup,
        sellingPrice: product.pricePerUnit + markup,
      };
      return { ...c, cart: [...c.cart, newItem] };
    }));
  }

  function removeFromCart(cid: string, idx: number) {
    setCustomers(prev => prev.map(c =>
      c.id === cid ? { ...c, cart: c.cart.filter((_, i) => i !== idx) } : c,
    ));
  }

  function updateCartQty(cid: string, idx: number, qty: number) {
    if (qty <= 0) { removeFromCart(cid, idx); return; }
    setCustomers(prev => prev.map(c => {
      if (c.id !== cid) return c;
      const newCart = c.cart.map((item, i) =>
        i === idx ? { ...item, quantity: qty, totalPrice: qty * item.pricePerUnit } : item,
      );
      return { ...c, cart: newCart };
    }));
  }

  function updateCartItemSellingPrice(cid: string, idx: number, sellingPrice: number) {
    setCustomers(prev => prev.map(c => {
      if (c.id !== cid) return c;
      const newCart = c.cart.map((item, i) => {
        if (i !== idx) return item;
        const markup = Math.max(0, sellingPrice - item.pricePerUnit);
        return { ...item, sellingPrice, markupPerUnit: markup, agentMarkup: markup };
      });
      return { ...c, cart: newCart };
    }));
  }

  // ─── Apply global markup to a customer's cart ─────────────────────────────
  const applyGlobalToCustomer = useCallback((cid: string) => {
    setCustomers(prev => prev.map(c => {
      if (c.id !== cid) return c;
      const newCart = c.cart.map(item => {
        const product = products.find(p => p.id === item.productId);
        if (!product) return item;
        const markup = c.useCustomMarkup && c.customMarkupPercent > 0
          ? Math.round(product.pricePerUnit * c.customMarkupPercent / 100)
          : computeMarkupRs(product, globalMarkupMode, globalMarkupValue);
        return { ...item, markupPerUnit: markup, agentMarkup: markup, sellingPrice: item.pricePerUnit + markup };
      });
      return { ...c, cart: newCart };
    }));
    toast.success('Markup applied');
  }, [products, globalMarkupMode, globalMarkupValue]);

  // ─── Apply global markup to ALL customers ─────────────────────────────────
  const applyGlobalToAll = useCallback(() => {
    setCustomers(prev => prev.map(c => {
      const newCart = c.cart.map(item => {
        const product = products.find(p => p.id === item.productId);
        if (!product) return item;
        const markup = c.useCustomMarkup && c.customMarkupPercent > 0
          ? Math.round(product.pricePerUnit * c.customMarkupPercent / 100)
          : computeMarkupRs(product, globalMarkupMode, globalMarkupValue);
        return { ...item, markupPerUnit: markup, agentMarkup: markup, sellingPrice: item.pricePerUnit + markup };
      });
      return { ...c, cart: newCart };
    }));
    toast.success('Markup applied to all customers');
  }, [products, globalMarkupMode, globalMarkupValue]);

  // ─── Save markup preference ────────────────────────────────────────────────
  async function saveMarkupPreference() {
    if (!agentSession) return;
    setSavingMarkup(true);
    try {
      await agentsService.saveMarkupPreference(agentSession.id, globalMarkupMode, globalMarkupValue);
      const updated = { ...agentSession, savedMarkupType: globalMarkupMode, savedMarkupValue: globalMarkupValue };
      sessionStorage.setItem('skc_agent_session', JSON.stringify(updated));
      setMarkupSaved(true);
      setTimeout(() => setMarkupSaved(false), 2500);
    } finally { setSavingMarkup(false); }
  }

  // ─── Place All Orders ──────────────────────────────────────────────────────
  async function placeAllOrders() {
    if (!agentSession) return;
    const agent = agentSession;
    const valid = customers.filter(c => c.cart.length > 0);
    if (valid.length === 0) { toast.error('Add products to at least one customer'); return; }
    const nameMissing = valid.find(c => !c.name.trim());
    if (nameMissing) { toast.error('Enter name for all customers with items'); return; }

    setSaving(true);
    setSavingProgress(`Placing ${valid.length} order${valid.length > 1 ? 's' : ''}…`);
    let placed = 0;
    try {
      for (const cust of valid) {
        const skc = cartSkcTotal(cust.cart);
        const commission = Math.round(skc * agent.commissionPercent / 100);
        const orderItems: OrderItem[] = cust.cart.map(i => ({
          productId: i.productId, productName: i.productName, unit: i.unit,
          quantity: i.quantity, pricePerUnit: i.pricePerUnit, totalPrice: i.totalPrice,
          isOnDemand: i.isOnDemand, agentMarkup: i.markupPerUnit,
        }));
        const order: Omit<Order, 'id'> = {
          orderNumber: generateOrderNumber(), type: 'regular',
          customerName: cust.name.trim(),
          customerWhatsapp: agent.phone,
          customerPlace: cust.place.trim(),
          items: orderItems,
          subtotal: skc, discount: 0, total: skc,
          status: 'confirmed', paymentStatus: 'pending',
          notes: cust.notes.trim(),
          hasOnDemandItems: cust.cart.some(i => i.isOnDemand),
          referralDiscount: 0, creditUsed: 0, deliveryCharge: 0,
          agentId: agent.id, agentName: agent.name, agentCommission: commission,
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        };
        await ordersService.add(order);
        for (const item of cust.cart) {
          if (!item.isOnDemand) {
            await stockService.deduct(item.productId, item.quantity, { productName: item.productName, unit: item.unit });
          }
        }
        await agentsService.recordOrder(agent.id, skc, commission);
        placed++;
        setSavingProgress(`Placed ${placed}/${valid.length}…`);
      }
      toast.success(`${placed} order${placed > 1 ? 's' : ''} placed! 🎉`);
      setCustomers([newCustomer()]);
    } catch (err) {
      console.error(err);
      toast.error(`Failed after ${placed} order(s) — check your connection`);
    } finally {
      setSaving(false);
      setSavingProgress('');
    }
  }

  // ─── Recent orders ─────────────────────────────────────────────────────────
  async function loadRecentOrders() {
    if (!agentSession) return;
    setLoadingOrders(true);
    try {
      const all = await ordersService.getAll();
      setRecentOrders(
        all.filter(o => o.agentId === agentSession.id)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, 30),
      );
      setShowOrders(true);
    } finally { setLoadingOrders(false); }
  }

  function logout() { clearAgentSession(); navigate('/agent/login'); }

  if (!agentSession) return null;
  const agent = agentSession;

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#fdf5e6' }}>
      <div className="w-8 h-8 border-4 border-orange-400 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  const totalOrderCount = customers.filter(c => c.cart.length > 0).length;
  const grandSkcTotal = customers.reduce((s, c) => s + cartSkcTotal(c.cart), 0);

  return (
    <div className="min-h-screen" style={{ background: '#fdf5e6' }}>

      {/* ── Header ── */}
      <div className="sticky top-0 z-10 px-4 py-3 flex items-center justify-between shadow-sm" style={{ background: '#3d1c02' }}>
        <div className="flex items-center gap-2">
          <div>
            <p className="text-white font-bold text-sm">🤝 {agent.name}</p>
            <p className="text-orange-300 text-xs">{agent.phone} · {agent.agentCode}</p>
          </div>
          <span
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{ background: __APP_ENV__ === 'production' ? '#22c55e' : '#3b82f6' }}
            title={__APP_ENV__ === 'production' ? 'Production (Green)' : 'Staging (Blue)'}
          />
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={showOrders ? () => setShowOrders(false) : loadRecentOrders}
            disabled={loadingOrders}
            className="text-xs text-orange-300 hover:text-white flex items-center gap-1">
            <Package className="w-4 h-4" />
            {loadingOrders ? 'Loading…' : showOrders ? '+ New Order' : 'My Orders'}
          </button>
          <button onClick={logout} className="text-orange-300 hover:text-white">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ── Recent Orders ── */}
      {showOrders && (
        <div className="max-w-2xl mx-auto p-4 space-y-3">
          <h2 className="font-bold text-gray-800">My Orders</h2>
          {recentOrders.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-8">No orders yet.</p>
          )}
          {recentOrders.map(o => (
            <div key={o.id} className="bg-white rounded-xl border border-gray-100 px-4 py-3 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono text-gray-400">#{o.orderNumber}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${o.paymentStatus === 'paid' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                  {o.paymentStatus}
                </span>
              </div>
              <p className="text-sm font-semibold text-gray-800">
                {o.customerName}
                {o.customerPlace && <span className="text-gray-400 font-normal text-xs ml-1">· {o.customerPlace}</span>}
              </p>
              <p className="text-xs text-gray-500">
                {o.items.map(i => `${i.productName} ${formatQty(i.quantity, i.unit)}`).join(', ')}
              </p>
              <div className="flex justify-between text-xs text-gray-500 pt-1 border-t border-gray-50">
                <span>SKC: <strong className="text-gray-700">₹{o.total}</strong></span>
                {(o.agentCommission ?? 0) > 0 && (
                  <span className="text-green-600">Commission: <strong>₹{o.agentCommission}</strong></span>
                )}
                <span>{new Date(o.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' })}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Place Orders ── */}
      {!showOrders && (
        <div className="max-w-2xl mx-auto p-4 space-y-4 pb-12">

          {/* ── Global Markup Panel (TOP) ── */}
          <GlobalMarkupPanel
            mode={globalMarkupMode}
            value={globalMarkupValue}
            saving={savingMarkup}
            saved={markupSaved}
            savedValue={agent.savedMarkupValue}
            savedType={agent.savedMarkupType}
            adminLocked={adminLocked}
            adminMarkupType={agent.adminMarkupType}
            adminMarkupValue={agent.adminMarkupValue}
            onModeChange={setGlobalMarkupMode}
            onValueChange={setGlobalMarkupValue}
            onApplyAll={applyGlobalToAll}
            onSave={saveMarkupPreference}
            hasAnyCart={customers.some(c => c.cart.length > 0)}
          />

          {/* Product reference list */}
          <ProductReferenceList products={products} />

          {/* ── Customer cards ── */}
          {customers.map((cust, cidx) => (
            <CustomerCard
              key={cust.id}
              cust={cust}
              cidx={cidx}
              products={products}
              addState={addState[cust.id]}
              globalMarkupMode={globalMarkupMode}
              globalMarkupValue={globalMarkupValue}
              onUpdateCustomer={updates => updateCustomer(cust.id, updates)}
              onRemoveCustomer={() => removeCustomer(cust.id)}
              adminLocked={adminLocked}
              onAddStateChange={s => setAddState(prev => ({ ...prev, [cust.id]: s }))}
              onAddToCart={() => addToCart(cust.id)}
              onRemoveCartItem={idx => removeFromCart(cust.id, idx)}
              onUpdateCartQty={(idx, qty) => updateCartQty(cust.id, idx, qty)}
              onUpdateItemSellingPrice={(idx, sp) => updateCartItemSellingPrice(cust.id, idx, sp)}
              onApplyGlobal={() => applyGlobalToCustomer(cust.id)}
              canDelete={customers.length > 1}
            />
          ))}

          {/* Add customer button */}
          <button
            onClick={addCustomer}
            className="w-full py-3 rounded-2xl border-2 border-dashed border-orange-300 text-orange-600 font-semibold text-sm flex items-center justify-center gap-2 hover:bg-orange-50 transition-colors">
            <UserPlus className="w-4 h-4" /> Add Another Customer
          </button>

          {/* ── Place All Orders button ── */}
          <button
            onClick={placeAllOrders}
            disabled={saving || customers.every(c => c.cart.length === 0)}
            className="w-full py-4 rounded-2xl text-white font-bold text-sm disabled:opacity-40 flex items-center justify-center gap-2 transition-opacity"
            style={{ background: '#3d1c02' }}>
            <ShoppingBag className="w-5 h-5" />
            {saving
              ? savingProgress || 'Placing orders…'
              : totalOrderCount > 0
                ? `Place ${totalOrderCount} Order${totalOrderCount > 1 ? 's' : ''} · ₹${Math.round(grandSkcTotal)} to SKC`
                : 'Place Orders'}
          </button>

          <p className="text-center text-xs text-gray-400">
            SKC will hand feedback slips on delivery to share with your customers.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Product Reference List ────────────────────────────────────────────────────
function ProductReferenceList({ products }: { products: Product[] }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full px-4 py-3 flex items-center justify-between text-left">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
          📦 SKC Product List ({products.length})
        </p>
        {expanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
      </button>
      {expanded && (
        <div className="border-t border-gray-50 divide-y divide-gray-50">
          {products.map(p => {
            const minQ = defaultMinQty(p);
            return (
              <div key={p.id} className="px-4 py-2.5 flex items-center justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{p.name}</p>
                  {p.isOnDemand && <span className="text-xs text-purple-600 font-medium">On-demand</span>}
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-bold text-gray-800">
                    ₹{p.pricePerUnit}<span className="text-xs font-normal text-gray-400">/{p.unit}</span>
                  </p>
                  <p className="text-xs text-gray-400">min {formatQty(minQ, p.unit)}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Customer Card ─────────────────────────────────────────────────────────────
interface CustomerCardProps {
  cust: AgentCustomer;
  cidx: number;
  products: Product[];
  addState?: { productId: string; qty: number };
  globalMarkupMode: MarkupMode;
  globalMarkupValue: number;
  adminLocked: boolean;
  onUpdateCustomer: (u: Partial<AgentCustomer>) => void;
  onRemoveCustomer: () => void;
  onAddStateChange: (s: { productId: string; qty: number }) => void;
  onAddToCart: () => void;
  onRemoveCartItem: (idx: number) => void;
  onUpdateCartQty: (idx: number, qty: number) => void;
  onUpdateItemSellingPrice: (idx: number, sp: number) => void;
  onApplyGlobal: () => void;
  canDelete: boolean;
}

function CustomerCard({
  cust, cidx, products, addState,
  adminLocked,
  onUpdateCustomer, onRemoveCustomer, onAddStateChange, onAddToCart,
  onRemoveCartItem, onUpdateCartQty, onUpdateItemSellingPrice, onApplyGlobal,
  canDelete,
}: CustomerCardProps) {
  const skc = cartSkcTotal(cust.cart);
  const margin = cartMarginTotal(cust.cart);
  const custTotal = cartCustomerTotal(cust.cart);
  const highMargin = skc > 0 && margin / skc > 0.15;

  const defaultProductId = products.length > 0 ? products[0].id : '';
  const currentProductId = addState?.productId || defaultProductId;
  const currentProduct = products.find(p => p.id === currentProductId);
  const currentQty = addState?.qty ?? (currentProduct ? defaultMinQty(currentProduct) : 1);

  function setProduct(productId: string) {
    const p = products.find(x => x.id === productId);
    onAddStateChange({ productId, qty: p ? defaultMinQty(p) : 1 });
  }
  function setQty(qty: number) {
    onAddStateChange({ productId: currentProductId, qty });
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
      {/* Card header */}
      <div className="px-4 py-3 flex items-center gap-3" style={{ background: '#fdf0e0' }}>
        <div
          className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
          style={{ background: '#c8821a' }}>
          {cidx + 1}
        </div>
        <input
          type="text"
          value={cust.name}
          onChange={e => onUpdateCustomer({ name: e.target.value })}
          placeholder={`Customer ${cidx + 1} name *`}
          className="flex-1 min-w-0 bg-transparent text-sm font-semibold text-gray-800 placeholder-gray-400 outline-none border-b border-transparent focus:border-orange-300 transition-colors"
        />
        {canDelete && (
          <button onClick={onRemoveCustomer} className="p-1.5 hover:bg-red-50 rounded-lg flex-shrink-0">
            <Trash2 className="w-4 h-4 text-red-400" />
          </button>
        )}
        <button
          onClick={() => onUpdateCustomer({ collapsed: !cust.collapsed })}
          className="p-1.5 hover:bg-gray-100 rounded-lg flex-shrink-0">
          {cust.collapsed ? <ChevronDown className="w-4 h-4 text-gray-500" /> : <ChevronUp className="w-4 h-4 text-gray-500" />}
        </button>
      </div>

      {!cust.collapsed && (
        <div className="p-4 space-y-4">
          {/* Place & Notes */}
          <div className="grid grid-cols-2 gap-2">
            <input
              type="text" value={cust.place}
              onChange={e => onUpdateCustomer({ place: e.target.value })}
              placeholder="Area / Place"
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-orange-400"
            />
            <input
              type="text" value={cust.notes}
              onChange={e => onUpdateCustomer({ notes: e.target.value })}
              placeholder="Notes (optional)"
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-orange-400"
            />
          </div>

          {/* Per-customer markup override — hidden when admin has set a fixed markup */}
          {!adminLocked && (
          <div className="flex items-center gap-3">
            <button
              onClick={() => onUpdateCustomer({ useCustomMarkup: !cust.useCustomMarkup })}
              className="flex items-center gap-2 select-none">
              <div className={`w-9 h-5 rounded-full transition-colors flex-shrink-0 relative ${cust.useCustomMarkup ? 'bg-orange-500' : 'bg-gray-200'}`}>
                <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${cust.useCustomMarkup ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </div>
              <span className="text-xs text-gray-600">Custom % for this customer</span>
            </button>
            {cust.useCustomMarkup && (
              <div className="flex items-center gap-1 ml-auto">
                <input
                  type="number" min="0" step="0.5"
                  value={cust.customMarkupPercent || ''}
                  onChange={e => onUpdateCustomer({ customMarkupPercent: Math.max(0, Number(e.target.value)) })}
                  placeholder="0"
                  className="w-16 border border-gray-200 rounded-lg px-2 py-1 text-xs outline-none focus:border-orange-400 text-center"
                />
                <span className="text-xs text-gray-500">%</span>
              </div>
            )}
          </div>
          )}

          {/* ── Product picker ── */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Add Products</p>

            {/* Clickable product grid */}
            <div className="grid grid-cols-2 gap-1.5 max-h-52 overflow-y-auto">
              {products.map(p => {
                const inCart = cust.cart.find(i => i.productId === p.id);
                const isSelected = currentProductId === p.id;
                return (
                  <button
                    key={p.id}
                    onClick={() => setProduct(p.id)}
                    className={`text-left px-3 py-2 rounded-xl border transition-all text-xs ${isSelected ? 'border-orange-400 bg-orange-50' : 'border-gray-100 hover:border-orange-200 hover:bg-orange-50/40'}`}>
                    <p className="font-semibold text-gray-800 truncate">{p.name}</p>
                    <p className="text-gray-500">₹{p.pricePerUnit}/{p.unit}</p>
                    <p className="text-gray-400">min {formatQty(defaultMinQty(p), p.unit)}</p>
                    {inCart && <p className="text-green-600 font-medium mt-0.5">✓ {formatQty(inCart.quantity, p.unit)}</p>}
                  </button>
                );
              })}
            </div>

            {/* Qty stepper + add button */}
            {currentProduct && (
              <div className="flex gap-2 items-end">
                <div className="flex-1">
                  <p className="text-xs font-medium text-gray-700 mb-1">
                    {currentProduct.name}
                    <span className="text-gray-400 ml-1">(min {formatQty(defaultMinQty(currentProduct), currentProduct.unit)})</span>
                  </p>
                  <div className="flex items-center gap-1 bg-gray-50 rounded-xl px-2 py-1.5 border border-gray-200">
                    <button
                      onClick={() => setQty(Math.max(defaultMinQty(currentProduct), currentQty - qtyStep(currentProduct.unit)))}
                      className="p-0.5 hover:bg-gray-200 rounded">
                      <Minus className="w-3.5 h-3.5 text-gray-600" />
                    </button>
                    <input
                      type="number"
                      min={defaultMinQty(currentProduct)}
                      step={qtyStep(currentProduct.unit)}
                      value={currentQty}
                      onChange={e => setQty(Number(e.target.value))}
                      className="flex-1 text-center text-sm font-medium bg-transparent outline-none w-14"
                    />
                    <span className="text-xs text-gray-400 pr-1">
                      {currentProduct.unit === 'piece' ? 'pcs' : currentProduct.unit === 'kg' ? 'kg' : 'g'}
                    </span>
                    <button
                      onClick={() => setQty(currentQty + qtyStep(currentProduct.unit))}
                      className="p-0.5 hover:bg-gray-200 rounded">
                      <Plus className="w-3.5 h-3.5 text-gray-600" />
                    </button>
                  </div>
                </div>
                <button
                  onClick={onAddToCart}
                  className="px-4 py-2.5 rounded-xl text-white text-sm font-semibold flex items-center gap-1.5 flex-shrink-0"
                  style={{ background: '#c8821a' }}>
                  <Plus className="w-4 h-4" /> Add
                </button>
              </div>
            )}
          </div>

          {/* ── Cart ── */}
          {cust.cart.length > 0 && (
            <div className="rounded-xl border border-gray-100 overflow-hidden">
              <div className="px-3 py-2 flex items-center justify-between" style={{ background: '#fdf5e6' }}>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Order Items</p>
                <button onClick={onApplyGlobal} className="text-xs text-orange-500 hover:text-orange-700 flex items-center gap-1">
                  <RefreshCw className="w-3 h-3" /> Re-apply markup
                </button>
              </div>

              {cust.cart.map((item, i) => (
                <div key={i} className={`px-3 py-2.5 space-y-1.5 ${i > 0 ? 'border-t border-gray-50' : ''}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-800 leading-tight">{item.productName}</p>
                      <p className="text-xs text-gray-400">SKC ₹{item.pricePerUnit}/{item.unit}</p>
                    </div>
                    <button onClick={() => onRemoveCartItem(i)} className="p-1 hover:bg-red-50 rounded-lg mt-0.5 flex-shrink-0">
                      <Trash2 className="w-3.5 h-3.5 text-red-400" />
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {/* Qty */}
                    <div className="flex items-center gap-0.5 bg-gray-50 rounded-lg px-1.5 py-1 border border-gray-100">
                      <button
                        onClick={() => onUpdateCartQty(i, Math.max(0, item.quantity - qtyStep(item.unit)))}
                        className="p-0.5 hover:bg-gray-200 rounded">
                        <Minus className="w-3 h-3 text-gray-600" />
                      </button>
                      <span className="text-xs font-medium w-16 text-center">{formatQty(item.quantity, item.unit)}</span>
                      <button onClick={() => onUpdateCartQty(i, item.quantity + qtyStep(item.unit))} className="p-0.5 hover:bg-gray-200 rounded">
                        <Plus className="w-3 h-3 text-gray-600" />
                      </button>
                    </div>

                    {/* Selling price (editable) */}
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-gray-400">Sell ₹</span>
                      <input
                        type="number"
                        min={item.pricePerUnit}
                        step="1"
                        value={item.sellingPrice}
                        onChange={e => onUpdateItemSellingPrice(i, Math.max(item.pricePerUnit, Number(e.target.value)))}
                        className="w-16 border border-gray-200 rounded-lg px-2 py-1 text-xs outline-none focus:border-orange-400 text-center"
                      />
                      <span className="text-xs text-gray-400">/{item.unit}</span>
                    </div>
                  </div>

                  <div className="flex justify-between text-xs">
                    <span className="text-gray-400">SKC: ₹{item.totalPrice}</span>
                    {item.markupPerUnit > 0
                      ? <span className="text-green-600 font-medium">Customer: ₹{Math.round(item.sellingPrice * item.quantity)} · margin +₹{Math.round(item.markupPerUnit * item.quantity)}</span>
                      : <span className="text-gray-400">Customer: ₹{Math.round(item.sellingPrice * item.quantity)}</span>
                    }
                  </div>
                </div>
              ))}

              {/* Totals */}
              <div className="border-t border-orange-100 px-3 py-2.5 space-y-1" style={{ background: '#fdf5e6' }}>
                <div className="flex justify-between text-xs text-gray-600">
                  <span>SKC charges you</span>
                  <span className="font-semibold">₹{Math.round(skc)}</span>
                </div>
                {margin > 0 && (
                  <div className="flex justify-between text-xs text-green-700">
                    <span>Your margin</span>
                    <span className="font-semibold">+₹{Math.round(margin)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm font-bold border-t border-orange-200 pt-1">
                  <span>Customer pays you</span>
                  <span style={{ color: '#c8821a' }}>₹{Math.round(custTotal)}</span>
                </div>
              </div>
            </div>
          )}

          {/* High margin warning */}
          {highMargin && (
            <div className="flex items-start gap-2 rounded-xl px-3 py-2.5 border" style={{ background: '#fffbeb', borderColor: '#fcd34d' }}>
              <span className="text-base leading-none flex-shrink-0 mt-0.5">⚠️</span>
              <div className="text-xs">
                <p className="font-semibold text-amber-800">{Math.round(margin / skc * 100)}% markup — above 15%</p>
                <p className="text-amber-700 mt-0.5">High markup may deter customers. Keeping under 15% helps retain them long-term.</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Collapsed summary */}
      {cust.collapsed && cust.cart.length > 0 && (
        <div className="px-4 pb-3 flex items-center justify-between text-xs text-gray-500">
          <span>{cust.cart.length} item{cust.cart.length > 1 ? 's' : ''} · SKC ₹{skc}</span>
          {margin > 0 && <span className="text-green-600 font-medium">Margin ₹{margin}</span>}
        </div>
      )}
    </div>
  );
}

// ─── Global Markup Panel ───────────────────────────────────────────────────────
interface GlobalMarkupPanelProps {
  mode: MarkupMode;
  value: number;
  saving: boolean;
  saved: boolean;
  savedValue?: number;
  savedType?: string;
  adminLocked: boolean;
  adminMarkupType?: string;
  adminMarkupValue?: number;
  onModeChange: (m: MarkupMode) => void;
  onValueChange: (v: number) => void;
  onApplyAll: () => void;
  onSave: () => void;
  hasAnyCart: boolean;
}

function GlobalMarkupPanel({
  mode, value, saving, saved, savedValue, savedType,
  adminLocked, adminMarkupType, adminMarkupValue,
  onModeChange, onValueChange, onApplyAll, onSave, hasAnyCart,
}: GlobalMarkupPanelProps) {
  return (
    <div className={`rounded-2xl border p-4 space-y-3 ${adminLocked ? 'border-orange-200' : 'bg-white border-gray-100'}`}
      style={adminLocked ? { background: '#fff8f0' } : {}}>
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Global Markup / Margin</p>
        {!adminLocked && savedValue && savedValue > 0 && (
          <span className="text-xs text-green-600">
            Saved: {savedType === 'percent' ? `${savedValue}%` : `₹${savedValue}`}
          </span>
        )}
        {adminLocked && (
          <span className="text-xs font-semibold text-orange-600 flex items-center gap-1">
            🔒 Managed by admin
          </span>
        )}
      </div>

      {/* Admin-locked notice */}
      {adminLocked && (
        <div className="rounded-xl px-3 py-2.5 border border-orange-200 flex items-start gap-2" style={{ background: '#fff3e0' }}>
          <span className="text-base leading-none flex-shrink-0">🔒</span>
          <div className="text-xs">
            <p className="font-semibold text-orange-800">
              Markup is set by admin:&nbsp;
              <strong>{adminMarkupType === 'percent' ? `${adminMarkupValue}%` : `₹${adminMarkupValue} per unit`}</strong>
            </p>
            <p className="text-orange-700 mt-0.5">
              You cannot change this. Contact your SKC admin if you need a different rate.
            </p>
          </div>
        </div>
      )}

      <div className="flex gap-2 items-center">
        <div className={`flex rounded-xl overflow-hidden border flex-shrink-0 ${adminLocked ? 'border-orange-200 opacity-50 pointer-events-none' : 'border-gray-200'}`}>
          <button
            onClick={() => onModeChange('rupees')}
            disabled={adminLocked}
            className={`px-3 py-2 text-sm font-bold transition-colors ${mode === 'rupees' ? 'text-white' : 'text-gray-500'}`}
            style={mode === 'rupees' ? { background: '#3d1c02' } : {}}>₹</button>
          <button
            onClick={() => onModeChange('percent')}
            disabled={adminLocked}
            className={`px-3 py-2 text-sm font-bold transition-colors ${mode === 'percent' ? 'text-white' : 'text-gray-500'}`}
            style={mode === 'percent' ? { background: '#3d1c02' } : {}}>%</button>
        </div>
        <input
          type="number" min="0" step={mode === 'percent' ? '0.5' : '1'}
          value={value || ''}
          onChange={e => onValueChange(Math.max(0, Number(e.target.value)))}
          placeholder={mode === 'rupees' ? 'e.g. 50' : 'e.g. 10'}
          disabled={adminLocked}
          className={`flex-1 border rounded-xl px-3 py-2 text-sm outline-none ${adminLocked ? 'border-orange-200 bg-orange-50 text-orange-700 cursor-not-allowed opacity-60' : 'border-gray-200 focus:border-orange-400'}`}
        />
        <button
          onClick={onApplyAll}
          disabled={!hasAnyCart || adminLocked}
          className="text-xs font-semibold px-3 py-2 rounded-xl border border-orange-300 text-orange-600 hover:bg-orange-50 flex-shrink-0 flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed">
          <RefreshCw className="w-3.5 h-3.5" /> Apply all
        </button>
      </div>

      {!adminLocked && (
        <p className="text-xs text-gray-400">
          {mode === 'percent'
            ? 'Applied as % above SKC price. Per-customer override takes priority.'
            : 'Fixed ₹ added per unit on every product. Per-customer override takes priority.'}
        </p>
      )}

      {!adminLocked && (
        <button
          onClick={onSave} disabled={saving}
          className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl border transition-colors disabled:opacity-50"
          style={saved
            ? { background: '#f0fdf4', borderColor: '#86efac', color: '#166534' }
            : { borderColor: '#e0d0c0', color: '#7a4010' }}>
          {saved ? <><Check className="w-3.5 h-3.5" />Saved!</> : saving ? 'Saving…' : '💾 Save for future orders'}
        </button>
      )}
    </div>
  );
}

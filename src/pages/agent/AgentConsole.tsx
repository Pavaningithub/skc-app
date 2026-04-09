import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus, Minus, Trash2, LogOut, ShoppingBag, Package,
  RefreshCw, UserPlus, ChevronDown, ChevronUp, Search,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { productsService, ordersService, stockService, agentsService } from '../../lib/services';
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
  cart: AgentCartItem[];
  collapsed: boolean;
}

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
    cart: [], collapsed: false,
  };
}

// ─── Component ────────────────────────────────────────────────────────────────────
export default function AgentConsole() {
  const navigate = useNavigate();
  const agentSession = getAgentSession();

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [liveAgent, setLiveAgent] = useState<{ markupPercent: number; enforceMarkup: boolean } | null>(null);

  // ── Multi-customer ────────────────────────────────────────────────────
  const [customers, setCustomers] = useState<AgentCustomer[]>([newCustomer()]);
  // Per-customer add-product UI: cid → { productId, qty }
  const [addState, setAddState] = useState<Record<string, { productId: string; qty: number; garlicPref?: 'with' | 'without' }>>({});   // ── Recent Orders ──────────────────────────────────────────────────────
  const [showOrders, setShowOrders] = useState(false);
  const [recentOrders, setRecentOrders] = useState<Order[]>([]);
  const [loadingOrders] = useState(false);

  // ── Saving ────────────────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const [savingProgress, setSavingProgress] = useState('');

  // ─── Subscribe to live product list + fetch live agent data ───────────────────────────────────────
  useEffect(() => {
    if (!agentSession) { navigate('/agent/login'); return; }
    // Fetch live agent so markup% and commission% are never stale from session
    agentsService.getById(agentSession.id).then(a => {
      if (a) setLiveAgent({ markupPercent: a.markupPercent ?? 0, enforceMarkup: a.enforceMarkup ?? false });
    });
    const unsub = productsService.subscribe(p => {
      setProducts(p.filter(x => x.isActive));
      setLoading(false);
    });
    return () => unsub();
  }, []);

  // ─── Per-item markup: agents start at 0 (same price as customers) and can increase manually ──
  function markupForProduct(_product: Product): number {
    return 0;
  }

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

    const garlicNote = product.hasGarlicOption
      ? ((state?.garlicPref ?? 'without') === 'with' ? 'With Garlic' : 'Without Garlic')
      : undefined;

    setCustomers(prev => prev.map(c => {
      if (c.id !== cid) return c;
      const markup = markupForProduct(product);
      const existing = c.cart.findIndex(i => i.productId === product.id && i.customizationNote === (garlicNote ?? ''));
      if (existing >= 0) {
        const newCart = c.cart.map((item, i) => {
          if (i !== existing) return item;
          const newQty = item.quantity + qty;
          return { ...item, quantity: newQty, totalPrice: newQty * item.pricePerUnit,
            sellingPrice: item.sellingPrice, markupPerUnit: item.markupPerUnit };
        });
        return { ...c, cart: newCart };
      }
      const skcTotal = qty * product.pricePerUnit;
      const sellTotal = qty * (product.pricePerUnit + markup);
      const newItem: AgentCartItem = {
        productId: product.id, productName: product.name,
        unit: product.unit, quantity: qty,
        pricePerUnit: product.pricePerUnit, totalPrice: skcTotal,
        isOnDemand: product.isOnDemand,
        agentMarkup: markup, markupPerUnit: markup,
        sellingPrice: sellTotal / qty,
        ...(garlicNote ? { customizationNote: garlicNote } : {}),
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

  // ─── Re-apply markup to all items in a customer's cart ───────────────────
  function reapplyMarkup(cid: string) {
    setCustomers(prev => prev.map(c => {
      if (c.id !== cid) return c;
      const newCart = c.cart.map(item => {
        const product = products.find(p => p.id === item.productId);
        if (!product) return item;
        const markup = markupForProduct(product);
        return { ...item, markupPerUnit: markup, agentMarkup: markup, sellingPrice: item.pricePerUnit + markup };
      });
      return { ...c, cart: newCart };
    }));
    toast.success('Markup re-applied');
  }

  // ─── Place All Orders ──────────────────────────────────────────────────────
  async function placeAllOrders() {
    if (!agentSession) return;
    const agent = agentSession;
    const valid = customers.filter(c => c.cart.length > 0);
    if (valid.length === 0) { toast.error('Add products to at least one customer'); return; }
    const nameMissing = valid.find(c => !c.name.trim());
    if (nameMissing) { toast.error('Enter name for all customers with items'); return; }

    // Block if any item has sell price below SKC cost
    for (const cust of valid) {
      for (const item of cust.cart) {
        const skcAmt = item.totalPrice;
        const custAmt = Math.round(item.sellingPrice * item.quantity);
        if (custAmt < skcAmt) {
          toast.error(`${cust.name || 'Customer'}: "${item.productName}" sell price (₹${custAmt}) is below SKC cost (₹${skcAmt})`);
          return;
        }
        // Block if enforced cap is exceeded
        if (liveAgent?.enforceMarkup && liveAgent.markupPercent > 0) {
          const maxSell = Math.round(skcAmt * (1 + liveAgent.markupPercent / 100));
          if (custAmt > maxSell) {
            toast.error(`${cust.name || 'Customer'}: "${item.productName}" exceeds the ${liveAgent.markupPercent}% markup cap (max ₹${maxSell})`);
            return;
          }
        }
      }
    }

    setSaving(true);
    setSavingProgress(`Placing ${valid.length} order${valid.length > 1 ? 's' : ''}…`);
    let placed = 0;
    try {
      for (const cust of valid) {
        const skc = cartSkcTotal(cust.cart);
        const customerTotal = cartCustomerTotal(cust.cart);
        const agentMargin = Math.round(customerTotal - skc);
        const orderItems: OrderItem[] = cust.cart.map(i => ({
          productId: i.productId, productName: i.productName, unit: i.unit,
          quantity: i.quantity, pricePerUnit: i.pricePerUnit, totalPrice: i.totalPrice,
          isOnDemand: i.isOnDemand,
          // agentMarkup intentionally omitted — admin should not see agent's margin
          ...(i.customizationNote ? { customizationNote: i.customizationNote } : {}),
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
          agentId: agent.id, agentName: agent.name,
          agentMargin: agentMargin > 0 ? agentMargin : undefined,
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        };
        await ordersService.add(order);
        for (const item of cust.cart) {
          if (!item.isOnDemand) {
            await stockService.deduct(item.productId, item.quantity, { productName: item.productName, unit: item.unit });
          }
        }
        await agentsService.recordOrder(agent.id, skc);
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

  // ─── Live orders subscription ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!agentSession) return;
    // Subscribe to live orders so status always matches SKC
    const unsub = ordersService.subscribe(all => {
      setRecentOrders(
        all.filter(o => o.agentId === agentSession.id)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, 50),
      );
    });
    return () => unsub();
  }, []);

  async function loadRecentOrders() {
    setShowOrders(true);
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
          {recentOrders.length > 0 && (() => {
            const ordersWithMargin = recentOrders.filter(o => o.agentMargin != null && o.agentMargin > 0);
            const totalMargin = ordersWithMargin.reduce((s, o) => s + (o.agentMargin ?? 0), 0);
            const paidMargin  = ordersWithMargin.filter(o => o.paymentStatus === 'paid').reduce((s, o) => s + (o.agentMargin ?? 0), 0);
            const totalCollect = recentOrders.reduce((s, o) => s + o.total + (o.agentMargin ?? 0), 0);
            return (
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-green-50 border border-green-200 rounded-xl px-3 py-2 text-center">
                  <p className="text-xs text-green-600">Total Profit</p>
                  <p className="font-bold text-green-700 text-lg">₹{totalMargin}</p>
                  <p className="text-[10px] text-green-500">{ordersWithMargin.length} orders</p>
                </div>
                <div className="bg-blue-50 border border-blue-200 rounded-xl px-3 py-2 text-center">
                  <p className="text-xs text-blue-600">Paid Orders Profit</p>
                  <p className="font-bold text-blue-700 text-lg">₹{paidMargin}</p>
                </div>
                <div className="bg-orange-50 border border-orange-200 rounded-xl px-3 py-2 text-center col-span-2">
                  <p className="text-xs text-orange-600">Total to Collect from Customers</p>
                  <p className="font-bold text-orange-700 text-lg">₹{totalCollect}</p>
                </div>
              </div>
            );
          })()}
          {recentOrders.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-8">No orders yet.</p>
          )}
          {recentOrders.map(o => (
            <div key={o.id} className="bg-white rounded-xl border border-gray-100 px-4 py-3 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono text-gray-400">#{o.orderNumber}</span>
                <div className="flex items-center gap-1.5">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    o.status === 'delivered'        ? 'bg-green-100 text-green-700' :
                    o.status === 'confirmed'        ? 'bg-blue-100 text-blue-700' :
                    o.status === 'out_for_delivery' ? 'bg-purple-100 text-purple-700' :
                    o.status === 'cancelled'        ? 'bg-red-100 text-red-500' :
                                                     'bg-amber-100 text-amber-700'
                  }`}>
                    {o.status === 'out_for_delivery' ? 'Out for delivery' : o.status}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${o.paymentStatus === 'paid' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {o.paymentStatus === 'paid' ? '✅ Paid' : '⏳ Unpaid'}
                  </span>
                </div>
              </div>
              <p className="text-sm font-semibold text-gray-800">
                {o.customerName}
                {o.customerPlace && <span className="text-gray-400 font-normal text-xs ml-1">· {o.customerPlace}</span>}
              </p>
              <p className="text-xs text-gray-500">
                {o.items.map(i => `${i.productName} ${formatQty(i.quantity, i.unit)}`).join(', ')}
              </p>
              <div className="flex justify-between items-center text-xs pt-1 border-t border-gray-50 gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className="text-gray-400">SKC: <strong className="text-gray-600">₹{o.total}</strong></span>
                  {o.agentMargin != null && o.agentMargin > 0 && (
                    <>
                      <span className="text-gray-300">·</span>
                      <span className="text-gray-400">Collect: <strong className="text-gray-800">₹{o.total + o.agentMargin}</strong></span>
                      <span className="text-gray-300">·</span>
                      <span className="font-semibold text-green-600">+₹{o.agentMargin} profit</span>
                    </>
                  )}
                </div>
                <span className="text-gray-400">{new Date(o.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' })}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Place Orders ── */}
      {!showOrders && (
        <div className="max-w-2xl mx-auto p-4 space-y-4 pb-12">



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
              onUpdateCustomer={updates => updateCustomer(cust.id, updates)}
              onRemoveCustomer={() => removeCustomer(cust.id)}
              onAddStateChange={s => setAddState(prev => ({ ...prev, [cust.id]: s }))}
              onAddToCart={() => addToCart(cust.id)}
              onRemoveCartItem={idx => removeFromCart(cust.id, idx)}
              onUpdateCartQty={(idx, qty) => updateCartQty(cust.id, idx, qty)}
              onUpdateItemSellingPrice={(idx, sp) => updateCartItemSellingPrice(cust.id, idx, sp)}
              onReapplyMarkup={() => reapplyMarkup(cust.id)}
              maxMarkupPct={liveAgent?.markupPercent ?? 0}
              enforceMarkup={liveAgent?.enforceMarkup ?? false}
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
  addState?: { productId: string; qty: number; garlicPref?: 'with' | 'without' };
  onUpdateCustomer: (u: Partial<AgentCustomer>) => void;
  onRemoveCustomer: () => void;
  onAddStateChange: (s: { productId: string; qty: number; garlicPref?: 'with' | 'without' }) => void;
  onAddToCart: () => void;
  onRemoveCartItem: (idx: number) => void;
  onUpdateCartQty: (idx: number, qty: number) => void;
  onUpdateItemSellingPrice: (idx: number, sp: number) => void;
  onReapplyMarkup: () => void;
  maxMarkupPct: number;       // 0 = no cap set by admin
  enforceMarkup: boolean;     // true = hard cap, false = warn at 15%
  canDelete: boolean;
}

function CustomerCard({
  cust, cidx, products, addState,
  onUpdateCustomer, onRemoveCustomer, onAddStateChange, onAddToCart,
  onRemoveCartItem, onUpdateCartQty, onUpdateItemSellingPrice, onReapplyMarkup,
  maxMarkupPct, enforceMarkup,
  canDelete,
}: CustomerCardProps) {
  const skc = cartSkcTotal(cust.cart);
  const margin = cartMarginTotal(cust.cart);
  const custTotal = cartCustomerTotal(cust.cart);
  // Warn threshold: if enforced, use admin cap; otherwise warn at 15%
  const warnThreshold = enforceMarkup && maxMarkupPct > 0 ? maxMarkupPct : 15;
  const highMargin = skc > 0 && margin / skc * 100 > warnThreshold;

  const [productSearch, setProductSearch] = useState('');
  const [garlicOnly, setGarlicOnly] = useState(false);

  const defaultProductId = products.length > 0 ? products[0].id : '';
  const currentProductId = addState?.productId || defaultProductId;
  const currentProduct = products.find(p => p.id === currentProductId);
  const currentQty = addState?.qty ?? (currentProduct ? defaultMinQty(currentProduct) : 1);

  const filteredProducts = products
    .filter(p => !productSearch.trim() || p.name.toLowerCase().includes(productSearch.trim().toLowerCase()))
    .filter(p => !garlicOnly || !!p.hasGarlicOption);

  function setProduct(productId: string) {
    const p = products.find(x => x.id === productId);
    // reset garlicPref to 'without' when product changes
    onAddStateChange({ productId, qty: p ? defaultMinQty(p) : 1, garlicPref: 'without' });
  }
  function setQty(qty: number) {
    onAddStateChange({ productId: currentProductId, qty, garlicPref: addState?.garlicPref ?? 'without' });
  }
  function setGarlicPref(pref: 'with' | 'without') {
    onAddStateChange({ productId: currentProductId, qty: currentQty, garlicPref: pref });
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

          {/* ── Product picker ── */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Add Products</p>

            {/* Search + Garlic filter */}
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
                <input
                  type="text"
                  value={productSearch}
                  onChange={e => setProductSearch(e.target.value)}
                  placeholder="Search products…"
                  className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-orange-400"
                />
              </div>
              <button
                onClick={() => setGarlicOnly(v => !v)}
                title={garlicOnly ? 'Show all products' : 'Show With/Without Garlic products only'}
                className={`px-2.5 py-2 rounded-xl text-xs border transition-colors flex-shrink-0 ${
                  garlicOnly ? 'bg-amber-100 border-amber-300 text-amber-800 font-medium' : 'bg-white border-gray-200 text-gray-500 hover:border-amber-300'
                }`}>
                🧄 Garlic
              </button>
            </div>

            {/* Clickable product grid */}
            <div className="grid grid-cols-2 gap-1.5 max-h-52 overflow-y-auto">
              {filteredProducts.length === 0 && (
                <p className="col-span-2 text-center text-xs text-gray-400 py-4">No products match "{productSearch}"</p>
              )}
              {filteredProducts.map(p => {
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
                    {p.hasGarlicOption && <p className="text-amber-700 text-xs font-medium">🧄 w/wo garlic</p>}
                    {inCart && <p className="text-green-600 font-medium mt-0.5">✓ {formatQty(inCart.quantity, p.unit)}</p>}
                  </button>
                );
              })}
            </div>

            {/* Qty stepper + add button */}
            {currentProduct && (
              <div className="space-y-2">
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
                {currentProduct.hasGarlicOption && (
                  <div className="flex items-center gap-3 px-1">
                    <span className="text-xs font-medium text-amber-700">🧄 Garlic:</span>
                    {(['without', 'with'] as const).map(opt => (
                      <label key={opt} className="flex items-center gap-1.5 cursor-pointer">
                        <input type="radio" name={`garlic-${cust.id}`} value={opt}
                          checked={(addState?.garlicPref ?? 'without') === opt}
                          onChange={() => setGarlicPref(opt)}
                          className="accent-orange-500 w-3.5 h-3.5" />
                        <span className="text-xs text-gray-700">{opt === 'with' ? '🧄 With' : '🚫 Without'}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Cart ── */}
          {cust.cart.length > 0 && (
            <div className="rounded-xl border border-gray-100 overflow-hidden">
              {/* Header */}
              <div className="px-3 py-2 flex items-center justify-between" style={{ background: '#fdf5e6' }}>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Order Items</p>
                <button onClick={onReapplyMarkup} className="text-xs text-orange-500 hover:text-orange-700 flex items-center gap-1">
                  <RefreshCw className="w-3 h-3" /> Re-apply markup
                </button>
              </div>

              {/* Column labels */}
              <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-2 px-3 py-1.5 bg-gray-50 border-b border-gray-100 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
                <span>Product</span>
                <span className="text-right w-16">SKC ₹</span>
                <span className="text-right w-20">Sell ₹</span>
                <span className="text-right w-20">Margin</span>
              </div>

              {cust.cart.map((item, i) => {
                const skcAmt = item.totalPrice;
                const custAmt = Math.round(item.sellingPrice * item.quantity);
                const marginAmt = custAmt - skcAmt;
                const marginPct = skcAmt > 0 ? Math.round(marginAmt / skcAmt * 100) : 0;
                // Per-item threshold: enforced cap or 15% warning
                const itemWarnPct = enforceMarkup && maxMarkupPct > 0 ? maxMarkupPct : 15;
                const itemHighMargin = marginPct > itemWarnPct;
                // Max allowed sell amount when enforced
                const maxSellAmt = enforceMarkup && maxMarkupPct > 0
                  ? Math.round(skcAmt * (1 + maxMarkupPct / 100))
                  : Infinity;
                return (
                  <div key={i} className={`px-3 py-2.5 space-y-2 ${i > 0 ? 'border-t border-gray-50' : ''}`}>
                    {/* Row 1: name + delete */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-800 leading-tight truncate">{item.productName}</p>
                        {item.customizationNote && <span className="text-xs text-amber-700 font-medium">{item.customizationNote}</span>}
                        {item.isOnDemand && <span className="text-[10px] text-purple-600 font-medium">On-demand</span>}
                      </div>
                      <button onClick={() => onRemoveCartItem(i)} className="p-1 hover:bg-red-50 rounded-lg flex-shrink-0">
                        <Trash2 className="w-3.5 h-3.5 text-red-400" />
                      </button>
                    </div>

                    {/* Row 2: qty stepper + pricing columns */}
                    <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-2 items-center">
                      {/* Qty stepper */}
                      <div className="flex items-center gap-0.5 bg-gray-50 rounded-lg px-1.5 py-1 border border-gray-100 w-fit">
                        <button onClick={() => onUpdateCartQty(i, Math.max(0, item.quantity - qtyStep(item.unit)))} className="p-0.5 hover:bg-gray-200 rounded">
                          <Minus className="w-3 h-3 text-gray-600" />
                        </button>
                        <span className="text-xs font-medium w-14 text-center">{formatQty(item.quantity, item.unit)}</span>
                        <button onClick={() => onUpdateCartQty(i, item.quantity + qtyStep(item.unit))} className="p-0.5 hover:bg-gray-200 rounded">
                          <Plus className="w-3 h-3 text-gray-600" />
                        </button>
                      </div>

                      {/* SKC cost */}
                      <span className="text-sm font-medium text-gray-600 w-16 text-right">₹{skcAmt}</span>

                      {/* Editable customer price */}
                      <input
                        type="number"
                        min={skcAmt}
                        step="10"
                        value={custAmt}
                        onChange={e => {
                          const raw = Number(e.target.value);
                          onUpdateItemSellingPrice(i, Math.max(0, raw) / item.quantity);
                        }}
                        onBlur={e => {
                          const raw = Number(e.target.value);
                          if (raw < skcAmt) {
                            onUpdateItemSellingPrice(i, skcAmt / item.quantity);
                            toast.error(`Sell price can't be less than SKC cost (₹${skcAmt})`);
                          } else if (enforceMarkup && maxMarkupPct > 0 && raw > maxSellAmt) {
                            onUpdateItemSellingPrice(i, maxSellAmt / item.quantity);
                            toast.error(`Max ${maxMarkupPct}% markup enforced — capped at ₹${maxSellAmt}`);
                          }
                        }}
                        className="w-20 border rounded-lg px-2 py-1 text-sm font-semibold outline-none text-center focus:border-orange-400"
                        style={{
                          borderColor: custAmt < skcAmt ? '#ef4444' : itemHighMargin ? (enforceMarkup ? '#ef4444' : '#fbbf24') : '#e5e7eb',
                          color: custAmt < skcAmt ? '#ef4444' : '#c8821a',
                        }}
                      />

                      {/* Margin */}
                      <div className="w-20 text-right">
                        {custAmt < skcAmt
                          ? <span className="text-xs font-semibold text-red-500">−₹{skcAmt - custAmt}</span>
                          : marginAmt > 0
                            ? <span className={`text-xs font-semibold ${itemHighMargin ? 'text-amber-600' : 'text-green-600'}`}>
                                +₹{marginAmt}<br />
                                <span className="font-normal text-[10px]">({marginPct}%)</span>
                              </span>
                            : <span className="text-xs text-gray-300">—</span>
                        }
                      </div>
                    </div>

                    {/* Per-item high-margin nudge */}
                    {itemHighMargin && (
                      <p className={`text-[10px] flex items-center gap-1 ${enforceMarkup ? 'text-red-600' : 'text-amber-600'}`}>
                        {enforceMarkup
                          ? `🔒 Exceeds ${maxMarkupPct}% cap — will be clamped when you leave this field.`
                          : `⚠️ ${marginPct}% margin on this item — consider reducing for customer retention.`
                        }
                      </p>
                    )}
                  </div>
                );
              })}

              {/* ── Customer totals ── */}
              <div className="border-t-2 border-orange-100 px-3 py-3 space-y-1.5" style={{ background: '#fdf5e6' }}>
                <div className="flex justify-between text-xs text-gray-500">
                  <span>SKC cost</span>
                  <span className="font-semibold text-gray-700">₹{Math.round(skc)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-green-700">Your margin profit</span>
                  <span className={`font-semibold ${margin > 0 ? 'text-green-700' : 'text-gray-400'}`}>
                    {margin > 0 ? `+₹${Math.round(margin)} (${Math.round(margin / skc * 100)}%)` : '₹0'}
                  </span>
                </div>
                <div className="flex justify-between text-sm font-bold border-t border-orange-200 pt-1.5">
                  <span style={{ color: '#3d1c02' }}>Customer pays you</span>
                  <span style={{ color: '#c8821a' }}>₹{Math.round(custTotal)}</span>
                </div>
              </div>

              {/* Overall high-margin warning */}
              {highMargin && (
                <div className="flex items-start gap-2 px-3 py-2.5 border-t" style={{ background: enforceMarkup ? '#fef2f2' : '#fffbeb', borderColor: enforceMarkup ? '#fca5a5' : '#fcd34d' }}>
                  <span className="text-base leading-none flex-shrink-0">{enforceMarkup ? '🔒' : '⚠️'}</span>
                  <p className={`text-xs ${enforceMarkup ? 'text-red-700' : 'text-amber-700'}`}>
                    {enforceMarkup
                      ? <><strong className="text-red-800">Overall {Math.round(margin / skc * 100)}% markup exceeds the {maxMarkupPct}% cap.</strong> Prices will be clamped when you leave each field.</>
                      : <><strong className="text-amber-800">Overall {Math.round(margin / skc * 100)}% markup</strong> — above 15% may deter customers. Consider lowering prices to retain them long-term.</>
                    }
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Collapsed summary */}
      {cust.collapsed && cust.cart.length > 0 && (
        <div className="px-4 pb-3 flex items-center justify-between text-xs text-gray-500">
          <span>{cust.cart.length} item{cust.cart.length > 1 ? 's' : ''} · SKC ₹{Math.round(skc)}</span>
          {margin > 0 && <span className="text-green-600 font-medium">+₹{Math.round(margin)} margin ({Math.round(margin / skc * 100)}%)</span>}
          <span className="font-semibold" style={{ color: '#c8821a' }}>Customer ₹{Math.round(custTotal)}</span>
        </div>
      )}
    </div>
  );
}


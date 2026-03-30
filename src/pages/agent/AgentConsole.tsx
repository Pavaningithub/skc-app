import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Minus, Trash2, LogOut, ShoppingBag, Package, Check, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { productsService, ordersService, agentsService, stockService } from '../../lib/services';
import { generateOrderNumber } from '../../lib/utils';
import type { Product, OrderItem, Order } from '../../lib/types';
import { getAgentSession, clearAgentSession } from './AgentLogin';

interface AgentCartItem extends OrderItem {
  markupPerUnit: number; // ₹ per unit above SKC price
}

type MarkupMode = 'rupees' | 'percent';

export default function AgentConsole() {
  const navigate = useNavigate();
  const agentSession = getAgentSession();

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  // Order form
  const [customerName, setCustomerName] = useState('');
  const [customerPlace, setCustomerPlace] = useState('');
  const [notes, setNotes] = useState('');
  const [cart, setCart] = useState<AgentCartItem[]>([]);
  const [saving, setSaving] = useState(false);

  // Product picker
  const [selectedProductId, setSelectedProductId] = useState('');
  const [selectedQty, setSelectedQty] = useState(100);

  // Global markup
  const [globalMarkupMode, setGlobalMarkupMode] = useState<MarkupMode>('rupees');
  const [globalMarkupValue, setGlobalMarkupValue] = useState(0);
  const [savingMarkup, setSavingMarkup] = useState(false);
  const [markupSaved, setMarkupSaved] = useState(false);

  // Recent orders
  const [recentOrders, setRecentOrders] = useState<Order[]>([]);
  const [showOrders, setShowOrders] = useState(false);
  const [loadingOrders, setLoadingOrders] = useState(false);

  useEffect(() => {
    if (!agentSession) { navigate('/agent/login'); return; }
    if (agentSession.savedMarkupType) setGlobalMarkupMode(agentSession.savedMarkupType);
    if (agentSession.savedMarkupValue) setGlobalMarkupValue(agentSession.savedMarkupValue);
    productsService.getActive().then(p => {
      setProducts(p);
      if (p.length > 0) setSelectedProductId(p[0].id);
      setLoading(false);
    });
  }, []);

  if (!agentSession) return null;
  const agent = agentSession;
  const selectedProduct = products.find(p => p.id === selectedProductId);

  // ── Markup helpers ────────────────────────────────────────────────────────
  function computeMarkupForProduct(product: Product): number {
    if (globalMarkupValue <= 0) return 0;
    if (globalMarkupMode === 'rupees') return globalMarkupValue;
    return Math.round(product.pricePerUnit * globalMarkupValue / 100);
  }

  function applyMarkupToAll() {
    setCart(prev => prev.map(item => {
      const product = products.find(p => p.id === item.productId);
      if (!product) return item;
      const markup = computeMarkupForProduct(product);
      return { ...item, markupPerUnit: markup, agentMarkup: markup };
    }));
    toast.success('Markup applied to all items');
  }

  async function saveMarkupPreference() {
    setSavingMarkup(true);
    try {
      await agentsService.saveMarkupPreference(agent.id, globalMarkupMode, globalMarkupValue);
      const session = { ...agent, savedMarkupType: globalMarkupMode, savedMarkupValue: globalMarkupValue };
      sessionStorage.setItem('skc_agent_session', JSON.stringify(session));
      setMarkupSaved(true);
      setTimeout(() => setMarkupSaved(false), 2500);
    } finally { setSavingMarkup(false); }
  }

  // ── Cart calcs ────────────────────────────────────────────────────────────
  const skcSubtotal = cart.reduce((s, i) => s + i.totalPrice, 0);
  const agentMargin = cart.reduce((s, i) => s + i.markupPerUnit * i.quantity, 0);
  const agentCommission = Math.round(skcSubtotal * agent.commissionPercent / 100);
  const customerSubtotal = skcSubtotal + agentMargin;

  function addToCart() {
    if (!selectedProduct) return;
    const qty = Number(selectedQty);
    if (qty <= 0) return toast.error('Enter a valid quantity');
    const markup = computeMarkupForProduct(selectedProduct);
    const existing = cart.findIndex(i => i.productId === selectedProduct.id);
    if (existing >= 0) {
      setCart(prev => prev.map((item, i) => i === existing
        ? { ...item, quantity: item.quantity + qty, totalPrice: (item.quantity + qty) * item.pricePerUnit }
        : item));
    } else {
      setCart(prev => [...prev, {
        productId: selectedProduct.id, productName: selectedProduct.name,
        unit: selectedProduct.unit, quantity: qty,
        pricePerUnit: selectedProduct.pricePerUnit, totalPrice: qty * selectedProduct.pricePerUnit,
        isOnDemand: selectedProduct.isOnDemand, agentMarkup: markup, markupPerUnit: markup,
      }]);
    }
  }

  function removeFromCart(idx: number) { setCart(c => c.filter((_, i) => i !== idx)); }

  function updateQty(idx: number, qty: number) {
    if (qty <= 0) return removeFromCart(idx);
    setCart(prev => prev.map((item, i) => i === idx
      ? { ...item, quantity: qty, totalPrice: qty * item.pricePerUnit } : item));
  }

  function updateItemMarkup(idx: number, markup: number) {
    setCart(prev => prev.map((item, i) => i === idx
      ? { ...item, markupPerUnit: markup, agentMarkup: markup } : item));
  }

  // ── Place Order ───────────────────────────────────────────────────────────
  async function placeOrder() {
    if (!customerName.trim()) return toast.error("Enter your customer's name");
    if (cart.length === 0) return toast.error('Add at least one product');
    setSaving(true);
    try {
      const orderItems: OrderItem[] = cart.map(i => ({
        productId: i.productId, productName: i.productName, unit: i.unit,
        quantity: i.quantity, pricePerUnit: i.pricePerUnit, totalPrice: i.totalPrice,
        isOnDemand: i.isOnDemand, agentMarkup: i.markupPerUnit,
      }));
      const order: Omit<Order, 'id'> = {
        orderNumber: generateOrderNumber(), type: 'regular',
        customerName: customerName.trim(),
        customerWhatsapp: agent.phone,  // agent's phone for tracking
        customerPlace: customerPlace.trim(),
        items: orderItems, subtotal: skcSubtotal,
        discount: 0, total: skcSubtotal,  // no discounts on agent orders
        status: 'confirmed', paymentStatus: 'pending',
        notes: notes.trim(), hasOnDemandItems: cart.some(i => i.isOnDemand),
        referralDiscount: 0, creditUsed: 0, deliveryCharge: 0,
        agentId: agent.id, agentName: agent.name, agentCommission,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      await ordersService.add(order);
      for (const item of cart) {
        if (!item.isOnDemand) await stockService.deduct(item.productId, item.quantity, { productName: item.productName, unit: item.unit });
      }
      await agentsService.recordOrder(agent.id, skcSubtotal, agentCommission);
      toast.success('Order placed! 🎉');
      setCart([]); setCustomerName(''); setCustomerPlace(''); setNotes('');
    } catch (err) { console.error(err); toast.error('Failed to place order'); }
    finally { setSaving(false); }
  }

  async function loadRecentOrders() {
    setLoadingOrders(true);
    try {
      const all = await ordersService.getAll();
      setRecentOrders(all.filter(o => o.agentId === agent.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 30));
      setShowOrders(true);
    } finally { setLoadingOrders(false); }
  }

  function logout() { clearAgentSession(); navigate('/agent/login'); }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#fdf5e6' }}>
      <div className="w-8 h-8 border-4 border-orange-400 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="min-h-screen" style={{ background: '#fdf5e6' }}>

      {/* Header */}
      <div className="sticky top-0 z-10 px-4 py-3 flex items-center justify-between shadow-sm" style={{ background: '#3d1c02' }}>
        <div>
          <p className="text-white font-bold text-sm">🤝 {agent.name}</p>
          <p className="text-orange-300 text-xs">{agent.phone} · {agent.agentCode}</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={showOrders ? () => setShowOrders(false) : loadRecentOrders}
            disabled={loadingOrders}
            className="text-xs text-orange-300 hover:text-white flex items-center gap-1">
            <Package className="w-4 h-4" />
            {loadingOrders ? 'Loading…' : showOrders ? '+ New Order' : 'My Orders'}
          </button>
          <button onClick={logout} className="text-orange-300 hover:text-white"><LogOut className="w-4 h-4" /></button>
        </div>
      </div>

      {/* Recent Orders */}
      {showOrders && (
        <div className="max-w-xl mx-auto p-4 space-y-3">
          <h2 className="font-bold text-gray-800">My Orders</h2>
          {recentOrders.length === 0 && <p className="text-sm text-gray-400 text-center py-8">No orders yet.</p>}
          {recentOrders.map(o => (
            <div key={o.id} className="bg-white rounded-xl border border-gray-100 px-4 py-3 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono text-gray-400">#{o.orderNumber}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${o.paymentStatus === 'paid' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                  {o.paymentStatus}
                </span>
              </div>
              <p className="text-sm font-semibold text-gray-800">{o.customerName}
                {o.customerPlace && <span className="text-gray-400 font-normal text-xs ml-1">· {o.customerPlace}</span>}
              </p>
              <p className="text-xs text-gray-500">{o.items.map(i => `${i.productName} ${i.quantity}${i.unit}`).join(', ')}</p>
              <div className="flex justify-between text-xs text-gray-500 pt-1 border-t border-gray-50">
                <span>SKC: <strong className="text-gray-700">₹{o.total}</strong></span>
                {(o.agentCommission ?? 0) > 0 && <span className="text-green-600">Commission: <strong>₹{o.agentCommission}</strong></span>}
                <span>{new Date(o.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' })}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Place Order */}
      {!showOrders && (
        <div className="max-w-xl mx-auto p-4 space-y-4 pb-10">

          {/* Global Markup Panel */}
          <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Your Markup</p>
              {agent.savedMarkupValue && agent.savedMarkupValue > 0 && (
                <span className="text-xs text-green-600">
                  Saved: {agent.savedMarkupType === 'percent' ? `${agent.savedMarkupValue}%` : `₹${agent.savedMarkupValue}`}
                </span>
              )}
            </div>

            <div className="flex gap-2 items-center">
              {/* ₹ / % toggle */}
              <div className="flex rounded-xl overflow-hidden border border-gray-200 flex-shrink-0">
                <button onClick={() => setGlobalMarkupMode('rupees')}
                  className={`px-3 py-2 text-sm font-bold transition-colors ${globalMarkupMode === 'rupees' ? 'text-white' : 'text-gray-500'}`}
                  style={globalMarkupMode === 'rupees' ? { background: '#3d1c02' } : {}}>₹</button>
                <button onClick={() => setGlobalMarkupMode('percent')}
                  className={`px-3 py-2 text-sm font-bold transition-colors ${globalMarkupMode === 'percent' ? 'text-white' : 'text-gray-500'}`}
                  style={globalMarkupMode === 'percent' ? { background: '#3d1c02' } : {}}>%</button>
              </div>
              <input type="number" min="0" step={globalMarkupMode === 'percent' ? '0.5' : '1'}
                value={globalMarkupValue || ''}
                onChange={e => setGlobalMarkupValue(Math.max(0, Number(e.target.value)))}
                placeholder={globalMarkupMode === 'rupees' ? 'e.g. 50' : 'e.g. 10'}
                className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-orange-400" />
              {cart.length > 0 && (
                <button onClick={applyMarkupToAll}
                  className="text-xs font-semibold px-3 py-2 rounded-xl border border-orange-300 text-orange-600 hover:bg-orange-50 flex-shrink-0 flex items-center gap-1">
                  <RefreshCw className="w-3.5 h-3.5" />Apply all
                </button>
              )}
            </div>

            {selectedProduct && globalMarkupValue > 0 && (
              <p className="text-xs text-gray-400">
                {selectedProduct.name} ₹{selectedProduct.pricePerUnit} →
                customer pays <strong className="text-green-600">₹{selectedProduct.pricePerUnit + computeMarkupForProduct(selectedProduct)}/{selectedProduct.unit}</strong>
              </p>
            )}

            <button onClick={saveMarkupPreference} disabled={savingMarkup}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl border transition-colors disabled:opacity-50"
              style={markupSaved ? { background: '#f0fdf4', borderColor: '#86efac', color: '#166534' } : { borderColor: '#e0d0c0', color: '#7a4010' }}>
              {markupSaved ? <><Check className="w-3.5 h-3.5" />Saved!</> : savingMarkup ? 'Saving…' : '💾 Save for future orders'}
            </button>
          </div>

          {/* Customer Details */}
          <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Customer Details</p>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Customer Name *</label>
              <input type="text" value={customerName} onChange={e => setCustomerName(e.target.value)}
                placeholder="Your customer's name"
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-orange-400" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Area / Place</label>
              <input type="text" value={customerPlace} onChange={e => setCustomerPlace(e.target.value)}
                placeholder="e.g. Rajajinagar, Mysore"
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-orange-400" />
            </div>
          </div>

          {/* Add Products */}
          <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Add Products</p>
            <div className="flex gap-2">
              <select value={selectedProductId} onChange={e => setSelectedProductId(e.target.value)}
                className="flex-1 border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-orange-400 bg-white">
                {products.map(p => <option key={p.id} value={p.id}>{p.name} — ₹{p.pricePerUnit}/{p.unit}</option>)}
              </select>
              <input type="number" min="1" value={selectedQty} onChange={e => setSelectedQty(Number(e.target.value))}
                className="w-20 border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-orange-400 text-center"
                placeholder={selectedProduct?.unit === 'piece' ? 'pcs' : 'gm'} />
            </div>
            <button onClick={addToCart}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-white text-sm font-semibold"
              style={{ background: '#c8821a' }}>
              <Plus className="w-4 h-4" /> Add to Order
              {selectedProduct && globalMarkupValue > 0 && (
                <span className="text-orange-200 font-normal text-xs">
                  (+₹{computeMarkupForProduct(selectedProduct)} markup)
                </span>
              )}
            </button>
          </div>

          {/* Cart */}
          {cart.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-50 flex items-center justify-between">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Order Items</p>
                {cart.length > 1 && (
                  <button onClick={applyMarkupToAll}
                    className="text-xs text-orange-500 hover:text-orange-700 font-medium flex items-center gap-1">
                    <RefreshCw className="w-3 h-3" />Apply global markup to all
                  </button>
                )}
              </div>

              {cart.map((item, i) => {
                const customerItemTotal = item.totalPrice + item.markupPerUnit * item.quantity;
                return (
                  <div key={i} className={`px-4 py-3 space-y-2 ${i > 0 ? 'border-t border-gray-50' : ''}`}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-800 truncate">{item.productName}</p>
                        <p className="text-xs text-gray-400">SKC ₹{item.pricePerUnit}/{item.unit}</p>
                      </div>
                      <button onClick={() => removeFromCart(i)} className="p-1 hover:bg-red-50 rounded-lg">
                        <Trash2 className="w-4 h-4 text-red-400" />
                      </button>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="flex items-center gap-1 bg-gray-50 rounded-lg px-2 py-1">
                        <button onClick={() => updateQty(i, item.quantity - (item.unit === 'piece' ? 1 : 50))}
                          className="p-0.5 hover:bg-gray-200 rounded"><Minus className="w-3 h-3 text-gray-600" /></button>
                        <span className="text-sm font-medium w-14 text-center">{item.quantity}{item.unit === 'piece' ? 'pc' : 'g'}</span>
                        <button onClick={() => updateQty(i, item.quantity + (item.unit === 'piece' ? 1 : 50))}
                          className="p-0.5 hover:bg-gray-200 rounded"><Plus className="w-3 h-3 text-gray-600" /></button>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-gray-400">Markup ₹</span>
                        <input type="number" min="0" step="1"
                          value={item.markupPerUnit || ''}
                          onChange={e => updateItemMarkup(i, Math.max(0, Number(e.target.value)))}
                          placeholder="0"
                          className="w-16 border border-gray-200 rounded-lg px-2 py-1 text-xs outline-none focus:border-orange-400 text-center" />
                        <span className="text-xs text-gray-400">/unit</span>
                      </div>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-400">SKC: ₹{item.totalPrice}</span>
                      {item.markupPerUnit > 0 && (
                        <span className="text-green-600 font-medium">
                          Customer: ₹{customerItemTotal} · margin: ₹{item.markupPerUnit * item.quantity}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}

              <div className="border-t border-gray-100 px-4 py-3 space-y-1.5" style={{ background: '#fdf5e6' }}>
                <div className="flex justify-between text-sm text-gray-600">
                  <span>SKC charges you</span><span className="font-semibold">₹{skcSubtotal}</span>
                </div>
                {agentMargin > 0 && (
                  <div className="flex justify-between text-sm text-green-700">
                    <span>Your markup (margin)</span><span className="font-semibold">+₹{agentMargin}</span>
                  </div>
                )}
                {agent.commissionPercent > 0 && (
                  <div className="flex justify-between text-sm text-blue-700">
                    <span>Commission from SKC ({agent.commissionPercent}%)</span>
                    <span className="font-semibold">+₹{agentCommission}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-sm border-t border-orange-200 pt-1.5">
                  <span>Customer pays you</span>
                  <span style={{ color: '#c8821a' }}>₹{customerSubtotal}</span>
                </div>
              </div>
            </div>
          )}

          {/* Notes */}
          <div className="bg-white rounded-2xl border border-gray-100 p-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              placeholder="Special instructions for SKC…"
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none resize-none focus:border-orange-400" />
          </div>

          {/* High margin warning */}
          {cart.length > 0 && skcSubtotal > 0 && agentMargin / skcSubtotal > 0.15 && (
            <div className="flex items-start gap-3 rounded-2xl px-4 py-3 border"
              style={{ background: '#fffbeb', borderColor: '#fcd34d' }}>
              <span className="text-xl leading-none flex-shrink-0">⚠️</span>
              <div className="text-sm">
                <p className="font-semibold text-amber-800">High markup — {Math.round(agentMargin / skcSubtotal * 100)}% above SKC price</p>
                <p className="text-amber-700 text-xs mt-0.5">
                  Your customer may feel the price is overvalued compared to the market.
                  Keeping markup under 15% helps retain customers long-term.
                </p>
              </div>
            </div>
          )}

          <button onClick={placeOrder}
            disabled={saving || cart.length === 0 || !customerName.trim()}
            className="w-full py-4 rounded-2xl text-white font-bold text-sm disabled:opacity-40 flex items-center justify-center gap-2"
            style={{ background: '#3d1c02' }}>
            <ShoppingBag className="w-5 h-5" />
            {saving ? 'Placing Order…' : `Place Order · ₹${skcSubtotal} to SKC`}
          </button>

          <p className="text-center text-xs text-gray-400">
            SKC will hand you a feedback slip on delivery to share with your customer.
          </p>
        </div>
      )}
    </div>
  );
}

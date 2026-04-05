import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Search, Copy, Share2, ChevronDown, ChevronUp,
  ArrowLeft, Star, Leaf, CheckCircle2, Clock, Truck, XCircle,
  Package, Gift, Phone, RefreshCw,
} from 'lucide-react';
import { ordersService, customersService } from '../../lib/services';
import {
  normalizeWhatsapp, formatCurrency, formatDate,
  referralShareMessage, computeReferralDiscountFromTiers,
} from '../../lib/utils';
import { useReferralConfig } from '../../lib/useReferralConfig';
import { APP_CONFIG } from '../../config';
import toast from 'react-hot-toast';
import type { Order } from '../../lib/types';

const EDITABLE_STATUSES = ['pending', 'confirmed'];
const LS_KEY = 'skc_my_phone';

const STATUS_META: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  pending:          { label: 'Pending',          color: 'bg-yellow-100 text-yellow-700', icon: <Clock className="w-3 h-3" /> },
  confirmed:        { label: 'Confirmed',        color: 'bg-blue-100 text-blue-700',    icon: <CheckCircle2 className="w-3 h-3" /> },
  out_for_delivery: { label: 'Out for Delivery', color: 'bg-purple-100 text-purple-700', icon: <Truck className="w-3 h-3" /> },
  delivered:        { label: 'Delivered',        color: 'bg-green-100 text-green-700',  icon: <CheckCircle2 className="w-3 h-3" /> },
  cancelled:        { label: 'Cancelled',        color: 'bg-red-100 text-red-400',      icon: <XCircle className="w-3 h-3" /> },
};

export default function MyAccountPage() {
  const [searchParams] = useSearchParams();
  const [phone, setPhone]               = useState('');
  const [loading, setLoading]           = useState(false);
  const [orders, setOrders]             = useState<Order[] | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [referralCode, setReferralCode] = useState<string | null>(null);
  const [referralCredit, setReferralCredit] = useState(0);
  const [notFound, setNotFound]         = useState(false);
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null);
  const [editingNotes, setEditingNotes]   = useState<Record<string, string>>({});
  const [savingNotes, setSavingNotes]     = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<'orders' | 'referral'>(
    searchParams.get('tab') === 'referral' ? 'referral' : 'orders'
  );

  const { config: referralConfig } = useReferralConfig();
  const storeUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const topTier = referralConfig.tiers.length > 0
    ? referralConfig.tiers.reduce((b, t) => t.minOrder > b.minOrder ? t : b, referralConfig.tiers[0])
    : null;
  const topTierSample = topTier
    ? computeReferralDiscountFromTiers(
        topTier.cap !== null ? Math.ceil(topTier.cap / (topTier.pct / 100)) : topTier.minOrder,
        referralConfig.tiers, referralConfig.splitReferrerPct)
    : null;
  const topTierHint = topTier && topTierSample
    ? `up to ₹${topTierSample.customerDiscount} off on orders ₹${topTier.minOrder}+`
    : undefined;
  const shareMsg = referralCode ? referralShareMessage(customerName, referralCode, storeUrl, topTierHint) : '';
  const shareUrl = `https://wa.me/?text=${encodeURIComponent(shareMsg)}`;
  const digits = normalizeWhatsapp(phone);

  // Restore saved phone on mount and auto-lookup
  useEffect(() => {
    const saved = localStorage.getItem(LS_KEY);
    if (saved) {
      setPhone(saved);
      doLookup(saved);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function doLookup(rawPhone: string) {
    const d = normalizeWhatsapp(rawPhone);
    if (d.length < 10) return;
    setLoading(true);
    setOrders(null);
    setNotFound(false);
    setReferralCode(null);
    setExpandedOrder(null);
    try {
      const [customer, fetchedOrders] = await Promise.all([
        customersService.getByWhatsapp(d),
        ordersService.getByWhatsapp(d),
      ]);
      if (!customer && fetchedOrders.length === 0) { setNotFound(true); return; }
      if (customer) {
        setCustomerName(customer.name);
        setReferralCode(customer.referralCode ?? null);
        setReferralCredit(customer.referralCredit ?? 0);
      } else if (fetchedOrders.length > 0) {
        setCustomerName(fetchedOrders[0].customerName);
      }
      setOrders(fetchedOrders);
      localStorage.setItem(LS_KEY, rawPhone);
      const notesMap: Record<string, string> = {};
      for (const o of fetchedOrders) notesMap[o.id] = o.notes ?? '';
      setEditingNotes(notesMap);
    } finally {
      setLoading(false);
    }
  }

  function lookup() { doLookup(phone); }

  function switchAccount() {
    localStorage.removeItem(LS_KEY);
    setPhone('');
    setOrders(null);
    setNotFound(false);
    setCustomerName('');
    setReferralCode(null);
    setReferralCredit(0);
  }

  async function saveNotes(order: Order) {
    const newNotes = editingNotes[order.id] ?? '';
    if (newNotes === order.notes) return;
    setSavingNotes(prev => new Set(prev).add(order.id));
    try {
      await ordersService.update(order.id, { notes: newNotes });
      const fresh = await ordersService.getByWhatsapp(digits);
      setOrders(fresh);
      toast.success('Notes updated!');
    } catch {
      toast.error('Failed to save — please try again');
    } finally {
      setSavingNotes(prev => { const n = new Set(prev); n.delete(order.id); return n; });
    }
  }

  function copyCode() {
    if (!referralCode) return;
    navigator.clipboard.writeText(referralCode).then(() => toast.success('Code copied!'));
  }

  const hasResult = orders !== null;
  const activeOrders = orders?.filter(o => !['delivered', 'cancelled'].includes(o.status)) ?? [];
  const pastOrders   = orders?.filter(o => ['delivered', 'cancelled'].includes(o.status)) ?? [];

  return (
    <div className="min-h-screen" style={{ background: '#fdf5e6' }}>
      {/* Version badge */}
      <div className="fixed bottom-3 right-3 z-50 flex items-center gap-1.5 px-2.5 py-1 rounded-full shadow-md text-white text-xs font-mono"
        style={{ background: __APP_ENV__ === 'production' ? '#22c55e' : '#3b82f6', opacity: 0.85 }}
        title={__APP_ENV__ === 'production' ? 'Production (Green)' : 'Staging (Blue)'}>
        <span className="w-1.5 h-1.5 rounded-full bg-white/70" />
        v{__APP_VERSION__}{__APP_ENV__ !== 'production' && ` · ${__APP_ENV__}`}
      </div>
      {/* Header */}
      <div className="sticky top-0 z-10 shadow-sm" style={{ background: 'linear-gradient(90deg, #3d1c02 0%, #7a4010 50%, #3d1c02 100%)', borderBottom: '2px solid #c8821a' }}>
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/" className="text-orange-300 hover:text-white transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div className="flex items-center gap-2">
              <Leaf className="w-5 h-5 text-orange-400" />
              <span className="font-bold text-white text-base">My Account</span>
            </div>
          </div>
          {hasResult && (
            <button onClick={switchAccount}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full transition-colors"
              style={{ color: '#ffd700', border: '1px solid rgba(200,130,26,0.5)' }}>
              <RefreshCw className="w-3 h-3" /> Switch
            </button>
          )}
        </div>
      </div>

      {!hasResult ? (
        /* ── Lookup screen ───────────────────────────────────────────────── */
        <div className="max-w-lg mx-auto px-4 pt-10 pb-16 space-y-6">
          {/* Welcome card */}
          <div className="text-center space-y-2">
            <div className="w-20 h-20 rounded-full flex items-center justify-center text-4xl mx-auto shadow-md"
              style={{ background: 'linear-gradient(135deg, #c8821a, #3d1c02)', border: '3px solid #c8821a' }}>
              🪷
            </div>
            <h1 className="text-xl font-bold" style={{ color: '#3d1c02', fontFamily: 'Georgia, serif' }}>Welcome Back!</h1>
            <p className="text-sm text-gray-500">Enter your WhatsApp number to view your orders and referral code.</p>
          </div>

          {/* Phone input */}
          <div className="bg-white rounded-2xl shadow-sm p-5 space-y-4" style={{ border: '1px solid #f0d9c8' }}>
            <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: '#3d1c02' }}>
              <Phone className="w-4 h-4 text-orange-500" /> Your WhatsApp Number
            </div>
            <div className="flex gap-2">
              <input
                type="tel" inputMode="numeric" maxLength={10}
                placeholder="10-digit number"
                value={phone}
                onChange={e => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                onKeyDown={e => e.key === 'Enter' && lookup()}
                className="flex-1 border border-gray-200 rounded-xl px-3 py-3 text-sm focus:outline-none focus:border-orange-400 focus:ring-1 focus:ring-orange-200"
              />
              <button onClick={lookup} disabled={loading || digits.length < 10}
                className="flex items-center gap-1.5 px-5 py-3 rounded-xl text-sm font-semibold text-white transition-colors disabled:opacity-50"
                style={{ background: '#c8821a' }}>
                {loading
                  ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  : <><Search className="w-4 h-4" /> Find</>}
              </button>
            </div>
            <p className="text-xs text-gray-400 flex items-center gap-1">
              🔒 Used only to look up your account. Never shared.
            </p>
          </div>

          {/* Not found */}
          {notFound && (
            <div className="bg-white rounded-2xl shadow-sm p-6 text-center space-y-3" style={{ border: '1px solid #f0d9c8' }}>
              <p className="text-3xl">🔍</p>
              <p className="text-sm font-semibold text-gray-700">No account found for <strong>{phone}</strong></p>
              <p className="text-xs text-gray-400">Make sure you're using the same number you placed your order with.</p>
              <a
                href={`https://wa.me/${APP_CONFIG.WHATSAPP_NUMBER}?text=${encodeURIComponent('Hi, I placed an order and need help finding it. My number: ' + phone)}`}
                target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-semibold px-4 py-2.5 rounded-xl text-white"
                style={{ background: '#25d366' }}>
                💬 Contact us on WhatsApp
              </a>
            </div>
          )}

          {/* Quick links */}
          <div className="flex gap-3 justify-center">
            <a href="/" className="text-xs text-gray-400 hover:text-orange-600 transition-colors">← Back to Store</a>
            <span className="text-gray-300">·</span>

          </div>
        </div>
      ) : (
        /* ── Account dashboard ───────────────────────────────────────────── */
        <div className="max-w-lg mx-auto px-4 py-5 space-y-4">

          {/* Profile strip */}
          <div className="rounded-2xl px-4 py-3.5 flex items-center gap-3"
            style={{ background: 'linear-gradient(135deg, #3d1c02 0%, #7a4010 100%)', border: '1px solid #c8821a' }}>
            <div className="w-12 h-12 rounded-full flex items-center justify-center text-2xl flex-shrink-0"
              style={{ background: 'rgba(200,130,26,0.3)', border: '2px solid #c8821a' }}>
              🪷
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-white text-base truncate">{customerName || 'Welcome back!'}</p>
              <p className="text-xs flex items-center gap-1" style={{ color: 'rgba(255,255,255,0.6)' }}>
                <Phone className="w-3 h-3" /> {phone}
              </p>
            </div>
            <div className="text-right flex-shrink-0">
              <p className="text-xs" style={{ color: 'rgba(255,255,255,0.5)' }}>Orders</p>
              <p className="text-xl font-bold" style={{ color: '#c8821a' }}>{orders?.length ?? 0}</p>
            </div>
          </div>

          {/* Summary pills */}
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-white rounded-xl p-3 text-center shadow-sm" style={{ border: '1px solid #f0d9c8' }}>
              <p className="text-lg font-bold" style={{ color: '#c8821a' }}>{activeOrders.length}</p>
              <p className="text-xs text-gray-500 mt-0.5">Active</p>
            </div>
            <div className="bg-white rounded-xl p-3 text-center shadow-sm" style={{ border: '1px solid #f0d9c8' }}>
              <p className="text-lg font-bold" style={{ color: '#3d1c02' }}>{pastOrders.length}</p>
              <p className="text-xs text-gray-500 mt-0.5">Delivered</p>
            </div>
            <div className="bg-white rounded-xl p-3 text-center shadow-sm" style={{ border: '1px solid #f0d9c8' }}>
              <p className="text-lg font-bold text-green-600">₹{referralCredit}</p>
              <p className="text-xs text-gray-500 mt-0.5">Credit</p>
            </div>
          </div>

          {/* Referral credit banner */}
          {referralCredit > 0 && (
            <div className="rounded-2xl px-4 py-3 flex items-center gap-3"
              style={{ background: '#fff8e1', border: '1px solid #ffe082' }}>
              <span className="text-2xl">🎉</span>
              <div>
                <p className="text-sm font-bold" style={{ color: '#3d1c02' }}>₹{referralCredit} referral credit available!</p>
                <p className="text-xs text-gray-500">Applied automatically at checkout.</p>
              </div>
            </div>
          )}

          {/* Tabs */}
          <div className="flex rounded-xl overflow-hidden border" style={{ borderColor: '#f0d9c8' }}>
            <button onClick={() => setActiveTab('orders')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-semibold transition-colors ${activeTab === 'orders' ? 'text-white' : 'text-gray-500 bg-white'}`}
              style={activeTab === 'orders' ? { background: '#c8821a' } : {}}>
              <Package className="w-4 h-4" /> Orders {orders && orders.length > 0 ? `(${orders.length})` : ''}
            </button>
            <button onClick={() => setActiveTab('referral')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-semibold transition-colors ${activeTab === 'referral' ? 'text-white' : 'text-gray-500 bg-white'}`}
              style={activeTab === 'referral' ? { background: '#c8821a' } : {}}>
              <Gift className="w-4 h-4" /> Referral
            </button>
          </div>

          {/* ── Orders tab ── */}
          {activeTab === 'orders' && (
            <div className="space-y-3">
              {orders && orders.length === 0 && (
                <div className="bg-white rounded-2xl shadow-sm p-8 text-center" style={{ border: '1px solid #f0d9c8' }}>
                  <p className="text-4xl mb-2">📭</p>
                  <p className="text-sm font-semibold text-gray-600">No orders yet</p>
                  <a href="/" className="inline-block mt-3 text-xs font-semibold px-4 py-2 rounded-xl text-white" style={{ background: '#c8821a' }}>
                    Shop Now →
                  </a>
                </div>
              )}

              {/* Active orders */}
              {activeOrders.length > 0 && (
                <div>
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wide px-1 mb-2">Active Orders</p>
                  {activeOrders.map(order => <OrderCard key={order.id} order={order} expanded={expandedOrder === order.id}
                    onToggle={() => setExpandedOrder(expandedOrder === order.id ? null : order.id)}
                    editingNotes={editingNotes} setEditingNotes={setEditingNotes}
                    savingNotes={savingNotes} onSave={() => saveNotes(order)} digits={digits} />)}
                </div>
              )}

              {/* Past orders */}
              {pastOrders.length > 0 && (
                <div>
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wide px-1 mb-2">Past Orders</p>
                  {pastOrders.map(order => <OrderCard key={order.id} order={order} expanded={expandedOrder === order.id}
                    onToggle={() => setExpandedOrder(expandedOrder === order.id ? null : order.id)}
                    editingNotes={editingNotes} setEditingNotes={setEditingNotes}
                    savingNotes={savingNotes} onSave={() => saveNotes(order)} digits={digits} />)}
                </div>
              )}
            </div>
          )}

          {/* ── Referral tab ── */}
          {activeTab === 'referral' && (
            <div className="space-y-3">
              {referralCode ? (
                <>
                  {/* Code card */}
                  <div className="bg-white rounded-2xl shadow-sm overflow-hidden" style={{ border: '1px solid #f0d9c8' }}>
                    <div className="px-5 pt-5 pb-4 text-center"
                      style={{ background: 'linear-gradient(135deg, #fff8e1 0%, #fdf5e6 100%)' }}>
                      <p className="text-xs text-gray-400 uppercase tracking-widest font-medium mb-1">Your Referral Code</p>
                      <p className="text-4xl font-bold tracking-widest mb-1" style={{ color: '#c8821a', fontFamily: 'Georgia, serif' }}>
                        {referralCode}
                      </p>
                      <p className="text-xs text-gray-500">Share this code with friends to earn credit</p>
                    </div>
                    <div className="flex border-t" style={{ borderColor: '#f0d9c8' }}>
                      <button onClick={copyCode}
                        className="flex-1 flex items-center justify-center gap-1.5 py-3 text-sm font-semibold transition-colors hover:bg-orange-50"
                        style={{ color: '#c8821a', borderRight: '1px solid #f0d9c8' }}>
                        <Copy className="w-4 h-4" /> Copy
                      </button>
                      <a href={shareUrl} target="_blank" rel="noreferrer"
                        className="flex-1 flex items-center justify-center gap-1.5 py-3 text-sm font-semibold text-white"
                        style={{ background: '#25d366' }}>
                        <Share2 className="w-4 h-4" /> Share on WhatsApp
                      </a>
                    </div>
                  </div>

                  {/* Tiers */}
                  <div className="bg-white rounded-2xl shadow-sm p-4 space-y-3" style={{ border: '1px solid #f0d9c8' }}>
                    <p className="text-sm font-bold" style={{ color: '#3d1c02' }}>💡 How it works</p>
                    <div className="space-y-2">
                      {referralConfig.tiers.map((tier, i) => {
                        // Compute at the amount that yields the maximum discount for this tier
                        const maxAmt = tier.cap !== null
                          ? Math.ceil(tier.cap / (tier.pct / 100))
                          : tier.maxOrder !== null
                            ? tier.maxOrder - 1
                            : tier.minOrder;
                        const disc = computeReferralDiscountFromTiers(maxAmt, referralConfig.tiers, referralConfig.splitReferrerPct);
                        const rangeLabel = tier.maxOrder ? `₹${tier.minOrder}–₹${tier.maxOrder - 1}` : `₹${tier.minOrder}+`;
                        return (
                          <div key={i} className="flex items-center gap-3 rounded-xl px-3 py-2.5" style={{ background: '#fdf5e6' }}>
                            <span className="text-xl">{'🥉🥈🥇'[Math.min(i, 2)]}</span>
                            <div className="flex-1 text-xs">
                              <span className="text-gray-500">Friend orders {rangeLabel}</span>
                              <div className="flex gap-3 mt-0.5">
                                <span className="font-semibold text-green-600">Friend gets ₹{disc.customerDiscount} off</span>
                                <span className="font-semibold" style={{ color: '#c8821a' }}>You earn ₹{disc.referrerCredit}</span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <p className="text-xs text-gray-400">Credit is applied automatically at checkout on your next order.</p>
                  </div>
                </>
              ) : (
                <div className="bg-white rounded-2xl shadow-sm p-6 text-center space-y-3" style={{ border: '1px solid #f0d9c8' }}>
                  <p className="text-3xl">🎁</p>
                  <p className="text-sm font-semibold text-gray-700">No referral code yet</p>
                  <p className="text-xs text-gray-400">Referral codes are assigned after your first order. Contact us if you think this is an error.</p>
                  <a
                    href={`https://wa.me/${APP_CONFIG.WHATSAPP_NUMBER}?text=${encodeURIComponent('Hi, I placed an order but don\'t have a referral code. My number: ' + phone)}`}
                    target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs font-semibold px-4 py-2.5 rounded-xl text-white"
                    style={{ background: '#25d366' }}>
                    💬 Contact us
                  </a>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── OrderCard sub-component ────────────────────────────────────────────────── */
function OrderCard({ order, expanded, onToggle, editingNotes, setEditingNotes, savingNotes, onSave, digits: _digits }: {
  order: Order;
  expanded: boolean;
  onToggle: () => void;
  editingNotes: Record<string, string>;
  setEditingNotes: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  savingNotes: Set<string>;
  onSave: () => void;
  digits: string;
}) {
  const meta = STATUS_META[order.status] ?? STATUS_META['pending'];
  const canEdit = EDITABLE_STATUSES.includes(order.status);
  const currentNotes = editingNotes[order.id] ?? order.notes ?? '';
  const notesChanged = currentNotes !== (order.notes ?? '');
  const isSaving = savingNotes.has(order.id);

  return (
    <div className="bg-white rounded-2xl shadow-sm overflow-hidden mb-2" style={{ border: '1px solid #f0d9c8' }}>
      <button className="w-full text-left px-4 py-3.5 flex items-start justify-between gap-3" onClick={onToggle}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="font-mono text-xs font-bold" style={{ color: '#c8821a' }}>#{order.orderNumber}</span>
            <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${meta.color}`}>
              {meta.icon}{meta.label}
            </span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${order.paymentStatus === 'paid' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-600'}`}>
              {order.paymentStatus === 'paid' ? '✅ Paid' : '⏳ Unpaid'}
            </span>
          </div>
          <p className="text-xs text-gray-400">{formatDate(order.createdAt)}</p>
          <p className="text-sm font-bold mt-0.5" style={{ color: '#3d1c02' }}>{formatCurrency(order.total)}</p>
        </div>
        {expanded
          ? <ChevronUp className="w-4 h-4 text-gray-400 flex-shrink-0 mt-1" />
          : <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0 mt-1" />}
      </button>

      {expanded && (
        <div className="border-t px-4 py-3 space-y-3" style={{ borderColor: '#f0d9c8', background: '#fffbf5' }}>
          {/* Items */}
          <div>
            <p className="text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">Items</p>
            <div className="space-y-1">
              {order.items.map((item, i) => (
                <div key={i} className="flex justify-between text-sm">
                  <span className="text-gray-700">{item.productName}
                    <span className="text-gray-400 text-xs ml-1">× {item.quantity}{item.unit === 'gram' ? 'g' : item.unit === 'kg' ? 'kg' : ''}</span>
                  </span>
                  <span className="font-medium text-gray-800">{formatCurrency(item.totalPrice)}</span>
                </div>
              ))}
            </div>
          </div>
          {/* Price breakdown */}
          <div className="border-t pt-2 space-y-1" style={{ borderColor: '#f0d9c8' }}>
            {order.discount > 0 && (
              <div className="flex justify-between text-xs text-gray-500">
                <span>Discount</span><span className="text-green-600">−{formatCurrency(order.discount)}</span>
              </div>
            )}
            {order.referralDiscount > 0 && (
              <div className="flex justify-between text-xs text-gray-500">
                <span>Referral discount</span><span className="text-green-600">−{formatCurrency(order.referralDiscount)}</span>
              </div>
            )}
            {order.deliveryCharge > 0 && (
              <div className="flex justify-between text-xs text-gray-500">
                <span>Delivery</span><span>{formatCurrency(order.deliveryCharge)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm font-bold pt-1" style={{ color: '#3d1c02' }}>
              <span>Total</span><span>{formatCurrency(order.total)}</span>
            </div>
          </div>
          {/* Notes */}
          <div>
            <p className="text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">
              Notes
              {canEdit && <span className="ml-1 normal-case font-normal text-orange-500">(editable)</span>}
            </p>
            {canEdit ? (
              <div className="space-y-2">
                <textarea rows={2} placeholder="Add notes or instructions…"
                  value={currentNotes}
                  onChange={e => setEditingNotes(prev => ({ ...prev, [order.id]: e.target.value }))}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-orange-400 resize-none" />
                {notesChanged && (
                  <button onClick={onSave} disabled={isSaving}
                    className="text-xs font-semibold px-4 py-2 rounded-xl text-white disabled:opacity-50"
                    style={{ background: '#c8821a' }}>
                    {isSaving ? 'Saving…' : '✓ Save Notes'}
                  </button>
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-600">{order.notes || <span className="text-gray-400 italic">No notes</span>}</p>
            )}
          </div>
          {/* Feedback */}
          {order.status === 'delivered' && (
            <Link to={`/feedback/${order.id}`}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl border transition-colors"
              style={{ borderColor: '#f0d9c8', color: '#c8821a' }}>
              <Star className="w-3.5 h-3.5" /> Leave a review for this order
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Search, Copy, Share2, ChevronDown, ChevronUp,
  ArrowLeft, Star, Leaf, CheckCircle2, Clock, Truck, XCircle,
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

// ── editable fields (only notes for pending/confirmed) ──────────────────────
const EDITABLE_STATUSES = ['pending', 'confirmed'];

const STATUS_META: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  pending:          { label: 'Pending',          color: 'bg-yellow-100 text-yellow-700', icon: <Clock className="w-3 h-3" /> },
  confirmed:        { label: 'Confirmed',        color: 'bg-blue-100 text-blue-700',    icon: <CheckCircle2 className="w-3 h-3" /> },
  out_for_delivery: { label: 'Out for Delivery', color: 'bg-purple-100 text-purple-700', icon: <Truck className="w-3 h-3" /> },
  delivered:        { label: 'Delivered',        color: 'bg-green-100 text-green-700',  icon: <CheckCircle2 className="w-3 h-3" /> },
  cancelled:        { label: 'Cancelled',        color: 'bg-red-100 text-red-400',      icon: <XCircle className="w-3 h-3" /> },
};

export default function MyAccountPage() {
  const [phone, setPhone]         = useState('');
  const [loading, setLoading]     = useState(false);
  const [orders, setOrders]       = useState<Order[] | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [referralCode, setReferralCode] = useState<string | null>(null);
  const [referralCredit, setReferralCredit] = useState(0);
  const [notFound, setNotFound]   = useState(false);
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null);
  const [editingNotes, setEditingNotes]   = useState<Record<string, string>>({});
  const [savingNotes, setSavingNotes]     = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<'orders' | 'referral'>('orders');

  const { config: referralConfig } = useReferralConfig();
  const storeUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const topTier = referralConfig.tiers.length > 0
    ? referralConfig.tiers.reduce((b, t) => t.minOrder > b.minOrder ? t : b, referralConfig.tiers[0])
    : null;
  const topTierSample = topTier
    ? computeReferralDiscountFromTiers(topTier.minOrder + 1, referralConfig.tiers, referralConfig.splitReferrerPct)
    : null;
  const topTierHint = topTier && topTierSample
    ? `up to ₹${topTierSample.customerDiscount} off on orders ₹${topTier.minOrder}+`
    : undefined;
  const shareMsg = referralCode ? referralShareMessage(customerName, referralCode, storeUrl, topTierHint) : '';
  const shareUrl = `https://wa.me/?text=${encodeURIComponent(shareMsg)}`;

  const digits = normalizeWhatsapp(phone);

  async function lookup() {
    if (digits.length < 10) return toast.error('Enter your 10-digit WhatsApp number');
    setLoading(true);
    setOrders(null);
    setNotFound(false);
    setReferralCode(null);
    setExpandedOrder(null);
    try {
      const [customer, fetchedOrders] = await Promise.all([
        customersService.getByWhatsapp(digits),
        ordersService.getByWhatsapp(digits),
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
      // Pre-fill notes state
      const notesMap: Record<string, string> = {};
      for (const o of fetchedOrders) notesMap[o.id] = o.notes ?? '';
      setEditingNotes(notesMap);
    } finally {
      setLoading(false);
    }
  }

  async function saveNotes(order: Order) {
    const newNotes = editingNotes[order.id] ?? '';
    if (newNotes === order.notes) return;
    setSavingNotes(prev => new Set(prev).add(order.id));
    try {
      await ordersService.update(order.id, { notes: newNotes });
      // Refresh orders list
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

  return (
    <div className="min-h-screen" style={{ background: '#fdf5e6' }}>
      {/* Header */}
      <div className="sticky top-0 z-10 shadow-sm" style={{ background: '#3d1c02' }}>
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          <Link to="/" className="text-orange-300 hover:text-white transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="flex items-center gap-2">
            <Leaf className="w-5 h-5 text-orange-400" />
            <span className="font-bold text-white text-base">My Account</span>
          </div>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-5">

        {/* Phone lookup */}
        <div className="bg-white rounded-2xl shadow-sm p-4 space-y-3" style={{ border: '1px solid #f0d9c8' }}>
          <p className="text-sm font-semibold" style={{ color: '#3d1c02' }}>Enter your WhatsApp number</p>
          <div className="flex gap-2">
            <input
              type="tel" inputMode="numeric" maxLength={10}
              placeholder="10-digit number"
              value={phone}
              onChange={e => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
              onKeyDown={e => e.key === 'Enter' && lookup()}
              className="flex-1 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-orange-400 focus:ring-1 focus:ring-orange-200"
            />
            <button
              onClick={lookup}
              disabled={loading || digits.length < 10}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold text-white transition-colors disabled:opacity-50"
              style={{ background: '#c8821a' }}>
              {loading ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Search className="w-4 h-4" />}
              {loading ? '' : 'Find'}
            </button>
          </div>
          <p className="text-xs text-gray-400">We only use this to look up your orders. We never store or share it.</p>
        </div>

        {/* Not found */}
        {notFound && (
          <div className="bg-white rounded-2xl shadow-sm p-5 text-center space-y-2" style={{ border: '1px solid #f0d9c8' }}>
            <p className="text-2xl">🔍</p>
            <p className="text-sm font-semibold text-gray-700">No account found for <strong>{phone}</strong></p>
            <p className="text-xs text-gray-400">Make sure you're using the same number you placed your order with.</p>
            <a
              href={`https://wa.me/91${APP_CONFIG.WHATSAPP_NUMBER}?text=${encodeURIComponent('Hi, I placed an order and need help finding it. My number: ' + phone)}`}
              target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-xl text-white mt-1"
              style={{ background: '#25d366' }}>
              💬 Contact us on WhatsApp
            </a>
          </div>
        )}

        {/* Results */}
        {hasResult && (
          <>
            {/* Welcome + tabs */}
            <div className="space-y-3">
              {customerName && (
                <p className="text-base font-bold" style={{ color: '#3d1c02' }}>
                  👋 Hi, {customerName}!
                </p>
              )}
              <div className="flex rounded-xl overflow-hidden border" style={{ borderColor: '#f0d9c8' }}>
                <button
                  onClick={() => setActiveTab('orders')}
                  className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${activeTab === 'orders' ? 'text-white' : 'text-gray-500 bg-white'}`}
                  style={activeTab === 'orders' ? { background: '#c8821a' } : {}}>
                  📦 My Orders {orders && orders.length > 0 ? `(${orders.length})` : ''}
                </button>
                <button
                  onClick={() => setActiveTab('referral')}
                  className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${activeTab === 'referral' ? 'text-white' : 'text-gray-500 bg-white'}`}
                  style={activeTab === 'referral' ? { background: '#c8821a' } : {}}>
                  🎁 Referral
                </button>
              </div>
            </div>

            {/* ── Orders tab ── */}
            {activeTab === 'orders' && (
              <div className="space-y-3">
                {orders && orders.length === 0 && (
                  <div className="bg-white rounded-2xl shadow-sm p-6 text-center" style={{ border: '1px solid #f0d9c8' }}>
                    <p className="text-3xl mb-2">📭</p>
                    <p className="text-sm text-gray-500">No orders found for this number.</p>
                  </div>
                )}
                {orders && orders.map(order => {
                  const meta = STATUS_META[order.status] ?? STATUS_META['pending'];
                  const isExpanded = expandedOrder === order.id;
                  const canEdit = EDITABLE_STATUSES.includes(order.status);
                  const currentNotes = editingNotes[order.id] ?? order.notes ?? '';
                  const notesChanged = currentNotes !== (order.notes ?? '');
                  const isSaving = savingNotes.has(order.id);
                  return (
                    <div key={order.id} className="bg-white rounded-2xl shadow-sm overflow-hidden" style={{ border: '1px solid #f0d9c8' }}>
                      {/* Order header — tap to expand */}
                      <button
                        className="w-full text-left px-4 py-3.5 flex items-start justify-between gap-3"
                        onClick={() => setExpandedOrder(isExpanded ? null : order.id)}>
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
                        {isExpanded
                          ? <ChevronUp className="w-4 h-4 text-gray-400 flex-shrink-0 mt-1" />
                          : <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0 mt-1" />}
                      </button>

                      {/* Expanded details */}
                      {isExpanded && (
                        <div className="border-t px-4 py-3 space-y-3" style={{ borderColor: '#f0d9c8', background: '#fffbf5' }}>
                          {/* Items */}
                          <div>
                            <p className="text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">Items</p>
                            <div className="space-y-1">
                              {order.items.map((item, i) => (
                                <div key={i} className="flex justify-between text-sm">
                                  <span className="text-gray-700">{item.productName}
                                    <span className="text-gray-400 text-xs ml-1">
                                      × {item.quantity}{item.unit === 'gram' ? 'g' : item.unit === 'kg' ? 'kg' : ''}
                                    </span>
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
                            <div className="flex justify-between text-sm font-bold pt-1">
                              <span style={{ color: '#3d1c02' }}>Total</span>
                              <span style={{ color: '#3d1c02' }}>{formatCurrency(order.total)}</span>
                            </div>
                          </div>

                          {/* Notes — editable only for pending/confirmed */}
                          <div>
                            <p className="text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">
                              Notes / Special Instructions
                              {canEdit && <span className="ml-1 normal-case font-normal text-orange-500">(editable)</span>}
                            </p>
                            {canEdit ? (
                              <div className="space-y-2">
                                <textarea
                                  rows={2}
                                  placeholder="Add any notes or instructions for this order…"
                                  value={currentNotes}
                                  onChange={e => setEditingNotes(prev => ({ ...prev, [order.id]: e.target.value }))}
                                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-orange-400 focus:ring-1 focus:ring-orange-200 resize-none"
                                />
                                {notesChanged && (
                                  <button
                                    onClick={() => saveNotes(order)}
                                    disabled={isSaving}
                                    className="text-xs font-semibold px-4 py-2 rounded-xl text-white disabled:opacity-50 transition-colors"
                                    style={{ background: '#c8821a' }}>
                                    {isSaving ? 'Saving…' : '✓ Save Notes'}
                                  </button>
                                )}
                              </div>
                            ) : (
                              <p className="text-sm text-gray-600">{order.notes || <span className="text-gray-400 italic">No notes</span>}</p>
                            )}
                          </div>

                          {/* Feedback link for delivered orders */}
                          {order.status === 'delivered' && (
                            <Link
                              to={`/feedback/${order.id}`}
                              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl border transition-colors"
                              style={{ borderColor: '#f0d9c8', color: '#c8821a' }}>
                              <Star className="w-3.5 h-3.5" /> Leave a review for this order
                            </Link>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── Referral tab ── */}
            {activeTab === 'referral' && (
              <div className="space-y-3">
                {/* Credit balance */}
                {referralCredit > 0 && (
                  <div className="rounded-2xl px-4 py-3 flex items-center gap-3"
                    style={{ background: '#fff8e1', border: '1px solid #ffe082' }}>
                    <span className="text-2xl">🎉</span>
                    <div>
                      <p className="text-sm font-bold" style={{ color: '#3d1c02' }}>You have ₹{referralCredit} referral credit!</p>
                      <p className="text-xs text-gray-500">Applied automatically at checkout on your next order.</p>
                    </div>
                  </div>
                )}

                {/* Referral code */}
                {referralCode ? (
                  <div className="bg-white rounded-2xl shadow-sm p-5 space-y-4" style={{ border: '1px solid #f0d9c8' }}>
                    <div className="text-center space-y-1">
                      <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">Your Referral Code</p>
                      <p className="text-3xl font-bold tracking-widest" style={{ color: '#c8821a' }}>{referralCode}</p>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={copyCode}
                        className="flex-1 flex items-center justify-center gap-1.5 border rounded-xl py-2.5 text-sm font-semibold transition-colors hover:bg-orange-50"
                        style={{ borderColor: '#c8821a', color: '#c8821a' }}>
                        <Copy className="w-4 h-4" /> Copy Code
                      </button>
                      <a href={shareUrl} target="_blank" rel="noreferrer"
                        className="flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-semibold text-white"
                        style={{ background: '#25d366' }}>
                        <Share2 className="w-4 h-4" /> Share on WhatsApp
                      </a>
                    </div>
                    {/* How it works */}
                    <div className="rounded-xl p-3 space-y-1.5" style={{ background: '#fdf5e6' }}>
                      <p className="text-xs font-bold" style={{ color: '#3d1c02' }}>How it works</p>
                      {referralConfig.tiers.map((tier, i) => {
                        const sampleAmt = tier.minOrder + 1;
                        const disc = computeReferralDiscountFromTiers(sampleAmt, referralConfig.tiers, referralConfig.splitReferrerPct);
                        const rangeLabel = tier.maxOrder ? `₹${tier.minOrder}–₹${tier.maxOrder - 1}` : `₹${tier.minOrder}+`;
                        return (
                          <p key={i} className="text-xs text-gray-600">
                            → Friend gets <strong>₹{disc.customerDiscount}</strong> off · you earn <strong>₹{disc.referrerCredit}</strong> credit (orders {rangeLabel})
                          </p>
                        );
                      })}
                      <p className="text-xs text-gray-400 pt-0.5">Credit is redeemable on your future orders.</p>
                    </div>
                  </div>
                ) : (
                  <div className="bg-white rounded-2xl shadow-sm p-5 text-center space-y-2" style={{ border: '1px solid #f0d9c8' }}>
                    <p className="text-2xl">🎁</p>
                    <p className="text-sm font-semibold text-gray-700">No referral code yet</p>
                    <p className="text-xs text-gray-400">Referral codes are assigned after your first order. Contact us if you think this is an error.</p>
                    <a
                      href={`https://wa.me/91${APP_CONFIG.WHATSAPP_NUMBER}?text=${encodeURIComponent('Hi, I placed an order but don\'t have a referral code. My number: ' + phone)}`}
                      target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-xl text-white mt-1"
                      style={{ background: '#25d366' }}>
                      💬 Contact us
                    </a>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

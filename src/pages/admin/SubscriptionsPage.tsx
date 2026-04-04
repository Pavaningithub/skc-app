import { useState, useMemo } from 'react';
import { Plus, Settings, Save, X, ChevronDown, ChevronUp, AlertTriangle, CheckCircle, Send, Copy, Search, Filter, Pencil, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import Portal from '../../components/Portal';
import { subscriptionsService, subscriptionConfigService, productsService, customersService, ordersService } from '../../lib/services';
import { useRealtimeCollection } from '../../lib/useRealtimeCollection';
import { useSubscriptionConfig } from '../../lib/useSubscriptionConfig';
import { formatCurrency, formatDate, generateSubscriptionOrderNumber, buildWABusinessUrl, subscriptionPaymentRequest } from '../../lib/utils';
import { APP_CONFIG } from '../../config';
import type { Subscription, MonthlyEntry, Product, OrderItem } from '../../lib/types';
import type { SubscriptionDuration, SubscriptionStatus } from '../../lib/constants';

// ── Helpers ────────────────────────────────────────────────────────────────

function statusBadge(status: SubscriptionStatus) {
  const map: Record<SubscriptionStatus, { label: string; cls: string }> = {
    pending:           { label: '⏳ Pending',           cls: 'bg-yellow-100 text-yellow-700 border border-yellow-200' },
    confirmed:         { label: '✅ Confirmed',          cls: 'bg-blue-100 text-blue-700 border border-blue-200' },
    payment_requested: { label: '💳 Payment Sent',       cls: 'bg-purple-100 text-purple-700 border border-purple-200' },
    active:            { label: '🟢 Active',             cls: 'bg-green-100 text-green-700 border border-green-200' },
    in_progress:       { label: '📦 In Progress',        cls: 'bg-teal-100 text-teal-700 border border-teal-200' },
    completed:         { label: '🏆 Completed',          cls: 'bg-emerald-100 text-emerald-700 border border-emerald-200' },
    cancelled:         { label: '❌ Cancelled',          cls: 'bg-red-100 text-red-500 border border-red-200' },
  };
  const { label, cls } = map[status] ?? map.pending;
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cls}`}>{label}</span>;
}

/** Build per-month entries using calendar months (April, May, June…) starting from the subscription start date */
function buildMonthlyTracking(startDateISO: string, durationMonths: number): MonthlyEntry[] {
  const start = new Date(startDateISO);
  const baseYear  = start.getFullYear();
  const baseMonth = start.getMonth(); // 0-indexed
  return Array.from({ length: durationMonths }, (_, i) => {
    const monthDate = new Date(baseYear, baseMonth + i, 1);
    const label = monthDate.toLocaleString('en-IN', { month: 'long', year: 'numeric' });
    return {
      month: i + 1,
      label,
      startDate: monthDate.toISOString(),
      endDate:   new Date(baseYear, baseMonth + i + 1, 0, 23, 59, 59).toISOString(), // last day of that month
      paymentStatus: 'pending' as const,
      deliveryStatus: 'pending' as const,
    };
  });
}

/** Derive the true lifecycle status from a subscription doc */
function deriveStatus(sub: Subscription): SubscriptionStatus {
  if (sub.status === 'cancelled') return 'cancelled';
  if (!sub.isActive) return 'cancelled';
  const tracking = sub.monthlyTracking ?? [];
  if (tracking.length > 0) {
    const allDelivered = tracking.every(e => e.deliveryStatus === 'delivered');
    const anyDelivered = tracking.some(e => e.deliveryStatus === 'delivered');
    if (allDelivered) return 'completed';
    if (anyDelivered) return 'in_progress';
  }
  if (sub.status) return sub.status;
  return 'active';
}

/** Copy text to clipboard with toast */
function copyText(text: string, label = 'Copied!') {
  navigator.clipboard.writeText(text).then(() => toast.success(label));
}

// ── Component ──────────────────────────────────────────────────────────────

export default function SubscriptionsPage() {
  const [subs, subsLoading]     = useRealtimeCollection<Subscription>(subscriptionsService.subscribe.bind(subscriptionsService));
  const [products, prodLoading] = useRealtimeCollection<Product>(productsService.subscribe.bind(productsService));
  const loading = subsLoading || prodLoading;

  const { config: subConfig, loading: configLoading } = useSubscriptionConfig();

  // UI state
  const [showForm, setShowForm]               = useState(false);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [expandedId, setExpandedId]           = useState<string | null>(null);
  const [saving, setSaving]                   = useState(false);
  const [cancelConfirmId, setCancelConfirmId] = useState<string | null>(null);
  const [editMonthIdx, setEditMonthIdx]       = useState<{ subId: string; month: number } | null>(null);
  const [editMonthDate, setEditMonthDate]     = useState('');
  const [editingSub, setEditingSub]           = useState<Subscription | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleting, setDeleting]               = useState(false);

  // Filter / sort state
  const [search, setSearch]               = useState('');
  const [filterStatus, setFilterStatus]   = useState<SubscriptionStatus | 'all'>('all');
  const [filterDuration, setFilterDuration] = useState<SubscriptionDuration | 'all'>('all');
  const [filterPayMode, setFilterPayMode] = useState<'upfront' | 'monthly' | 'all'>('all');
  const [sortBy, setSortBy]               = useState<'newest' | 'oldest' | 'amount'>('newest');

  // Config edit state
  const [configDraft, setConfigDraft] = useState({
    upfrontThreeMonthPct: 5, upfrontSixMonthPct: 10,
    monthlyThreeMonthPct: 3, monthlySixMonthPct: 7,
  });
  const [savingConfig, setSavingConfig] = useState(false);

  function openConfigModal() {
    setConfigDraft({
      upfrontThreeMonthPct: subConfig.upfrontThreeMonthPct,
      upfrontSixMonthPct:   subConfig.upfrontSixMonthPct,
      monthlyThreeMonthPct: subConfig.monthlyThreeMonthPct,
      monthlySixMonthPct:   subConfig.monthlySixMonthPct,
    });
    setShowConfigModal(true);
  }

  async function saveConfig() {
    setSavingConfig(true);
    try {
      await subscriptionConfigService.save({ ...configDraft, updatedAt: new Date().toISOString() });
      toast.success('Discount rates updated! Applies to new subscriptions only.');
      setShowConfigModal(false);
    } catch { toast.error('Failed to save'); }
    finally { setSavingConfig(false); }
  }

  // ── Form state ──────────────────────────────────────────────────────────
  const emptyForm = {
    customerName: '', customerWhatsapp: '',
    duration: '3months' as SubscriptionDuration,
    paymentMode: 'upfront' as 'upfront' | 'monthly',
    items: [] as OrderItem[],
    paymentStatus: 'pending' as 'pending' | 'paid',
  };
  const [form, setForm]                       = useState(emptyForm);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [selectedQty, setSelectedQty]         = useState(250);

  function getDiscountPct(duration: SubscriptionDuration, paymentMode: 'upfront' | 'monthly' = 'upfront') {
    if (paymentMode === 'monthly')
      return duration === '3months' ? subConfig.monthlyThreeMonthPct : subConfig.monthlySixMonthPct;
    return duration === '3months' ? subConfig.upfrontThreeMonthPct : subConfig.upfrontSixMonthPct;
  }

  function addItem() {
    const product = products.find(p => p.id === selectedProductId);
    if (!product) return;
    setForm(f => ({
      ...f,
      items: [...f.items, {
        productId: product.id, productName: product.name,
        unit: product.unit, quantity: Number(selectedQty),
        pricePerUnit: product.pricePerUnit,
        totalPrice: Number(selectedQty) * product.pricePerUnit,
      }],
    }));
  }

  function removeItem(idx: number) {
    setForm(f => ({ ...f, items: f.items.filter((_, i) => i !== idx) }));
  }

  async function handleSave() {
    if (!form.customerName.trim()) return toast.error('Customer name required');
    if (!form.customerWhatsapp.trim()) return toast.error('WhatsApp number required');
    if (form.items.length === 0) return toast.error('Add at least one product');
    setSaving(true);
    try {
      const baseAmount       = form.items.reduce((s, i) => s + i.totalPrice, 0);
      const discountPct      = getDiscountPct(form.duration, form.paymentMode);
      const discountedAmount = baseAmount * (1 - discountPct / 100);
      const durationMonths   = form.duration === '3months' ? 3 : 6;

      const startDate = new Date();
      const endDate   = new Date(startDate.getTime() + durationMonths * 30 * 24 * 60 * 60 * 1000);

      let customerId: string | undefined;
      const existing = await customersService.getByWhatsapp(form.customerWhatsapp.replace(/\D/g, ''));
      if (existing) customerId = existing.id;
      else customerId = await customersService.upsert({
        name: form.customerName, whatsapp: form.customerWhatsapp.replace(/\D/g, ''),
        place: '', joinedWhatsappGroup: false, createdAt: new Date().toISOString(),
      });

      const subId = await subscriptionsService.add({
        customerId: customerId || '',
        customerName: form.customerName,
        customerWhatsapp: form.customerWhatsapp.replace(/\D/g, ''),
        items: form.items,
        duration: form.duration,
        paymentMode: form.paymentMode,
        discountPercent: discountPct,
        baseAmount, discountedAmount,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        isActive: true,
        paymentStatus: form.paymentStatus,
        status: 'pending',
        monthlyTracking: [],
        createdAt: new Date().toISOString(),
      });

      await ordersService.add({
        orderNumber: generateSubscriptionOrderNumber(),
        type: 'subscription', customerId,
        customerName: form.customerName,
        customerWhatsapp: form.customerWhatsapp.replace(/\D/g, ''),
        customerPlace: '',
        items: form.items,
        subtotal: baseAmount,
        discount: baseAmount - discountedAmount,
        total: form.paymentMode === 'upfront' ? discountedAmount * durationMonths : discountedAmount,
        status: 'confirmed',
        paymentStatus: form.paymentStatus,
        notes: `Subscription ${form.duration} — ${form.paymentMode === 'upfront' ? 'Upfront' : 'Monthly'} payment (${discountPct}% off)`,
        subscriptionId: subId, subscriptionDuration: form.duration,
        hasOnDemandItems: false, referralDiscount: 0, creditUsed: 0, deliveryCharge: 0,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      });

      toast.success('Subscription created!');
      setShowForm(false);
      setForm(emptyForm);
    } finally { setSaving(false); }
  }

  async function cancelSub(id: string) {
    await subscriptionsService.update(id, { isActive: false, status: 'cancelled' });
    toast.success('Subscription cancelled');
    setCancelConfirmId(null);
  }

  function openEditSub(sub: Subscription) {
    setEditingSub(sub);
    setForm({
      customerName:    sub.customerName,
      customerWhatsapp: sub.customerWhatsapp,
      duration:        sub.duration,
      paymentMode:     sub.paymentMode ?? 'upfront',
      items:           sub.items,
      paymentStatus:   (sub.paymentStatus === 'paid' ? 'paid' : 'pending') as 'pending' | 'paid',
    });
    setShowForm(true);
  }

  async function handleEditSave() {
    if (!editingSub) return handleSave();
    if (!form.customerName.trim()) return toast.error('Customer name required');
    if (!form.customerWhatsapp.trim()) return toast.error('WhatsApp number required');
    if (form.items.length === 0) return toast.error('Add at least one product');
    setSaving(true);
    try {
      const baseAmount       = form.items.reduce((s, i) => s + i.totalPrice, 0);
      const discountPct      = editingSub.discountPercent; // keep original discount on edit
      const discountedAmount = baseAmount * (1 - discountPct / 100);
      const durationMonths   = form.duration === '3months' ? 3 : 6;
      const endDate          = new Date(
        new Date(editingSub.startDate).getTime() + durationMonths * 30 * 24 * 60 * 60 * 1000
      );

      await subscriptionsService.update(editingSub.id, {
        customerName:     form.customerName,
        customerWhatsapp: form.customerWhatsapp.replace(/\D/g, ''),
        duration:         form.duration,
        paymentMode:      form.paymentMode,
        items:            form.items,
        baseAmount,
        discountedAmount,
        endDate:          endDate.toISOString(),
        paymentStatus:    form.paymentStatus,
      });

      toast.success('Subscription updated!');
      setShowForm(false);
      setEditingSub(null);
      setForm(emptyForm);
    } finally { setSaving(false); }
  }

  async function deleteSub(id: string) {
    setDeleting(true);
    try {
      await subscriptionsService.delete(id);
      toast.success('Subscription deleted');
      setDeleteConfirmId(null);
      setExpandedId(null);
    } finally { setDeleting(false); }
  }

  async function confirmSub(sub: Subscription) {
    const durationMonths = sub.duration === '6months' ? 6 : 3;
    const tracking = buildMonthlyTracking(sub.startDate, durationMonths);
    await subscriptionsService.update(sub.id, {
      status: 'confirmed',
      isActive: true,
      monthlyTracking: tracking,
    });
    toast.success('Confirmed! Monthly tracking rows generated.');
  }

  function requestPaymentWA(sub: Subscription, entry: MonthlyEntry) {
    const subNum = sub.subscriptionNumber ?? sub.id.slice(0, 8).toUpperCase();
    const durationMonths = sub.duration === '6months' ? 6 : 3;
    const isUpfront = sub.paymentMode === 'upfront' && entry.month === 1;
    const msg = subscriptionPaymentRequest(
      sub.customerName, subNum, entry.label, sub.discountedAmount,
      APP_CONFIG.UPI_ID, isUpfront, durationMonths
    );
    window.open(`https://wa.me/91${sub.customerWhatsapp}?text=${encodeURIComponent(msg)}`, '_blank');
    const updated = (sub.monthlyTracking ?? []).map(e =>
      e.month === entry.month
        ? { ...e, paymentStatus: 'requested' as const, paymentRequestedAt: new Date().toISOString() }
        : e
    );
    subscriptionsService.update(sub.id, { monthlyTracking: updated, status: 'payment_requested' });
  }

  async function markMonthPaid(sub: Subscription, monthNum: number) {
    const updated = (sub.monthlyTracking ?? []).map(e =>
      e.month === monthNum ? { ...e, paymentStatus: 'paid' as const, paidAt: new Date().toISOString() } : e
    );
    const allPaid = updated.every(e => e.paymentStatus === 'paid');
    await subscriptionsService.update(sub.id, {
      monthlyTracking: updated, status: 'active',
      ...(allPaid ? { paymentStatus: 'paid' } : {}),
    });
    toast.success(`Month ${monthNum} marked as paid`);
  }

  async function markMonthDelivered(sub: Subscription, monthNum: number) {
    const updated = (sub.monthlyTracking ?? []).map(e =>
      e.month === monthNum ? { ...e, deliveryStatus: 'delivered' as const, deliveredAt: new Date().toISOString() } : e
    );
    const allDelivered = updated.every(e => e.deliveryStatus === 'delivered');
    const newStatus = allDelivered ? 'completed' : 'in_progress';
    await subscriptionsService.update(sub.id, { monthlyTracking: updated, status: newStatus });
    toast.success(allDelivered ? '🏆 All months delivered — subscription completed!' : `Month ${monthNum} marked as delivered`);
  }

  async function saveMonthStartDate(sub: Subscription, monthNum: number) {
    if (!editMonthDate) return;
    const newStart = new Date(editMonthDate);
    const newEnd   = new Date(newStart.getTime() + 30 * 24 * 60 * 60 * 1000 - 1);
    const updated  = (sub.monthlyTracking ?? []).map(e =>
      e.month === monthNum
        ? { ...e, startDate: newStart.toISOString(), endDate: newEnd.toISOString(),
            label: newStart.toLocaleString('en-IN', { month: 'long', year: 'numeric' }) }
        : e
    );
    await subscriptionsService.update(sub.id, { monthlyTracking: updated });
    toast.success(`Month ${monthNum} dates updated`);
    setEditMonthIdx(null);
  }

  // ── Derived lists ────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    let result = subs.map(s => ({ ...s, _status: deriveStatus(s) }));

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(s =>
        s.customerName.toLowerCase().includes(q) ||
        s.customerWhatsapp.includes(q) ||
        (s.subscriptionNumber ?? '').toLowerCase().includes(q)
      );
    }
    if (filterStatus !== 'all')   result = result.filter(s => s._status === filterStatus);
    if (filterDuration !== 'all') result = result.filter(s => s.duration === filterDuration);
    if (filterPayMode !== 'all')  result = result.filter(s => s.paymentMode === filterPayMode);

    result.sort((a, b) => {
      if (sortBy === 'amount')  return b.discountedAmount - a.discountedAmount;
      if (sortBy === 'oldest')  return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    return result;
  }, [subs, search, filterStatus, filterDuration, filterPayMode, sortBy]);

  const statusCounts = useMemo(() => {
    const counts: Record<SubscriptionStatus, number> = {
      pending: 0, confirmed: 0, payment_requested: 0, active: 0, in_progress: 0, completed: 0, cancelled: 0,
    };
    subs.forEach(s => { counts[deriveStatus(s)]++; });
    return counts;
  }, [subs]);

  // Price breakdown for form
  const baseAmount       = form.items.reduce((s, i) => s + i.totalPrice, 0);
  const discountPct      = getDiscountPct(form.duration, form.paymentMode);
  const discountedAmount = baseAmount * (1 - discountPct / 100);
  const durationMonths   = form.duration === '3months' ? 3 : 6;

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="p-4 md:p-6 space-y-4 animate-fade-in">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 font-display">Subscriptions</h1>
          <div className="flex gap-2 flex-wrap mt-1 items-center">
            {(Object.entries(statusCounts) as [SubscriptionStatus, number][])
              .filter(([, c]) => c > 0)
              .map(([s, c]) => (
                <span key={s} className="inline-flex items-center gap-1">
                  {statusBadge(s)}
                  <span className="text-xs text-gray-500 font-semibold">{c}</span>
                </span>
              ))}
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={openConfigModal}
            className="flex items-center gap-1.5 border border-gray-200 text-gray-600 px-3 py-2 rounded-xl text-sm hover:bg-gray-50">
            <Settings className="w-4 h-4" /> Rates
          </button>
          <button onClick={() => { setForm(emptyForm); setShowForm(true); }}
            className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-colors">
            <Plus className="w-4 h-4" /> New
          </button>
        </div>
      </div>

      {/* Live rate cards */}
      {!configLoading && (
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3">
            <p className="text-sm font-bold text-blue-800">3-Month Plan</p>
            <p className="text-xs text-blue-700 mt-0.5">Upfront: <span className="font-bold text-blue-600">{subConfig.upfrontThreeMonthPct}% off</span></p>
            <p className="text-xs text-blue-700">Monthly: <span className="font-bold text-blue-500">{subConfig.monthlyThreeMonthPct}% off</span></p>
          </div>
          <div className="bg-green-50 border border-green-200 rounded-xl p-3">
            <p className="text-sm font-bold text-green-800">6-Month Plan</p>
            <p className="text-xs text-green-700 mt-0.5">Upfront: <span className="font-bold text-green-600">{subConfig.upfrontSixMonthPct}% off</span></p>
            <p className="text-xs text-green-700">Monthly: <span className="font-bold text-green-500">{subConfig.monthlySixMonthPct}% off</span></p>
          </div>
        </div>
      )}

      {/* Filter / Search */}
      <div className="bg-white border border-gray-200 rounded-xl p-3 space-y-2">
        <div className="flex gap-2 items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search name or phone…"
              className="w-full border border-gray-200 rounded-xl pl-8 pr-3 py-2 text-sm outline-none focus:border-orange-400"
            />
          </div>
          <select value={sortBy} onChange={e => setSortBy(e.target.value as typeof sortBy)}
            className="border border-gray-200 rounded-xl px-2 py-2 text-xs outline-none bg-white text-gray-600">
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="amount">By amount</option>
          </select>
        </div>
        <div className="flex gap-1.5 flex-wrap items-center">
          <Filter className="w-3 h-3 text-gray-400" />
          {(['all', 'pending', 'confirmed', 'payment_requested', 'active', 'in_progress', 'completed', 'cancelled'] as const).map(s => (
            <button key={s} onClick={() => setFilterStatus(s)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                filterStatus === s ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-gray-500 border-gray-200 hover:border-orange-300'
              }`}>
              {s === 'all' ? 'All' : s === 'payment_requested' ? 'Pay Sent' : s === 'in_progress' ? 'In Progress' : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
          <span className="w-px h-4 bg-gray-200 mx-0.5" />
          {(['all', '3months', '6months'] as const).map(d => (
            <button key={d} onClick={() => setFilterDuration(d)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                filterDuration === d ? 'bg-blue-500 text-white border-blue-500' : 'bg-white text-gray-500 border-gray-200 hover:border-blue-300'
              }`}>
              {d === 'all' ? 'All Plans' : d === '3months' ? '3 Mo' : '6 Mo'}
            </button>
          ))}
          <span className="w-px h-4 bg-gray-200 mx-0.5" />
          {(['all', 'upfront', 'monthly'] as const).map(m => (
            <button key={m} onClick={() => setFilterPayMode(m)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                filterPayMode === m ? 'bg-purple-500 text-white border-purple-500' : 'bg-white text-gray-500 border-gray-200 hover:border-purple-300'
              }`}>
              {m === 'all' ? 'All Pay' : m === 'upfront' ? '💳 Upfront' : '📅 Monthly'}
            </button>
          ))}
        </div>
        {filtered.length !== subs.length && (
          <p className="text-xs text-gray-400">Showing {filtered.length} of {subs.length}</p>
        )}
      </div>

      {/* Subscription list */}
      {loading ? (
        <div className="flex justify-center py-8">
          <div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-10 text-gray-400">
          {subs.length === 0 ? 'No subscriptions yet' : 'No results match your filters'}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(sub => {
            const status      = sub._status;
            const isPending   = status === 'pending';
            const isCancelled = status === 'cancelled';
            const isExpanded  = expandedId === sub.id;
            const tracking    = sub.monthlyTracking ?? [];
            const durationMo  = sub.duration === '6months' ? 6 : 3;
            const isUpfront   = sub.paymentMode === 'upfront';

            const borderCls = isPending   ? 'border-yellow-300'
              : isCancelled  ? 'border-gray-200 opacity-75'
              : status === 'active' ? 'border-green-300'
              : 'border-orange-200';

            return (
              <div key={sub.id} className={`bg-white border rounded-xl overflow-hidden ${borderCls}`}>

                {/* Summary row */}
                <button className="w-full text-left p-4" onClick={() => setExpandedId(isExpanded ? null : sub.id)}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="font-semibold text-gray-800 truncate">{sub.customerName}</p>
                        <button onClick={e => { e.stopPropagation(); copyText(sub.customerName, 'Name copied'); }}
                          className="text-gray-300 hover:text-gray-500 flex-shrink-0">
                          <Copy className="w-3 h-3" />
                        </button>
                      </div>
                      <div className="flex items-center gap-1">
                        <p className="text-xs text-gray-500">📱 {sub.customerWhatsapp}</p>
                        <button onClick={e => { e.stopPropagation(); copyText(sub.customerWhatsapp, 'Number copied'); }}
                          className="text-gray-300 hover:text-gray-500">
                          <Copy className="w-3 h-3" />
                        </button>
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {formatDate(sub.startDate)} → {formatDate(sub.endDate)}
                      </p>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        {statusBadge(status)}
                        <span className="text-xs text-gray-400">
                          {durationMo} Mo · {isUpfront ? '💳 Upfront' : '📅 Monthly'}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      <p className="text-sm font-bold text-orange-600">
                        {formatCurrency(sub.discountedAmount)}<span className="text-xs font-normal text-gray-400">/mo</span>
                      </p>
                      <p className="text-xs text-gray-400 line-through">{formatCurrency(sub.baseAmount)}/mo</p>
                      {isUpfront && (
                        <p className="text-xs text-purple-600 font-medium">
                          Total: {formatCurrency(sub.discountedAmount * durationMo)}
                        </p>
                      )}
                      {isExpanded
                        ? <ChevronUp className="w-4 h-4 text-gray-400 mt-1" />
                        : <ChevronDown className="w-4 h-4 text-gray-400 mt-1" />}
                    </div>
                  </div>
                </button>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="border-t border-gray-100 px-4 pb-4 space-y-4">

                    {/* Plan badges */}
                    <div className="flex gap-2 text-xs flex-wrap pt-2">
                      <span className="bg-blue-50 text-blue-600 px-2 py-1 rounded-full">
                        {durationMo} Months · {sub.discountPercent}% off · {isUpfront ? 'Upfront payment' : 'Monthly payment'}
                      </span>
                      {isUpfront && (
                        <span className={`px-2 py-1 rounded-full ${
                          sub.paymentStatus === 'paid' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'
                        }`}>
                          Full payment: {sub.paymentStatus === 'paid' ? '✅ Received' : '⏳ Awaiting'}
                        </span>
                      )}
                    </div>

                    {/* Products subscribed */}
                    <div className="space-y-1">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Products</p>
                      {sub.items.map((item, i) => (
                        <div key={i} className="flex justify-between text-sm bg-orange-50 rounded-lg px-3 py-1.5">
                          <span>{item.productName} ×{item.quantity}{item.unit === 'piece' ? 'pc' : 'g'}</span>
                          <span className="font-medium">{formatCurrency(item.totalPrice)}/mo</span>
                        </div>
                      ))}
                    </div>

                    {/* Monthly Tracking Table */}
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                        Monthly Tracking
                        {tracking.length === 0 && status !== 'pending' && (
                          <span className="ml-2 normal-case font-normal text-orange-500">
                            — <button onClick={() => confirmSub(sub)} className="underline hover:text-orange-600">
                                Generate months
                              </button>
                          </span>
                        )}
                        {tracking.length === 0 && status === 'pending' && (
                          <span className="ml-2 normal-case font-normal text-gray-400">— rows generated on confirm</span>
                        )}
                      </p>

                      {tracking.length > 0 && (
                        <div className="rounded-xl overflow-hidden border border-gray-200">
                          <table className="w-full text-xs">
                            <thead className="bg-gray-50">
                              <tr>
                                <th className="text-left px-3 py-2 text-gray-500 font-medium w-8">Mo</th>
                                <th className="text-left px-2 py-2 text-gray-500 font-medium">Month</th>
                                {!isUpfront && <th className="text-center px-2 py-2 text-gray-500 font-medium">Payment</th>}
                                <th className="text-center px-2 py-2 text-gray-500 font-medium">Delivery</th>
                                <th className="text-right px-2 py-2 text-gray-500 font-medium">Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {tracking.map((entry, idx) => {
                                const isEditingThis =
                                  editMonthIdx?.subId === sub.id && editMonthIdx.month === entry.month;
                                // For upfront: allow delivery regardless of payment (payment tracked at top level)
                                const canDeliver = isUpfront
                                  ? sub.paymentStatus === 'paid' && entry.deliveryStatus !== 'delivered'
                                  : entry.paymentStatus === 'paid' && entry.deliveryStatus !== 'delivered';
                                return (
                                  <tr key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
                                    <td className="px-3 py-2.5 font-bold text-gray-700">#{entry.month}</td>
                                    <td className="px-2 py-2.5 text-gray-600 font-medium">
                                      {isEditingThis ? (
                                        <div className="flex items-center gap-1">
                                          <input type="date" value={editMonthDate}
                                            onChange={e => setEditMonthDate(e.target.value)}
                                            className="border border-orange-300 rounded px-1 py-0.5 text-xs w-28 outline-none" />
                                          <button onClick={() => saveMonthStartDate(sub, entry.month)}
                                            className="text-green-600 hover:text-green-700">
                                            <CheckCircle className="w-3.5 h-3.5" />
                                          </button>
                                          <button onClick={() => setEditMonthIdx(null)}
                                            className="text-gray-400 hover:text-gray-600">
                                            <X className="w-3 h-3" />
                                          </button>
                                        </div>
                                      ) : (
                                        <button
                                          onClick={() => {
                                            setEditMonthIdx({ subId: sub.id, month: entry.month });
                                            setEditMonthDate(
                                              entry.startDate ? entry.startDate.split('T')[0] : ''
                                            );
                                          }}
                                          className="text-left hover:text-orange-500 transition-colors font-medium"
                                          title="Tap to adjust month">
                                          {entry.label}
                                        </button>
                                      )}
                                    </td>
                                    {!isUpfront && (
                                      <td className="px-2 py-2.5 text-center">
                                        {entry.paymentStatus === 'paid'
                                          ? <span className="text-green-600 font-semibold">✅ Paid</span>
                                          : entry.paymentStatus === 'requested'
                                          ? <span className="text-purple-600">💳 Sent</span>
                                          : <span className="text-yellow-600">⏳ Pending</span>}
                                      </td>
                                    )}
                                    <td className="px-2 py-2.5 text-center">
                                      {entry.deliveryStatus === 'delivered'
                                        ? <span className="text-green-600 font-semibold">📦 Done</span>
                                        : <span className="text-gray-400">—</span>}
                                    </td>
                                    <td className="px-2 py-2.5">
                                      <div className="flex justify-end gap-1 flex-wrap">
                                        {/* Monthly pay: send WA request per month */}
                                        {!isUpfront && entry.paymentStatus !== 'paid' && (
                                          <button onClick={() => requestPaymentWA(sub, entry)}
                                            className="bg-purple-500 text-white px-2 py-1 rounded-lg flex items-center gap-0.5 hover:bg-purple-600">
                                            <Send className="w-2.5 h-2.5" /> WA
                                          </button>
                                        )}
                                        {/* Monthly pay: mark paid */}
                                        {!isUpfront && entry.paymentStatus !== 'paid' && (
                                          <button onClick={() => markMonthPaid(sub, entry.month)}
                                            className="bg-green-500 text-white px-2 py-1 rounded-lg hover:bg-green-600">
                                            ✓ Paid
                                          </button>
                                        )}
                                        {/* Delivery button — for upfront: show once full payment received */}
                                        {canDeliver && (
                                          <button onClick={() => markMonthDelivered(sub, entry.month)}
                                            className="bg-blue-500 text-white px-2 py-1 rounded-lg hover:bg-blue-600">
                                            📦 Delivered
                                          </button>
                                        )}
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>

                    {/* Bottom actions */}
                    <div className="flex gap-2 flex-wrap items-center">
                      <a href={buildWABusinessUrl(sub.customerWhatsapp)} target="_blank" rel="noreferrer"
                        className="text-xs border border-green-300 text-green-600 px-3 py-1.5 rounded-lg hover:bg-green-50">
                        📱 WhatsApp
                      </a>

                      {/* Confirm pending sub */}
                      {isPending && (
                        <button onClick={() => confirmSub(sub)}
                          className="text-xs bg-blue-500 text-white px-3 py-1.5 rounded-lg hover:bg-blue-600 flex items-center gap-1">
                          <CheckCircle className="w-3 h-3" /> Confirm
                        </button>
                      )}

                      {/* Upfront: request full payment via WA */}
                      {isUpfront && sub.status === 'confirmed' && sub.paymentStatus !== 'paid' && tracking.length > 0 && (
                        <button onClick={() => requestPaymentWA(sub, tracking[0])}
                          className="text-xs bg-purple-500 text-white px-3 py-1.5 rounded-lg hover:bg-purple-600 flex items-center gap-1">
                          <Send className="w-3 h-3" /> Request Payment
                        </button>
                      )}

                      {/* Upfront: mark full payment received */}
                      {isUpfront && sub.paymentStatus !== 'paid' && (
                        <button onClick={async () => {
                          await subscriptionsService.update(sub.id, { paymentStatus: 'paid', status: 'active' });
                          toast.success('Full payment received!');
                        }} className="text-xs bg-green-500 text-white px-3 py-1.5 rounded-lg hover:bg-green-600 flex items-center gap-1">
                          <CheckCircle className="w-3 h-3" /> Full Payment Received
                        </button>
                      )}

                      {/* Cancel */}
                      {status !== 'cancelled' && (
                        cancelConfirmId === sub.id ? (
                          <div className="flex gap-2 items-center">
                            <span className="text-xs text-red-600 font-medium">Cancel this sub?</span>
                            <button onClick={() => cancelSub(sub.id)}
                              className="text-xs bg-red-500 text-white px-2 py-1 rounded-lg">Yes</button>
                            <button onClick={() => setCancelConfirmId(null)}
                              className="text-xs border border-gray-300 px-2 py-1 rounded-lg">No</button>
                          </div>
                        ) : (
                          <button onClick={() => setCancelConfirmId(sub.id)}
                            className="text-xs border border-red-300 text-red-500 px-3 py-1.5 rounded-lg hover:bg-red-50 flex items-center gap-1">
                            <X className="w-3 h-3" /> Cancel Sub
                          </button>
                        )
                      )}

                      {/* Edit */}
                      <button onClick={() => openEditSub(sub)}
                        className="text-xs border border-blue-300 text-blue-600 px-3 py-1.5 rounded-lg hover:bg-blue-50 flex items-center gap-1">
                        <Pencil className="w-3 h-3" /> Edit
                      </button>

                      {/* Delete */}
                      {deleteConfirmId === sub.id ? (
                        <div className="flex gap-2 items-center">
                          <span className="text-xs text-red-700 font-semibold">Permanently delete?</span>
                          <button onClick={() => deleteSub(sub.id)} disabled={deleting}
                            className="text-xs bg-red-600 text-white px-2 py-1 rounded-lg disabled:opacity-50">
                            {deleting ? '…' : 'Delete'}
                          </button>
                          <button onClick={() => setDeleteConfirmId(null)}
                            className="text-xs border border-gray-300 px-2 py-1 rounded-lg">No</button>
                        </div>
                      ) : (
                        <button onClick={() => setDeleteConfirmId(sub.id)}
                          className="text-xs border border-red-200 text-red-400 px-3 py-1.5 rounded-lg hover:bg-red-50 flex items-center gap-1">
                          <Trash2 className="w-3 h-3" /> Delete
                        </button>
                      )}

                      {/* Copy sub summary */}
                      <button
                        onClick={() => copyText(
                          [
                            `Sub: ${sub.subscriptionNumber ?? sub.id.slice(0, 8).toUpperCase()}`,
                            `Customer: ${sub.customerName} · 📱 ${sub.customerWhatsapp}`,
                            `Plan: ${durationMo} Months · ${isUpfront ? 'Upfront' : 'Monthly payment'}`,
                            `Amount: ₹${sub.discountedAmount}/mo · Discount: ${sub.discountPercent}%`,
                            `Status: ${status}`,
                            `Period: ${formatDate(sub.startDate)} → ${formatDate(sub.endDate)}`,
                          ].join('\n'),
                          'Sub details copied!'
                        )}
                        className="text-xs border border-gray-200 text-gray-500 px-3 py-1.5 rounded-lg hover:bg-gray-50 flex items-center gap-1 ml-auto">
                        <Copy className="w-3 h-3" /> Copy
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Discount Settings Modal ── */}
      {showConfigModal && (
        <Portal>
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl">
              <div className="border-b border-gray-100 px-5 py-4 flex items-center justify-between">
                <h2 className="font-bold text-gray-800 flex items-center gap-2">
                  <Settings className="w-4 h-4" /> Discount Rates
                </h2>
                <button onClick={() => setShowConfigModal(false)} className="text-gray-400 hover:text-gray-600">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-5 space-y-4">
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 flex gap-2 items-start text-xs text-amber-700">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>Changes apply to <strong>new subscriptions only</strong>.</span>
                </div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">💳 Upfront Payment</p>
                <div className="grid grid-cols-2 gap-3">
                  {([['3-Month (%)', 'upfrontThreeMonthPct'], ['6-Month (%)', 'upfrontSixMonthPct']] as const).map(([lbl, key]) => (
                    <div key={key}>
                      <label className="block text-xs font-medium text-gray-700 mb-1">{lbl}</label>
                      <input type="number" min={0} max={50} value={configDraft[key]}
                        onChange={e => setConfigDraft(d => ({ ...d, [key]: Number(e.target.value) }))}
                        className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-orange-400" />
                    </div>
                  ))}
                </div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">📅 Monthly Payment</p>
                <div className="grid grid-cols-2 gap-3">
                  {([['3-Month (%)', 'monthlyThreeMonthPct'], ['6-Month (%)', 'monthlySixMonthPct']] as const).map(([lbl, key]) => (
                    <div key={key}>
                      <label className="block text-xs font-medium text-gray-700 mb-1">{lbl}</label>
                      <input type="number" min={0} max={50} value={configDraft[key]}
                        onChange={e => setConfigDraft(d => ({ ...d, [key]: Number(e.target.value) }))}
                        className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-orange-400" />
                    </div>
                  ))}
                </div>
                <div className="flex gap-3">
                  <button onClick={() => setShowConfigModal(false)}
                    className="flex-1 border border-gray-200 text-gray-600 py-2.5 rounded-xl text-sm">Cancel</button>
                  <button onClick={saveConfig} disabled={savingConfig}
                    className="flex-1 bg-orange-500 hover:bg-orange-600 text-white py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2">
                    <Save className="w-4 h-4" />{savingConfig ? 'Saving…' : 'Save Rates'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </Portal>
      )}

      {/* ── Create / Edit Subscription Modal ── */}
      {showForm && (
        <Portal>
          <div className="fixed inset-0 bg-black/50 z-50 flex items-end justify-center sm:items-center sm:p-4">
            <div className="bg-white rounded-t-3xl sm:rounded-2xl w-full max-w-lg flex flex-col" style={{ maxHeight: '92dvh' }}>
              <div className="border-b border-gray-100 px-5 py-4 flex items-center justify-between flex-shrink-0">
                <h2 className="font-bold text-gray-800">
                  {editingSub ? '✏️ Edit Subscription' : 'New Subscription'}
                </h2>
                <button onClick={() => { setShowForm(false); setEditingSub(null); setForm(emptyForm); }}
                  className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
              </div>
              <div className="overflow-y-auto flex-1 p-5 space-y-4">

                {/* Customer */}
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Customer Name</label>
                    <input type="text" value={form.customerName}
                      onChange={e => setForm(f => ({ ...f, customerName: e.target.value }))}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-orange-400" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">WhatsApp Number</label>
                    <input type="tel" value={form.customerWhatsapp}
                      onChange={e => setForm(f => ({ ...f, customerWhatsapp: e.target.value }))}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-orange-400" />
                  </div>
                </div>

                {/* Plan */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Subscription Plan</label>
                  <div className="grid grid-cols-2 gap-2">
                    {(['3months', '6months'] as SubscriptionDuration[]).map(d => (
                      <button key={d} onClick={() => setForm(f => ({ ...f, duration: d }))}
                        className={`py-3 rounded-xl border text-sm font-medium transition-colors ${
                          form.duration === d ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-gray-600 border-gray-200'
                        }`}>
                        {d === '3months'
                          ? `3 Months — ${getDiscountPct('3months', form.paymentMode)}% off`
                          : `6 Months — ${getDiscountPct('6months', form.paymentMode)}% off`}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Payment mode */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Payment Mode</label>
                  <div className="grid grid-cols-2 gap-2">
                    {(['upfront', 'monthly'] as const).map(mode => (
                      <button key={mode} onClick={() => setForm(f => ({ ...f, paymentMode: mode }))}
                        className={`py-2.5 rounded-xl border text-sm font-medium transition-colors ${
                          form.paymentMode === mode ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-gray-600 border-gray-200'
                        }`}>
                        {mode === 'upfront' ? '💳 Pay Upfront' : '📅 Pay Monthly'}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-gray-400 mt-1">
                    {editingSub
                      ? `Discount locked at ${editingSub.discountPercent}% (set at creation)`
                      : form.paymentMode === 'upfront'
                      ? `${getDiscountPct(form.duration, 'upfront')}% off — pay full ${durationMonths}-month total upfront`
                      : `${getDiscountPct(form.duration, 'monthly')}% off — pay each month separately`}
                  </p>
                </div>

                {/* Products */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Products</label>
                  <div className="flex gap-2">
                    <select value={selectedProductId} onChange={e => setSelectedProductId(e.target.value)}
                      className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none bg-white">
                      <option value="">Select product…</option>
                      {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    <button onClick={addItem} disabled={!selectedProductId}
                      className="bg-orange-500 text-white px-3 py-2 rounded-xl disabled:opacity-40">
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="flex gap-2 mt-2">
                    {([250, 500, 1000] as const).map(qty => (
                      <button key={qty} type="button" onClick={() => setSelectedQty(qty)}
                        className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                          selectedQty === qty
                            ? 'bg-orange-500 text-white border-orange-500'
                            : 'bg-white text-gray-600 border-gray-300 hover:border-orange-400'
                        }`}>
                        {qty === 1000 ? '1 kg' : `${qty} g`}
                      </button>
                    ))}
                  </div>
                  {form.items.length > 0 && (
                    <div className="mt-3 space-y-1">
                      {form.items.map((item, i) => (
                        <div key={i} className="flex justify-between items-center text-sm bg-orange-50 rounded-lg px-3 py-2">
                          <span>{item.productName} ×{item.quantity}{item.unit === 'piece' ? 'pc' : 'g'}</span>
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{formatCurrency(item.totalPrice)}/mo</span>
                            <button onClick={() => removeItem(i)} className="text-gray-400 hover:text-red-500">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Price breakdown */}
                {form.items.length > 0 && (
                  <div className="bg-gray-50 rounded-xl p-4 space-y-1.5 text-sm">
                    <div className="flex justify-between text-gray-600">
                      <span>Per month (base)</span><span>{formatCurrency(baseAmount)}</span>
                    </div>
                    {form.paymentMode === 'upfront' && (
                      <div className="flex justify-between text-gray-600">
                        <span>× {durationMonths} months</span><span>{formatCurrency(baseAmount * durationMonths)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-green-600">
                      <span>Discount ({discountPct}%)</span>
                      <span>−{formatCurrency(
                        form.paymentMode === 'upfront'
                          ? baseAmount * durationMonths * discountPct / 100
                          : baseAmount * discountPct / 100
                      )}</span>
                    </div>
                    <div className="flex justify-between font-bold text-gray-800 border-t border-gray-200 pt-1.5">
                      <span>{form.paymentMode === 'upfront' ? 'Total upfront' : 'Per month (discounted)'}</span>
                      <span className="text-orange-600">{formatCurrency(
                        form.paymentMode === 'upfront' ? discountedAmount * durationMonths : discountedAmount
                      )}</span>
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Initial Payment Status</label>
                  <select value={form.paymentStatus}
                    onChange={e => setForm(f => ({ ...f, paymentStatus: e.target.value as 'pending' | 'paid' }))}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none bg-white">
                    <option value="pending">Pending</option>
                    <option value="paid">Paid</option>
                  </select>
                </div>
              </div>

              <div className="border-t border-gray-100 p-5 flex gap-3 flex-shrink-0">
                <button onClick={() => { setShowForm(false); setEditingSub(null); setForm(emptyForm); }}
                  className="flex-1 border border-gray-200 text-gray-600 py-3 rounded-xl text-sm">Cancel</button>
                <button onClick={handleEditSave} disabled={saving}
                  className="flex-1 bg-orange-500 hover:bg-orange-600 text-white py-3 rounded-xl text-sm font-semibold disabled:opacity-50">
                  {saving ? 'Saving…' : editingSub ? 'Save Changes' : 'Create Subscription'}
                </button>
              </div>
            </div>
          </div>
        </Portal>
      )}
    </div>
  );
}

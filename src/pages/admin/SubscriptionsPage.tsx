import { useState, useMemo } from 'react';
import { Plus, Settings, Save, X, RefreshCw, ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import Portal from '../../components/Portal';
import { subscriptionsService, subscriptionConfigService, productsService, customersService, ordersService } from '../../lib/services';
import { useRealtimeCollection } from '../../lib/useRealtimeCollection';
import { useSubscriptionConfig } from '../../lib/useSubscriptionConfig';
import { formatCurrency, formatDate, generateSubscriptionOrderNumber, buildWABusinessUrl } from '../../lib/utils';
import type { Subscription, Product, OrderItem } from '../../lib/types';
import type { SubscriptionDuration } from '../../lib/constants';

export default function SubscriptionsPage() {
  const [subs, subsLoading] = useRealtimeCollection<Subscription>(subscriptionsService.subscribe.bind(subscriptionsService));
  const [products, prodLoading] = useRealtimeCollection<Product>(productsService.subscribe.bind(productsService));
  const loading = subsLoading || prodLoading;

  // Live subscription config (admin-editable discounts)
  const { config: subConfig, loading: configLoading } = useSubscriptionConfig();

  // UI state
  const [showForm, setShowForm] = useState(false);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [cancelConfirmId, setCancelConfirmId] = useState<string | null>(null);
  const [renewSub, setRenewSub] = useState<Subscription | null>(null);

  // Config edit state
  const [configDraft, setConfigDraft] = useState({
    upfrontThreeMonthPct: 5, upfrontSixMonthPct: 10,
    monthlyThreeMonthPct: 3, monthlySixMonthPct:  7,
  });
  const [savingConfig, setSavingConfig] = useState(false);

  // Sync draft when modal opens
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

  // Form state
  const emptyForm = {
    customerName: '',
    customerWhatsapp: '',
    duration: '3months' as SubscriptionDuration,
    paymentMode: 'upfront' as 'upfront' | 'monthly',
    items: [] as OrderItem[],
    paymentStatus: 'pending' as 'pending' | 'paid',
  };
  const [form, setForm] = useState(emptyForm);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [selectedQty, setSelectedQty] = useState(250);

  // Renewals due within 30 days
  const renewalsDue = useMemo(() => {
    const now = new Date();
    const cutoff = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    return subs.filter(s => {
      if (!s.isActive) return false;
      const end = new Date(s.endDate);
      return end >= now && end <= cutoff;
    }).sort((a, b) => new Date(a.endDate).getTime() - new Date(b.endDate).getTime());
  }, [subs]);

  const activeSubs = useMemo(() => subs.filter(s => s.isActive), [subs]);
  const expiredSubs = useMemo(() => subs.filter(s => !s.isActive), [subs]);

  function getDiscountPct(duration: SubscriptionDuration, paymentMode: 'upfront' | 'monthly' = 'upfront') {
    if (paymentMode === 'monthly') {
      return duration === '3months' ? subConfig.monthlyThreeMonthPct : subConfig.monthlySixMonthPct;
    }
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

  async function handleSave(isRenew = false) {
    if (!form.customerName.trim()) return toast.error('Customer name required');
    if (!form.customerWhatsapp.trim()) return toast.error('WhatsApp number required');
    if (form.items.length === 0) return toast.error('Add at least one product');
    setSaving(true);
    try {
      const baseAmount = form.items.reduce((s, i) => s + i.totalPrice, 0);
      const discountPct = getDiscountPct(form.duration, form.paymentMode);
      const discountedAmount = baseAmount * (1 - discountPct / 100);
      const durationMonths = form.duration === '3months' ? 3 : 6;

      const startDate = new Date();
      const endDate = new Date();
      endDate.setMonth(endDate.getMonth() + durationMonths);

      // Upsert customer
      let customerId: string | undefined;
      const existing = await customersService.getByWhatsapp(form.customerWhatsapp.replace(/\D/g, ''));
      if (existing) customerId = existing.id;
      else customerId = await customersService.upsert({
        name: form.customerName,
        whatsapp: form.customerWhatsapp.replace(/\D/g, ''),
        place: '',
        joinedWhatsappGroup: false,
        createdAt: new Date().toISOString(),
      });

      const subId = await subscriptionsService.add({
        customerId: customerId || '',
        customerName: form.customerName,
        customerWhatsapp: form.customerWhatsapp.replace(/\D/g, ''),
        items: form.items,
        duration: form.duration,
        discountPercent: discountPct,
        baseAmount,
        discountedAmount,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        isActive: true,
        paymentStatus: form.paymentStatus,
        createdAt: new Date().toISOString(),
      });

      // Mark old subscription inactive when renewing
      if (isRenew && renewSub) {
        await subscriptionsService.update(renewSub.id, { isActive: false });
      }

      // Create order with SUB prefix
      await ordersService.add({
        orderNumber: generateSubscriptionOrderNumber(),
        type: 'subscription',
        customerId,
        customerName: form.customerName,
        customerWhatsapp: form.customerWhatsapp.replace(/\D/g, ''),
        customerPlace: '',
        items: form.items,
        subtotal: baseAmount,
        discount: baseAmount - discountedAmount,
        total: discountedAmount,
        status: 'confirmed',
        paymentStatus: form.paymentStatus,
        notes: `Subscription ${form.duration} — ${form.paymentMode === 'upfront' ? 'Upfront' : 'Monthly'} payment (${discountPct}% off)`,
        subscriptionId: subId,
        subscriptionDuration: form.duration,
        hasOnDemandItems: false,
        referralDiscount: 0,
        creditUsed: 0,
        deliveryCharge: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      toast.success(isRenew ? 'Subscription renewed!' : 'Subscription created!');
      setShowForm(false);
      setRenewSub(null);
      setForm(emptyForm);
    } finally { setSaving(false); }
  }

  function openRenew(sub: Subscription) {
    setForm({
      customerName: sub.customerName,
      customerWhatsapp: sub.customerWhatsapp,
      duration: sub.duration,
      paymentMode: 'upfront',
      items: sub.items,
      paymentStatus: 'pending',
    });
    setRenewSub(sub);
    setShowForm(true);
  }

  async function cancelSub(id: string) {
    await subscriptionsService.update(id, { isActive: false });
    toast.success('Subscription cancelled');
    setCancelConfirmId(null);
  }

  // Price breakdown for form
  const baseAmount = form.items.reduce((s, i) => s + i.totalPrice, 0);
  const discountPct = getDiscountPct(form.duration, form.paymentMode);
  const discountedAmount = baseAmount * (1 - discountPct / 100);
  const durationMonths = form.duration === '3months' ? 3 : 6;

  return (
    <div className="p-4 md:p-6 space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 font-display">Subscriptions</h1>
          <p className="text-sm text-gray-500">{activeSubs.length} active · {expiredSubs.length} expired</p>
        </div>
        <div className="flex gap-2">
          <button onClick={openConfigModal}
            className="flex items-center gap-1.5 border border-gray-200 text-gray-600 px-3 py-2 rounded-xl text-sm hover:bg-gray-50">
            <Settings className="w-4 h-4" /> Rates
          </button>
          <button onClick={() => { setRenewSub(null); setForm(emptyForm); setShowForm(true); }}
            className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-colors">
            <Plus className="w-4 h-4" /> New
          </button>
        </div>
      </div>

      {/* Plan info cards (live rates) */}
      {!configLoading && (
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
            <p className="text-sm font-bold text-blue-800">3-Month Plan</p>
            <p className="text-xs text-blue-700 mt-1">Upfront: <span className="font-bold text-blue-600 text-base">{subConfig.upfrontThreeMonthPct}% OFF</span></p>
            <p className="text-xs text-blue-700">Monthly: <span className="font-bold text-blue-500">{subConfig.monthlyThreeMonthPct}% OFF</span></p>
          </div>
          <div className="bg-green-50 border border-green-200 rounded-xl p-4">
            <p className="text-sm font-bold text-green-800">6-Month Plan</p>
            <p className="text-xs text-green-700 mt-1">Upfront: <span className="font-bold text-green-600 text-base">{subConfig.upfrontSixMonthPct}% OFF</span></p>
            <p className="text-xs text-green-700">Monthly: <span className="font-bold text-green-500">{subConfig.monthlySixMonthPct}% OFF</span></p>
          </div>
        </div>
      )}

      {/* Renewals due panel */}
      {renewalsDue.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-2">
          <p className="text-sm font-bold text-amber-800 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" /> Renewals Due (next 30 days)
          </p>
          {renewalsDue.map(sub => {
            const daysLeft = Math.ceil((new Date(sub.endDate).getTime() - Date.now()) / 86400000);
            return (
              <div key={sub.id} className="flex items-center justify-between bg-white rounded-lg px-3 py-2 text-sm">
                <div>
                  <span className="font-medium">{sub.customerName}</span>
                  <span className="text-gray-400 ml-2">expires {formatDate(sub.endDate)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-bold ${daysLeft <= 7 ? 'text-red-600' : 'text-amber-600'}`}>
                    {daysLeft}d left
                  </span>
                  <button onClick={() => openRenew(sub)}
                    className="text-xs bg-orange-500 text-white px-2 py-1 rounded-lg">
                    Renew
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-8">
          <div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="space-y-3">
          {subs.length === 0 && (
            <div className="text-center py-10 text-gray-400">No subscriptions yet</div>
          )}
          {/* Active first, then expired */}
          {[...activeSubs, ...expiredSubs].map(sub => {
            const isExpired = !sub.isActive || new Date(sub.endDate) < new Date();
            const isExpanded = expandedId === sub.id;
            return (
              <div key={sub.id} className={`bg-white border rounded-xl overflow-hidden
                ${isExpired ? 'border-gray-200 opacity-80' : 'border-orange-200'}`}>
                {/* Summary row — tap to expand */}
                <button className="w-full text-left p-4" onClick={() => setExpandedId(isExpanded ? null : sub.id)}>
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-semibold text-gray-800">{sub.customerName}</p>
                      <p className="text-xs text-gray-500">📱 {sub.customerWhatsapp}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{formatDate(sub.startDate)} → {formatDate(sub.endDate)}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium
                        ${isExpired ? 'bg-gray-100 text-gray-500' : 'bg-green-100 text-green-700'}`}>
                        {isExpired ? 'Expired' : '✅ Active'}
                      </span>
                      <p className="text-sm font-bold text-orange-600">{formatCurrency(sub.discountedAmount)}</p>
                      <p className="text-xs text-gray-400 line-through">{formatCurrency(sub.baseAmount)}</p>
                      {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                    </div>
                  </div>
                </button>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="border-t border-gray-100 px-4 pb-4 space-y-3">
                    {/* Badges */}
                    <div className="flex gap-2 text-xs flex-wrap pt-2">
                      <span className="bg-blue-50 text-blue-600 px-2 py-1 rounded-full">
                        {sub.duration === '3months' ? '3 Months' : '6 Months'} · {sub.discountPercent}% off
                      </span>
                      <span className={`px-2 py-1 rounded-full ${sub.paymentStatus === 'paid' ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}>
                        {sub.paymentStatus === 'paid' ? '✅ Paid' : '💰 Pending'}
                      </span>
                    </div>

                    {/* Items */}
                    <div className="space-y-1">
                      {sub.items.map((item, i) => (
                        <div key={i} className="flex justify-between text-sm bg-orange-50 rounded-lg px-3 py-1.5">
                          <span>{item.productName} ×{item.quantity}{item.unit === 'piece' ? 'pc' : 'g'}</span>
                          <span className="font-medium">{formatCurrency(item.totalPrice)}/mo</span>
                        </div>
                      ))}
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2 flex-wrap">
                      <a href={buildWABusinessUrl(sub.customerWhatsapp)} target="_blank" rel="noreferrer"
                        className="text-xs border border-green-300 text-green-600 px-3 py-1.5 rounded-lg hover:bg-green-50">
                        📱 WhatsApp
                      </a>
                      {sub.paymentStatus === 'pending' && (
                        <button onClick={async () => {
                          await subscriptionsService.update(sub.id, { paymentStatus: 'paid' });
                          toast.success('Marked as paid');
                        }} className="text-xs bg-green-500 text-white px-3 py-1.5 rounded-lg hover:bg-green-600">
                          Mark Paid
                        </button>
                      )}
                      {isExpired ? (
                        <button onClick={() => openRenew(sub)}
                          className="text-xs bg-blue-500 text-white px-3 py-1.5 rounded-lg hover:bg-blue-600 flex items-center gap-1">
                          <RefreshCw className="w-3 h-3" /> Renew
                        </button>
                      ) : (
                        cancelConfirmId === sub.id ? (
                          <div className="flex gap-2 items-center">
                            <span className="text-xs text-red-600 font-medium">Confirm cancel?</span>
                            <button onClick={() => cancelSub(sub.id)}
                              className="text-xs bg-red-500 text-white px-2 py-1 rounded-lg">Yes</button>
                            <button onClick={() => setCancelConfirmId(null)}
                              className="text-xs border border-gray-300 px-2 py-1 rounded-lg">No</button>
                          </div>
                        ) : (
                          <button onClick={() => setCancelConfirmId(sub.id)}
                            className="text-xs border border-red-300 text-red-500 px-3 py-1.5 rounded-lg hover:bg-red-50 flex items-center gap-1">
                            <X className="w-3 h-3" /> Cancel
                          </button>
                        )
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Discount Settings Modal ───────────────────────────── */}
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
                {/* Warning */}
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 flex gap-2 items-start text-xs text-amber-700">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>Changes apply to <strong>new subscriptions only</strong>. Existing subscriptions keep their original discount.</span>
                </div>

                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">💳 Upfront Payment (pay in full)</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">3-Month (%)</label>
                    <input type="number" min={0} max={50} value={configDraft.upfrontThreeMonthPct}
                      onChange={e => setConfigDraft(d => ({ ...d, upfrontThreeMonthPct: Number(e.target.value) }))}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-orange-400" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">6-Month (%)</label>
                    <input type="number" min={0} max={50} value={configDraft.upfrontSixMonthPct}
                      onChange={e => setConfigDraft(d => ({ ...d, upfrontSixMonthPct: Number(e.target.value) }))}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-orange-400" />
                  </div>
                </div>

                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">📅 Monthly Payment (pay each month)</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">3-Month (%)</label>
                    <input type="number" min={0} max={50} value={configDraft.monthlyThreeMonthPct}
                      onChange={e => setConfigDraft(d => ({ ...d, monthlyThreeMonthPct: Number(e.target.value) }))}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-orange-400" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">6-Month (%)</label>
                    <input type="number" min={0} max={50} value={configDraft.monthlySixMonthPct}
                      onChange={e => setConfigDraft(d => ({ ...d, monthlySixMonthPct: Number(e.target.value) }))}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-orange-400" />
                  </div>
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

      {/* ── Create / Renew Subscription Modal ────────────────── */}
      {showForm && (
        <Portal>
          <div className="fixed inset-0 bg-black/50 z-50 flex items-end justify-center sm:items-center sm:p-4">
            <div className="bg-white rounded-t-3xl sm:rounded-2xl w-full max-w-lg flex flex-col" style={{ maxHeight: '92dvh' }}>
              <div className="border-b border-gray-100 px-5 py-4 flex items-center justify-between flex-shrink-0">
                <h2 className="font-bold text-gray-800">
                  {renewSub ? '🔄 Renew Subscription' : 'New Subscription'}
                </h2>
                <button onClick={() => { setShowForm(false); setRenewSub(null); setForm(emptyForm); }}
                  className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
              </div>
              <div className="overflow-y-auto flex-1 p-5 space-y-4">
                {/* Customer info */}
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Customer Name</label>
                    <input type="text" value={form.customerName} onChange={e => setForm(f => ({ ...f, customerName: e.target.value }))}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-orange-400" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">WhatsApp Number</label>
                    <input type="tel" value={form.customerWhatsapp} onChange={e => setForm(f => ({ ...f, customerWhatsapp: e.target.value }))}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-orange-400" />
                  </div>
                </div>

                {/* Duration */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Subscription Plan</label>
                  <div className="grid grid-cols-2 gap-2">
                    {(['3months', '6months'] as SubscriptionDuration[]).map(d => (
                      <button key={d} onClick={() => setForm(f => ({ ...f, duration: d }))}
                        className={`py-3 rounded-xl border text-sm font-medium transition-colors
                          ${form.duration === d ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-gray-600 border-gray-200'}`}>
                        {d === '3months'
                          ? `3 Months — ${getDiscountPct('3months', form.paymentMode)}% Off`
                          : `6 Months — ${getDiscountPct('6months', form.paymentMode)}% Off`}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Payment Mode */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Payment Mode</label>
                  <div className="grid grid-cols-2 gap-2">
                    {(['upfront', 'monthly'] as const).map(mode => (
                      <button key={mode} onClick={() => setForm(f => ({ ...f, paymentMode: mode }))}
                        className={`py-2.5 rounded-xl border text-sm font-medium transition-colors
                          ${form.paymentMode === mode ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-gray-600 border-gray-200'}`}>
                        {mode === 'upfront' ? '💳 Pay Upfront' : '📅 Pay Monthly'}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-gray-400 mt-1">
                    {form.paymentMode === 'upfront'
                      ? `Upfront discount: ${getDiscountPct(form.duration, 'upfront')}% — customer pays full ${durationMonths}m total at once`
                      : `Monthly discount: ${getDiscountPct(form.duration, 'monthly')}% — customer pays each month`}
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
                    <select value={selectedQty} onChange={e => setSelectedQty(Number(e.target.value))}
                      className="w-24 border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none bg-white">
                      <option value={250}>250 g</option>
                      <option value={500}>500 g</option>
                      <option value={1000}>1 kg</option>
                    </select>
                    <button onClick={addItem} disabled={!selectedProductId}
                      className="bg-orange-500 text-white px-3 py-2 rounded-xl disabled:opacity-40">
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                  {/* Added items */}
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
                      <span>Per month</span>
                      <span>{formatCurrency(baseAmount)}</span>
                    </div>
                    {form.paymentMode === 'upfront' && (
                      <div className="flex justify-between text-gray-600">
                        <span>× {durationMonths} months</span>
                        <span>{formatCurrency(baseAmount * durationMonths)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-green-600">
                      <span>Discount ({discountPct}%)</span>
                      <span>− {formatCurrency(
                        form.paymentMode === 'upfront'
                          ? (baseAmount * durationMonths) * discountPct / 100
                          : baseAmount * discountPct / 100
                      )}</span>
                    </div>
                    <div className="flex justify-between font-bold text-gray-800 border-t border-gray-200 pt-1.5">
                      <span>{form.paymentMode === 'upfront' ? 'Total upfront' : 'Per month (discounted)'}</span>
                      <span className="text-orange-600">{formatCurrency(
                        form.paymentMode === 'upfront'
                          ? discountedAmount * durationMonths
                          : discountedAmount
                      )}</span>
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Payment Status</label>
                  <select value={form.paymentStatus} onChange={e => setForm(f => ({ ...f, paymentStatus: e.target.value as 'pending' | 'paid' }))}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none bg-white">
                    <option value="pending">Pending</option>
                    <option value="paid">Paid</option>
                  </select>
                </div>
              </div>

              <div className="border-t border-gray-100 p-5 flex gap-3 flex-shrink-0">
                <button onClick={() => { setShowForm(false); setRenewSub(null); setForm(emptyForm); }}
                  className="flex-1 border border-gray-200 text-gray-600 py-3 rounded-xl text-sm">Cancel</button>
                <button onClick={() => handleSave(!!renewSub)} disabled={saving}
                  className="flex-1 bg-orange-500 hover:bg-orange-600 text-white py-3 rounded-xl text-sm font-semibold disabled:opacity-50">
                  {saving ? 'Saving…' : renewSub ? 'Renew Subscription' : 'Create Subscription'}
                </button>
              </div>
            </div>
          </div>
        </Portal>
      )}
    </div>
  );
}

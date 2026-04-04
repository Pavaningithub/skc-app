import { useState, useMemo } from 'react';
import {
  TrendingUp, Users, DollarSign, Calendar, Package,
  Copy, Search, Filter, ChevronDown, ChevronUp,
} from 'lucide-react';
import { subscriptionsService } from '../../lib/services';
import { useRealtimeCollection } from '../../lib/useRealtimeCollection';
import { formatCurrency, formatDate } from '../../lib/utils';
import type { Subscription } from '../../lib/types';
import type { SubscriptionStatus } from '../../lib/constants';
import toast from 'react-hot-toast';

// ── Helpers ────────────────────────────────────────────────────────────────

function deriveStatus(sub: Subscription): SubscriptionStatus {
  if (sub.status) return sub.status;
  if (!sub.isActive) return 'cancelled';
  return 'active';
}

function copyText(text: string, label = 'Copied!') {
  navigator.clipboard.writeText(text).then(() => toast.success(label));
}

function KpiCard({ icon, label, value, sub, bg }: {
  icon: React.ReactNode; label: string; value: string | number; sub?: string; bg: string;
}) {
  return (
    <div className={`${bg} rounded-xl p-4`}>
      <div className="flex items-center gap-2 mb-1">{icon}
        <span className="text-xs text-gray-500 font-medium">{label}</span>
      </div>
      <p className="text-xl font-bold text-gray-800">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────────────────

export default function SubscriptionAnalyticsPage() {
  const [subs, loading] = useRealtimeCollection<Subscription>(
    subscriptionsService.subscribe.bind(subscriptionsService)
  );

  // Filter / sort state
  const [search, setSearch]               = useState('');
  const [filterStatus, setFilterStatus]   = useState<SubscriptionStatus | 'all'>('all');
  const [filterDuration, setFilterDuration] = useState<'3months' | '6months' | 'all'>('all');
  const [filterPayMode, setFilterPayMode] = useState<'upfront' | 'monthly' | 'all'>('all');
  const [sortBy, setSortBy]               = useState<'newest' | 'oldest' | 'amount' | 'name'>('newest');
  const [expandedSub, setExpandedSub]     = useState<string | null>(null);

  // ── Computed stats ────────────────────────────────────────────────────────

  const stats = useMemo(() => {
    const now = new Date();

    const active    = subs.filter(s => s.isActive && new Date(s.endDate) >= now);
    const pending   = subs.filter(s => deriveStatus(s) === 'pending');
    const cancelled = subs.filter(s => deriveStatus(s) === 'cancelled');

    // MRR from active subscriptions
    const mrr = active.reduce((sum, s) => sum + s.discountedAmount, 0);

    // Revenue actually collected from monthlyTracking paid entries
    let totalCollected = 0;
    let totalPending   = 0;
    let totalDelivered = 0;
    let totalMonthsDue = 0;
    let totalMonthsDelivered = 0;

    for (const sub of subs) {
      const tracking = sub.monthlyTracking ?? [];
      if (tracking.length > 0) {
        for (const entry of tracking) {
          if (entry.paymentStatus === 'paid') totalCollected += sub.discountedAmount;
          else totalPending += sub.discountedAmount;
          if (entry.deliveryStatus === 'delivered') { totalDelivered++; totalMonthsDelivered++; }
          totalMonthsDue++;
        }
      } else {
        // Legacy: use top-level paymentStatus
        if (sub.paymentStatus === 'paid') totalCollected += sub.discountedAmount;
        else totalPending += sub.discountedAmount;
      }
    }

    // Plan breakdown
    const threeMoSubs = subs.filter(s => s.duration === '3months');
    const sixMoSubs   = subs.filter(s => s.duration === '6months');
    const upfrontSubs = subs.filter(s => s.paymentMode === 'upfront');
    const monthlySubs = subs.filter(s => s.paymentMode === 'monthly');

    // Savings delivered to customers
    const totalSavings = subs.reduce((sum, s) => {
      const months = s.duration === '3months' ? 3 : 6;
      return sum + (s.baseAmount - s.discountedAmount) * months;
    }, 0);

    // Product breakdown
    const productMap: Record<string, { name: string; count: number; monthlyRevenue: number; paidMonths: number }> = {};
    for (const sub of subs) {
      for (const item of sub.items) {
        if (!productMap[item.productName])
          productMap[item.productName] = { name: item.productName, count: 0, monthlyRevenue: 0, paidMonths: 0 };
        productMap[item.productName].count += 1;
        productMap[item.productName].monthlyRevenue += item.totalPrice;
        const paidCount = (sub.monthlyTracking ?? []).filter(e => e.paymentStatus === 'paid').length;
        productMap[item.productName].paidMonths += paidCount;
      }
    }
    const topProducts = Object.values(productMap).sort((a, b) => b.count - a.count);

    // Delivery completion rate
    const deliveryRate = totalMonthsDue > 0
      ? Math.round((totalMonthsDelivered / totalMonthsDue) * 100)
      : 0;

    // Payment collection rate (months)
    const paidMonthsTotal = subs.flatMap(s => s.monthlyTracking ?? []).filter(e => e.paymentStatus === 'paid').length;
    const allMonthsTotal  = subs.flatMap(s => s.monthlyTracking ?? []).length;
    const paymentRate = allMonthsTotal > 0
      ? Math.round((paidMonthsTotal / allMonthsTotal) * 100)
      : 0;

    // Month-by-month collection (last 6 months)
    const monthlyBreakdown: Record<string, { collected: number; delivered: number; pending: number }> = {};
    for (const sub of subs) {
      for (const entry of sub.monthlyTracking ?? []) {
        const key = entry.label;
        if (!monthlyBreakdown[key]) monthlyBreakdown[key] = { collected: 0, delivered: 0, pending: 0 };
        if (entry.paymentStatus === 'paid') monthlyBreakdown[key].collected += sub.discountedAmount;
        else monthlyBreakdown[key].pending += sub.discountedAmount;
        if (entry.deliveryStatus === 'delivered') monthlyBreakdown[key].delivered++;
      }
    }

    return {
      active, pending, cancelled,
      mrr, totalCollected, totalPending, totalSavings,
      threeMoSubs, sixMoSubs, upfrontSubs, monthlySubs,
      topProducts,
      deliveryRate, paymentRate, paidMonthsTotal, allMonthsTotal,
      totalDelivered, totalMonthsDue,
      monthlyBreakdown,
    };
  }, [subs]);

  // ── Filtered sub list for drill-down ─────────────────────────────────────

  const filtered = useMemo(() => {
    let result = subs.map(s => ({ ...s, _status: deriveStatus(s) }));

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(s =>
        s.customerName.toLowerCase().includes(q) ||
        s.customerWhatsapp.includes(q)
      );
    }
    if (filterStatus !== 'all')   result = result.filter(s => s._status === filterStatus);
    if (filterDuration !== 'all') result = result.filter(s => s.duration === filterDuration);
    if (filterPayMode !== 'all')  result = result.filter(s => s.paymentMode === filterPayMode);

    result.sort((a, b) => {
      if (sortBy === 'amount') return b.discountedAmount - a.discountedAmount;
      if (sortBy === 'name')   return a.customerName.localeCompare(b.customerName);
      if (sortBy === 'oldest') return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    return result;
  }, [subs, search, filterStatus, filterDuration, filterPayMode, sortBy]);

  if (loading) return (
    <div className="flex justify-center items-center min-h-60">
      <div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="p-4 md:p-6 space-y-6 animate-fade-in">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 font-display">Subscription Analytics</h1>
          <p className="text-sm text-gray-500">{subs.length} total · {stats.active.length} active · {stats.pending.length} pending · {stats.cancelled.length} cancelled</p>
        </div>
        <button
          onClick={() => copyText(
            [
              `Subscription Summary — ${new Date().toLocaleDateString('en-IN')}`,
              `Total: ${subs.length} | Active: ${stats.active.length} | Pending: ${stats.pending.length} | Cancelled: ${stats.cancelled.length}`,
              `MRR: ₹${stats.mrr} | Collected: ₹${stats.totalCollected} | Pending: ₹${stats.totalPending}`,
              `Payment rate: ${stats.paymentRate}% (${stats.paidMonthsTotal}/${stats.allMonthsTotal} months paid)`,
              `Delivery rate: ${stats.deliveryRate}% (${stats.totalDelivered}/${stats.totalMonthsDue} months delivered)`,
              `Savings to customers: ₹${stats.totalSavings}`,
            ].join('\n'),
            'Analytics summary copied!'
          )}
          className="flex items-center gap-1.5 border border-gray-200 text-gray-600 px-3 py-2 rounded-xl text-sm hover:bg-gray-50">
          <Copy className="w-4 h-4" /> Copy Summary
        </button>
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard
          icon={<Users className="w-5 h-5 text-green-600" />}
          label="Active" value={stats.active.length}
          sub={`${stats.pending.length} pending`}
          bg="bg-green-50" />
        <KpiCard
          icon={<TrendingUp className="w-5 h-5 text-blue-600" />}
          label="MRR" value={formatCurrency(stats.mrr)}
          sub="active subs/mo"
          bg="bg-blue-50" />
        <KpiCard
          icon={<DollarSign className="w-5 h-5 text-orange-600" />}
          label="Collected" value={formatCurrency(stats.totalCollected)}
          sub={`${stats.paymentRate}% payment rate`}
          bg="bg-orange-50" />
        <KpiCard
          icon={<Calendar className="w-5 h-5 text-purple-600" />}
          label="Pending ₹" value={formatCurrency(stats.totalPending)}
          sub={`${stats.deliveryRate}% delivery rate`}
          bg="bg-purple-50" />
      </div>

      {/* Payment & Delivery rates */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-xs text-gray-500 font-medium mb-2">💰 Payment Rate</p>
          <div className="flex items-end gap-2">
            <p className="text-2xl font-bold text-gray-800">{stats.paymentRate}%</p>
            <p className="text-xs text-gray-400 mb-1">{stats.paidMonthsTotal}/{stats.allMonthsTotal} months</p>
          </div>
          <div className="mt-2 h-2 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${stats.paymentRate}%` }} />
          </div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-xs text-gray-500 font-medium mb-2">📦 Delivery Rate</p>
          <div className="flex items-end gap-2">
            <p className="text-2xl font-bold text-gray-800">{stats.deliveryRate}%</p>
            <p className="text-xs text-gray-400 mb-1">{stats.totalDelivered}/{stats.totalMonthsDue} months</p>
          </div>
          <div className="mt-2 h-2 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${stats.deliveryRate}%` }} />
          </div>
        </div>
      </div>

      {/* Plan & Payment mode mix */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
        <h2 className="font-semibold text-gray-700">Plan Mix</h2>
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-blue-50 rounded-xl p-4 text-center">
            <p className="text-3xl font-bold text-blue-600">{stats.threeMoSubs.length}</p>
            <p className="text-sm text-blue-700 font-medium mt-1">3-Month Plans</p>
            <p className="text-xs text-blue-500 mt-0.5">
              {formatCurrency(stats.threeMoSubs.reduce((s, sub) => s + sub.discountedAmount, 0))}/mo combined
            </p>
          </div>
          <div className="bg-green-50 rounded-xl p-4 text-center">
            <p className="text-3xl font-bold text-green-600">{stats.sixMoSubs.length}</p>
            <p className="text-sm text-green-700 font-medium mt-1">6-Month Plans</p>
            <p className="text-xs text-green-500 mt-0.5">
              {formatCurrency(stats.sixMoSubs.reduce((s, sub) => s + sub.discountedAmount, 0))}/mo combined
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-purple-50 rounded-xl p-3 text-center">
            <p className="text-xl font-bold text-purple-600">{stats.upfrontSubs.length}</p>
            <p className="text-xs text-purple-700 font-medium mt-0.5">💳 Upfront</p>
          </div>
          <div className="bg-amber-50 rounded-xl p-3 text-center">
            <p className="text-xl font-bold text-amber-600">{stats.monthlySubs.length}</p>
            <p className="text-xs text-amber-700 font-medium mt-0.5">📅 Monthly pay</p>
          </div>
        </div>
        <p className="text-xs text-gray-400 text-center">
          Total savings delivered to customers: <span className="font-semibold text-green-600">{formatCurrency(stats.totalSavings)}</span>
        </p>
      </div>

      {/* Month-by-month breakdown */}
      {Object.keys(stats.monthlyBreakdown).length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-700">Month-by-Month Tracking</h2>
            <button
              onClick={() => copyText(
                Object.entries(stats.monthlyBreakdown)
                  .map(([mo, d]) => `${mo}: Collected ₹${d.collected} | Pending ₹${d.pending} | Delivered ${d.delivered} orders`)
                  .join('\n'),
                'Monthly breakdown copied!'
              )}
              className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1">
              <Copy className="w-3 h-3" /> Copy
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-3 py-2 text-gray-500 font-medium">Month</th>
                  <th className="text-right px-3 py-2 text-gray-500 font-medium">Collected</th>
                  <th className="text-right px-3 py-2 text-gray-500 font-medium">Pending</th>
                  <th className="text-center px-3 py-2 text-gray-500 font-medium">Delivered</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(stats.monthlyBreakdown).map(([mo, d], idx) => (
                  <tr key={mo} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
                    <td className="px-3 py-2 font-medium text-gray-700">{mo}</td>
                    <td className="px-3 py-2 text-right text-green-600 font-semibold">{formatCurrency(d.collected)}</td>
                    <td className="px-3 py-2 text-right text-yellow-600">{formatCurrency(d.pending)}</td>
                    <td className="px-3 py-2 text-center text-blue-600">{d.delivered} 📦</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Top Products */}
      {stats.topProducts.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-700 flex items-center gap-2">
              <Package className="w-4 h-4" /> Top Products
            </h2>
            <button
              onClick={() => copyText(
                stats.topProducts.map(p =>
                  `${p.name}: ${p.count} subs · ₹${p.monthlyRevenue}/mo · ${p.paidMonths} months paid`
                ).join('\n'),
                'Products copied!'
              )}
              className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1">
              <Copy className="w-3 h-3" /> Copy
            </button>
          </div>
          <div className="space-y-2">
            {stats.topProducts.map(p => (
              <div key={p.name} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-orange-400" />
                  <span className="text-gray-700">{p.name}</span>
                </div>
                <div className="flex items-center gap-4 text-xs">
                  <span className="text-gray-500">{p.count} subs</span>
                  <span className="font-medium text-orange-600">{formatCurrency(p.monthlyRevenue)}/mo</span>
                  <span className="text-green-600">{p.paidMonths} paid</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Subscriber drill-down ─────────────────────────────────────────── */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-gray-700">All Subscriptions</h2>
          <button
            onClick={() => copyText(
              filtered.map(s =>
                `${s.customerName} | ${s.customerWhatsapp} | ${s.duration} | ${s.paymentMode ?? 'upfront'} | ₹${s.discountedAmount}/mo | ${s._status}`
              ).join('\n'),
              'Subscriber list copied!'
            )}
            className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1">
            <Copy className="w-3 h-3" /> Copy All
          </button>
        </div>

        {/* Filters */}
        <div className="space-y-2">
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
              <option value="amount">Amount ↓</option>
              <option value="name">Name A-Z</option>
            </select>
          </div>
          <div className="flex gap-1.5 flex-wrap items-center">
            <Filter className="w-3 h-3 text-gray-400" />
            {(['all', 'pending', 'confirmed', 'payment_requested', 'active', 'cancelled'] as const).map(s => (
              <button key={s} onClick={() => setFilterStatus(s)}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                  filterStatus === s ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-gray-500 border-gray-200 hover:border-orange-300'
                }`}>
                {s === 'all' ? 'All' : s === 'payment_requested' ? 'Pay Sent' : s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
            <span className="w-px h-4 bg-gray-200" />
            {(['all', '3months', '6months'] as const).map(d => (
              <button key={d} onClick={() => setFilterDuration(d)}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                  filterDuration === d ? 'bg-blue-500 text-white border-blue-500' : 'bg-white text-gray-500 border-gray-200 hover:border-blue-300'
                }`}>
                {d === 'all' ? 'All Plans' : d === '3months' ? '3 Mo' : '6 Mo'}
              </button>
            ))}
            <span className="w-px h-4 bg-gray-200" />
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

        {/* Subscriber rows */}
        <div className="space-y-2">
          {filtered.length === 0 && (
            <p className="text-center text-sm text-gray-400 py-4">No results</p>
          )}
          {filtered.map(sub => {
            const durationMo = sub.duration === '6months' ? 6 : 3;
            const isUpfront  = sub.paymentMode === 'upfront';
            const tracking   = sub.monthlyTracking ?? [];
            const paidMonths = tracking.filter(e => e.paymentStatus === 'paid').length;
            const deliveredMonths = tracking.filter(e => e.deliveryStatus === 'delivered').length;
            const isExpanded = expandedSub === sub.id;

            const statusCls: Record<SubscriptionStatus, string> = {
              pending:           'text-yellow-600',
              confirmed:         'text-blue-600',
              payment_requested: 'text-purple-600',
              active:            'text-green-600',
              cancelled:         'text-gray-400',
            };

            return (
              <div key={sub.id} className="border border-gray-100 rounded-xl overflow-hidden">
                <button className="w-full text-left px-3 py-2.5 hover:bg-gray-50 transition-colors"
                  onClick={() => setExpandedSub(isExpanded ? null : sub.id)}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-gray-800 truncate">{sub.customerName}</p>
                        <span className={`text-xs font-medium ${statusCls[sub._status]}`}>
                          {sub._status === 'payment_requested' ? 'Pay Sent' : sub._status.charAt(0).toUpperCase() + sub._status.slice(1)}
                        </span>
                      </div>
                      <p className="text-xs text-gray-400">
                        📱 {sub.customerWhatsapp} · {durationMo} Mo · {isUpfront ? 'Upfront' : 'Monthly'}
                        {tracking.length > 0 && ` · ${paidMonths}/${durationMo} paid · ${deliveredMonths}/${durationMo} delivered`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <div className="text-right">
                        <p className="text-sm font-bold text-orange-600">{formatCurrency(sub.discountedAmount)}/mo</p>
                        {isUpfront && (
                          <p className="text-xs text-purple-500">Total: {formatCurrency(sub.discountedAmount * durationMo)}</p>
                        )}
                      </div>
                      <button onClick={e => { e.stopPropagation(); copyText(
                        `${sub.customerName} | ${sub.customerWhatsapp} | ${durationMo} Mo | ${isUpfront ? 'Upfront' : 'Monthly'} | ₹${sub.discountedAmount}/mo | ${sub._status}`,
                        'Copied!'
                      ); }} className="text-gray-300 hover:text-gray-500">
                        <Copy className="w-3 h-3" />
                      </button>
                      {isExpanded
                        ? <ChevronUp className="w-4 h-4 text-gray-400" />
                        : <ChevronDown className="w-4 h-4 text-gray-400" />}
                    </div>
                  </div>
                </button>

                {/* Monthly tracking drill-down */}
                {isExpanded && tracking.length > 0 && (
                  <div className="border-t border-gray-100 px-3 pb-3">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mt-2 mb-1.5">Monthly Tracking</p>
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-gray-400">
                          <th className="text-left py-1">Mo</th>
                          <th className="text-left py-1">Period</th>
                          <th className="text-center py-1">Payment</th>
                          <th className="text-center py-1">Delivery</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tracking.map(entry => (
                          <tr key={entry.month} className="border-t border-gray-50">
                            <td className="py-1 font-bold text-gray-600">#{entry.month}</td>
                            <td className="py-1 text-gray-400">
                              {entry.startDate
                                ? `${formatDate(entry.startDate)} → ${formatDate(entry.endDate)}`
                                : entry.label}
                            </td>
                            <td className="py-1 text-center">
                              {entry.paymentStatus === 'paid'
                                ? <span className="text-green-600">✅ Paid</span>
                                : entry.paymentStatus === 'requested'
                                ? <span className="text-purple-500">💳 Sent</span>
                                : <span className="text-yellow-500">⏳</span>}
                            </td>
                            <td className="py-1 text-center">
                              {entry.deliveryStatus === 'delivered'
                                ? <span className="text-blue-500">📦</span>
                                : <span className="text-gray-300">—</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="mt-2 flex items-center justify-between text-xs">
                      <span className="text-gray-400">
                        {formatDate(sub.startDate)} → {formatDate(sub.endDate)}
                      </span>
                      <button onClick={() => copyText(
                        tracking.map(e =>
                          `Month ${e.month} (${e.label}): Payment=${e.paymentStatus} Delivery=${e.deliveryStatus}`
                        ).join('\n'),
                        'Tracking copied!'
                      )} className="text-gray-400 hover:text-gray-600 flex items-center gap-0.5">
                        <Copy className="w-3 h-3" /> Copy tracking
                      </button>
                    </div>
                  </div>
                )}

                {isExpanded && tracking.length === 0 && (
                  <div className="border-t border-gray-100 px-3 py-2 text-xs text-gray-400">
                    No monthly tracking yet. Go to Subscriptions page and click Confirm to generate months.
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

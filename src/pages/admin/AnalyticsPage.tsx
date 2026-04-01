import { useMemo, useState } from 'react';
import {
  TrendingUp, TrendingDown, ShoppingBag, Users, Package,
  ChevronLeft, ChevronRight, BarChart2, IndianRupee,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  Cell, PieChart, Pie,
} from 'recharts';
import { ordersService, expensesService, customersService } from '../../lib/services';
import { useRealtimeCollection } from '../../lib/useRealtimeCollection';
import { formatCurrency } from '../../lib/utils';
import type { Order, Expense, Customer } from '../../lib/types';

// ── helpers ──────────────────────────────────────────────────────────────────
function monthLabel(year: number, month: number) {
  return new Date(year, month, 1).toLocaleString('en-IN', { month: 'long', year: 'numeric' });
}

const STATUS_COLORS: Record<string, string> = {
  delivered:        '#22c55e',
  out_for_delivery: '#a855f7',
  confirmed:        '#3b82f6',
  pending:          '#eab308',
  cancelled:        '#9ca3af',
};

const CHART_COLORS = ['#c8821a', '#3d1c02', '#22c55e', '#3b82f6', '#a855f7', '#f97316', '#14b8a6'];

// ── component ─────────────────────────────────────────────────────────────────
export default function AnalyticsPage() {
  const [orders,    ordersLoading]    = useRealtimeCollection<Order>(ordersService.subscribe.bind(ordersService));
  const [expenses,  expensesLoading]  = useRealtimeCollection<Expense>(expensesService.subscribe.bind(expensesService));
  const [customers, customersLoading] = useRealtimeCollection<Customer>(customersService.subscribe.bind(customersService));
  const loading = ordersLoading || expensesLoading || customersLoading;

  // ── month picker ────────────────────────────────────────────────────────────
  const today = new Date();
  const [selYear,  setSelYear]  = useState(today.getFullYear());
  const [selMonth, setSelMonth] = useState(today.getMonth()); // 0-indexed

  function prevMonth() {
    if (selMonth === 0) { setSelYear(y => y - 1); setSelMonth(11); }
    else setSelMonth(m => m - 1);
  }
  function nextMonth() {
    const isCurrentMonth = selYear === today.getFullYear() && selMonth === today.getMonth();
    if (isCurrentMonth) return;
    if (selMonth === 11) { setSelYear(y => y + 1); setSelMonth(0); }
    else setSelMonth(m => m + 1);
  }
  const isCurrentMonth = selYear === today.getFullYear() && selMonth === today.getMonth();

  // ── date range for selected month ────────────────────────────────────────────
  const { monthStart, monthEnd } = useMemo(() => ({
    monthStart: new Date(selYear, selMonth, 1).toISOString(),
    monthEnd:   new Date(selYear, selMonth + 1, 0, 23, 59, 59).toISOString(),
  }), [selYear, selMonth]);

  // ── computed stats ────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const monthOrders   = orders.filter(o =>
      o.createdAt >= monthStart && o.createdAt <= monthEnd && o.status !== 'cancelled'
    );
    const monthExpenses = expenses.filter(e => e.date >= monthStart && e.date <= monthEnd);
    const cancelledOrders = orders.filter(o =>
      o.createdAt >= monthStart && o.createdAt <= monthEnd && o.status === 'cancelled'
    );

    // Revenue & profit
    const revenue  = monthOrders.reduce((s, o) => s + o.total, 0);
    const expTotal = monthExpenses.reduce((s, e) => s + e.amount, 0);
    const profit   = revenue - expTotal;

    // Status breakdown
    const byStatus: Record<string, number> = {};
    for (const o of [...monthOrders, ...cancelledOrders]) {
      byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;
    }

    // Payment breakdown
    const paid    = monthOrders.filter(o => o.paymentStatus === 'paid').reduce((s, o) => s + o.total, 0);
    const unpaid  = monthOrders.filter(o => o.paymentStatus === 'pending').reduce((s, o) => s + o.total, 0);

    // Top products by revenue
    const productMap = new Map<string, { name: string; revenue: number; qty: number; orders: number }>();
    for (const o of monthOrders) {
      for (const item of o.items) {
        const key = item.productId;
        if (!productMap.has(key)) productMap.set(key, { name: item.productName, revenue: 0, qty: 0, orders: 0 });
        const p = productMap.get(key)!;
        p.revenue += item.totalPrice;
        p.qty     += item.quantity;
        p.orders  += 1;
      }
    }
    const topProducts = [...productMap.values()]
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 8);

    // Daily revenue for bar chart
    const daysInMonth = new Date(selYear, selMonth + 1, 0).getDate();
    const dailyRevenue: { day: string; revenue: number; orders: number }[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const dayStr = `${selYear}-${String(selMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dayOrders = monthOrders.filter(o => o.createdAt.startsWith(dayStr));
      dailyRevenue.push({
        day: String(d),
        revenue: dayOrders.reduce((s, o) => s + o.total, 0),
        orders:  dayOrders.length,
      });
    }

    // Expense breakdown by category
    const expByCategory = new Map<string, number>();
    for (const e of monthExpenses) {
      const cat = e.category ?? 'Other';
      expByCategory.set(cat, (expByCategory.get(cat) ?? 0) + e.amount);
    }
    const expenseBreakdown = [...expByCategory.entries()]
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);

    // Avg order value
    const avgOrderValue = monthOrders.length > 0 ? Math.round(revenue / monthOrders.length) : 0;

    // New customers this month
    const newCustomers = customers.filter(c =>
      c.createdAt >= monthStart && c.createdAt <= monthEnd
    ).length;

    // Referral discount total
    const referralDiscountTotal = monthOrders.reduce((s, o) => s + (o.referralDiscount ?? 0), 0);

    // Delivery charge collected
    const deliveryChargeTotal = monthOrders.reduce((s, o) => s + (o.deliveryCharge ?? 0), 0);

    return {
      revenue, expTotal, profit,
      orderCount: monthOrders.length,
      cancelledCount: cancelledOrders.length,
      paid, unpaid,
      byStatus,
      topProducts,
      dailyRevenue,
      expenseBreakdown,
      avgOrderValue,
      newCustomers,
      referralDiscountTotal,
      deliveryChargeTotal,
      marginPct: revenue > 0 ? ((profit / revenue) * 100).toFixed(1) : '0.0',
    };
  }, [orders, expenses, customers, monthStart, monthEnd, selYear, selMonth]);

  // ── prev month comparison ────────────────────────────────────────────────────
  const prevStats = useMemo(() => {
    const pm = selMonth === 0 ? 11 : selMonth - 1;
    const py = selMonth === 0 ? selYear - 1 : selYear;
    const pStart = new Date(py, pm, 1).toISOString();
    const pEnd   = new Date(py, pm + 1, 0, 23, 59, 59).toISOString();
    const po = orders.filter(o => o.createdAt >= pStart && o.createdAt <= pEnd && o.status !== 'cancelled');
    const pe = expenses.filter(e => e.date >= pStart && e.date <= pEnd);
    const revenue  = po.reduce((s, o) => s + o.total, 0);
    const expTotal = pe.reduce((s, e) => s + e.amount, 0);
    return { revenue, expTotal, profit: revenue - expTotal, orderCount: po.length };
  }, [orders, expenses, selYear, selMonth]);

  function delta(curr: number, prev: number) {
    if (prev === 0) return null;
    const pct = ((curr - prev) / prev * 100).toFixed(0);
    const up = curr >= prev;
    return { pct, up };
  }

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-64">
        <div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const revenueD = delta(stats.revenue, prevStats.revenue);
  const profitD  = delta(stats.profit,  prevStats.profit);
  const ordersD  = delta(stats.orderCount, prevStats.orderCount);

  return (
    <div className="p-4 md:p-6 space-y-6 animate-fade-in">

      {/* Header + month picker */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 font-display flex items-center gap-2">
            <BarChart2 className="w-6 h-6 text-orange-500" /> Analytics
          </h1>
          <p className="text-gray-500 text-sm">Business performance by month</p>
        </div>
        <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-2 shadow-sm">
          <button onClick={prevMonth} className="p-1 hover:bg-gray-100 rounded-lg transition-colors">
            <ChevronLeft className="w-4 h-4 text-gray-600" />
          </button>
          <span className="text-sm font-semibold text-gray-800 min-w-[140px] text-center">
            {monthLabel(selYear, selMonth)}
          </span>
          <button onClick={nextMonth} disabled={isCurrentMonth}
            className="p-1 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-30">
            <ChevronRight className="w-4 h-4 text-gray-600" />
          </button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Revenue */}
        <div className="bg-white rounded-xl border border-green-200 p-4">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp className="w-4 h-4 text-green-500" />
            <span className="text-xs text-gray-400 uppercase tracking-wide font-medium">Revenue</span>
          </div>
          <p className="text-2xl font-bold text-green-600">{formatCurrency(stats.revenue)}</p>
          <p className="text-xs text-gray-400 mt-0.5">{stats.orderCount} orders</p>
          {revenueD && (
            <p className={`text-xs mt-1 font-semibold flex items-center gap-0.5 ${revenueD.up ? 'text-green-600' : 'text-red-500'}`}>
              {revenueD.up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              {revenueD.up ? '+' : ''}{revenueD.pct}% vs last month
            </p>
          )}
        </div>

        {/* Expenses */}
        <div className="bg-white rounded-xl border border-red-200 p-4">
          <div className="flex items-center gap-2 mb-1">
            <TrendingDown className="w-4 h-4 text-red-400" />
            <span className="text-xs text-gray-400 uppercase tracking-wide font-medium">Expenses</span>
          </div>
          <p className="text-2xl font-bold text-red-500">{formatCurrency(stats.expTotal)}</p>
          <p className="text-xs text-gray-400 mt-0.5">&nbsp;</p>
        </div>

        {/* Profit */}
        <div className={`rounded-xl border p-4 ${stats.profit >= 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
          <div className="flex items-center gap-2 mb-1">
            <IndianRupee className={`w-4 h-4 ${stats.profit >= 0 ? 'text-emerald-500' : 'text-red-400'}`} />
            <span className="text-xs text-gray-400 uppercase tracking-wide font-medium">Net Profit</span>
          </div>
          <p className={`text-2xl font-bold ${stats.profit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
            {formatCurrency(stats.profit)}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">{stats.marginPct}% margin</p>
          {profitD && (
            <p className={`text-xs mt-1 font-semibold flex items-center gap-0.5 ${profitD.up ? 'text-green-600' : 'text-red-500'}`}>
              {profitD.up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              {profitD.up ? '+' : ''}{profitD.pct}% vs last month
            </p>
          )}
        </div>

        {/* Orders */}
        <div className="bg-white rounded-xl border border-blue-200 p-4">
          <div className="flex items-center gap-2 mb-1">
            <ShoppingBag className="w-4 h-4 text-blue-500" />
            <span className="text-xs text-gray-400 uppercase tracking-wide font-medium">Orders</span>
          </div>
          <p className="text-2xl font-bold text-blue-600">{stats.orderCount}</p>
          <p className="text-xs text-gray-400 mt-0.5">Avg ₹{stats.avgOrderValue}/order</p>
          {ordersD && (
            <p className={`text-xs mt-1 font-semibold flex items-center gap-0.5 ${ordersD.up ? 'text-green-600' : 'text-red-500'}`}>
              {ordersD.up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              {ordersD.up ? '+' : ''}{ordersD.pct}% vs last month
            </p>
          )}
        </div>
      </div>

      {/* Secondary stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
          <p className="text-xs text-gray-400 mb-1">Paid</p>
          <p className="font-bold text-gray-800">{formatCurrency(stats.paid)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
          <p className="text-xs text-gray-400 mb-1">Unpaid</p>
          <p className="font-bold text-orange-600">{formatCurrency(stats.unpaid)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
          <p className="text-xs text-gray-400 mb-1">New Customers</p>
          <p className="font-bold text-gray-800 flex items-center justify-center gap-1">
            <Users className="w-3.5 h-3.5 text-blue-400" />{stats.newCustomers}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
          <p className="text-xs text-gray-400 mb-1">Cancelled</p>
          <p className="font-bold text-red-400">{stats.cancelledCount}</p>
        </div>
      </div>

      {/* Daily Revenue Bar Chart */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <h2 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
          <BarChart2 className="w-4 h-4 text-orange-500" />
          Daily Revenue — {monthLabel(selYear, selMonth)}
        </h2>
        {stats.dailyRevenue.every(d => d.revenue === 0) ? (
          <p className="text-center text-gray-400 text-sm py-8">No revenue data for this month</p>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={stats.dailyRevenue} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <XAxis dataKey="day" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false}
                tickFormatter={v => v >= 1000 ? `₹${(v / 1000).toFixed(0)}k` : `₹${v}`} />
              <Tooltip
                formatter={(value, name) => [
                  name === 'revenue' ? formatCurrency(Number(value)) : value,
                  name === 'revenue' ? 'Revenue' : 'Orders',
                ]}
                labelFormatter={d => `Day ${d}`}
                contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
              />
              <Bar dataKey="revenue" radius={[4, 4, 0, 0]}>
                {stats.dailyRevenue.map((entry, index) => (
                  <Cell key={index} fill={entry.revenue > 0 ? '#c8821a' : '#f3f4f6'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Top products + Order status */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Top Products */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
            <Package className="w-4 h-4 text-orange-500" />
            <h2 className="font-semibold text-gray-800">Top Products by Revenue</h2>
          </div>
          {stats.topProducts.length === 0 ? (
            <p className="text-center text-gray-400 text-sm py-8">No orders this month</p>
          ) : (
            <div className="divide-y divide-gray-50">
              {stats.topProducts.map((p, i) => {
                const maxRev = stats.topProducts[0].revenue;
                const barPct = maxRev > 0 ? Math.round((p.revenue / maxRev) * 100) : 0;
                return (
                  <div key={p.name} className="px-4 py-3">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xs font-bold text-gray-400 w-4 flex-shrink-0">#{i + 1}</span>
                        <span className="text-sm font-medium text-gray-800 truncate">{p.name}</span>
                      </div>
                      <div className="text-right flex-shrink-0 ml-2">
                        <span className="text-sm font-bold text-gray-800">{formatCurrency(p.revenue)}</span>
                        <span className="text-xs text-gray-400 ml-1">({p.orders} orders)</span>
                      </div>
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all"
                        style={{ width: `${barPct}%`, background: CHART_COLORS[i % CHART_COLORS.length] }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Order Status Breakdown */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-2 mb-4">
            <ShoppingBag className="w-4 h-4 text-orange-500" />
            <h2 className="font-semibold text-gray-800">Order Status Breakdown</h2>
          </div>
          {Object.keys(stats.byStatus).length === 0 ? (
            <p className="text-center text-gray-400 text-sm py-8">No orders this month</p>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie
                    data={Object.entries(stats.byStatus).map(([name, value]) => ({ name, value }))}
                    cx="50%" cy="50%"
                    innerRadius={45} outerRadius={70}
                    dataKey="value"
                    paddingAngle={2}
                  >
                    {Object.entries(stats.byStatus).map(([name], i) => (
                      <Cell key={name} fill={STATUS_COLORS[name] ?? CHART_COLORS[i]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(v, name) => [v, String(name).replace(/_/g, ' ')]}
                    contentStyle={{ fontSize: 12, borderRadius: 8 }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="grid grid-cols-2 gap-1.5 mt-2">
                {Object.entries(stats.byStatus).map(([status, count]) => (
                  <div key={status} className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                      style={{ background: STATUS_COLORS[status] ?? '#9ca3af' }} />
                    <span className="text-xs text-gray-600 capitalize">{status.replace(/_/g, ' ')}</span>
                    <span className="text-xs font-bold text-gray-800 ml-auto">{count}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Expense breakdown */}
      {stats.expenseBreakdown.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingDown className="w-4 h-4 text-red-400" />
              <h2 className="font-semibold text-gray-800">Expense Breakdown</h2>
            </div>
            <span className="text-sm font-bold text-red-500">{formatCurrency(stats.expTotal)}</span>
          </div>
          <div className="divide-y divide-gray-50">
            {stats.expenseBreakdown.map((e, i) => {
              const pct = stats.expTotal > 0 ? Math.round((e.value / stats.expTotal) * 100) : 0;
              return (
                <div key={e.name} className="px-4 py-3 flex items-center gap-3">
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                  <span className="text-sm text-gray-700 flex-1">{e.name}</span>
                  <span className="text-xs text-gray-400">{pct}%</span>
                  <span className="text-sm font-semibold text-gray-800">{formatCurrency(e.value)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Additional metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
          <h2 className="font-semibold text-gray-800 text-sm">Payment Collection</h2>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Paid</span>
              <span className="font-semibold text-green-600">{formatCurrency(stats.paid)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Pending</span>
              <span className="font-semibold text-orange-500">{formatCurrency(stats.unpaid)}</span>
            </div>
            {stats.revenue > 0 && (
              <div className="mt-2">
                <div className="flex justify-between text-xs text-gray-400 mb-1">
                  <span>Collection rate</span>
                  <span>{Math.round((stats.paid / stats.revenue) * 100)}%</span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-green-400 rounded-full"
                    style={{ width: `${Math.round((stats.paid / stats.revenue) * 100)}%` }} />
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
          <h2 className="font-semibold text-gray-800 text-sm">Other Metrics</h2>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Avg Order Value</span>
              <span className="font-semibold text-gray-800">₹{stats.avgOrderValue}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Referral Discounts Given</span>
              <span className="font-semibold text-gray-800">{formatCurrency(stats.referralDiscountTotal)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Delivery Charges Collected</span>
              <span className="font-semibold text-gray-800">{formatCurrency(stats.deliveryChargeTotal)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">New Customers</span>
              <span className="font-semibold text-gray-800">{stats.newCustomers}</span>
            </div>
          </div>
        </div>
      </div>

      {/* vs prev month summary */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <h2 className="font-semibold text-gray-800 text-sm mb-3">
          vs {monthLabel(selMonth === 0 ? selYear - 1 : selYear, selMonth === 0 ? 11 : selMonth - 1)}
        </h2>
        <div className="grid grid-cols-3 gap-3 text-center">
          {[
            { label: 'Revenue', curr: stats.revenue, prev: prevStats.revenue },
            { label: 'Profit',  curr: stats.profit,  prev: prevStats.profit  },
            { label: 'Orders',  curr: stats.orderCount, prev: prevStats.orderCount },
          ].map(({ label, curr, prev }) => {
            const d = delta(curr, prev);
            return (
              <div key={label} className="space-y-0.5">
                <p className="text-xs text-gray-400">{label}</p>
                <p className="font-bold text-gray-800 text-sm">
                  {label === 'Orders' ? curr : formatCurrency(curr)}
                </p>
                {d ? (
                  <p className={`text-xs font-semibold ${d.up ? 'text-green-600' : 'text-red-500'}`}>
                    {d.up ? '▲' : '▼'} {Math.abs(Number(d.pct))}%
                  </p>
                ) : (
                  <p className="text-xs text-gray-300">—</p>
                )}
              </div>
            );
          })}
        </div>
      </div>

    </div>
  );
}

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ShoppingBag, AlertTriangle, CreditCard, TrendingUp, TrendingDown,
  Users, ArrowRight, Clock, MessageCircle, ChevronDown, ChevronUp, CheckCircle2,
  Activity, Truck,
} from 'lucide-react';
import { ordersService, stockService, customersService, expensesService, activityService } from '../../lib/services';
import { useRealtimeCollection } from '../../lib/useRealtimeCollection';
import { formatCurrency, formatDate, formatDateTime, buildCustomerWhatsAppUrl, paymentReminderToCustomer } from '../../lib/utils';
import type { Order, StockItem, Customer, Expense, AdminAction } from '../../lib/types';

const OVERDUE_DAYS = 3;
const STUCK_DAYS = 2;   // orders not delivered within this many days are flagged
const LS_REMINDERS_KEY = 'skc_reminders_sent';

function daysSince(order: { createdAt: string; deliveredAt?: string }): number {
  const from = order.deliveredAt ?? order.createdAt;
  return Math.floor((Date.now() - new Date(from).getTime()) / (1000 * 60 * 60 * 24));
}

function daysSinceCreated(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24));
}

export default function Dashboard() {
  const [orders, ordersLoading]       = useRealtimeCollection<Order>(ordersService.subscribe.bind(ordersService));
  const [stock, stockLoading]         = useRealtimeCollection<StockItem>(stockService.subscribe.bind(stockService));
  const [customers, customersLoading] = useRealtimeCollection<Customer>(customersService.subscribe.bind(customersService));
  const [expenses, expensesLoading]   = useRealtimeCollection<Expense>(expensesService.subscribe.bind(expensesService));
  const loading = ordersLoading || stockLoading || customersLoading || expensesLoading;

  const [showAllOverdue, setShowAllOverdue] = useState(false);

  // Persist reminder-sent state across sessions via localStorage
  const [reminderSent, setReminderSent] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem(LS_REMINDERS_KEY);
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch { return new Set(); }
  });

  const [recentActions] = useRealtimeCollection<AdminAction>(activityService.subscribe.bind(activityService));

  function markReminderSent(orderId: string, order: Order) {
    const next = new Set(reminderSent).add(orderId);
    setReminderSent(next);
    localStorage.setItem(LS_REMINDERS_KEY, JSON.stringify([...next]));
    activityService.log(
      'payment_reminder_sent',
      `Payment reminder sent to ${order.customerName} for #${order.orderNumber} (₹${order.total})`,
      orderId,
      order.orderNumber,
    );
  }

  const { stats, recentOrders, lowStockItems, overdueOrders, allPendingPayment, stuckOrders } = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const monthEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString();

    const pendingOrders  = orders.filter(o => ['pending', 'confirmed'].includes(o.status));
    const allPendingPay  = orders.filter(o => o.paymentStatus === 'pending' && o.total > 0);
    const overdue        = allPendingPay
      .filter(o => daysSince(o) >= OVERDUE_DAYS)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    // Orders placed/confirmed but NOT delivered within STUCK_DAYS
    const stuck = orders
      .filter(o =>
        ['pending', 'confirmed', 'out_for_delivery'].includes(o.status) &&
        daysSinceCreated(o.createdAt) >= STUCK_DAYS
      )
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const monthOrders    = orders.filter(o => o.createdAt >= monthStart && o.createdAt <= monthEnd && o.status !== 'cancelled');
    const monthExpenses  = expenses.filter(e => e.date >= monthStart && e.date <= monthEnd);
    const lowStock       = stock.filter(s => s.quantityAvailable <= s.lowStockThreshold);

    return {
      stats: {
        pendingOrders:        pendingOrders.length,
        pendingPaymentAmount: allPendingPay.reduce((s, o) => s + o.total, 0),
        overdueCount:         overdue.length,
        lowStockCount:        lowStock.length,
        monthlyRevenue:       monthOrders.reduce((s, o) => s + o.total, 0),
        monthlyExpenses:      monthExpenses.reduce((s, e) => s + e.amount, 0),
        totalCustomers:       customers.length,
        totalOrdersMonth:     monthOrders.length,
      },
      recentOrders:      orders.slice(0, 5),
      lowStockItems:     lowStock,
      overdueOrders:     overdue,
      allPendingPayment: allPendingPay,
      stuckOrders:       stuck,
    };
  }, [orders, stock, customers, expenses]);

  const profit = stats.monthlyRevenue - stats.monthlyExpenses;
  const visibleOverdue = showAllOverdue ? overdueOrders : overdueOrders.slice(0, 3);

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-64">
        <div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }  return (
    <div className="p-4 md:p-6 space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-gray-800 font-display">Dashboard</h1>
        <p className="text-gray-500 text-sm">{new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Link to="/admin/orders"
          className="bg-white rounded-xl border border-yellow-200 p-4 hover:shadow-md transition-shadow">
          <div className="w-9 h-9 bg-yellow-50 rounded-lg flex items-center justify-center mb-3">
            <ShoppingBag className="w-5 h-5 text-yellow-600" />
          </div>
          <p className="text-2xl font-bold text-gray-800">{stats.pendingOrders}</p>
          <p className="text-xs text-gray-500 mt-0.5">Pending Orders</p>
        </Link>

        <Link to="/admin/orders"
          className={`bg-white rounded-xl border p-4 hover:shadow-md transition-shadow ${stats.overdueCount > 0 ? 'border-red-300 bg-red-50' : 'border-red-200'}`}>
          <div className="w-9 h-9 bg-red-100 rounded-lg flex items-center justify-center mb-3">
            <CreditCard className="w-5 h-5 text-red-600" />
          </div>
          <p className="text-2xl font-bold text-gray-800">{formatCurrency(stats.pendingPaymentAmount)}</p>
          <p className="text-xs text-gray-500 mt-0.5">Payment Pending</p>
          {stats.overdueCount > 0 && (
            <p className="text-xs text-red-600 font-semibold mt-1 flex items-center gap-1">
              <Clock className="w-3 h-3" /> {stats.overdueCount} overdue {OVERDUE_DAYS}+ days
            </p>
          )}
        </Link>

        <Link to="/admin/stock"
          className="bg-white rounded-xl border border-orange-200 p-4 hover:shadow-md transition-shadow">
          <div className="w-9 h-9 bg-orange-50 rounded-lg flex items-center justify-center mb-3">
            <AlertTriangle className="w-5 h-5 text-orange-600" />
          </div>
          <p className="text-2xl font-bold text-gray-800">{stats.lowStockCount}</p>
          <p className="text-xs text-gray-500 mt-0.5">Low Stock Items</p>
        </Link>

        <Link to="/admin/customers"
          className="bg-white rounded-xl border border-blue-200 p-4 hover:shadow-md transition-shadow">
          <div className="w-9 h-9 bg-blue-50 rounded-lg flex items-center justify-center mb-3">
            <Users className="w-5 h-5 text-blue-600" />
          </div>
          <p className="text-2xl font-bold text-gray-800">{stats.totalCustomers}</p>
          <p className="text-xs text-gray-500 mt-0.5">Total Customers</p>
        </Link>
      </div>

      {/* Monthly P&L */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border border-green-200 p-4">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp className="w-4 h-4 text-green-500" />
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Revenue this month</span>
          </div>
          <p className="text-2xl font-bold text-green-600">{formatCurrency(stats.monthlyRevenue)}</p>
          <p className="text-xs text-gray-400 mt-0.5">{stats.totalOrdersMonth} orders</p>
        </div>
        <div className="bg-white rounded-xl border border-red-200 p-4">
          <div className="flex items-center gap-2 mb-1">
            <TrendingDown className="w-4 h-4 text-red-500" />
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Expenses this month</span>
          </div>
          <p className="text-2xl font-bold text-red-600">{formatCurrency(stats.monthlyExpenses)}</p>
        </div>
        <div className={`rounded-xl border p-4 ${profit >= 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp className={`w-4 h-4 ${profit >= 0 ? 'text-emerald-500' : 'text-red-500'}`} />
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Net Profit</span>
          </div>
          <p className={`text-2xl font-bold ${profit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
            {formatCurrency(profit)}
          </p>
          {stats.monthlyRevenue > 0 && (
            <p className="text-xs text-gray-400 mt-0.5">
              {((profit / stats.monthlyRevenue) * 100).toFixed(1)}% margin
            </p>
          )}
        </div>
      </div>

      {/* Payment Overdue — 3+ days */}
      {overdueOrders.length > 0 && (
        <div className="bg-white rounded-xl border border-red-200 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 bg-red-50 border-b border-red-100">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-red-500" />
              <h2 className="font-semibold text-red-800 text-sm">
                Payment Overdue ({OVERDUE_DAYS}+ days) — {overdueOrders.length} order{overdueOrders.length !== 1 ? 's' : ''}
              </h2>
            </div>
            <span className="text-sm font-bold text-red-600">
              {formatCurrency(overdueOrders.reduce((s, o) => s + o.total, 0))}
            </span>
          </div>
          <div className="divide-y divide-gray-50">
            {visibleOverdue.map(order => {
              const days = daysSince(order);
              const sent = reminderSent.has(order.id);
              const waUrl = buildCustomerWhatsAppUrl(order.customerWhatsapp, paymentReminderToCustomer(order));
              return (
                <div key={order.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link to={`/admin/orders/${order.id}`}
                        className="text-sm font-semibold text-gray-800 hover:text-orange-500 transition-colors">
                        #{order.orderNumber}
                      </Link>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium
                        ${days >= 7 ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'}`}>
                        {days}d overdue
                      </span>
                      {sent && (
                        <span className="text-xs text-green-600 flex items-center gap-0.5">
                          <CheckCircle2 className="w-3 h-3" /> Reminded
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {order.customerName} · 📱 {order.customerWhatsapp}
                      {order.customerPlace ? ` · 📍 ${order.customerPlace}` : ''}
                    </p>
                    <p className="text-xs text-gray-400">{formatDateTime(order.createdAt)}</p>
                  </div>
                  <div className="text-right flex-shrink-0 space-y-1.5">
                    <p className="font-bold text-gray-800">{formatCurrency(order.total)}</p>
                    <a href={waUrl} target="_blank" rel="noreferrer"
                      onClick={() => markReminderSent(order.id, order)}
                      className={`flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors
                        ${sent
                          ? 'bg-green-100 text-green-700 hover:bg-green-200'
                          : 'bg-green-500 text-white hover:bg-green-600'}`}>
                      <MessageCircle className="w-3 h-3" />
                      {sent ? 'Resend' : 'Remind'}
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
          {overdueOrders.length > 3 && (
            <button onClick={() => setShowAllOverdue(v => !v)}
              className="w-full flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium text-gray-500 hover:bg-gray-50 border-t border-gray-100 transition-colors">
              {showAllOverdue
                ? <><ChevronUp className="w-3.5 h-3.5" /> Show less</>
                : <><ChevronDown className="w-3.5 h-3.5" /> Show {overdueOrders.length - 3} more</>}
            </button>
          )}
        </div>
      )}

      {/* Awaiting payment — within 3 days */}
      {allPendingPayment.filter(o => daysSince(o) < OVERDUE_DAYS).length > 0 && (
        <div className="bg-white rounded-xl border border-amber-200 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-amber-100">
            <h2 className="font-semibold text-gray-800 text-sm flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-amber-500" />
              Awaiting Payment
              <span className="text-xs text-gray-400 font-normal">(within {OVERDUE_DAYS} days)</span>
            </h2>
            <span className="text-sm font-bold text-amber-700">
              {formatCurrency(allPendingPayment.filter(o => daysSince(o) < OVERDUE_DAYS).reduce((s, o) => s + o.total, 0))}
            </span>
          </div>
          <div className="divide-y divide-gray-50">
            {allPendingPayment
              .filter(o => daysSince(o) < OVERDUE_DAYS)
              .map(order => {
                const waUrl = buildCustomerWhatsAppUrl(order.customerWhatsapp, paymentReminderToCustomer(order));
                const sent = reminderSent.has(order.id);
                return (
                  <div key={order.id} className="flex items-center justify-between px-4 py-2.5 gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Link to={`/admin/orders/${order.id}`}
                          className="text-sm font-medium text-gray-800 hover:text-orange-500">
                          #{order.orderNumber}
                        </Link>
                        <span className="text-xs text-gray-400">{daysSince(order)}d ago</span>
                        {sent && <span className="text-xs text-green-600 flex items-center gap-0.5"><CheckCircle2 className="w-3 h-3" /> Reminded</span>}
                      </div>
                      <p className="text-xs text-gray-500 truncate">{order.customerName}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-sm font-bold text-gray-800">{formatCurrency(order.total)}</span>
                      <a href={waUrl} target="_blank" rel="noreferrer"
                        onClick={() => markReminderSent(order.id, order)}
                        className="border border-green-300 text-green-600 hover:bg-green-50 px-2 py-1 rounded-lg text-xs font-medium transition-colors flex items-center gap-1">
                        <MessageCircle className="w-3 h-3" />
                        {sent ? 'Resend' : 'Remind'}
                      </a>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* 🚩 Stuck Orders — placed but not delivered in 2+ days */}
      {stuckOrders.length > 0 && (
        <div className="bg-white rounded-xl border border-rose-300 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 bg-rose-50 border-b border-rose-100">
            <div className="flex items-center gap-2">
              <Truck className="w-4 h-4 text-rose-500" />
              <h2 className="font-semibold text-rose-800 text-sm">
                🚩 Not Delivered in {STUCK_DAYS}+ Days — {stuckOrders.length} order{stuckOrders.length !== 1 ? 's' : ''}
              </h2>
            </div>
          </div>
          <div className="divide-y divide-gray-50">
            {stuckOrders.map(order => {
              const days = daysSinceCreated(order.createdAt);
              const waUrl = buildCustomerWhatsAppUrl(order.customerWhatsapp,
                `🙏 *Shri Krishna Condiments*\n\nHi *${order.customerName}*, just checking in on your order *#${order.orderNumber}* placed ${days} day${days !== 1 ? 's' : ''} ago.\n\nWe'll update you shortly on the delivery. Thank you for your patience! 🌿`);
              return (
                <div key={order.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link to={`/admin/orders/${order.id}`}
                        className="text-sm font-semibold text-gray-800 hover:text-orange-500 transition-colors">
                        #{order.orderNumber}
                      </Link>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 font-medium">
                        {days}d since order
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        order.status === 'out_for_delivery' ? 'bg-purple-100 text-purple-700' :
                        order.status === 'confirmed' ? 'bg-blue-100 text-blue-700' :
                        'bg-yellow-100 text-yellow-700'
                      }`}>{order.status.replace('_', ' ')}</span>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {order.customerName} · 📱 {order.customerWhatsapp}
                      {order.customerPlace ? ` · 📍 ${order.customerPlace}` : ''}
                    </p>
                    <p className="text-xs text-gray-400">{formatDateTime(order.createdAt)}</p>
                  </div>
                  <div className="text-right flex-shrink-0 space-y-1.5">
                    <p className="font-bold text-gray-800">{formatCurrency(order.total)}</p>
                    <a href={waUrl} target="_blank" rel="noreferrer"
                      className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg bg-rose-500 text-white hover:bg-rose-600 transition-colors">
                      <MessageCircle className="w-3 h-3" /> Follow up
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Recent Admin Actions — always visible */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <h2 className="font-semibold text-gray-800 flex items-center gap-2">
            <Activity className="w-4 h-4 text-orange-500" />
            Recent Actions
          </h2>
          <span className="text-xs text-gray-400">last {Math.min(recentActions.length, 5)}</span>
        </div>
        <div className="divide-y divide-gray-50">
          {recentActions.length === 0 && (
            <p className="text-center text-gray-400 py-6 text-sm">No actions recorded yet. Actions will appear here as you use the app.</p>
          )}
          {recentActions.slice(0, 5).map((action, idx) => {
            const isReminder = action.type === 'payment_reminder_sent';
            const isDuplicate = isReminder && recentActions
              .slice(0, idx)
              .some(a => a.type === 'payment_reminder_sent' && a.entityId === action.entityId);
            return (
              <div key={action.id} className={`flex items-start gap-3 px-4 py-3 ${
                isDuplicate ? 'bg-yellow-50' : ''
              }`}>
                <span className="text-lg mt-0.5">
                  {action.type === 'order_created' ? '🛍️' :
                   action.type === 'order_status_changed' ? '📦' :
                   action.type === 'payment_marked' ? '✅' :
                   action.type === 'order_edited' ? '✏️' :
                   action.type === 'order_cancelled' ? '❌' :
                   action.type === 'order_deleted' ? '🗑️' :
                   action.type === 'payment_reminder_sent' ? '💬' :
                   action.type === 'stock_updated' ? '📦' :
                   action.type === 'expense_added' ? '💸' :
                   action.type === 'batch_recorded' ? '🏭' : '📋'}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-800 leading-snug">{action.label}</p>
                  {isDuplicate && (
                    <p className="text-xs text-yellow-700 font-semibold mt-0.5">⚠️ Reminder already sent recently!</p>
                  )}
                  <p className="text-xs text-gray-400 mt-0.5">{formatDateTime(action.createdAt)}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Recent Orders + Low Stock */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="flex items-center justify-between p-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-800">Recent Orders</h2>
            <Link to="/admin/orders" className="text-orange-500 text-sm flex items-center gap-1 hover:underline">
              View all <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
          <div className="divide-y divide-gray-50">
            {recentOrders.length === 0 && (
              <p className="text-center text-gray-400 py-8 text-sm">No orders yet</p>
            )}
            {recentOrders.map(order => (
              <Link key={order.id} to={`/admin/orders/${order.id}`}
                className="flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors">
                <div>
                  <p className="text-sm font-medium text-gray-800">#{order.orderNumber}</p>
                  <p className="text-xs text-gray-500">{order.customerName} · {formatDate(order.createdAt)}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-gray-800">{formatCurrency(order.total)}</p>
                  <span className={`text-xs px-2 py-0.5 rounded-full
                    ${order.status === 'delivered' ? 'bg-green-100 text-green-700' :
                      order.status === 'out_for_delivery' ? 'bg-purple-100 text-purple-700' :
                      order.status === 'confirmed' ? 'bg-blue-100 text-blue-700' :
                      'bg-yellow-100 text-yellow-700'}`}>
                    {order.status.replace('_', ' ')}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200">
          <div className="flex items-center justify-between p-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-800">⚠️ Low Stock Alerts</h2>
            <Link to="/admin/stock" className="text-orange-500 text-sm flex items-center gap-1 hover:underline">
              Manage <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
          <div className="divide-y divide-gray-50">
            {lowStockItems.length === 0 && (
              <p className="text-center text-gray-400 py-8 text-sm">✅ All stock levels are good</p>
            )}
            {lowStockItems.map(item => (
              <div key={item.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-gray-800">{item.productName}</p>
                  <p className="text-xs text-gray-500">Threshold: {item.lowStockThreshold}{item.unit === 'piece' ? ' pcs' : 'g'}</p>
                </div>
                <span className="text-sm font-bold text-red-600">
                  {item.quantityAvailable}{item.unit === 'piece' ? ' pcs' : 'g'} left
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

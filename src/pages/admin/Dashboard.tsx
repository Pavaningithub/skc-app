import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ShoppingBag, AlertTriangle, CreditCard, TrendingUp, TrendingDown, Users, ArrowRight } from 'lucide-react';
import { ordersService, stockService, customersService, expensesService } from '../../lib/services';
import { formatCurrency, formatDate } from '../../lib/utils';
import type { Order, StockItem } from '../../lib/types';

interface Stats {
  pendingOrders: number;
  pendingPaymentAmount: number;
  lowStockCount: number;
  monthlyRevenue: number;
  monthlyExpenses: number;
  totalCustomers: number;
}

export default function Dashboard() {
  const [stats, setStats] = useState<Stats>({
    pendingOrders: 0, pendingPaymentAmount: 0, lowStockCount: 0,
    monthlyRevenue: 0, monthlyExpenses: 0, totalCustomers: 0,
  });
  const [recentOrders, setRecentOrders] = useState<Order[]>([]);
  const [lowStockItems, setLowStockItems] = useState<StockItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const [orders, stock, customers, expenses] = await Promise.all([
        ordersService.getAll(),
        stockService.getLowStock(),
        customersService.getAll(),
        expensesService.getAll(),
      ]);

      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString();

      const pendingOrders = orders.filter(o => ['pending', 'confirmed'].includes(o.status));
      const pendingPayment = orders.filter(o => o.paymentStatus === 'pending' && o.total > 0);
      const monthOrders = orders.filter(o => o.createdAt >= monthStart && o.createdAt <= monthEnd && o.status !== 'cancelled');
      const monthExpenses = expenses.filter(e => e.date >= monthStart && e.date <= monthEnd);

      setStats({
        pendingOrders: pendingOrders.length,
        pendingPaymentAmount: pendingPayment.reduce((s, o) => s + o.total, 0),
        lowStockCount: stock.length,
        monthlyRevenue: monthOrders.reduce((s, o) => s + o.total, 0),
        monthlyExpenses: monthExpenses.reduce((s, e) => s + e.amount, 0),
        totalCustomers: customers.length,
      });
      setRecentOrders(orders.slice(0, 5));
      setLowStockItems(stock);
    } finally {
      setLoading(false);
    }
  }

  const profit = stats.monthlyRevenue - stats.monthlyExpenses;

  const cards = [
    {
      title: 'Pending Orders', value: stats.pendingOrders, icon: ShoppingBag,
      color: 'text-yellow-600', bg: 'bg-yellow-50', border: 'border-yellow-200',
      link: '/admin/orders',
    },
    {
      title: 'Payment Pending', value: formatCurrency(stats.pendingPaymentAmount),
      icon: CreditCard, color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-200',
      link: '/admin/orders',
    },
    {
      title: 'Low Stock Items', value: stats.lowStockCount, icon: AlertTriangle,
      color: 'text-orange-600', bg: 'bg-orange-50', border: 'border-orange-200',
      link: '/admin/stock',
    },
    {
      title: 'Total Customers', value: stats.totalCustomers, icon: Users,
      color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-200',
      link: '/admin/customers',
    },
  ];

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-64">
        <div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-gray-800 font-display">Dashboard</h1>
        <p className="text-gray-500 text-sm">{new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {cards.map(card => (
          <Link key={card.title} to={card.link}
            className={`bg-white rounded-xl border ${card.border} p-4 hover:shadow-md transition-shadow`}>
            <div className={`w-9 h-9 ${card.bg} rounded-lg flex items-center justify-center mb-3`}>
              <card.icon className={`w-5 h-5 ${card.color}`} />
            </div>
            <p className="text-2xl font-bold text-gray-800">{card.value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{card.title}</p>
          </Link>
        ))}
      </div>

      {/* Monthly P&L */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border border-green-200 p-4">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-5 h-5 text-green-500" />
            <span className="text-sm font-medium text-gray-600">This Month Revenue</span>
          </div>
          <p className="text-2xl font-bold text-green-600">{formatCurrency(stats.monthlyRevenue)}</p>
        </div>
        <div className="bg-white rounded-xl border border-red-200 p-4">
          <div className="flex items-center gap-2 mb-2">
            <TrendingDown className="w-5 h-5 text-red-500" />
            <span className="text-sm font-medium text-gray-600">This Month Expenses</span>
          </div>
          <p className="text-2xl font-bold text-red-600">{formatCurrency(stats.monthlyExpenses)}</p>
        </div>
        <div className={`rounded-xl border p-4 ${profit >= 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className={`w-5 h-5 ${profit >= 0 ? 'text-emerald-500' : 'text-red-500'}`} />
            <span className="text-sm font-medium text-gray-600">Net Profit</span>
          </div>
          <p className={`text-2xl font-bold ${profit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
            {formatCurrency(profit)}
          </p>
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
                  <p className="text-xs text-gray-500">Threshold: {item.lowStockThreshold}
                    {item.unit === 'piece' ? ' pcs' : 'g'}</p>
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

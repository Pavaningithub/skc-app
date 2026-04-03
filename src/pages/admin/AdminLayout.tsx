import { useState, useEffect, useRef } from 'react';
import { Outlet, NavLink, useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import {
  LayoutDashboard, ShoppingBag, Package, BarChart3, Users,
  Receipt, RefreshCw, MessageSquare, Settings, Menu,
  Leaf, LogOut, Bell, Megaphone, Handshake, Boxes, Gift, TrendingUp,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { ordersService } from '../../lib/services';
import { buildAdminWhatsAppUrl, newOrderAlertToAdmin } from '../../lib/utils';
import type { Order } from '../../lib/types';

const navItems = [
  { to: '/admin/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/admin/analytics', icon: BarChart3,        label: 'Analytics' },
  { to: '/admin/orders',    icon: ShoppingBag,      label: 'Orders' },
  { to: '/admin/packing',   icon: Boxes,           label: 'Packing' },
  { to: '/admin/products',  icon: Package,         label: 'Products' },
  // { to: '/admin/stock', icon: BarChart3, label: 'Stock' },        // disabled — enable when needed
  // { to: '/admin/batches', icon: FlaskConical, label: 'Production' }, // disabled — enable when needed
  { to: '/admin/expenses', icon: Receipt, label: 'Expenses' },
  { to: '/admin/customers', icon: Users, label: 'Customers' },
  { to: '/admin/subscriptions', icon: RefreshCw, label: 'Subscriptions' },
  { to: '/admin/subscription-analytics', icon: TrendingUp, label: 'Sub Analytics' },
  { to: '/admin/agents', icon: Handshake, label: 'Agents' },
  { to: '/admin/referral-settings', icon: Gift, label: 'Referral' },
  { to: '/admin/feedback', icon: MessageSquare, label: 'Feedback' },
  { to: '/admin/announcements', icon: Megaphone, label: 'Announce' },
  { to: '/admin/settings', icon: Settings, label: 'Settings' },
];

export default function AdminLayout() {
  const { isAdminAuthenticated, logout, currentUser } = useAuth();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const startTimeRef = useRef(new Date().toISOString());

  // Real-time new order watcher — fires on admin's device only
  useEffect(() => {
    if (!isAdminAuthenticated) return;
    const since = startTimeRef.current;
    const unsub = ordersService.subscribeToNewOrders(since, (order: Order) => {
      const waUrl = buildAdminWhatsAppUrl(newOrderAlertToAdmin(order, window.location.origin));
      toast(
        (t) => (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-orange-500 flex-shrink-0" />
              <div className="min-w-0">
                <p className="font-semibold text-sm text-gray-800">
                  New {order.type === 'sample' ? 'Sample ' : ''}Order #{order.orderNumber}
                </p>
                <p className="text-xs text-gray-500">
                  {order.customerName} · {order.customerPlace || '—'} · {order.type === 'sample' ? 'Free sample' : `₹${order.total}`}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <a
                href={waUrl}
                target="_blank"
                rel="noreferrer"
                onClick={() => toast.dismiss(t.id)}
                className="flex-1 text-center bg-green-500 hover:bg-green-600 text-white text-xs font-semibold py-1.5 rounded-lg"
              >
                📲 Open in WhatsApp
              </a>
              <a
                href={`/admin/orders/${order.id}`}
                onClick={() => toast.dismiss(t.id)}
                className="flex-1 text-center border border-orange-300 text-orange-600 text-xs font-semibold py-1.5 rounded-lg hover:bg-orange-50"
              >
                Open Order →
              </a>
            </div>
          </div>
        ),
        {
          duration: Infinity,
          style: { maxWidth: '320px', padding: '12px' },
        }
      );
    });
    return unsub;
  }, [isAdminAuthenticated]);

  if (!isAdminAuthenticated) {
    return <Navigate to="/admin/login" replace />;
  }

  const handleLogout = () => {
    logout();
    navigate('/admin/login');
  };

  const NavContent = () => (
    <>
      <div className="flex items-center gap-3 px-4 py-5 border-b border-orange-100">
        <div className="w-9 h-9 bg-orange-500 rounded-lg flex items-center justify-center flex-shrink-0">
          <Leaf className="w-5 h-5 text-white" />
        </div>
        <div className="min-w-0">
          <p className="font-bold text-gray-800 text-sm leading-tight font-display">Sri Krishna</p>
          <p className="text-xs text-orange-500">Condiments</p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto py-3 px-2">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            onClick={() => setSidebarOpen(false)}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg mb-0.5 text-sm font-medium transition-all
              ${isActive
                ? 'bg-orange-50 text-orange-600 border border-orange-100'
                : 'text-gray-600 hover:bg-gray-50 hover:text-gray-800'
              }`
            }
          >
            <Icon className="w-4 h-4 flex-shrink-0" />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="p-3 border-t border-gray-100 space-y-1">
        {currentUser && (
          <div className="px-3 py-2 rounded-lg bg-orange-50">
            <p className="text-xs font-semibold text-orange-700">{currentUser.displayName}</p>
            <p className="text-xs text-orange-400 capitalize">{currentUser.role}</p>
          </div>
        )}
        <button
          onClick={handleLogout}
          className="flex items-center gap-2 w-full px-3 py-2 text-sm text-red-500 hover:bg-red-50 rounded-lg transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Logout
        </button>
        {/* Version / env badge */}
        <div className="px-3 py-1.5 flex items-center gap-1.5">
          <span
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{ background: __APP_ENV__ === 'production' ? '#22c55e' : '#3b82f6' }}
            title={__APP_ENV__ === 'production' ? 'Production (Green)' : 'Staging (Blue)'}
          />
          <span className="text-xs font-mono text-gray-400">v{__APP_VERSION__}</span>
          {__APP_ENV__ !== 'production' && (
            <span className="text-xs font-semibold px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">
              {__APP_ENV__}
            </span>
          )}
        </div>
      </div>
    </>
  );

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex flex-col w-56 bg-white border-r border-gray-200 flex-shrink-0">
        <NavContent />
      </aside>

      {/* Mobile Overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Mobile Sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-50 w-56 bg-white border-r border-gray-200 flex flex-col
        transform transition-transform duration-250 lg:hidden
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <NavContent />
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile topbar */}
        <header className="lg:hidden flex items-center justify-between px-4 py-3 bg-white border-b border-gray-200">
          <button onClick={() => setSidebarOpen(true)} className="p-2 rounded-lg hover:bg-gray-100">
            <Menu className="w-5 h-5 text-gray-600" />
          </button>
          <div className="flex items-center gap-2">
            <Leaf className="w-5 h-5 text-orange-500" />
            <span className="font-bold text-gray-800 font-display text-sm">SKC Admin</span>
            <span
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ background: __APP_ENV__ === 'production' ? '#22c55e' : '#3b82f6' }}
              title={__APP_ENV__ === 'production' ? 'Production (Green)' : 'Staging (Blue)'}
            />
            <span className="text-xs font-mono text-gray-400">v{__APP_VERSION__}</span>
            {__APP_ENV__ !== 'production' && (
              <span className="text-xs font-semibold px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">
                {__APP_ENV__}
              </span>
            )}
          </div>
          <div className="w-9" />
        </header>

        <main className="flex-1 min-h-0 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

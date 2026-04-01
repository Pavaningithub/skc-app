import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from './contexts/AuthContext';
import { Suspense, lazy, useEffect } from 'react';
import { APP_CONFIG } from './config';

/**
 * SubdomainGuard — runs once on mount and redirects the browser to the
 * correct section based on the subdomain, when a custom domain is configured.
 *
 * admin.skctreats.in  → /admin/dashboard
 * agents.skctreats.in → /agent/login  (or /agent if already authenticated)
 * skctreats.in        → /  (storefront — block /admin and /agent paths)
 */
function SubdomainGuard() {
  useEffect(() => {
    if (!APP_CONFIG.APP_DOMAIN) return; // not configured (local dev / staging)
    const host = window.location.hostname;
    const path = window.location.pathname;

    if (host === APP_CONFIG.ADMIN_SUBDOMAIN) {
      // admin subdomain — must be on an /admin/* path
      if (!path.startsWith('/admin')) {
        window.location.replace('/admin/dashboard');
      }
    } else if (host === APP_CONFIG.AGENT_SUBDOMAIN) {
      // agents subdomain — must be on an /agent/* path
      if (!path.startsWith('/agent')) {
        window.location.replace('/agent/login');
      }
    } else if (host === APP_CONFIG.APP_DOMAIN) {
      // storefront — block admin and agent paths
      if (path.startsWith('/admin') || path.startsWith('/agent')) {
        window.location.replace('/');
      }
    }
  }, []);
  return null;
}

// Customer pages — eagerly loaded (public-facing, must be fast)
import StoreFront from './pages/customer/StoreFront';
const OrderConfirmation = lazy(() => import('./pages/customer/OrderConfirmation'));
const FeedbackPage      = lazy(() => import('./pages/customer/FeedbackPage'));
const MyReferralPage    = lazy(() => import('./pages/customer/MyReferralPage'));
const MyAccountPage     = lazy(() => import('./pages/customer/MyAccountPage'));
const AboutPage         = lazy(() => import('./pages/customer/AboutPage'));

// Admin pages — all lazy loaded (never needed by customers)
const AdminLayout      = lazy(() => import('./pages/admin/AdminLayout'));
const PinLogin         = lazy(() => import('./pages/admin/PinLogin'));
const Dashboard        = lazy(() => import('./pages/admin/Dashboard'));
const Products         = lazy(() => import('./pages/admin/Products'));
const StockPage        = lazy(() => import('./pages/admin/StockPage'));
const OrdersPage       = lazy(() => import('./pages/admin/OrdersPage'));
const OrderDetail      = lazy(() => import('./pages/admin/OrderDetail'));
const PackingPage      = lazy(() => import('./pages/admin/PackingPage'));
const ExpensesPage     = lazy(() => import('./pages/admin/ExpensesPage'));
const CustomersPage    = lazy(() => import('./pages/admin/CustomersPage'));
const SubscriptionsPage = lazy(() => import('./pages/admin/SubscriptionsPage'));
const FeedbackAdmin    = lazy(() => import('./pages/admin/FeedbackAdmin'));
const BatchesPage      = lazy(() => import('./pages/admin/BatchesPage'));
const SettingsPage     = lazy(() => import('./pages/admin/SettingsPage'));
const AnnouncementsPage = lazy(() => import('./pages/admin/AnnouncementsPage'));
const AgentsPage       = lazy(() => import('./pages/admin/AgentsPage'));
const ReferralSettingsPage = lazy(() => import('./pages/admin/ReferralSettingsPage'));
const AnalyticsPage        = lazy(() => import('./pages/admin/AnalyticsPage'));
const SubscriptionAnalyticsPage = lazy(() => import('./pages/admin/SubscriptionAnalyticsPage'));

// Agent portal
const AgentLogin   = lazy(() => import('./pages/agent/AgentLogin'));
const AgentConsole = lazy(() => import('./pages/agent/AgentConsole'));

function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-amber-50">
      <div className="flex flex-col items-center gap-3">
        <div className="w-10 h-10 border-4 border-amber-400 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-amber-700 font-medium">Loading…</p>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <SubdomainGuard />
      <AuthProvider>
        <Toaster
          position="top-center"
          toastOptions={{
            duration: 3000,
            style: { fontFamily: "Inter, sans-serif", fontSize: "14px" },
            success: { iconTheme: { primary: "#f97316", secondary: "#fff" } },
          }}
        />
        <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/" element={<StoreFront />} />
          <Route path="/order-confirmation/:orderId" element={<OrderConfirmation />} />
          <Route path="/feedback/:orderId" element={<FeedbackPage />} />
          <Route path="/my-referral" element={<MyReferralPage />} />
          <Route path="/my-orders" element={<MyAccountPage />} />
          <Route path="/about" element={<AboutPage />} />

          {/* Agent portal — separate from customer storefront and admin */}
          <Route path="/agent/login" element={<AgentLogin />} />
          <Route path="/agent" element={<AgentConsole />} />

          <Route path="/admin/login" element={<PinLogin />} />
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<Navigate to="/admin/dashboard" replace />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="analytics" element={<AnalyticsPage />} />
            <Route path="orders" element={<OrdersPage />} />
            <Route path="orders/:orderId" element={<OrderDetail />} />
            <Route path="packing" element={<PackingPage />} />
            <Route path="products" element={<Products />} />
            <Route path="stock" element={<StockPage />} />
            <Route path="batches" element={<BatchesPage />} />
            <Route path="expenses" element={<ExpensesPage />} />
            <Route path="customers" element={<CustomersPage />} />
            <Route path="subscriptions" element={<SubscriptionsPage />} />
            <Route path="subscription-analytics" element={<SubscriptionAnalyticsPage />} />
            <Route path="feedback" element={<FeedbackAdmin />} />
            <Route path="announcements" element={<AnnouncementsPage />} />
            <Route path="agents" element={<AgentsPage />} />
            <Route path="referral-settings" element={<ReferralSettingsPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
      </AuthProvider>
    </BrowserRouter>
  );
}

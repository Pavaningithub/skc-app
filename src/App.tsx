import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from './contexts/AuthContext';
import { Suspense, lazy } from 'react';

// Customer pages
import StoreFront from './pages/customer/StoreFront';
const OrderConfirmation        = lazy(() => import('./pages/customer/OrderConfirmation'));
const SubscriptionConfirmation = lazy(() => import('./pages/customer/SubscriptionConfirmation'));
const FeedbackPage             = lazy(() => import('./pages/customer/FeedbackPage'));
const MyAccountPage     = lazy(() => import('./pages/customer/MyAccountPage'));

// Admin pages
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
const FeaturesPage         = lazy(() => import('./pages/admin/FeaturesPage'));
const LoadingFactsPage     = lazy(() => import('./pages/admin/LoadingFactsPage'));
const RawMaterialCostsPage = lazy(() => import('./pages/admin/RawMaterialCostsPage'));
const ProductCostingPage   = lazy(() => import('./pages/admin/ProductCostingPage'));

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
            {/* ── Storefront ──────────────────────────────────────── */}
            <Route path="/" element={<StoreFront />} />
            <Route path="/order-confirmation/:orderId" element={<OrderConfirmation />} />
            <Route path="/subscription-confirmation/:subId" element={<SubscriptionConfirmation />} />
            <Route path="/feedback/:orderId" element={<FeedbackPage />} />
            <Route path="/my-referral" element={<Navigate to="/my-orders?tab=referral" replace />} />
            <Route path="/my-orders" element={<MyAccountPage />} />

            {/* ── Agent portal ─────────────────────────────────────── */}
            <Route path="/agent/login" element={<AgentLogin />} />
            <Route path="/agent" element={<AgentConsole />} />

            {/* ── Admin panel ──────────────────────────────────────── */}
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
              <Route path="features" element={<FeaturesPage />} />
              <Route path="loading-facts" element={<LoadingFactsPage />} />
              <Route path="raw-material-costs" element={<RawMaterialCostsPage />} />
              <Route path="product-costing" element={<ProductCostingPage />} />
              <Route path="settings" element={<SettingsPage />} />
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </AuthProvider>
    </BrowserRouter>
  );
}

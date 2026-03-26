import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from './contexts/AuthContext';
import { Suspense, lazy } from 'react';

// Customer pages — eagerly loaded (public-facing, must be fast)
import StoreFront from './pages/customer/StoreFront';
const OrderConfirmation = lazy(() => import('./pages/customer/OrderConfirmation'));
const FeedbackPage      = lazy(() => import('./pages/customer/FeedbackPage'));

// Admin pages — all lazy loaded (never needed by customers)
const AdminLayout      = lazy(() => import('./pages/admin/AdminLayout'));
const PinLogin         = lazy(() => import('./pages/admin/PinLogin'));
const Dashboard        = lazy(() => import('./pages/admin/Dashboard'));
const Products         = lazy(() => import('./pages/admin/Products'));
const StockPage        = lazy(() => import('./pages/admin/StockPage'));
const OrdersPage       = lazy(() => import('./pages/admin/OrdersPage'));
const OrderDetail      = lazy(() => import('./pages/admin/OrderDetail'));
const ExpensesPage     = lazy(() => import('./pages/admin/ExpensesPage'));
const CustomersPage    = lazy(() => import('./pages/admin/CustomersPage'));
const SubscriptionsPage = lazy(() => import('./pages/admin/SubscriptionsPage'));
const FeedbackAdmin    = lazy(() => import('./pages/admin/FeedbackAdmin'));
const BatchesPage      = lazy(() => import('./pages/admin/BatchesPage'));
const SettingsPage     = lazy(() => import('./pages/admin/SettingsPage'));
const AnnouncementsPage = lazy(() => import('./pages/admin/AnnouncementsPage'));

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
          <Route path="/" element={<StoreFront />} />
          <Route path="/order-confirmation/:orderId" element={<OrderConfirmation />} />
          <Route path="/feedback/:orderId" element={<FeedbackPage />} />

          <Route path="/admin/login" element={<PinLogin />} />
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<Navigate to="/admin/dashboard" replace />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="orders" element={<OrdersPage />} />
            <Route path="orders/:orderId" element={<OrderDetail />} />
            <Route path="products" element={<Products />} />
            <Route path="stock" element={<StockPage />} />
            <Route path="batches" element={<BatchesPage />} />
            <Route path="expenses" element={<ExpensesPage />} />
            <Route path="customers" element={<CustomersPage />} />
            <Route path="subscriptions" element={<SubscriptionsPage />} />
            <Route path="feedback" element={<FeedbackAdmin />} />
            <Route path="announcements" element={<AnnouncementsPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
      </AuthProvider>
    </BrowserRouter>
  );
}

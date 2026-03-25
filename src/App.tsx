import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from './contexts/AuthContext';

// Customer pages
import StoreFront from './pages/customer/StoreFront';
import OrderConfirmation from './pages/customer/OrderConfirmation';
import FeedbackPage from './pages/customer/FeedbackPage';

// Admin pages
import AdminLayout from './pages/admin/AdminLayout';
import PinLogin from './pages/admin/PinLogin';
import Dashboard from './pages/admin/Dashboard';
import Products from './pages/admin/Products';
import StockPage from './pages/admin/StockPage';
import OrdersPage from './pages/admin/OrdersPage';
import OrderDetail from './pages/admin/OrderDetail';
import ExpensesPage from './pages/admin/ExpensesPage';
import CustomersPage from './pages/admin/CustomersPage';
import SubscriptionsPage from './pages/admin/SubscriptionsPage';
import FeedbackAdmin from './pages/admin/FeedbackAdmin';
import BatchesPage from './pages/admin/BatchesPage';
import SettingsPage from './pages/admin/SettingsPage';

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
            <Route path="settings" element={<SettingsPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

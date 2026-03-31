import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { CheckCircle, Leaf, MessageCircle, XCircle, Copy, Share2 } from 'lucide-react';
import { ordersService, customersService } from '../../lib/services';
import { formatCurrency, buildAdminWhatsAppUrl, referralShareMessage } from '../../lib/utils';
import { UPI_ID } from '../../lib/constants';
import { APP_CONFIG } from '../../config';
import type { Order, Customer } from '../../lib/types';
import toast from 'react-hot-toast';

export default function OrderConfirmation() {
  const { orderId } = useParams<{ orderId: string }>();
  const [order, setOrder] = useState<Order | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orderId) return;
    ordersService.getById(orderId).then(async o => {
      setOrder(o);
      if (o?.customerId) {
        // Fetch customer to get their referral code
        try {
          const c = await customersService.getAll().then(all => all.find(x => x.id === o.customerId) ?? null);
          setCustomer(c);
        } catch { /* non-fatal */ }
      }
      setLoading(false);
    });
  }, [orderId]);

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-orange-50">
      <div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (!order) return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="text-center">
        <p className="text-gray-500">Order not found</p>
        <Link to="/" className="text-orange-500 hover:underline mt-2 block">Go to store</Link>
      </div>
    </div>
  );

  const isSample = order.type === 'sample';
  const referralCode = customer?.referralCode;
  const storeUrl = typeof window !== 'undefined' ? window.location.origin : 'https://skc-app.vercel.app';
  const shareMsg = referralCode ? referralShareMessage(order.customerName, referralCode, storeUrl) : '';
  const shareUrl = `https://wa.me/?text=${encodeURIComponent(shareMsg)}`;

  function copyCode() {
    if (!referralCode) return;
    navigator.clipboard.writeText(referralCode).then(() => toast.success('Code copied!'));
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-amber-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm animate-fade-in overflow-hidden">

        {/* Success header */}
        <div className="p-6 text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-9 h-9 text-green-500" />
          </div>
          <h1 className="text-xl font-bold text-gray-800 font-display mb-1">
            {isSample ? 'Sample Requested! 🎁' : 'Order Placed! 🎉'}
          </h1>
          <p className="text-gray-500 text-sm mb-4">
            {isSample
              ? "We'll contact you on WhatsApp to arrange delivery of your free sample."
              : "We'll send you updates on WhatsApp."}
          </p>

          <div className="bg-orange-50 rounded-xl p-4 text-left space-y-2 mb-4">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Order No:</span>
              <span className="font-bold text-gray-800">#{order.orderNumber}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Name:</span>
              <span className="font-medium text-gray-800">{order.customerName}</span>
            </div>
            {!isSample && (
              <>
                {order.referralDiscount > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-green-600">🎟️ Referral discount:</span>
                    <span className="font-semibold text-green-600">−₹{order.referralDiscount}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Amount:</span>
                  <span className="font-bold text-orange-600">{formatCurrency(order.total)}</span>
                </div>
              </>
            )}
          </div>

          {!isSample && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-left mb-4">
              <p className="text-sm font-semibold text-blue-800 mb-2">💳 Payment Instructions</p>
              <p className="text-xs text-blue-700 mb-1">Pay via GPay / PhonePe / UPI:</p>
              <p className="font-bold text-blue-800 text-sm">{UPI_ID}</p>
              <p className="text-xs text-blue-600 mt-1">Amount: ₹{order.total} | Reference: #{order.orderNumber}</p>
            </div>
          )}
        </div>

        {/* ── Referral Share Card ─────────────────────────────────── */}
        {!isSample && referralCode && (
          <div className="mx-4 mb-4 rounded-2xl overflow-hidden"
            style={{ background: 'linear-gradient(135deg, #3d1c02 0%, #7a4010 60%, #c8821a 100%)' }}>
            {/* Header */}
            <div className="px-4 pt-4 pb-2 text-center">
              <p className="text-white font-bold text-base">🎁 Share & Both Save!</p>
              <p className="text-orange-200 text-xs mt-0.5">
                Share your code — your friend gets a discount &amp; you earn credit
              </p>
            </div>
            {/* Code pill */}
            <div className="px-4 py-3">
              <div className="flex items-center justify-between bg-white/15 rounded-xl px-3 py-2.5 mb-3">
                <div>
                  <p className="text-orange-200 text-xs font-medium mb-0.5">Your referral code</p>
                  <p className="text-white font-mono font-bold text-xl tracking-widest">{referralCode}</p>
                </div>
                <button onClick={copyCode}
                  className="flex items-center gap-1.5 bg-white/20 hover:bg-white/30 text-white text-xs font-semibold px-3 py-2 rounded-xl transition-colors">
                  <Copy className="w-3.5 h-3.5" /> Copy
                </button>
              </div>
              {/* Discount info pills */}
              <div className="flex gap-2 mb-3">
                <div className="flex-1 bg-white/10 rounded-xl px-3 py-2 text-center">
                  <p className="text-orange-200 text-xs">Orders ₹1000+</p>
                  <p className="text-white font-bold text-sm">up to ₹25 off</p>
                  <p className="text-orange-300 text-xs">+ friend earns ₹75</p>
                </div>
                <div className="flex-1 bg-white/10 rounded-xl px-3 py-2 text-center">
                  <p className="text-orange-200 text-xs">Orders ₹500–₹999</p>
                  <p className="text-white font-bold text-sm">up to ₹13 off</p>
                  <p className="text-orange-300 text-xs">+ friend earns ₹37</p>
                </div>
              </div>
              {/* Share on WhatsApp button */}
              <a href={shareUrl} target="_blank" rel="noreferrer"
                className="flex items-center justify-center gap-2 w-full py-3 rounded-xl font-bold text-sm transition-colors"
                style={{ background: '#25d366', color: '#fff' }}>
                <Share2 className="w-4 h-4" />
                Share on WhatsApp
              </a>
            </div>
            {customer?.referralCredit != null && customer.referralCredit > 0 && (
              <div className="px-4 pb-3 text-center">
                <p className="text-orange-200 text-xs">
                  💰 You have <strong className="text-white">₹{customer.referralCredit}</strong> referral credit — redeemable on your next order!
                </p>
              </div>
            )}
          </div>
        )}

        {/* Action buttons */}
        <div className="px-4 pb-6 space-y-2">
          <a href={`https://wa.me/91${APP_CONFIG.WHATSAPP_NUMBER.replace(/^91/, '')}?text=${encodeURIComponent(`Hi, I just placed order #${order.orderNumber}`)}`}
            target="_blank" rel="noreferrer"
            className="flex items-center justify-center gap-2 w-full bg-green-500 hover:bg-green-600 text-white py-3 rounded-xl text-sm font-semibold transition-colors">
            <MessageCircle className="w-4 h-4" /> Contact Us on WhatsApp
          </a>
          <Link to="/"
            className="flex items-center justify-center gap-2 w-full border border-gray-200 text-gray-600 hover:bg-gray-50 py-3 rounded-xl text-sm font-medium transition-colors">
            <Leaf className="w-4 h-4 text-orange-500" /> Continue Shopping
          </Link>

          {order.status === 'pending' && (
            <details className="mt-1">
              <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600 text-center select-none">
                Need to cancel this order?
              </summary>
              <div className="mt-2 bg-red-50 border border-red-200 rounded-xl p-3 space-y-2">
                <p className="text-xs text-red-700">
                  To cancel, send us a message on WhatsApp. We'll confirm once it's done.
                </p>
                <a href={buildAdminWhatsAppUrl(
                    `Hi, I'd like to cancel my order.\n\nOrder No: #${order.orderNumber}\nName: ${order.customerName}\n\nPlease confirm the cancellation. Thank you.`
                  )}
                  target="_blank" rel="noreferrer"
                  className="flex items-center justify-center gap-2 w-full border border-red-300 text-red-600 hover:bg-red-100 py-2.5 rounded-xl text-xs font-semibold transition-colors">
                  <XCircle className="w-4 h-4" /> Request Cancellation on WhatsApp
                </a>
              </div>
            </details>
          )}
        </div>

        <p className="text-xs text-gray-400 text-center pb-5">
          Thank you for choosing Sri Krishna Condiments! 🙏
        </p>
      </div>
    </div>
  );
}

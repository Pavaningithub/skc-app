import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { CheckCircle, Leaf, MessageCircle, XCircle } from 'lucide-react';
import { ordersService } from '../../lib/services';
import { formatCurrency, buildAdminWhatsAppUrl } from '../../lib/utils';
import { UPI_ID } from '../../lib/constants';
import { APP_CONFIG } from '../../config';
import type { Order } from '../../lib/types';

export default function OrderConfirmation() {
  const { orderId } = useParams<{ orderId: string }>();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (orderId) ordersService.getById(orderId).then(o => { setOrder(o); setLoading(false); });
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-amber-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 text-center animate-fade-in">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <CheckCircle className="w-9 h-9 text-green-500" />
        </div>

        <h1 className="text-xl font-bold text-gray-800 font-display mb-1">
          {isSample ? 'Sample Requested! 🎁' : 'Order Placed! 🎉'}
        </h1>
        <p className="text-gray-500 text-sm mb-4">
          {isSample
            ? 'We\'ll contact you on WhatsApp to arrange delivery of your free sample.'
            : 'We\'ll send you updates on WhatsApp.'}
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
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Amount:</span>
              <span className="font-bold text-orange-600">{formatCurrency(order.total)}</span>
            </div>
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

        <div className="space-y-2">
          <a href={`https://wa.me/91${APP_CONFIG.WHATSAPP_NUMBER.replace(/^91/, '')}?text=${encodeURIComponent(`Hi, I just placed order #${order.orderNumber}`)}`}
            target="_blank" rel="noreferrer"
            className="flex items-center justify-center gap-2 w-full bg-green-500 hover:bg-green-600 text-white py-3 rounded-xl text-sm font-semibold transition-colors">
            <MessageCircle className="w-4 h-4" /> Contact Us on WhatsApp
          </a>
          <Link to="/"
            className="flex items-center justify-center gap-2 w-full border border-gray-200 text-gray-600 hover:bg-gray-50 py-3 rounded-xl text-sm font-medium transition-colors">
            <Leaf className="w-4 h-4 text-orange-500" /> Continue Shopping
          </Link>

          {/* Cancellation request */}
          {order.status === 'pending' && (
            <details className="mt-2">
              <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600 text-center select-none">
                Need to cancel this order?
              </summary>
              <div className="mt-2 bg-red-50 border border-red-200 rounded-xl p-3 space-y-2">
                <p className="text-xs text-red-700">
                  To cancel, send us a message on WhatsApp. We'll confirm once it's done.
                </p>
                <a
                  href={buildAdminWhatsAppUrl(
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

        <p className="text-xs text-gray-400 mt-4">
          Thank you for choosing Sri Krishna Condiments! 🙏
        </p>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { CheckCircle, MessageCircle, Calendar, Package } from 'lucide-react';
import { subscriptionsService } from '../../lib/services';
import { formatCurrency } from '../../lib/utils';
import { APP_CONFIG } from '../../config';
import type { Subscription } from '../../lib/types';

export default function SubscriptionConfirmation() {
  const { subId } = useParams<{ subId: string }>();
  const [sub, setSub] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!subId) return;
    subscriptionsService.getById(subId)
      .then(s => setSub(s))
      .catch(err => console.error('Failed to load subscription:', err))
      .finally(() => setLoading(false));
  }, [subId]);

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-green-50">
      <div className="w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (!sub) return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="text-center">
        <p className="text-gray-500">Subscription not found</p>
        <Link to="/" className="text-orange-500 hover:underline mt-2 block">Go to store</Link>
      </div>
    </div>
  );

  const durationMonths = sub.duration === '6months' ? 6 : 3;

  const waText = encodeURIComponent(
    `Hi! I just subscribed to Health Mix products on YOUR_DOMAIN.\n` +
    `Subscription #${sub.subscriptionNumber ?? sub.id.slice(0, 8).toUpperCase()}\n` +
    `Name: ${sub.customerName}\n` +
    `Plan: ${durationMonths}-month | ${sub.paymentMode === 'upfront' ? 'Upfront' : 'Monthly'} payment\n` +
    `Please confirm my subscription. 🙏`
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-emerald-50 flex items-center justify-center p-4">
      {/* Version badge */}
      <div className="fixed bottom-3 right-3 z-50 flex items-center gap-1.5 px-2.5 py-1 rounded-full shadow-md text-white text-xs font-mono"
        style={{ background: __APP_ENV__ === 'production' ? '#22c55e' : '#3b82f6', opacity: 0.85 }}>
        <span className="w-1.5 h-1.5 rounded-full bg-white/70" />
        v{__APP_VERSION__}{__APP_ENV__ !== 'production' && ` · ${__APP_ENV__}`}
      </div>

      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden">
        {/* Green header */}
        <div className="px-6 py-8 text-center"
          style={{ background: 'linear-gradient(135deg, #1b5e20 0%, #2e7d32 100%)' }}>
          <div className="w-16 h-16 rounded-full bg-white/20 flex items-center justify-center mx-auto mb-3">
            <CheckCircle className="w-9 h-9 text-white" />
          </div>
          <h1 className="text-xl font-bold text-white">Subscription Placed!</h1>
          <p className="text-green-200 text-sm mt-1">
            We'll confirm it on WhatsApp shortly 🙏
          </p>
          {sub.subscriptionNumber && (
            <div className="mt-3 inline-block bg-white/15 rounded-xl px-3 py-1.5">
              <p className="text-xs text-green-200">Subscription ID</p>
              <p className="font-mono font-bold text-white text-sm tracking-widest">{sub.subscriptionNumber}</p>
            </div>
          )}
        </div>

        <div className="p-5 space-y-4">
          {/* Customer info */}
          <div className="rounded-xl p-4 space-y-1" style={{ background: '#f9fafb', border: '1px solid #e5e7eb' }}>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Your Details</p>
            <p className="text-sm font-semibold text-gray-800">{sub.customerName}</p>
            <p className="text-sm text-gray-500">{sub.customerWhatsapp}</p>
            {sub.customerPlace && <p className="text-sm text-gray-500">{sub.customerPlace}</p>}
          </div>

          {/* Plan info */}
          <div className="rounded-xl p-4 space-y-2" style={{ background: '#f0fdf4', border: '1px solid #86efac' }}>
            <div className="flex items-center gap-2 mb-2">
              <Calendar className="w-4 h-4 text-green-600" />
              <p className="text-xs font-semibold text-green-700 uppercase tracking-wide">Subscription Plan</p>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-gray-600">Duration</span>
              <span className="font-semibold text-gray-800">{durationMonths} months</span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-gray-600">Payment</span>
              <span className="font-semibold text-gray-800 capitalize">{sub.paymentMode ?? 'upfront'}</span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-gray-600">Discount</span>
              <span className="font-semibold text-green-700">{sub.discountPercent}% off</span>
            </div>
          </div>

          {/* Items */}
          <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #e5e7eb' }}>
            <div className="flex items-center gap-2 px-4 py-2.5 bg-gray-50 border-b" style={{ borderColor: '#e5e7eb' }}>
              <Package className="w-4 h-4 text-gray-500" />
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Products / Month</p>
            </div>
            {sub.items.map((item, i) => (
              <div key={i}
                className={`flex justify-between items-center px-4 py-2.5 text-sm ${i > 0 ? 'border-t' : ''}`}
                style={{ borderColor: '#f0f0f0' }}>
                <span className="text-gray-700 flex-1 truncate mr-2">
                  {item.productName}
                  <span className="text-gray-400 ml-1 text-xs">×{item.quantity}g</span>
                </span>
                <span className="font-semibold" style={{ color: '#1b5e20' }}>{formatCurrency(item.totalPrice)}/mo</span>
              </div>
            ))}
            <div className="flex justify-between items-center px-4 py-2.5 bg-green-50 border-t font-bold text-sm"
              style={{ borderColor: '#d1fae5' }}>
              <span className="text-gray-700">Monthly total</span>
              <span style={{ color: '#166534' }}>{formatCurrency(sub.discountedAmount)}/mo</span>
            </div>
            {sub.paymentMode === 'upfront' && (
              <div className="flex justify-between items-center px-4 py-2.5 bg-green-100 border-t font-bold text-sm"
                style={{ borderColor: '#a7f3d0' }}>
                <span style={{ color: '#14532d' }}>Upfront total ({durationMonths} mo)</span>
                <span style={{ color: '#14532d' }}>{formatCurrency(sub.discountedAmount * durationMonths)}</span>
              </div>
            )}
          </div>

          {/* What happens next */}
          <div className="rounded-xl p-4 space-y-2" style={{ background: '#fff4eb', border: '1px solid #f0d9c8' }}>
            <p className="text-xs font-semibold text-orange-800 uppercase tracking-wide">What happens next?</p>
            <ol className="space-y-1.5 text-sm text-gray-600">
              <li className="flex items-start gap-2"><span className="text-orange-500 font-bold flex-shrink-0">1.</span>Our team reviews your subscription</li>
              <li className="flex items-start gap-2"><span className="text-orange-500 font-bold flex-shrink-0">2.</span>We'll WhatsApp you to confirm the plan &amp; payment</li>
              <li className="flex items-start gap-2"><span className="text-orange-500 font-bold flex-shrink-0">3.</span>First delivery arrives 1st–5th of next month</li>
            </ol>
          </div>

          {/* WA nudge */}
          <a href={`https://wa.me/${APP_CONFIG.WHATSAPP_NUMBER}?text=${waText}`}
            target="_blank" rel="noreferrer"
            className="flex items-center justify-center gap-2 w-full py-3.5 rounded-2xl font-bold text-white text-sm"
            style={{ background: '#25d366' }}>
            <MessageCircle className="w-4 h-4" />
            Message us on WhatsApp
          </a>

          <Link to="/"
            className="block text-center text-sm font-medium py-2"
            style={{ color: '#7a4010' }}>
            ← Back to Store
          </Link>
        </div>
      </div>
    </div>
  );
}

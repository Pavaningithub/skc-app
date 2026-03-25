import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Star, Leaf, CheckCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { feedbackService, ordersService } from '../../lib/services';
import type { Order } from '../../lib/types';

export default function FeedbackPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);

  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [whatYouLiked, setWhatYouLiked] = useState('');
  const [improvement, setImprovement] = useState('');
  const [recommend, setRecommend] = useState(true);

  useEffect(() => {
    if (!orderId) return;
    Promise.all([
      ordersService.getById(orderId),
      feedbackService.getByOrder(orderId),
    ]).then(([o, existingFeedback]) => {
      setOrder(o);
      if (existingFeedback) setSubmitted(true);
      setLoading(false);
    });
  }, [orderId]);

  async function handleSubmit() {
    if (rating === 0) return toast.error('Please select a rating');
    if (!whatYouLiked.trim()) return toast.error('Please tell us what you liked');
    setSaving(true);
    try {
      await feedbackService.add({
        orderId: orderId!,
        customerId: order?.customerId,
        customerName: order?.customerName || 'Customer',
        customerWhatsapp: order?.customerWhatsapp || '',
        rating,
        whatYouLiked: whatYouLiked.trim(),
        improvement: improvement.trim(),
        recommend,
        isPublic: rating >= 4,
        createdAt: new Date().toISOString(),
      });
      setSubmitted(true);
      toast.success('Thank you for your feedback! 🙏');
    } finally { setSaving(false); }
  }

  const ratingLabels = ['', '😕 Poor', '😐 Fair', '🙂 Good', '😊 Great', '🤩 Excellent!'];

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-orange-50">
      <div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (submitted) return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-amber-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 text-center">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <CheckCircle className="w-9 h-9 text-green-500" />
        </div>
        <h1 className="text-xl font-bold text-gray-800 font-display mb-2">Thank You! 🙏</h1>
        <p className="text-gray-500 text-sm">Your feedback helps us improve.</p>
        <a href="/" className="block mt-5 bg-orange-500 hover:bg-orange-600 text-white py-3 rounded-xl text-sm font-semibold transition-colors">
          Shop Again
        </a>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-amber-50 flex items-start justify-center p-4 pt-8">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden">
        <div className="bg-orange-500 px-5 py-5 text-center text-white">
          <div className="flex justify-center mb-2">
            <Leaf className="w-7 h-7" />
          </div>
          <h1 className="text-lg font-bold font-display">How was your order?</h1>
          <p className="text-orange-100 text-xs mt-1">Takes just 30 seconds · Helps us grow!</p>
        </div>

        <div className="p-5 space-y-5">
          {order && (
            <div className="bg-orange-50 rounded-xl p-3 text-xs text-gray-600">
              Order <strong>#{order.orderNumber}</strong> · {order.customerName}
            </div>
          )}

          {/* Star Rating */}
          <div className="text-center">
            <p className="text-sm font-medium text-gray-700 mb-3">Your overall rating</p>
            <div className="flex justify-center gap-3 mb-2">
              {[1, 2, 3, 4, 5].map(s => (
                <button key={s} className="star-btn"
                  onMouseEnter={() => setHoverRating(s)}
                  onMouseLeave={() => setHoverRating(0)}
                  onClick={() => setRating(s)}>
                  <Star className={`w-9 h-9 transition-colors
                    ${s <= (hoverRating || rating)
                      ? 'text-yellow-400 fill-yellow-400'
                      : 'text-gray-200 fill-gray-200'}`} />
                </button>
              ))}
            </div>
            {(hoverRating || rating) > 0 && (
              <p className="text-sm font-medium text-orange-600 animate-fade-in">
                {ratingLabels[hoverRating || rating]}
              </p>
            )}
          </div>

          {/* What you liked */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              👍 What did you like most? <span className="text-red-400">*</span>
            </label>
            <textarea value={whatYouLiked} onChange={e => setWhatYouLiked(e.target.value)}
              placeholder="e.g. The taste was amazing, very fresh…"
              rows={2}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-orange-400 resize-none"
              maxLength={200}
            />
          </div>

          {/* Improvement */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              💡 Any suggestions? (optional)
            </label>
            <textarea value={improvement} onChange={e => setImprovement(e.target.value)}
              placeholder="Anything we can do better…"
              rows={2}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-orange-400 resize-none"
              maxLength={200}
            />
          </div>

          {/* Recommend */}
          <div className="flex items-center gap-3 bg-gray-50 rounded-xl p-3">
            <input type="checkbox" id="recommend" checked={recommend}
              onChange={e => setRecommend(e.target.checked)}
              className="w-5 h-5 accent-orange-500 rounded" />
            <label htmlFor="recommend" className="text-sm text-gray-700">
              I'd recommend Sri Krishna Condiments to others 🙌
            </label>
          </div>

          <button onClick={handleSubmit} disabled={saving || rating === 0}
            className="w-full bg-orange-500 hover:bg-orange-600 disabled:bg-gray-200 disabled:text-gray-400
              text-white py-3 rounded-xl text-sm font-semibold transition-colors">
            {saving ? 'Submitting…' : '🙏 Submit Feedback'}
          </button>
        </div>
      </div>
    </div>
  );
}

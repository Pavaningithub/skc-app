import { useState } from 'react';
import { Star } from 'lucide-react';
import { feedbackService } from '../../lib/services';
import { useRealtimeCollection } from '../../lib/useRealtimeCollection';
import { formatDate } from '../../lib/utils';
import type { Feedback } from '../../lib/types';

export default function FeedbackAdmin() {
  const [feedback, loading] = useRealtimeCollection<Feedback>(feedbackService.subscribe.bind(feedbackService));
  const [tab, setTab] = useState<'all' | 'public' | 'private'>('all');

  const filtered = feedback.filter(f => {
    if (tab === 'public') return f.isPublic;
    if (tab === 'private') return !f.isPublic;
    return true;
  });

  const avgRating = feedback.length > 0
    ? (feedback.reduce((s, f) => s + f.rating, 0) / feedback.length).toFixed(1)
    : '—';

  return (
    <div className="p-4 md:p-6 space-y-4 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-gray-800 font-display">Feedback & Reviews</h1>
        <div className="flex items-center gap-2 mt-1">
          <Star className="w-4 h-4 text-yellow-400 fill-yellow-400" />
          <span className="text-sm font-medium text-gray-700">{avgRating} average · {feedback.length} reviews</span>
        </div>
      </div>

      {/* Rating Distribution */}
      {feedback.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h2 className="text-sm font-semibold text-gray-600 mb-3">Rating Distribution</h2>
          {[5, 4, 3, 2, 1].map(r => {
            const count = feedback.filter(f => f.rating === r).length;
            const pct = feedback.length > 0 ? (count / feedback.length) * 100 : 0;
            return (
              <div key={r} className="flex items-center gap-3 mb-1.5">
                <span className="text-xs text-gray-600 w-3">{r}</span>
                <Star className="w-3 h-3 text-yellow-400 fill-yellow-400 flex-shrink-0" />
                <div className="flex-1 bg-gray-100 rounded-full h-2">
                  <div className="bg-yellow-400 h-2 rounded-full transition-all" style={{ width: `${pct}%` }} />
                </div>
                <span className="text-xs text-gray-500 w-6 text-right">{count}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2">
        {(['all', 'public', 'private'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors
              ${tab === t ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            {t === 'all' ? 'All' : t === 'public' ? '⭐ Testimonials (4+)' : '📋 For Improvement (<4)'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.length === 0 && (
            <div className="text-center py-10 text-gray-400">No feedback in this category</div>
          )}
          {filtered.map(fb => (
            <div key={fb.id} className={`bg-white border rounded-xl p-4 space-y-2
              ${fb.isPublic ? 'border-yellow-200 bg-yellow-50/20' : 'border-gray-200'}`}>
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold text-gray-800">{fb.customerName}</p>
                  <p className="text-xs text-gray-500">📱 {fb.customerWhatsapp} · {formatDate(fb.createdAt)}</p>
                </div>
                <div className="flex items-center gap-1">
                  {[1, 2, 3, 4, 5].map(s => (
                    <Star key={s} className={`w-4 h-4 ${s <= fb.rating ? 'text-yellow-400 fill-yellow-400' : 'text-gray-200 fill-gray-200'}`} />
                  ))}
                  {fb.isPublic && <span className="ml-1 text-xs bg-green-100 text-green-600 px-2 py-0.5 rounded-full">Public</span>}
                </div>
              </div>
              {fb.whatYouLiked && (
                <div>
                  <p className="text-xs font-medium text-gray-500">👍 What they liked:</p>
                  <p className="text-sm text-gray-700">"{fb.whatYouLiked}"</p>
                </div>
              )}
              {fb.improvement && (
                <div>
                  <p className="text-xs font-medium text-gray-500">💡 Improvement suggestion:</p>
                  <p className="text-sm text-gray-700">"{fb.improvement}"</p>
                </div>
              )}
              <div className="flex items-center gap-2 text-xs text-gray-500">
                {fb.recommend && <span className="bg-green-50 text-green-600 px-2 py-1 rounded-full">👍 Would recommend</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

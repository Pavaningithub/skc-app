import { useMemo } from 'react';
import { TrendingUp, Users, DollarSign, Calendar, Package, RefreshCw } from 'lucide-react';
import { subscriptionsService } from '../../lib/services';
import { useRealtimeCollection } from '../../lib/useRealtimeCollection';
import { formatCurrency, formatDate } from '../../lib/utils';
import type { Subscription } from '../../lib/types';

export default function SubscriptionAnalyticsPage() {
  const [subs, loading] = useRealtimeCollection<Subscription>(subscriptionsService.subscribe.bind(subscriptionsService));

  const stats = useMemo(() => {
    const now = new Date();
    const active = subs.filter(s => s.isActive && new Date(s.endDate) >= now);
    const expired = subs.filter(s => !s.isActive || new Date(s.endDate) < now);

    // MRR = sum of (discountedAmount / durationMonths) for active subs
    const mrr = active.reduce((sum, s) => {
      const months = s.duration === '3months' ? 3 : 6;
      return sum + s.discountedAmount / months;
    }, 0);

    // Total collected (paid orders only)
    const totalCollected = subs.filter(s => s.paymentStatus === 'paid').reduce((sum, s) => sum + s.discountedAmount, 0);
    const totalPending = subs.filter(s => s.paymentStatus === 'pending').reduce((sum, s) => sum + s.discountedAmount, 0);

    // Plan breakdown
    const threeMo = subs.filter(s => s.duration === '3months').length;
    const sixMo = subs.filter(s => s.duration === '6months').length;

    // Savings delivered (base - discounted across all subs)
    const totalSavings = subs.reduce((sum, s) => sum + (s.baseAmount - s.discountedAmount), 0);

    // Product breakdown (count subscriptions per product)
    const productMap: Record<string, { name: string; count: number; revenue: number }> = {};
    for (const sub of subs) {
      for (const item of sub.items) {
        if (!productMap[item.productName]) productMap[item.productName] = { name: item.productName, count: 0, revenue: 0 };
        productMap[item.productName].count += 1;
        productMap[item.productName].revenue += item.totalPrice;
      }
    }
    const topProducts = Object.values(productMap).sort((a, b) => b.count - a.count);

    // Renewals in next 30 days
    const cutoff = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const renewalsDue = active
      .filter(s => new Date(s.endDate) <= cutoff)
      .sort((a, b) => new Date(a.endDate).getTime() - new Date(b.endDate).getTime());

    return { active, expired, mrr, totalCollected, totalPending, threeMo, sixMo, totalSavings, topProducts, renewalsDue };
  }, [subs]);

  if (loading) return (
    <div className="flex justify-center items-center min-h-60">
      <div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="p-4 md:p-6 space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-gray-800 font-display">Subscription Analytics</h1>
        <p className="text-sm text-gray-500">{subs.length} total subscriptions</p>
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard icon={<Users className="w-5 h-5 text-green-600" />} label="Active" value={stats.active.length} bg="bg-green-50" />
        <KpiCard icon={<TrendingUp className="w-5 h-5 text-blue-600" />} label="MRR" value={formatCurrency(stats.mrr)} bg="bg-blue-50" />
        <KpiCard icon={<DollarSign className="w-5 h-5 text-orange-600" />} label="Collected" value={formatCurrency(stats.totalCollected)} bg="bg-orange-50" />
        <KpiCard icon={<Calendar className="w-5 h-5 text-purple-600" />} label="Pending" value={formatCurrency(stats.totalPending)} bg="bg-purple-50" />
      </div>

      {/* Plan breakdown */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <h2 className="font-semibold text-gray-700 mb-3">Plan Mix</h2>
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-blue-50 rounded-xl p-4 text-center">
            <p className="text-3xl font-bold text-blue-600">{stats.threeMo}</p>
            <p className="text-sm text-blue-700 font-medium mt-1">3-Month Plans</p>
          </div>
          <div className="bg-green-50 rounded-xl p-4 text-center">
            <p className="text-3xl font-bold text-green-600">{stats.sixMo}</p>
            <p className="text-sm text-green-700 font-medium mt-1">6-Month Plans</p>
          </div>
        </div>
        <p className="text-xs text-gray-400 mt-3 text-center">
          Total savings delivered to customers: <span className="font-semibold text-green-600">{formatCurrency(stats.totalSavings)}</span>
        </p>
      </div>

      {/* Product breakdown */}
      {stats.topProducts.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <h2 className="font-semibold text-gray-700 mb-3 flex items-center gap-2">
            <Package className="w-4 h-4" /> Top Products in Subscriptions
          </h2>
          <div className="space-y-2">
            {stats.topProducts.map(p => (
              <div key={p.name} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-orange-400" />
                  <span className="text-gray-700">{p.name}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-gray-500">{p.count} subs</span>
                  <span className="font-medium text-orange-600">{formatCurrency(p.revenue)}/mo</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Renewals due */}
      {stats.renewalsDue.length > 0 && (
        <div className="bg-white border border-amber-200 rounded-xl p-4">
          <h2 className="font-semibold text-gray-700 mb-3 flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-amber-600" /> Renewals Due (next 30 days)
          </h2>
          <div className="space-y-2">
            {stats.renewalsDue.map(sub => {
              const daysLeft = Math.ceil((new Date(sub.endDate).getTime() - Date.now()) / 86400000);
              return (
                <div key={sub.id} className="flex items-center justify-between text-sm bg-amber-50 rounded-lg px-3 py-2">
                  <div>
                    <p className="font-medium text-gray-800">{sub.customerName}</p>
                    <p className="text-xs text-gray-500">Expires {formatDate(sub.endDate)}</p>
                  </div>
                  <div className="text-right">
                    <p className={`text-xs font-bold ${daysLeft <= 7 ? 'text-red-600' : 'text-amber-600'}`}>
                      {daysLeft}d left
                    </p>
                    <p className="text-xs text-gray-500">{formatCurrency(sub.discountedAmount)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Expired list */}
      {stats.expired.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <h2 className="font-semibold text-gray-700 mb-3">Expired / Cancelled ({stats.expired.length})</h2>
          <div className="space-y-2">
            {stats.expired.map(sub => (
              <div key={sub.id} className="flex items-center justify-between text-sm border-b border-gray-50 pb-2 last:border-0">
                <div>
                  <p className="font-medium text-gray-600">{sub.customerName}</p>
                  <p className="text-xs text-gray-400">Ended {formatDate(sub.endDate)}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-gray-500">{sub.duration === '3months' ? '3 Mo' : '6 Mo'}</p>
                  <p className="text-xs text-gray-400">{formatCurrency(sub.discountedAmount)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function KpiCard({ icon, label, value, bg }: { icon: React.ReactNode; label: string; value: string | number; bg: string }) {
  return (
    <div className={`${bg} rounded-xl p-4`}>
      <div className="flex items-center gap-2 mb-1">{icon}<span className="text-xs text-gray-500 font-medium">{label}</span></div>
      <p className="text-xl font-bold text-gray-800">{value}</p>
    </div>
  );
}

import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Search, Plus, ArrowUpDown, Copy } from 'lucide-react';
import toast from 'react-hot-toast';
import { ordersService } from '../../lib/services';
import { useRealtimeCollection } from '../../lib/useRealtimeCollection';
import { formatCurrency, formatDateTime, buildWABusinessUrl } from '../../lib/utils';
import { ORDER_STATUS_COLORS, ORDER_STATUS_LABELS } from '../../lib/constants';
import type { Order } from '../../lib/types';
import type { OrderStatus } from '../../lib/constants';
import CreateOrderModal from '../../components/admin/CreateOrderModal';

type SortKey = 'date_desc' | 'date_asc' | 'amount_desc' | 'amount_asc' | 'name_asc';
type PayFilter = 'all' | 'unpaid' | 'paid';

const SORT_LABELS: Record<SortKey, string> = {
  date_desc:   'Newest first',
  date_asc:    'Oldest first',
  amount_desc: 'Amount ↓',
  amount_asc:  'Amount ↑',
  name_asc:    'Name A–Z',
};

export default function OrdersPage() {
  const [orders, loading] = useRealtimeCollection<Order>(ordersService.subscribe.bind(ordersService));
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<OrderStatus | 'all'>('all');
  const [payFilter, setPayFilter] = useState<PayFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('date_desc');
  const [showCreate, setShowCreate] = useState(false);
  const [showSubscriptions, setShowSubscriptions] = useState(false);

  async function updateStatus(order: Order, status: OrderStatus) {
    await ordersService.updateStatus(order.id, status);
  }

  const filtered = useMemo(() => {
    let result = orders.filter(o => {
      if (!showSubscriptions && o.type === 'subscription') return false;
      const matchSearch = o.customerName.toLowerCase().includes(search.toLowerCase()) ||
        o.orderNumber.toLowerCase().includes(search.toLowerCase()) ||
        o.customerPlace.toLowerCase().includes(search.toLowerCase());
      const matchStatus = statusFilter === 'all' || o.status === statusFilter;
      const matchPay = payFilter === 'all'
        ? true
        : payFilter === 'unpaid'
          ? o.paymentStatus === 'pending' && o.total > 0
          : o.paymentStatus === 'paid';
      return matchSearch && matchStatus && matchPay;
    });
    result = [...result].sort((a, b) => {
      switch (sortKey) {
        case 'date_asc':    return a.createdAt.localeCompare(b.createdAt);
        case 'amount_desc': return b.total - a.total;
        case 'amount_asc':  return a.total - b.total;
        case 'name_asc':    return a.customerName.localeCompare(b.customerName);
        default:            return b.createdAt.localeCompare(a.createdAt); // date_desc
      }
    });
    return result;
  }, [orders, search, statusFilter, payFilter, sortKey, showSubscriptions]);

  const subCount = orders.filter(o => o.type === 'subscription').length;

  const statusCounts = {
    all: orders.length,
    pending: orders.filter(o => o.status === 'pending').length,
    confirmed: orders.filter(o => o.status === 'confirmed').length,
    out_for_delivery: orders.filter(o => o.status === 'out_for_delivery').length,
    delivered: orders.filter(o => o.status === 'delivered').length,
  };

  const nextStatus: Partial<Record<OrderStatus, OrderStatus>> = {
    pending: 'confirmed',
    confirmed: 'out_for_delivery',
    out_for_delivery: 'delivered',
  };

  const nextLabel: Partial<Record<OrderStatus, string>> = {
    pending: '✅ Confirm',
    confirmed: '🚚 Out for Delivery',
    out_for_delivery: '📦 Mark Delivered',
  };

  return (
    <div className="p-4 md:p-6 space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 font-display">Orders</h1>
          <p className="text-sm text-gray-500">{filtered.length !== orders.length ? `${filtered.length} of ${orders.length}` : `${orders.length} total`} orders</p>
        </div>
        <div className="flex items-center gap-2">
          {subCount > 0 && (
            <button onClick={() => setShowSubscriptions(v => !v)}
              className={`text-xs px-3 py-1.5 rounded-xl border font-medium transition-colors ${
                showSubscriptions ? 'bg-blue-500 text-white border-blue-500' : 'bg-white text-blue-600 border-blue-200 hover:bg-blue-50'
              }`}>
              {showSubscriptions ? '✓ ' : ''}SUB orders ({subCount})
            </button>
          )}
          <button onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-colors">
            <Plus className="w-4 h-4" /> New Order
          </button>
        </div>
      </div>

      {/* Status Filter Pills */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4">
        {(['all', 'pending', 'confirmed', 'out_for_delivery', 'delivered'] as const).map(s => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors
              ${statusFilter === s ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            {s === 'all' ? 'All' : ORDER_STATUS_LABELS[s]} ({statusCounts[s] ?? 0})
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text" placeholder="Search by name, order number, place…"
          value={search} onChange={e => setSearch(e.target.value)}
          className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm outline-none focus:border-orange-400 bg-white"
        />
      </div>

      {/* Sort + Payment filter */}
      <div className="flex gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 flex-1 min-w-[160px]">
          <ArrowUpDown className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
          <select value={sortKey} onChange={e => setSortKey(e.target.value as SortKey)}
            className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-orange-400 bg-white">
            {(Object.entries(SORT_LABELS) as [SortKey, string][]).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
        <div className="flex gap-1">
          {(['all', 'unpaid', 'paid'] as PayFilter[]).map(f => (
            <button key={f} onClick={() => setPayFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors
                ${payFilter === f
                  ? f === 'unpaid' ? 'bg-red-500 text-white border-red-500'
                    : f === 'paid' ? 'bg-green-500 text-white border-green-500'
                    : 'bg-orange-500 text-white border-orange-500'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'}`}>
              {f === 'all' ? 'All payments' : f === 'unpaid' ? '💰 Unpaid' : '✅ Paid'}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.length === 0 && (
            <div className="text-center py-12 text-gray-400">
              <p className="text-lg">No orders found</p>
            </div>
          )}
          {filtered.map(order => (
            <div key={order.id} className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
              {/* ── Customer row (always first) ── */}
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-bold text-gray-800 text-base">{order.customerName}</span>
                    <button
                      onClick={() => { navigator.clipboard.writeText(order.customerName); toast.success('Name copied'); }}
                      className="text-gray-300 hover:text-gray-500 transition-colors" title="Copy name">
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-sm text-gray-500">📱 {order.customerWhatsapp}</span>
                    <button
                      onClick={() => { navigator.clipboard.writeText(order.customerWhatsapp); toast.success('Phone copied'); }}
                      className="text-gray-300 hover:text-gray-500 transition-colors" title="Copy phone">
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                    <span className="text-gray-300">·</span>
                    <span className="text-sm text-gray-400">{order.customerPlace}</span>
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="font-bold text-gray-800">{formatCurrency(order.total)}</p>
                  {order.type === 'sample' && <p className="text-xs text-purple-500">Free sample</p>}
                </div>
              </div>

              {/* ── Order ID + status pills ── */}
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center gap-1">
                  <Link to={`/admin/orders/${order.id}`}
                    className="font-mono font-semibold text-sm text-orange-600 hover:text-orange-700 transition-colors">
                    #{order.orderNumber}
                  </Link>
                  <button
                    onClick={() => { navigator.clipboard.writeText(order.orderNumber); toast.success('Order ID copied'); }}
                    className="text-gray-300 hover:text-gray-500 transition-colors" title="Copy order ID">
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full ${ORDER_STATUS_COLORS[order.status]}`}>
                  {ORDER_STATUS_LABELS[order.status]}
                </span>
                {order.type === 'sample' && (
                  <span className="text-xs bg-purple-100 text-purple-600 px-2 py-0.5 rounded-full">Sample</span>
                )}
                {order.paymentStatus === 'pending' && order.total > 0 && (
                  <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full">💰 Unpaid</span>
                )}
                {order.paymentStatus === 'paid' && (
                  <span className="text-xs bg-green-100 text-green-600 px-2 py-0.5 rounded-full">✅ Paid</span>
                )}
                {order.agentId && (
                  <span className="text-xs bg-indigo-100 text-indigo-600 px-2 py-0.5 rounded-full">🤝 {order.agentName ?? 'Agent'}</span>
                )}
                <span className="text-xs text-gray-400 ml-auto">{formatDateTime(order.createdAt)}</span>
              </div>

              <div className="text-sm text-gray-600">
                {order.items.map((item, i) => (
                  <span key={i} className="mr-2">
                    {item.productName} ×{item.quantity}{item.unit === 'piece' ? 'pc' : 'g'}
                    {item.customizationNote && (
                      <span className="ml-1 text-xs text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded-full border border-amber-200">
                        {item.customizationNote}
                      </span>
                    )}
                    {i < order.items.length - 1 ? ',' : ''}
                  </span>
                ))}
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {nextStatus[order.status] && (
                  <button
                    onClick={() => updateStatus(order, nextStatus[order.status]!)}
                    className="flex-1 sm:flex-none bg-orange-500 hover:bg-orange-600 text-white px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors">
                    {nextLabel[order.status]}
                  </button>
                )}
                {order.paymentStatus === 'pending' && order.total > 0 && (
                  <button
                    onClick={async () => {
                      await ordersService.updatePayment(order.id, 'paid');
                    }}
                    className="bg-green-500 hover:bg-green-600 text-white px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors">
                    Mark Paid
                  </button>
                )}
                <a href={buildWABusinessUrl(order.customerWhatsapp)} target="_blank" rel="noreferrer"
                  className="border border-green-300 text-green-600 hover:bg-green-50 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors">
                  📱 WhatsApp
                </a>
                <Link to={`/admin/orders/${order.id}`}
                  className="border border-gray-200 text-gray-600 hover:bg-gray-50 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors">
                  View Details
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && <CreateOrderModal onClose={() => setShowCreate(false)} onCreated={() => setShowCreate(false)} />}
    </div>
  );
}

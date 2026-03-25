import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, Plus } from 'lucide-react';
import { ordersService } from '../../lib/services';
import { formatCurrency, formatDateTime } from '../../lib/utils';
import { ORDER_STATUS_COLORS, ORDER_STATUS_LABELS } from '../../lib/constants';
import type { Order } from '../../lib/types';
import type { OrderStatus } from '../../lib/constants';
import CreateOrderModal from '../../components/admin/CreateOrderModal';

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<OrderStatus | 'all'>('all');
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try { setOrders(await ordersService.getAll()); }
    finally { setLoading(false); }
  }

  async function updateStatus(order: Order, status: OrderStatus) {
    await ordersService.updateStatus(order.id, status);
    load();
  }

  const filtered = orders.filter(o => {
    const matchSearch = o.customerName.toLowerCase().includes(search.toLowerCase()) ||
      o.orderNumber.toLowerCase().includes(search.toLowerCase()) ||
      o.customerPlace.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'all' || o.status === statusFilter;
    return matchSearch && matchStatus;
  });

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
          <p className="text-sm text-gray-500">{orders.length} total orders</p>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-colors">
          <Plus className="w-4 h-4" /> New Order
        </button>
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
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link to={`/admin/orders/${order.id}`}
                      className="font-bold text-gray-800 hover:text-orange-500 transition-colors">
                      #{order.orderNumber}
                    </Link>
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
                  </div>
                  <p className="text-sm text-gray-600 mt-1">{order.customerName} · {order.customerPlace}</p>
                  <p className="text-xs text-gray-400">{formatDateTime(order.createdAt)}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="font-bold text-gray-800">{formatCurrency(order.total)}</p>
                  {order.type === 'sample' && <p className="text-xs text-purple-500">Free sample</p>}
                </div>
              </div>

              <div className="text-sm text-gray-600">
                {order.items.map((item, i) => (
                  <span key={i} className="mr-2">
                    {item.productName} ×{item.quantity}{item.unit === 'piece' ? 'pc' : 'g'}
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
                      load();
                    }}
                    className="bg-green-500 hover:bg-green-600 text-white px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors">
                    Mark Paid
                  </button>
                )}
                <a href={`https://wa.me/91${order.customerWhatsapp}`} target="_blank" rel="noreferrer"
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

      {showCreate && <CreateOrderModal onClose={() => setShowCreate(false)} onCreated={load} />}
    </div>
  );
}

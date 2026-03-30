import { useState, useMemo } from 'react';
import { Search, ChevronDown, ChevronUp, Tag, ArrowUpDown } from 'lucide-react';
import { customersService, ordersService } from '../../lib/services';
import { useRealtimeCollection } from '../../lib/useRealtimeCollection';
import { formatCurrency, formatDate } from '../../lib/utils';
import type { Customer, Order } from '../../lib/types';

type CustSort = 'name_asc' | 'spent_desc' | 'orders_desc' | 'pending_desc';
type CustFilter = 'all' | 'has_discount' | 'has_pending' | 'in_wa_group' | 'not_in_wa_group';

const CUST_SORT_LABELS: Record<CustSort, string> = {
  name_asc:     'Name A–Z',
  spent_desc:   'Highest spent',
  orders_desc:  'Most orders',
  pending_desc: 'Highest pending',
};

const CUST_FILTER_LABELS: Record<CustFilter, string> = {
  all:              'All',
  has_discount:     '🏷️ Discounted',
  has_pending:      '💰 Pending payment',
  in_wa_group:      '✅ In WA group',
  not_in_wa_group:  '❌ Not in WA group',
};

export default function CustomersPage() {
  const [customers, loading] = useRealtimeCollection<Customer>(customersService.subscribe.bind(customersService));
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [customerOrders, setCustomerOrders] = useState<Record<string, Order[]>>({});
  const [discountEdit, setDiscountEdit] = useState<Record<string, string>>({}); // customerId -> draft string
  const [savingDiscount, setSavingDiscount] = useState<string | null>(null);
  const [markingPaid, setMarkingPaid] = useState<string | null>(null);   // customerId being processed
  const [custFilter, setCustFilter] = useState<CustFilter>('all');
  const [sortKey, setSortKey] = useState<CustSort>('name_asc');

  async function loadOrders(customerId: string) {
    // Always re-fetch — no cache, so payment status changes are immediately visible
    const orders = await ordersService.getByCustomerId(customerId);
    setCustomerOrders(prev => ({ ...prev, [customerId]: orders }));
  }

  async function toggleExpand(id: string) {
    if (expanded === id) { setExpanded(null); return; }
    setExpanded(id);
    await loadOrders(id);
    // Silently heal any stale pendingAmount in the customer record
    customersService.adjustAfterOrderEdit(id, 0, 0, 'pending').catch(() => {});
  }

  async function saveDiscount(c: Customer) {
    const raw = discountEdit[c.id];
    const pct = raw === '' ? 0 : Math.min(100, Math.max(0, Number(raw)));
    if (isNaN(pct)) return;
    setSavingDiscount(c.id);
    try {
      await customersService.update(c.id, { discountPercent: pct });
      setDiscountEdit(prev => ({ ...prev, [c.id]: String(pct) }));
    } finally {
      setSavingDiscount(null);
    }
  }

  /** Mark ONLY truly pending orders as paid using live order data */
  async function markAllPaid(c: Customer) {
    setMarkingPaid(c.id);
    try {
      const orders = customerOrders[c.id] || [];
      const pendingOrders = orders.filter(o => o.paymentStatus === 'pending');
      if (pendingOrders.length === 0) return;
      await Promise.all(pendingOrders.map(o => ordersService.updatePayment(o.id, 'paid')));
      await loadOrders(c.id);
    } finally {
      setMarkingPaid(null);
    }
  }

  const filtered = useMemo(() => {
    let result = customers.filter(c => {
      const matchSearch = c.name.toLowerCase().includes(search.toLowerCase()) ||
        c.whatsapp.includes(search) ||
        c.place.toLowerCase().includes(search.toLowerCase());
      const matchFilter =
        custFilter === 'all'             ? true :
        custFilter === 'has_discount'    ? (c.discountPercent ?? 0) > 0 :
        custFilter === 'has_pending'     ? c.pendingAmount > 0 :
        custFilter === 'in_wa_group'     ? c.joinedWhatsappGroup :
        /* not_in_wa_group */              !c.joinedWhatsappGroup;
      return matchSearch && matchFilter;
    });
    result = [...result].sort((a, b) => {
      switch (sortKey) {
        case 'spent_desc':   return b.totalSpent - a.totalSpent;
        case 'orders_desc':  return b.totalOrders - a.totalOrders;
        case 'pending_desc': return b.pendingAmount - a.pendingAmount;
        default:             return a.name.localeCompare(b.name);
      }
    });
    return result;
  }, [customers, search, custFilter, sortKey]);

  return (
    <div className="p-4 md:p-6 space-y-4 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-gray-800 font-display">Customers</h1>
        <p className="text-sm text-gray-500">{filtered.length !== customers.length ? `${filtered.length} of ${customers.length}` : `${customers.length} total`} customers</p>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input type="text" placeholder="Search by name, number, place…"
          value={search} onChange={e => setSearch(e.target.value)}
          className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm outline-none focus:border-orange-400 bg-white" />
      </div>

      {/* Filter pills */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4">
        {(Object.entries(CUST_FILTER_LABELS) as [CustFilter, string][]).map(([k, v]) => (
          <button key={k} onClick={() => setCustFilter(k)}
            className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors
              ${custFilter === k ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            {v}
          </button>
        ))}
      </div>

      {/* Sort */}
      <div className="flex items-center gap-2">
        <ArrowUpDown className="w-3.5 h-3.5 text-gray-400" />
        <select value={sortKey} onChange={e => setSortKey(e.target.value as CustSort)}
          className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-orange-400 bg-white">
          {(Object.entries(CUST_SORT_LABELS) as [CustSort, string][]).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.length === 0 && (
            <div className="text-center py-10 text-gray-400">No customers found</div>
          )}
          {filtered.map(c => (
            <div key={c.id} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <button onClick={() => toggleExpand(c.id)}
                className="w-full flex items-center gap-4 px-4 py-3 hover:bg-gray-50 transition-colors text-left">
                <div className="w-10 h-10 bg-orange-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <span className="font-bold text-orange-600 text-sm">{c.name.charAt(0).toUpperCase()}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-gray-800">{c.name}</p>
                    {c.discountPercent && c.discountPercent > 0 ? (
                      <span className="inline-flex items-center gap-0.5 text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-medium">
                        <Tag className="w-2.5 h-2.5" />{c.discountPercent}% off
                      </span>
                    ) : null}
                  </div>
                  <p className="text-xs text-gray-500">📱 {c.whatsapp} · 📍 {c.place}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-bold text-gray-800">{formatCurrency(c.totalSpent)}</p>
                  <p className="text-xs text-gray-500">{c.totalOrders} orders</p>
                  {c.pendingAmount > 0 && (
                    <p className="text-xs text-red-500">₹{c.pendingAmount} pending</p>
                  )}
                </div>
                {expanded === c.id ? <ChevronUp className="w-4 h-4 text-gray-400 flex-shrink-0" /> : <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />}
              </button>

              {expanded === c.id && (
                <div className="border-t border-gray-100 bg-gray-50 p-4 space-y-3">
                  <div className="flex gap-3 flex-wrap text-xs">
                    <span className={`px-2 py-1 rounded-full ${c.joinedWhatsappGroup ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {c.joinedWhatsappGroup ? '✅ In WA Group' : '❌ Not in WA Group'}
                    </span>
                    <span className="px-2 py-1 bg-blue-50 text-blue-600 rounded-full">
                      Member since {formatDate(c.createdAt)}
                    </span>
                  </div>
                  <p className="text-xs font-semibold text-gray-500 uppercase">Order History</p>
                  {(customerOrders[c.id] || []).length === 0 ? (
                    <p className="text-xs text-gray-400">No orders yet</p>
                  ) : (
                    <div className="space-y-1">
                      {(customerOrders[c.id] || []).map(o => (
                        <div key={o.id} className="flex justify-between items-center text-xs bg-white rounded-lg px-3 py-2 border border-gray-100">
                          <span className="text-gray-700">#{o.orderNumber} · {formatDate(o.createdAt)}</span>
                          <div className="flex items-center gap-2">
                            <span className={`font-medium ${
                              o.status === 'delivered' ? 'text-green-600' :
                              o.status === 'cancelled' ? 'text-red-400' : 'text-orange-600'
                            }`}>{formatCurrency(o.total)}</span>
                            <span className={`px-1.5 py-0.5 rounded-full font-medium ${
                              o.paymentStatus === 'paid' ? 'bg-green-100 text-green-700' :
                              o.paymentStatus === 'na'   ? 'bg-gray-100 text-gray-500'  :
                                                           'bg-red-100 text-red-600'
                            }`}>
                              {o.paymentStatus === 'paid' ? '✅ Paid' : o.paymentStatus === 'na' ? 'N/A' : '⏳ Pending'}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {/* Compute live pending from actual order data */}
                  {(() => {
                    const livePending = (customerOrders[c.id] || [])
                      .filter(o => o.paymentStatus === 'pending')
                      .reduce((s, o) => s + (o.total || 0), 0);
                    const hasPending = livePending > 0;

                    return (
                      <>
                        {/* Discount — only for customers with outstanding payments */}
                        {hasPending && (
                          <div className="bg-white rounded-xl border border-orange-200 p-3">
                            <p className="text-xs font-semibold text-gray-600 mb-1 flex items-center gap-1">
                              <Tag className="w-3.5 h-3.5 text-green-600" /> Apply Discount on Pending Amount
                            </p>
                            <p className="text-xs text-gray-400 mb-2">
                              Outstanding: <strong className="text-red-500">₹{livePending}</strong> — set a % to reduce what they owe
                            </p>
                            <div className="flex items-center gap-2">
                              <div className="relative flex-1">
                                <input
                                  type="number" min="0" max="100" step="1"
                                  value={discountEdit[c.id] ?? String(c.discountPercent ?? 0)}
                                  onChange={e => setDiscountEdit(prev => ({ ...prev, [c.id]: e.target.value }))}
                                  placeholder="0"
                                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-green-400 pr-7"
                                />
                                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-gray-400">%</span>
                              </div>
                              <button
                                onClick={() => saveDiscount(c)}
                                disabled={savingDiscount === c.id}
                                className="bg-green-500 hover:bg-green-600 text-white px-3 py-2 rounded-lg text-xs font-semibold disabled:opacity-50 transition-colors">
                                {savingDiscount === c.id ? 'Saving…' : 'Save'}
                              </button>
                            </div>
                            {(c.discountPercent ?? 0) > 0 && (
                              <p className="text-xs text-green-600 mt-1">✓ {c.discountPercent}% standing discount active on new orders</p>
                            )}
                          </div>
                        )}

                        <div className="flex gap-2 flex-wrap">
                          <a href={`https://wa.me/91${c.whatsapp}`} target="_blank" rel="noreferrer"
                            className="text-xs bg-green-500 text-white px-3 py-1.5 rounded-lg hover:bg-green-600 transition-colors">
                            📱 WhatsApp
                          </a>
                          {hasPending && (
                            <button
                              onClick={() => markAllPaid(c)}
                              disabled={markingPaid === c.id}
                              className="text-xs bg-blue-500 text-white px-3 py-1.5 rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50">
                              {markingPaid === c.id ? 'Marking…' : `✅ Mark All Paid (₹${livePending})`}
                            </button>
                          )}
                        </div>
                      </>
                    );
                  })()}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

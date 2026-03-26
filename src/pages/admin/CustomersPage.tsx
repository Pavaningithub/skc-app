import { useEffect, useState } from 'react';
import { Search, ChevronDown, ChevronUp, Tag } from 'lucide-react';
import { customersService, ordersService } from '../../lib/services';
import { formatCurrency, formatDate } from '../../lib/utils';
import type { Customer, Order } from '../../lib/types';

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [customerOrders, setCustomerOrders] = useState<Record<string, Order[]>>({});
  const [discountEdit, setDiscountEdit] = useState<Record<string, string>>({}); // customerId -> draft string
  const [savingDiscount, setSavingDiscount] = useState<string | null>(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try { setCustomers(await customersService.getAll()); }
    finally { setLoading(false); }
  }

  async function loadOrders(customerId: string) {
    if (customerOrders[customerId]) return;
    const all = await ordersService.getAll();
    const filtered = all.filter(o => o.customerId === customerId);
    setCustomerOrders(prev => ({ ...prev, [customerId]: filtered }));
  }

  async function toggleExpand(id: string) {
    if (expanded === id) { setExpanded(null); return; }
    setExpanded(id);
    await loadOrders(id);
  }

  async function saveDiscount(c: Customer) {
    const raw = discountEdit[c.id];
    const pct = raw === '' ? 0 : Math.min(100, Math.max(0, Number(raw)));
    if (isNaN(pct)) return;
    setSavingDiscount(c.id);
    try {
      await customersService.update(c.id, { discountPercent: pct });
      setCustomers(prev => prev.map(x => x.id === c.id ? { ...x, discountPercent: pct } : x));
      setDiscountEdit(prev => ({ ...prev, [c.id]: String(pct) }));
    } finally {
      setSavingDiscount(null);
    }
  }

  const filtered = customers.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.whatsapp.includes(search) ||
    c.place.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-4 md:p-6 space-y-4 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-gray-800 font-display">Customers</h1>
        <p className="text-sm text-gray-500">{customers.length} total customers</p>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input type="text" placeholder="Search by name, number, place…"
          value={search} onChange={e => setSearch(e.target.value)}
          className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm outline-none focus:border-orange-400 bg-white" />
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
                        <div key={o.id} className="flex justify-between text-xs bg-white rounded-lg px-3 py-2 border border-gray-100">
                          <span className="text-gray-700">#{o.orderNumber} · {formatDate(o.createdAt)}</span>
                          <span className={`font-medium ${o.status === 'delivered' ? 'text-green-600' : 'text-orange-600'}`}>
                            {formatCurrency(o.total)} · {o.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  {/* Discount setting */}
                  <div className="bg-white rounded-xl border border-gray-200 p-3">
                    <p className="text-xs font-semibold text-gray-600 mb-2 flex items-center gap-1">
                      <Tag className="w-3.5 h-3.5 text-green-600" /> Standing Discount
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
                    {(c.discountPercent ?? 0) > 0 ? (
                      <p className="text-xs text-green-600 mt-1">✓ {c.discountPercent}% discount auto-applied on all new orders</p>
                    ) : (
                      <p className="text-xs text-gray-400 mt-1">Set a % to auto-apply on new orders for this customer</p>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <a href={`https://wa.me/91${c.whatsapp}`} target="_blank" rel="noreferrer"
                      className="text-xs bg-green-500 text-white px-3 py-1.5 rounded-lg hover:bg-green-600 transition-colors">
                      📱 WhatsApp
                    </a>
                    {c.pendingAmount > 0 && (
                      <button onClick={async () => {
                        await customersService.update(c.id, { pendingAmount: 0 });
                        load();
                      }} className="text-xs bg-blue-500 text-white px-3 py-1.5 rounded-lg hover:bg-blue-600 transition-colors">
                        Clear Pending
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

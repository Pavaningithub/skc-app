import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import Portal from '../../components/Portal';
import { subscriptionsService, productsService, customersService, ordersService } from '../../lib/services';
import { formatCurrency, formatDate, generateOrderNumber } from '../../lib/utils';
import { SUBSCRIPTION_DISCOUNTS } from '../../lib/constants';
import type { Subscription, Product, OrderItem } from '../../lib/types';
import type { SubscriptionDuration } from '../../lib/constants';

export default function SubscriptionsPage() {
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    customerName: '',
    customerWhatsapp: '',
    duration: '3months' as SubscriptionDuration,
    items: [] as OrderItem[],
    paymentStatus: 'pending' as 'pending' | 'paid',
  });
  const [selectedProductId, setSelectedProductId] = useState('');
  const [selectedQty, setSelectedQty] = useState(100);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const [s, p] = await Promise.all([subscriptionsService.getAll(), productsService.getActive()]);
      setSubs(s); setProducts(p);
      if (p.length > 0) setSelectedProductId(p[0].id);
    } finally { setLoading(false); }
  }

  function addItem() {
    const product = products.find(p => p.id === selectedProductId);
    if (!product) return;
    setForm(f => ({
      ...f,
      items: [...f.items, {
        productId: product.id, productName: product.name,
        unit: product.unit, quantity: Number(selectedQty),
        pricePerUnit: product.pricePerUnit,
        totalPrice: Number(selectedQty) * product.pricePerUnit,
      }],
    }));
  }

  async function handleSave() {
    if (!form.customerName.trim()) return toast.error('Customer name required');
    if (!form.customerWhatsapp.trim()) return toast.error('WhatsApp number required');
    if (form.items.length === 0) return toast.error('Add at least one product');
    setSaving(true);
    try {
      const baseAmount = form.items.reduce((s, i) => s + i.totalPrice, 0);
      const discount = SUBSCRIPTION_DISCOUNTS[form.duration];
      const discountedAmount = baseAmount * (1 - discount / 100);

      const startDate = new Date();
      const endDate = new Date();
      if (form.duration === '3months') endDate.setMonth(endDate.getMonth() + 3);
      else endDate.setMonth(endDate.getMonth() + 6);

      // Upsert customer
      let customerId: string | undefined;
      const existing = await customersService.getByWhatsapp(form.customerWhatsapp.replace(/\D/g, ''));
      if (existing) customerId = existing.id;
      else customerId = await customersService.upsert({
        name: form.customerName,
        whatsapp: form.customerWhatsapp.replace(/\D/g, ''),
        place: '',
        joinedWhatsappGroup: false,
        createdAt: new Date().toISOString(),
      });

      const subId = await subscriptionsService.add({
        customerId: customerId || '',
        customerName: form.customerName,
        customerWhatsapp: form.customerWhatsapp.replace(/\D/g, ''),
        items: form.items,
        duration: form.duration,
        discountPercent: discount,
        baseAmount,
        discountedAmount,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        isActive: true,
        paymentStatus: form.paymentStatus,
        createdAt: new Date().toISOString(),
      });

      // Create an initial order
      await ordersService.add({
        orderNumber: generateOrderNumber(),
        type: 'subscription',
        customerId,
        customerName: form.customerName,
        customerWhatsapp: form.customerWhatsapp.replace(/\D/g, ''),
        customerPlace: '',
        items: form.items,
        subtotal: baseAmount,
        discount: baseAmount - discountedAmount,
        total: discountedAmount,
        status: 'confirmed',
        paymentStatus: form.paymentStatus,
        notes: `Subscription ${form.duration} (${discount}% off)`,
        subscriptionId: subId,
        subscriptionDuration: form.duration,
        hasOnDemandItems: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      toast.success('Subscription created!');
      setShowForm(false);
      load();
    } finally { setSaving(false); }
  }

  return (
    <div className="p-4 md:p-6 space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 font-display">Subscriptions</h1>
          <p className="text-sm text-gray-500">{subs.filter(s => s.isActive).length} active</p>
        </div>
        <button onClick={() => setShowForm(true)}
          className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-colors">
          <Plus className="w-4 h-4" /> New Subscription
        </button>
      </div>

      {/* Plan info */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
          <p className="text-sm font-bold text-blue-800">3-Month Plan</p>
          <p className="text-2xl font-bold text-blue-600">5% OFF</p>
          <p className="text-xs text-blue-600">Upfront payment</p>
        </div>
        <div className="bg-green-50 border border-green-200 rounded-xl p-4">
          <p className="text-sm font-bold text-green-800">6-Month Plan</p>
          <p className="text-2xl font-bold text-green-600">10% OFF</p>
          <p className="text-xs text-green-600">Upfront payment</p>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="space-y-3">
          {subs.length === 0 && (
            <div className="text-center py-10 text-gray-400">No subscriptions yet</div>
          )}
          {subs.map(sub => {
            const isExpired = new Date(sub.endDate) < new Date();
            return (
              <div key={sub.id} className={`bg-white border rounded-xl p-4 space-y-2
                ${isExpired ? 'border-gray-200 opacity-70' : 'border-orange-200'}`}>
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-semibold text-gray-800">{sub.customerName}</p>
                    <p className="text-xs text-gray-500">📱 {sub.customerWhatsapp}</p>
                  </div>
                  <div className="text-right">
                    <span className={`text-xs px-2 py-1 rounded-full font-medium
                      ${isExpired ? 'bg-gray-100 text-gray-500' : 'bg-green-100 text-green-700'}`}>
                      {isExpired ? 'Expired' : '✅ Active'}
                    </span>
                    <p className="text-sm font-bold text-orange-600 mt-1">{formatCurrency(sub.discountedAmount)}</p>
                    <p className="text-xs text-gray-400 line-through">{formatCurrency(sub.baseAmount)}</p>
                  </div>
                </div>
                <div className="flex gap-2 text-xs flex-wrap">
                  <span className="bg-blue-50 text-blue-600 px-2 py-1 rounded-full">
                    {sub.duration === '3months' ? '3 Months' : '6 Months'} · {sub.discountPercent}% off
                  </span>
                  <span className="bg-gray-50 text-gray-500 px-2 py-1 rounded-full">
                    {formatDate(sub.startDate)} → {formatDate(sub.endDate)}
                  </span>
                  <span className={`px-2 py-1 rounded-full ${sub.paymentStatus === 'paid' ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}>
                    {sub.paymentStatus === 'paid' ? '✅ Paid' : '💰 Pending'}
                  </span>
                </div>
                <div className="flex gap-2">
                  <a href={`https://wa.me/91${sub.customerWhatsapp}`} target="_blank" rel="noreferrer"
                    className="text-xs border border-green-300 text-green-600 px-3 py-1.5 rounded-lg hover:bg-green-50">
                    📱 WhatsApp
                  </a>
                  {sub.paymentStatus === 'pending' && (
                    <button onClick={async () => {
                      await subscriptionsService.update(sub.id, { paymentStatus: 'paid' });
                      load();
                    }} className="text-xs bg-green-500 text-white px-3 py-1.5 rounded-lg hover:bg-green-600">
                      Mark Paid
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create Subscription Modal */}
      {showForm && (
        <Portal>
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end justify-center sm:items-center sm:p-4">
          <div className="bg-white rounded-t-3xl sm:rounded-2xl w-full max-w-lg flex flex-col" style={{ maxHeight: '92dvh' }}>
            <div className="border-b border-gray-100 px-5 py-4 flex items-center justify-between flex-shrink-0">
              <h2 className="font-bold text-gray-800">New Subscription</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 text-xl">×</button>
            </div>
            <div className="overflow-y-auto flex-1 p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Customer Name</label>
                  <input type="text" value={form.customerName} onChange={e => setForm(f => ({ ...f, customerName: e.target.value }))}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-orange-400" />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">WhatsApp Number</label>
                  <input type="tel" value={form.customerWhatsapp} onChange={e => setForm(f => ({ ...f, customerWhatsapp: e.target.value }))}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-orange-400" />
                </div>
              </div>

              {/* Duration */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Subscription Plan</label>
                <div className="grid grid-cols-2 gap-2">
                  {(['3months', '6months'] as SubscriptionDuration[]).map(d => (
                    <button key={d} onClick={() => setForm(f => ({ ...f, duration: d }))}
                      className={`py-3 rounded-xl border text-sm font-medium transition-colors
                        ${form.duration === d ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-gray-600 border-gray-200'}`}>
                      {d === '3months' ? '3 Months — 5% Off' : '6 Months — 10% Off'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Products */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Products</label>
                <div className="flex gap-2">
                  <select value={selectedProductId} onChange={e => setSelectedProductId(e.target.value)}
                    className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none bg-white">
                    {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <input type="number" value={selectedQty} onChange={e => setSelectedQty(Number(e.target.value))}
                    className="w-20 border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none text-center" />
                  <button onClick={addItem} className="bg-orange-500 text-white px-3 py-2 rounded-xl">
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
                {form.items.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {form.items.map((item, i) => (
                      <div key={i} className="flex justify-between text-sm bg-orange-50 rounded-lg px-3 py-2">
                        <span>{item.productName} ×{item.quantity}{item.unit === 'piece' ? 'pc' : 'g'}</span>
                        <span className="font-medium">₹{item.totalPrice.toFixed(0)}</span>
                      </div>
                    ))}
                    <div className="flex justify-between font-bold text-sm px-3 py-1">
                      <span>Discounted Total</span>
                      <span className="text-orange-600">
                        ₹{(form.items.reduce((s, i) => s + i.totalPrice, 0) * (1 - SUBSCRIPTION_DISCOUNTS[form.duration] / 100)).toFixed(0)}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Payment Status</label>
                <select value={form.paymentStatus} onChange={e => setForm(f => ({ ...f, paymentStatus: e.target.value as any }))}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none bg-white">
                  <option value="pending">Pending</option>
                  <option value="paid">Paid</option>
                </select>
              </div>
            </div>
            <div className="border-t border-gray-100 p-5 flex gap-3 flex-shrink-0">
              <button onClick={() => setShowForm(false)}
                className="flex-1 border border-gray-200 text-gray-600 py-3 rounded-xl text-sm">Cancel</button>
              <button onClick={handleSave} disabled={saving}
                className="flex-1 bg-orange-500 hover:bg-orange-600 text-white py-3 rounded-xl text-sm font-semibold disabled:opacity-50">
                {saving ? 'Creating…' : 'Create Subscription'}
              </button>
            </div>
          </div>
        </div>
        </Portal>
      )}
    </div>
  );
}

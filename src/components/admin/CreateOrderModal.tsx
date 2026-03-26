import { useState, useEffect } from 'react';
import { Plus, Minus, Trash2, Tag } from 'lucide-react';
import toast from 'react-hot-toast';
import { productsService, ordersService, customersService, stockService } from '../../lib/services';
import { generateOrderNumber, buildAdminWhatsAppUrl, orderPlacedMessage } from '../../lib/utils';
import type { Product, OrderItem, Order } from '../../lib/types';
import type { OrderType } from '../../lib/constants';

interface Props {
  onClose: () => void;
  onCreated: () => void;
}

export default function CreateOrderModal({ onClose, onCreated }: Props) {
  const [products, setProducts] = useState<Product[]>([]);
  const [items, setItems] = useState<OrderItem[]>([]);
  const [orderType, setOrderType] = useState<OrderType>('regular');
  const [customerName, setCustomerName] = useState('');
  const [customerWhatsapp, setCustomerWhatsapp] = useState('');
  const [customerPlace, setCustomerPlace] = useState('');
  const [notes, setNotes] = useState('');
  const [paymentStatus, setPaymentStatus] = useState<'pending' | 'paid' | 'na'>('pending');
  const [saving, setSaving] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [selectedQty, setSelectedQty] = useState(100);
  // discount
  const [discountPercent, setDiscountPercent] = useState(0); // from customer standing discount
  const [manualDiscount, setManualDiscount] = useState(0);   // overridden manually
  const [customerDiscountLabel, setCustomerDiscountLabel] = useState(''); // label shown when auto-applied

  useEffect(() => {
    productsService.getActive().then(p => {
      setProducts(p);
      if (p.length > 0) setSelectedProductId(p[0].id);
    });
  }, []);

  // Auto-fill customer details + apply standing discount when a known WA number is entered
  useEffect(() => {
    const digits = customerWhatsapp.replace(/\D/g, '');
    if (digits.length < 10) {
      setCustomerDiscountLabel('');
      return;
    }
    customersService.getByWhatsapp(digits).then(c => {
      if (!c) { setCustomerDiscountLabel(''); return; }
      if (!customerName) setCustomerName(c.name);
      if (!customerPlace && c.place) setCustomerPlace(c.place);
      if (c.discountPercent && c.discountPercent > 0) {
        setDiscountPercent(c.discountPercent);
        setCustomerDiscountLabel(`${c.discountPercent}% standing discount for ${c.name}`);
      } else {
        setDiscountPercent(0);
        setCustomerDiscountLabel('');
      }
    });
  }, [customerWhatsapp]);

  function addItem() {
    const product = products.find(p => p.id === selectedProductId);
    if (!product) return;
    const qty = Number(selectedQty);
    if (qty <= 0) return toast.error('Enter a valid quantity');

    const existing = items.findIndex(i => i.productId === product.id);
    if (existing >= 0) {
      const updated = [...items];
      updated[existing].quantity += qty;
      updated[existing].totalPrice = updated[existing].quantity * product.pricePerUnit;
      setItems(updated);
    } else {
      setItems([...items, {
        productId: product.id,
        productName: product.name,
        unit: product.unit,
        quantity: qty,
        pricePerUnit: product.pricePerUnit,
        totalPrice: qty * product.pricePerUnit,
      }]);
    }
  }

  function removeItem(idx: number) {
    setItems(items.filter((_, i) => i !== idx));
  }

  function updateQty(idx: number, qty: number) {
    if (qty <= 0) return removeItem(idx);
    const updated = [...items];
    updated[idx].quantity = qty;
    updated[idx].totalPrice = qty * updated[idx].pricePerUnit;
    setItems(updated);
  }

  const subtotal = items.reduce((s, i) => s + i.totalPrice, 0);
  const isSample = orderType === 'sample';
  // Effective discount: standing % takes priority; admin can also set manualDiscount
  const effectiveDiscountAmt = isSample ? 0 : Math.round(
    manualDiscount > 0 ? manualDiscount : subtotal * discountPercent / 100
  );
  const total = isSample ? 0 : Math.max(0, subtotal - effectiveDiscountAmt);

  async function handleSubmit() {
    if (!customerName.trim()) return toast.error('Customer name required');
    if (!customerWhatsapp.trim() || customerWhatsapp.replace(/\D/g, '').length < 10)
      return toast.error('Valid WhatsApp number required');
    if (items.length === 0) return toast.error('Add at least one product');

    setSaving(true);
    try {
      // Upsert customer
      let customerId: string | undefined;
      const existing = await customersService.getByWhatsapp(customerWhatsapp.replace(/\D/g, ''));
      if (existing) {
        customerId = existing.id;
      } else {
        customerId = await customersService.upsert({
          name: customerName.trim(),
          whatsapp: customerWhatsapp.replace(/\D/g, ''),
          place: customerPlace.trim(),
          joinedWhatsappGroup: false,
          createdAt: new Date().toISOString(),
        });
      }

      const orderNumber = generateOrderNumber();
      const order: Omit<Order, 'id'> = {
        orderNumber,
        type: orderType,
        customerId,
        customerName: customerName.trim(),
        customerWhatsapp: customerWhatsapp.replace(/\D/g, ''),
        customerPlace: customerPlace.trim(),
        items,
        subtotal,
        discount: effectiveDiscountAmt,
        total,
        status: 'confirmed',
        paymentStatus: isSample ? 'na' : paymentStatus,
        notes,
        hasOnDemandItems: items.some(i => i.isOnDemand),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const orderId = await ordersService.add(order);

      // Deduct stock
      for (const item of items) {
        await stockService.deduct(item.productId, item.unit === 'piece' ? item.quantity : item.quantity);
      }

      // Update customer stats
      if (customerId) {
        await customersService.updateAfterOrder(customerId, total, paymentStatus);
      }

      toast.success('Order created!');

      // Open WhatsApp notification
      const fullOrder = { ...order, id: orderId };
      const msg = orderPlacedMessage(fullOrder as Order);
      window.open(buildAdminWhatsAppUrl(msg), '_blank');

      onCreated();
      onClose();
    } catch (e) {
      toast.error('Failed to create order');
      console.error(e);
    } finally {
      setSaving(false);
    }
  }

  const selectedProduct = products.find(p => p.id === selectedProductId);

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-xl max-h-[95vh] flex flex-col">
        <div className="border-b border-gray-100 px-5 py-4 flex items-center justify-between flex-shrink-0">
          <h2 className="font-bold text-gray-800">Create New Order</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-4">
          {/* Order Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Order Type</label>
            <div className="flex gap-2">
              {(['regular', 'sample'] as OrderType[]).map(t => (
                <button key={t} onClick={() => setOrderType(t)}
                  className={`flex-1 py-2 rounded-xl text-sm font-medium border transition-colors
                    ${orderType === t ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-gray-600 border-gray-200 hover:border-orange-200'}`}>
                  {t === 'regular' ? '🛍️ Regular Order' : '🎁 Free Sample'}
                </button>
              ))}
            </div>
            {isSample && (
              <p className="text-xs text-purple-600 mt-1 bg-purple-50 px-3 py-1.5 rounded-lg">
                Sample orders are tracked but no payment is collected.
              </p>
            )}
          </div>

          {/* Customer */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Customer Name *</label>
              <input type="text" value={customerName} onChange={e => setCustomerName(e.target.value)}
                placeholder="Full name"
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-orange-400" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">WhatsApp Number *</label>
              <input type="tel" value={customerWhatsapp} onChange={e => setCustomerWhatsapp(e.target.value)}
                placeholder="10-digit number"
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-orange-400" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Place / Area</label>
              <input type="text" value={customerPlace} onChange={e => setCustomerPlace(e.target.value)}
                placeholder="Bangalore, Mysore…"
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-orange-400" />
            </div>
          </div>

          {/* Add Products */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Products</label>
            <div className="flex gap-2">
              <select value={selectedProductId} onChange={e => setSelectedProductId(e.target.value)}
                className="flex-1 border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-orange-400 bg-white">
                {products.map(p => (
                  <option key={p.id} value={p.id}>{p.name} — ₹{p.pricePerUnit}/{p.unit}</option>
                ))}
              </select>
              <input type="number" min="1" value={selectedQty} onChange={e => setSelectedQty(Number(e.target.value))}
                className="w-24 border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-orange-400 text-center"
                placeholder={selectedProduct?.unit === 'piece' ? 'pcs' : 'grams'} />
              <button onClick={addItem}
                className="bg-orange-500 hover:bg-orange-600 text-white px-3 py-2 rounded-xl transition-colors">
                <Plus className="w-5 h-5" />
              </button>
            </div>
            {selectedProduct && (
              <p className="text-xs text-gray-400 mt-1">
                Unit: {selectedProduct.unit} · ₹{selectedProduct.pricePerUnit} per {selectedProduct.unit}
              </p>
            )}
          </div>

          {/* Items List */}
          {items.length > 0 && (
            <div className="border border-gray-100 rounded-xl overflow-hidden">
              {items.map((item, i) => (
                <div key={i} className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? 'border-t border-gray-50' : ''}`}>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{item.productName}</p>
                    <p className="text-xs text-gray-500">₹{item.pricePerUnit}/{item.unit}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => updateQty(i, item.quantity - (item.unit === 'piece' ? 1 : 50))}
                      className="p-1 hover:bg-gray-100 rounded-lg">
                      <Minus className="w-3 h-3 text-gray-500" />
                    </button>
                    <span className="text-sm font-medium w-16 text-center">
                      {item.quantity}{item.unit === 'piece' ? 'pc' : 'g'}
                    </span>
                    <button onClick={() => updateQty(i, item.quantity + (item.unit === 'piece' ? 1 : 50))}
                      className="p-1 hover:bg-gray-100 rounded-lg">
                      <Plus className="w-3 h-3 text-gray-500" />
                    </button>
                  </div>
                  <p className="text-sm font-bold text-gray-800 w-16 text-right">₹{item.totalPrice.toFixed(0)}</p>
                  <button onClick={() => removeItem(i)} className="p-1 hover:bg-red-50 rounded-lg">
                    <Trash2 className="w-4 h-4 text-red-400" />
                  </button>
                </div>
              ))}
              <div className="border-t border-gray-100 px-4 py-3 bg-gray-50 space-y-1.5">
                {customerDiscountLabel && (
                  <div className="flex items-center gap-1.5 text-xs text-green-700 bg-green-50 rounded-lg px-2 py-1.5 mb-1">
                    <Tag className="w-3 h-3" />
                    <span>{customerDiscountLabel} — auto-applied below</span>
                  </div>
                )}
                <div className="flex justify-between text-sm text-gray-600">
                  <span>Subtotal</span><span>₹{subtotal}</span>
                </div>
                {effectiveDiscountAmt > 0 && (
                  <div className="flex justify-between text-sm text-green-600">
                    <span>Discount {discountPercent > 0 && manualDiscount === 0 ? `(${discountPercent}%)` : ''}</span>
                    <span>−₹{effectiveDiscountAmt}</span>
                  </div>
                )}
                <div className="flex justify-between font-semibold text-gray-700 border-t border-gray-100 pt-1.5">
                  <span>{isSample ? 'Total (Sample - Free)' : 'Total'}</span>
                  <span className="text-lg text-orange-600">₹{total}</span>
                </div>
              </div>
            </div>
          )}

          {/* Manual discount override */}
          {!isSample && items.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1">
                <Tag className="w-3.5 h-3.5 text-green-600" /> Manual Discount (₹)
                {discountPercent > 0 && manualDiscount === 0 && (
                  <span className="text-xs text-green-600 ml-1">(auto: {discountPercent}% = ₹{Math.round(subtotal * discountPercent / 100)})</span>
                )}
              </label>
              <input type="number" min="0" step="1"
                value={manualDiscount || ''}
                onChange={e => setManualDiscount(Math.max(0, Number(e.target.value)))}
                placeholder={discountPercent > 0 ? `Leave blank for ${discountPercent}% auto-discount` : 'e.g. 50'}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-orange-400" />
            </div>
          )}

          {/* Payment & Notes */}
          {!isSample && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Payment Status</label>
              <select value={paymentStatus} onChange={e => setPaymentStatus(e.target.value as any)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-orange-400 bg-white">
                <option value="pending">Pending</option>
                <option value="paid">Paid</option>
              </select>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="Special instructions, delivery notes…" rows={2}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-orange-400 resize-none" />
          </div>
        </div>

        <div className="border-t border-gray-100 p-5 flex gap-3 flex-shrink-0">
          <button onClick={onClose}
            className="flex-1 border border-gray-200 text-gray-600 py-3 rounded-xl text-sm font-medium">Cancel</button>
          <button onClick={handleSubmit} disabled={saving}
            className="flex-1 bg-orange-500 hover:bg-orange-600 text-white py-3 rounded-xl text-sm font-semibold disabled:opacity-50 transition-colors">
            {saving ? 'Creating…' : '✅ Create Order & Notify'}
          </button>
        </div>
      </div>
    </div>
  );
}

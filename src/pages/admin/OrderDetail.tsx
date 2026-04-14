import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, MessageCircle, ChevronDown, ChevronUp, TrendingUp, Trash2, XCircle, Pencil, Plus, Minus, Tag } from 'lucide-react';
import toast from 'react-hot-toast';
import { ordersService, productsService, customersService, activityService } from '../../lib/services';
import {
  formatCurrency, formatDateTime, buildCustomerWhatsAppUrl, buildWABusinessUrl,
  orderConfirmedToCustomer, outForDeliveryToCustomer, deliveredToCustomer,
  orderCancelledToCustomer, formatQuantity,
} from '../../lib/utils';
import { ORDER_STATUS_COLORS, ORDER_STATUS_LABELS } from '../../lib/constants';
import type { Order, OrderItem, Product } from '../../lib/types';
import type { OrderStatus } from '../../lib/constants';

export default function OrderDetail() {
  const { orderId } = useParams<{ orderId: string }>();
  const navigate = useNavigate();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCost, setShowCost] = useState(false);
  const [itemCosts, setItemCosts] = useState<Record<number, number>>({});
  const [savingCost, setSavingCost] = useState(false);
  const [confirm, setConfirm] = useState<'cancel' | 'delete' | null>(null);
  const [lastStatusChanged, setLastStatusChanged] = useState<OrderStatus | null>(null);
  const [customerReferralCode, setCustomerReferralCode] = useState<string | undefined>(undefined);

  // ── Edit order state ──
  const [showEdit, setShowEdit] = useState(false);
  const [editItems, setEditItems] = useState<OrderItem[]>([]);
  const [editDiscount, setEditDiscount] = useState(0);
  const [products, setProducts] = useState<Product[]>([]);
  const [addProductId, setAddProductId] = useState('');
  const [addQty, setAddQty] = useState(250);
  const [addGarlic, setAddGarlic] = useState<'with' | 'without'>('without');
  const [savingEdit, setSavingEdit] = useState(false);

  // ── Edit order details (name / phone / place / notes / delivery charge / referral) ──
  const [showEditDetails, setShowEditDetails] = useState(false);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editPlace, setEditPlace] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editDelivery, setEditDelivery] = useState(0);
  const [editReferralCode, setEditReferralCode] = useState('');
  const [editReferralDiscount, setEditReferralDiscount] = useState(0);
  const [savingDetails, setSavingDetails] = useState(false);

  useEffect(() => { if (orderId) load(); }, [orderId]);

  async function load() {
    setLoading(true);
    try {
      const o = await ordersService.getById(orderId!);
      setOrder(o);
      if (o) {
        setEditItems(o.items.map(i => ({ ...i })));
        setEditDiscount(o.discount ?? 0);
        const cust = await customersService.getByWhatsapp(o.customerWhatsapp);
        setCustomerReferralCode(cust?.referralCode);
      }
    } finally { setLoading(false); }
  }

  async function openEdit() {
    if (products.length === 0) {
      const ps = await productsService.getActive();
      setProducts(ps);
      if (ps.length > 0) setAddProductId(ps[0].id);
    }
    setShowEdit(true);
  }

  function openEditDetails() {
    if (!order) return;
    setEditName(order.customerName);
    setEditPhone(order.customerWhatsapp);
    setEditPlace(order.customerPlace || '');
    setEditNotes(order.notes || '');
    setEditDelivery(order.deliveryCharge ?? 0);
    setEditReferralCode(order.referralCodeUsed || '');
    setEditReferralDiscount(order.referralDiscount ?? 0);
    setShowEditDetails(true);
  }

  async function saveDetails() {
    if (!order) return;
    if (!editName.trim()) return toast.error('Name cannot be empty');
    setSavingDetails(true);
    try {
      const referralDiscount = Math.max(0, editReferralDiscount);
      const deliveryCharge   = Math.max(0, editDelivery);
      // Recalculate total: subtotal − discount (items) − referralDiscount + deliveryCharge
      const newTotal = Math.max(0, order.subtotal - (order.discount ?? 0) - referralDiscount + deliveryCharge);
      const updates: Partial<Order> = {
        customerName: editName.trim(),
        customerWhatsapp: editPhone.replace(/\D/g, '').replace(/^(91|0)/, '').slice(0, 10),
        ...(editPlace.trim() ? { customerPlace: editPlace.trim() } : {}),
        notes: editNotes.trim(),
        deliveryCharge,
        ...(editReferralCode.trim() ? { referralCodeUsed: editReferralCode.trim().toUpperCase() } : {}),
        referralDiscount,
        total: newTotal,
        discount: (order.discount ?? 0),  // keep item discount unchanged
      };
      await ordersService.update(order.id, updates);
      // Sync customer name/place/phone
      if (order.customerId) {
        await customersService.update(order.customerId, {
          name: updates.customerName!,
          whatsapp: updates.customerWhatsapp!,
          ...(updates.customerPlace ? { place: updates.customerPlace } : {}),
        });
      }
      toast.success('Order details updated ✅');
      activityService.log('order_edited', `#${order.orderNumber} details updated by admin`, order.id, order.orderNumber);
      setShowEditDetails(false);
      load();
    } catch (e) {
      toast.error('Failed to save');
    } finally { setSavingDetails(false); }
  }

  function editUpdateQty(idx: number, qty: number) {
    if (qty <= 0) {
      setEditItems(prev => prev.filter((_, i) => i !== idx));
    } else {
      setEditItems(prev => prev.map((item, i) =>
        i === idx ? { ...item, quantity: qty, totalPrice: Math.ceil(qty * item.pricePerUnit / 10) * 10 } : item
      ));
    }
  }

  function editAddProduct() {
    const product = products.find(p => p.id === addProductId);
    if (!product) return;
    const qty = Number(addQty);
    if (qty <= 0) return toast.error('Enter a valid quantity');
    const garlicNote = product.hasGarlicOption
      ? (addGarlic === 'with' ? 'With Garlic' : 'Without Garlic')
      : undefined;
    const existing = editItems.findIndex(i => i.productId === product.id && i.customizationNote === (garlicNote ?? ''));
    if (existing >= 0) {
      setEditItems(prev => prev.map((item, i) =>
        i === existing
          ? { ...item, quantity: item.quantity + qty, totalPrice: Math.ceil((item.quantity + qty) * item.pricePerUnit / 10) * 10 }
          : item
      ));
    } else {
      setEditItems(prev => [...prev, {
        productId: product.id,
        productName: product.name,
        unit: product.unit,
        quantity: qty,
        pricePerUnit: product.pricePerUnit,
        totalPrice: Math.ceil(qty * product.pricePerUnit / 10) * 10,
        isOnDemand: product.isOnDemand,
        ...(garlicNote ? { customizationNote: garlicNote } : {}),
      }]);
    }
  }

  async function saveEdit() {
    if (!order) return;
    if (editItems.length === 0) return toast.error('Order must have at least one item');
    setSavingEdit(true);
    try {
      const subtotal = editItems.reduce((s, i) => s + i.totalPrice, 0);
      const discount = Math.min(editDiscount, subtotal);
      const newTotal = subtotal - discount;

      // Read the CURRENT order total fresh from Firestore to get the true baseline
      // (avoids stale React state if the page was loaded after a prior edit)
      const freshOrder = await ordersService.getById(order.id);
      const oldTotal = freshOrder?.total ?? order.total;

      await ordersService.update(order.id, {
        items: editItems,
        subtotal,
        discount,
        total: newTotal,
        hasOnDemandItems: editItems.some(i => i.isOnDemand),
      });

      // Sync customer totals using the real delta
      if (order.customerId && newTotal !== oldTotal) {
        await customersService.adjustAfterOrderEdit(order.customerId, oldTotal, newTotal, order.paymentStatus);
      }
      toast.success('Order updated ✅');
      activityService.log('order_edited', `Order #${order.orderNumber} edited — new total ₹${newTotal}`, order.id, order.orderNumber);
      setShowEdit(false);
      load();
    } catch (e) {
      toast.error('Failed to save changes');
    } finally {
      setSavingEdit(false);
    }
  }

  async function updateStatus(status: OrderStatus) {
    if (!order) return;
    await ordersService.updateStatus(order.id, status);
    toast.success(`Status → ${ORDER_STATUS_LABELS[status]}`);
    activityService.log('order_status_changed', `#${order.orderNumber} status → ${ORDER_STATUS_LABELS[status]} (${order.customerName})`, order.id, order.orderNumber);
    setLastStatusChanged(status);
    load();
  }

  async function markPaid() {
    if (!order) return;
    await ordersService.updatePayment(order.id, 'paid');
    toast.success('Marked as paid');
    activityService.log('payment_marked', `Payment marked as paid for #${order.orderNumber} (${order.customerName}) ₹${order.total}`, order.id, order.orderNumber);
    load();
  }

  async function markUnpaid() {
    if (!order) return;
    await ordersService.updatePayment(order.id, 'pending');
    toast.success('Marked as unpaid');
    activityService.log('payment_marked', `Payment reverted to pending for #${order.orderNumber} (${order.customerName})`, order.id, order.orderNumber);
    load();
  }

  async function cancelOrder() {
    if (!order) return;
    await ordersService.updateStatus(order.id, 'cancelled');
    // Restore any referral credit that was redeemed on this order
    if (order.customerId && (order.creditUsed ?? 0) > 0) {
      await customersService.addReferralCredit(order.customerId, order.creditUsed!);
      toast.success(`Order cancelled — ₹${order.creditUsed} credit restored to customer`);
    } else {
      toast.success('Order cancelled');
    }
    activityService.log('order_cancelled', `Order #${order.orderNumber} cancelled (${order.customerName})`, order.id, order.orderNumber);
    setConfirm(null);
    setLastStatusChanged('cancelled');
    load();
  }

  async function deleteOrder() {
    if (!order) return;
    // Restore any referral credit that was redeemed on this order before deleting
    if (order.customerId && (order.creditUsed ?? 0) > 0) {
      await customersService.addReferralCredit(order.customerId, order.creditUsed!);
    }
    await ordersService.delete(order.id);
    toast.success('Order deleted');
    activityService.log('order_deleted', `Order #${order.orderNumber} deleted (${order.customerName})`, order.id, order.orderNumber);
    navigate('/admin/orders');
  }

  async function saveProductionCost() {
    if (!order) return;
    setSavingCost(true);
    try {
      const updatedItems = order.items.map((item, i) => {
        const cost = itemCosts[i] ?? item.rawMaterialCost ?? 0;
        return { ...item, rawMaterialCost: cost, profitAmount: item.totalPrice - cost };
      });
      const totalProfit = updatedItems.reduce((s, i) => s + (i.profitAmount ?? 0), 0);
      await ordersService.update(order.id, { items: updatedItems, totalProfit });
      toast.success('Production cost saved ✅');
      load();
    } finally { setSavingCost(false); }
  }

  if (loading) return (
    <div className="flex justify-center items-center min-h-64">
      <div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
  if (!order) return <div className="p-6 text-gray-500">Order not found</div>;

  const storeOrigin = 'https://YOUR_DOMAIN'; // Customer storefront domain (NOT admin)

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-2xl animate-fade-in">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/admin/orders')} className="p-2 hover:bg-gray-100 rounded-lg">
          <ArrowLeft className="w-5 h-5 text-gray-600" />
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-gray-800 font-display">#{order.orderNumber}</h1>
          <p className="text-xs text-gray-500">{formatDateTime(order.createdAt)}</p>
        </div>
        {order.status !== 'cancelled' && order.status !== 'delivered' && (
          <button onClick={openEdit}
            className="flex items-center gap-1.5 border border-orange-300 text-orange-600 hover:bg-orange-50 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors">
            <Pencil className="w-3.5 h-3.5" /> Edit Order
          </button>
        )}
        <button onClick={openEditDetails}
          className="flex items-center gap-1.5 border border-gray-300 text-gray-600 hover:bg-gray-50 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors">
          <Pencil className="w-3.5 h-3.5" /> Details
        </button>
      </div>

      {/* Status & Actions */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-4">
        {/* Current status + payment */}
        <div className="flex items-center justify-between">
          <span className={`px-3 py-1 rounded-full text-sm font-medium ${ORDER_STATUS_COLORS[order.status]}`}>
            {ORDER_STATUS_LABELS[order.status]}
          </span>
          <span className={`px-3 py-1 rounded-full text-sm font-medium
            ${order.paymentStatus === 'paid' ? 'bg-green-100 text-green-700' :
              order.paymentStatus === 'na' ? 'bg-gray-100 text-gray-600' : 'bg-red-100 text-red-700'}`}>
            {order.paymentStatus === 'paid' ? '✅ Paid' : order.paymentStatus === 'na' ? 'N/A' : '💰 Payment Pending'}
          </span>
        </div>

        {/* Step 1 — Change status */}
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Step 1 — Update Status</p>
          <div className="flex gap-2 flex-wrap">
            {(['pending', 'confirmed', 'out_for_delivery', 'delivered'] as OrderStatus[]).map(s => (
              <button key={s} onClick={() => updateStatus(s)}
                disabled={order.status === s}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors
                  ${order.status === s
                    ? 'bg-orange-500 text-white border-orange-500'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-orange-300'}`}>
                {ORDER_STATUS_LABELS[s]}
              </button>
            ))}
          </div>
        </div>

        {/* Step 2 — Notify customer via your WA number */}
        <div className="border-t border-gray-100 pt-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Step 2 — Notify Customer</p>
          <p className="text-xs text-gray-400 mb-2">Opens WhatsApp on your phone. Send message to customer from your number.</p>
          <div className="flex gap-2 flex-wrap">
            {([
              { status: 'confirmed',        label: '✅ Order Confirmed',     url: buildCustomerWhatsAppUrl(order.customerWhatsapp, orderConfirmedToCustomer(order, order.agentId ? undefined : customerReferralCode, storeOrigin)) },
              { status: 'out_for_delivery', label: '🚚 Out for Delivery',  url: buildCustomerWhatsAppUrl(order.customerWhatsapp, outForDeliveryToCustomer(order)) },
              { status: 'delivered',        label: '🎉 Delivered',          url: buildCustomerWhatsAppUrl(order.customerWhatsapp, deliveredToCustomer(order, `${storeOrigin}/feedback/${order.id}`)) },
              { status: 'cancelled',        label: '❌ Cancelled',           url: buildCustomerWhatsAppUrl(order.customerWhatsapp, orderCancelledToCustomer(order)) },
            ] as const).map(({ status: s, label, url }) => (
              <a key={s} href={url} target="_blank" rel="noreferrer"
                className={`flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-medium border transition-all
                  ${lastStatusChanged === s
                    ? 'bg-green-500 text-white border-green-500 shadow-sm ring-2 ring-green-300'
                    : 'border-green-300 text-green-700 hover:bg-green-50'}`}>
                <MessageCircle className="w-3.5 h-3.5" />
                {label}
                {lastStatusChanged === s && <span className="ml-1 text-xs opacity-80">← tap now</span>}
              </a>
            ))}
          </div>
        </div>

        {order.paymentStatus !== 'na' && (
          order.paymentStatus === 'pending' && order.total > 0 ? (
            <button onClick={markPaid}
              className="w-full bg-green-500 hover:bg-green-600 text-white py-2 rounded-xl text-sm font-semibold transition-colors">
              ✅ Mark as Paid
            </button>
          ) : order.paymentStatus === 'paid' ? (
            <button onClick={markUnpaid}
              className="w-full bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 py-2 rounded-xl text-sm font-semibold transition-colors">
              ↩ Revert to Unpaid
            </button>
          ) : null
        )}
      </div>

      {/* Customer */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-2">
        <h2 className="font-semibold text-gray-800 text-sm uppercase tracking-wide text-gray-400">Customer</h2>
        <p className="font-semibold text-gray-800 text-lg">{order.customerName}</p>
        <div className="flex items-center gap-4 flex-wrap text-sm text-gray-600">
          <a href={buildWABusinessUrl(order.customerWhatsapp)} target="_blank" rel="noreferrer"
            className="flex items-center gap-1 text-green-600 hover:underline">
            📱 {order.customerWhatsapp}
          </a>
          <span>📍 {order.customerPlace}</span>
        </div>
      </div>

      {/* Items */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <h2 className="font-semibold text-gray-700 px-4 pt-4 pb-2 text-sm">Order Items</h2>
        {order.items.map((item, i) => (
          <div key={i} className={`flex items-center justify-between px-4 py-3 ${i > 0 ? 'border-t border-gray-50' : ''}`}>
            <div>
              <p className="text-sm font-medium text-gray-800">{item.productName}</p>
              <p className="text-xs text-gray-500">{formatQuantity(item.quantity, item.unit)} × ₹{item.pricePerUnit}/{item.unit}</p>
              {item.customizationNote && (
                <p className="text-xs font-medium text-amber-700">{item.customizationNote}</p>
              )}
              <span className="inline-flex items-center gap-1 mt-0.5">
                <span className="text-xs text-gray-400">👤</span>
                <select
                  value={item.handledBy ?? 'Sree Lakshmi'}
                  onChange={async e => {
                    const updatedItems = order.items.map((it, j) =>
                      j === i ? { ...it, handledBy: e.target.value } : it
                    );
                    await ordersService.update(order.id, { items: updatedItems });
                    load();
                  }}
                  className="text-xs text-blue-600 bg-transparent border-none outline-none cursor-pointer hover:underline"
                >
                  <option value="Sree Lakshmi">Sree Lakshmi</option>
                  <option value="Others">Others</option>
                  {item.handledBy && !['Sree Lakshmi','Others'].includes(item.handledBy) && (
                    <option value={item.handledBy}>{item.handledBy}</option>
                  )}
                </select>
              </span>
            </div>
            <p className="font-semibold text-gray-800">{formatCurrency(item.totalPrice)}</p>
          </div>
        ))}
        <div className="border-t border-gray-100 px-4 py-3 bg-gray-50 space-y-1">
          <div className="flex justify-between text-sm text-gray-600">
            <span>Subtotal</span><span>{formatCurrency(order.subtotal)}</span>
          </div>
          {order.discount > 0 && (
            <div className="flex justify-between text-sm text-green-600">
              <span>Discount</span><span>-{formatCurrency(order.discount)}</span>
            </div>
          )}
          {(order.referralDiscount ?? 0) > 0 && (
            <div className="flex justify-between text-sm text-purple-600">
              <span>🎟️ Referral discount
                {order.referralCodeUsed && <span className="ml-1 font-mono text-xs bg-purple-100 px-1.5 py-0.5 rounded">{order.referralCodeUsed}</span>}
              </span>
              <span>-{formatCurrency(order.referralDiscount ?? 0)}</span>
            </div>
          )}
          {(order.deliveryCharge ?? 0) > 0 && (
            <div className="flex justify-between text-sm text-blue-600">
              <span>🚚 Delivery charge</span>
              <span>+{formatCurrency(order.deliveryCharge ?? 0)}</span>
            </div>
          )}
          <div className="flex justify-between font-bold text-gray-800 text-lg pt-1 border-t border-gray-100 mt-1">
            <span>Total</span>
            <span className="text-orange-600">
              {order.type === 'sample' ? 'FREE SAMPLE' : formatCurrency(order.total)}
            </span>
          </div>
        </div>
      </div>

      {order.notes && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
          <p className="text-sm font-medium text-yellow-800">📝 Notes</p>
          <p className="text-sm text-yellow-700 mt-1">{order.notes}</p>
        </div>
      )}

      {/* Danger Zone */}
      <div className="bg-white rounded-xl border border-red-100 p-4 space-y-2">
        <p className="text-xs font-semibold text-red-400 uppercase tracking-wide">Danger Zone</p>
        <div className="flex gap-2">
          {order.status !== 'cancelled' && (
            <button
              onClick={() => setConfirm('cancel')}
              className="flex-1 flex items-center justify-center gap-1.5 border border-red-300 text-red-600
                hover:bg-red-50 py-2 rounded-xl text-sm font-medium transition-colors">
              <XCircle className="w-4 h-4" />
              Cancel Order
            </button>
          )}
          <button
            onClick={() => setConfirm('delete')}
            className="flex-1 flex items-center justify-center gap-1.5 bg-red-500 hover:bg-red-600
              text-white py-2 rounded-xl text-sm font-medium transition-colors">
            <Trash2 className="w-4 h-4" />
            Delete Order
          </button>
        </div>
      </div>

      {/* Confirm Dialog */}
      {confirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full space-y-4 shadow-xl">
            {confirm === 'cancel' ? (
              <>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center">
                    <XCircle className="w-5 h-5 text-red-500" />
                  </div>
                  <div>
                    <h3 className="font-bold text-gray-800">Cancel Order?</h3>
                    <p className="text-sm text-gray-500">#{order.orderNumber} will be marked as cancelled.</p>
                  </div>
                </div>
                <p className="text-sm text-gray-600">You can also notify the customer via WhatsApp after cancelling.</p>
                <div className="flex gap-2">
                  <button onClick={() => setConfirm(null)}
                    className="flex-1 border border-gray-200 text-gray-600 py-2.5 rounded-xl text-sm font-medium hover:bg-gray-50">
                    Keep Order
                  </button>
                  <button onClick={cancelOrder}
                    className="flex-1 bg-red-500 hover:bg-red-600 text-white py-2.5 rounded-xl text-sm font-medium">
                    Yes, Cancel
                  </button>
                </div>
                {order.customerWhatsapp && (
                  <a href={buildCustomerWhatsAppUrl(order.customerWhatsapp, orderCancelledToCustomer(order))}
                    target="_blank" rel="noreferrer"
                    className="flex items-center justify-center gap-1.5 border border-green-300 text-green-600
                      hover:bg-green-50 py-2 rounded-xl text-sm font-medium transition-colors w-full">
                    <MessageCircle className="w-4 h-4" />
                    Notify Customer on WhatsApp
                  </a>
                )}
              </>
            ) : (
              <>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center">
                    <Trash2 className="w-5 h-5 text-red-500" />
                  </div>
                  <div>
                    <h3 className="font-bold text-gray-800">Delete Order?</h3>
                    <p className="text-sm text-gray-500">This cannot be undone.</p>
                  </div>
                </div>
                <p className="text-sm text-gray-600">Order <strong>#{order.orderNumber}</strong> will be permanently removed from the database.</p>
                <div className="flex gap-2">
                  <button onClick={() => setConfirm(null)}
                    className="flex-1 border border-gray-200 text-gray-600 py-2.5 rounded-xl text-sm font-medium hover:bg-gray-50">
                    Cancel
                  </button>
                  <button onClick={deleteOrder}
                    className="flex-1 bg-red-500 hover:bg-red-600 text-white py-2.5 rounded-xl text-sm font-medium">
                    Yes, Delete
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Edit Order Details Panel (name, phone, place, notes, delivery charge) ── */}
      {showEditDetails && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
            <div className="border-b border-gray-100 px-5 py-4 flex items-center justify-between">
              <h2 className="font-bold text-gray-800">📝 Order Details — #{order.orderNumber}</h2>
              <button onClick={() => setShowEditDetails(false)} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Customer Name</label>
                <input value={editName} onChange={e => setEditName(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-orange-400" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">WhatsApp Number</label>
                <input value={editPhone} onChange={e => setEditPhone(e.target.value)}
                  placeholder="10-digit number"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-orange-400" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Place / Area</label>
                <input value={editPlace} onChange={e => setEditPlace(e.target.value)}
                  placeholder="e.g. Bangalore, JP Nagar"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-orange-400" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Notes / Instructions</label>
                <textarea value={editNotes} onChange={e => setEditNotes(e.target.value)}
                  rows={2} placeholder="Delivery notes, special requests…"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-orange-400 resize-none" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                  Delivery Charge (₹)
                  <span className="text-gray-400 font-normal ml-1">0 = free · 20 = standard</span>
                </label>
                <div className="flex items-center gap-2">
                  <input type="number" min="0" step="5" value={editDelivery}
                    onChange={e => setEditDelivery(Number(e.target.value))}
                    className="flex-1 border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-orange-400" />
                  {[0, 20, 30, 50].map(v => (
                    <button key={v} onClick={() => setEditDelivery(v)}
                      className={`flex-shrink-0 px-2.5 py-1.5 rounded-lg text-xs border transition-colors ${
                        editDelivery === v ? 'bg-orange-500 text-white border-orange-500' : 'border-gray-200 text-gray-600 hover:border-orange-300'
                      }`}>
                      ₹{v}
                    </button>
                  ))}
                </div>
              </div>

              {/* Referral — admin can fix code or override discount amount */}
              <div className="border-t border-gray-100 pt-4">
                <p className="text-xs font-semibold text-purple-500 uppercase tracking-wide mb-3">🎟️ Referral (override)</p>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Referral Code Used</label>
                    <input value={editReferralCode}
                      onChange={e => setEditReferralCode(e.target.value.toUpperCase())}
                      placeholder="e.g. SKC-PRIYA42 (leave blank to remove)"
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-purple-400 font-mono tracking-widest" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                      Referral Discount (₹)
                      <span className="text-gray-400 font-normal ml-1">subtracted from total</span>
                    </label>
                    <div className="flex items-center gap-2">
                      <input type="number" min="0" step="1" value={editReferralDiscount}
                        onChange={e => setEditReferralDiscount(Math.max(0, Number(e.target.value)))}
                        className="flex-1 border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-purple-400" />
                      {[0, 10, 12, 18, 25, 37, 56].map(v => (
                        <button key={v} onClick={() => setEditReferralDiscount(v)}
                          className={`flex-shrink-0 px-2 py-1.5 rounded-lg text-xs border transition-colors ${
                            editReferralDiscount === v ? 'bg-purple-500 text-white border-purple-500' : 'border-gray-200 text-gray-600 hover:border-purple-300'
                          }`}>
                          ₹{v}
                        </button>
                      ))}
                    </div>
                  </div>
                  {/* Live total preview */}
                  {(() => {
                    const newTotal = Math.max(0, (order.subtotal ?? 0) - (order.discount ?? 0) - editReferralDiscount + editDelivery);
                    return (
                      <div className="bg-gray-50 rounded-xl px-3 py-2.5 text-xs space-y-0.5">
                        <div className="flex justify-between text-gray-500">
                          <span>Subtotal</span><span>₹{order.subtotal}</span>
                        </div>
                        {(order.discount ?? 0) > 0 && <div className="flex justify-between text-green-600"><span>Item discount</span><span>-₹{order.discount}</span></div>}
                        {editReferralDiscount > 0 && <div className="flex justify-between text-purple-600"><span>Referral discount</span><span>-₹{editReferralDiscount}</span></div>}
                        {editDelivery > 0 && <div className="flex justify-between text-blue-600"><span>Delivery</span><span>+₹{editDelivery}</span></div>}
                        <div className="flex justify-between font-bold text-gray-800 border-t border-gray-200 pt-1 mt-1">
                          <span>New Total</span><span className="text-orange-600">₹{newTotal}</span>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>
            <div className="border-t border-gray-100 p-5 flex gap-3">
              <button onClick={() => setShowEditDetails(false)}
                className="flex-1 border border-gray-200 text-gray-600 py-3 rounded-xl text-sm font-medium hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={saveDetails} disabled={savingDetails}
                className="flex-1 bg-orange-500 hover:bg-orange-600 text-white py-3 rounded-xl text-sm font-semibold disabled:opacity-50 transition-colors">
                {savingDetails ? 'Saving…' : '💾 Save Details'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit Order Panel ─────────────────────────────────────────── */}
      {showEdit && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-xl max-h-[92vh] flex flex-col shadow-2xl">
            {/* Header */}
            <div className="border-b border-gray-100 px-5 py-4 flex items-center justify-between flex-shrink-0">
              <h2 className="font-bold text-gray-800">✏️ Edit Order #{order.orderNumber}</h2>
              <button onClick={() => setShowEdit(false)} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
            </div>

            <div className="overflow-y-auto flex-1 p-5 space-y-5">
              {/* Items */}
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Items</p>
                <div className="border border-gray-100 rounded-xl overflow-hidden">
                  {editItems.map((item, i) => (
                    <div key={i} className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? 'border-t border-gray-50' : ''}`}>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">{item.productName}</p>
                        <p className="text-xs text-gray-400">₹{item.pricePerUnit}/{item.unit}</p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => editUpdateQty(i, item.unit === 'piece' ? item.quantity - 1 : item.quantity - 50)}
                          className="p-1 hover:bg-gray-100 rounded-md">
                          <Minus className="w-3 h-3 text-gray-500" />
                        </button>
                        <input
                          type="number" min="1"
                          value={item.quantity}
                          onChange={e => editUpdateQty(i, Number(e.target.value))}
                          className="w-20 text-center border border-gray-200 rounded-lg px-2 py-1 text-sm outline-none focus:border-orange-400"
                        />
                        <span className="text-xs text-gray-400">{item.unit === 'piece' ? 'pc' : item.unit === 'kg' ? 'kg' : 'g'}</span>
                        <button onClick={() => editUpdateQty(i, item.unit === 'piece' ? item.quantity + 1 : item.quantity + 50)}
                          className="p-1 hover:bg-gray-100 rounded-md">
                          <Plus className="w-3 h-3 text-gray-500" />
                        </button>
                      </div>
                      <p className="text-sm font-bold text-gray-800 w-14 text-right">₹{item.totalPrice}</p>
                      <button onClick={() => setEditItems(prev => prev.filter((_, idx) => idx !== i))}
                        className="p-1 hover:bg-red-50 rounded-md">
                        <Trash2 className="w-4 h-4 text-red-400" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Add product */}
              {products.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Add Product</p>
                  <div className="flex gap-2">
                    <select value={addProductId} onChange={e => { setAddProductId(e.target.value); setAddGarlic('without'); }}
                      className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-orange-400 bg-white">
                      {products.map(p => (
                        <option key={p.id} value={p.id}>{p.name} — ₹{p.pricePerUnit}/{p.unit}</option>
                      ))}
                    </select>
                    <input type="number" min="1" value={addQty} onChange={e => setAddQty(Number(e.target.value))}
                      className="w-20 border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-orange-400 text-center" />
                    <button onClick={editAddProduct}
                      className="bg-orange-500 hover:bg-orange-600 text-white px-3 py-2 rounded-xl transition-colors">
                      <Plus className="w-5 h-5" />
                    </button>
                  </div>
                  {products.find(p => p.id === addProductId)?.hasGarlicOption && (
                    <div className="flex items-center gap-4 mt-1.5 px-1">
                      <span className="text-xs font-medium text-gray-600">🧄 Garlic:</span>
                      {(['without', 'with'] as const).map(opt => (
                        <label key={opt} className="flex items-center gap-1.5 cursor-pointer">
                          <input type="radio" name="edit-garlic" value={opt}
                            checked={addGarlic === opt}
                            onChange={() => setAddGarlic(opt)}
                            className="accent-orange-500 w-3.5 h-3.5" />
                          <span className="text-xs text-gray-700">{opt === 'with' ? '🧄 With Garlic' : '🚫 Without Garlic'}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Discount */}
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1">
                  <Tag className="w-3.5 h-3.5" /> Discount
                </p>
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <label className="text-xs text-gray-500 mb-1 block">Discount Amount (₹)</label>
                    <input type="number" min="0" step="1"
                      value={editDiscount || ''}
                      onChange={e => setEditDiscount(Math.max(0, Number(e.target.value)))}
                      placeholder="0"
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-orange-400" />
                  </div>
                  {editItems.length > 0 && editDiscount === 0 && (
                    <div className="flex gap-1.5 flex-wrap">
                      {[5, 10, 15, 20].map(pct => {
                        const sub = editItems.reduce((s, i) => s + i.totalPrice, 0);
                        return (
                          <button key={pct}
                            onClick={() => setEditDiscount(Math.round(sub * pct / 100))}
                            className="text-xs border border-orange-200 text-orange-600 hover:bg-orange-50 px-2 py-1 rounded-lg transition-colors">
                            {pct}%
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Live total summary */}
              {editItems.length > 0 && (() => {
                const sub = editItems.reduce((s, i) => s + i.totalPrice, 0);
                const disc = Math.min(editDiscount, sub);
                const total = sub - disc;
                return (
                  <div className="bg-gray-50 rounded-xl p-4 space-y-1.5 text-sm">
                    <div className="flex justify-between text-gray-600">
                      <span>Subtotal</span><span>{formatCurrency(sub)}</span>
                    </div>
                    {disc > 0 && (
                      <div className="flex justify-between text-green-600">
                        <span>Discount {sub > 0 ? `(${Math.round(disc / sub * 100)}%)` : ''}</span>
                        <span>−{formatCurrency(disc)}</span>
                      </div>
                    )}
                    <div className="flex justify-between font-bold text-gray-800 text-base border-t border-gray-200 pt-1.5">
                      <span>New Total</span>
                      <span className="text-orange-600">{formatCurrency(total)}</span>
                    </div>
                  </div>
                );
              })()}
            </div>

            <div className="border-t border-gray-100 p-5 flex gap-3 flex-shrink-0">
              <button onClick={() => setShowEdit(false)}
                className="flex-1 border border-gray-200 text-gray-600 py-3 rounded-xl text-sm font-medium hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={saveEdit} disabled={savingEdit}
                className="flex-1 bg-orange-500 hover:bg-orange-600 text-white py-3 rounded-xl text-sm font-semibold disabled:opacity-50 transition-colors">
                {savingEdit ? 'Saving…' : '💾 Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Production Cost Tracker — only for on-demand orders */}
      {order.hasOnDemandItems && (
        <div className="bg-white rounded-xl border border-orange-200 overflow-hidden">
          <button
            onClick={() => setShowCost(s => !s)}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-orange-50 transition-colors">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-orange-500" />
              <span className="font-semibold text-gray-800 text-sm">Production Cost & Profit</span>
              {order.totalProfit !== undefined && (
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${order.totalProfit >= 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                  {order.totalProfit >= 0 ? '+' : ''}₹{order.totalProfit.toFixed(0)}
                </span>
              )}
            </div>
            {showCost ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
          </button>

          {showCost && (
            <div className="border-t border-orange-100 p-4 space-y-3">
              <p className="text-xs text-gray-500">Enter the raw material / ingredient cost for each on-demand item to track profit.</p>

              {order.items.filter(item => item.isOnDemand).map((item) => {
                const realIdx = order.items.indexOf(item);
                const cost = itemCosts[realIdx] ?? item.rawMaterialCost ?? 0;
                const profit = item.totalPrice - cost;
                return (
                  <div key={realIdx} className="bg-gray-50 rounded-xl p-3 space-y-2">
                    <p className="text-sm font-semibold text-gray-800">{item.productName}</p>
                    <p className="text-xs text-gray-500">Selling price: ₹{item.totalPrice} ({formatQuantity(item.quantity, item.unit)})</p>
                    <div className="flex items-center gap-3">
                      <div className="flex-1">
                        <label className="block text-xs text-gray-500 mb-1">Ingredient / Material Cost (₹)</label>
                        <input
                          type="number" min="0" step="1"
                          value={cost || ''}
                          onChange={e => setItemCosts(c => ({ ...c, [realIdx]: parseFloat(e.target.value) || 0 }))}
                          placeholder="0"
                          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-orange-400"
                        />
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-gray-500 mb-1">Profit</p>
                        <p className={`text-base font-bold ${profit >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                          {profit >= 0 ? '+' : ''}₹{profit.toFixed(0)}
                        </p>
                      </div>
                    </div>
                    {cost > 0 && (
                      <div className="text-xs text-gray-400">
                        Margin: {((profit / item.totalPrice) * 100).toFixed(1)}%
                        {profit < 0 && <span className="text-red-500 font-medium ml-2">⚠️ Selling below cost! Consider updating price.</span>}
                      </div>
                    )}
                  </div>
                );
              })}

              <button onClick={saveProductionCost} disabled={savingCost}
                className="w-full bg-orange-500 hover:bg-orange-600 text-white py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50">
                {savingCost ? 'Saving…' : '💾 Save Production Cost'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

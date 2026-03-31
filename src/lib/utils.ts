import type { Order } from './types';
import { WHATSAPP_NUMBER, UPI_ID, BUSINESS_NAME } from './constants';
import { APP_CONFIG } from '../config';

/** Strip +91 / 0 prefix and non-digits — return bare 10-digit mobile number */
export function normalizeWhatsapp(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0'))  return digits.slice(1);
  return digits;
}

export function buildWhatsAppUrl(phone: string, message: string): string {
  const clean = phone.replace(/\D/g, '');
  const number = clean.startsWith('91') ? clean : `91${clean}`;
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}

// Opens WA to admin number
export function buildAdminWhatsAppUrl(message: string): string {
  return buildWhatsAppUrl(WHATSAPP_NUMBER, message);
}

// Opens WA to customer number
export function buildCustomerWhatsAppUrl(customerWhatsapp: string, message: string): string {
  return buildWhatsAppUrl(customerWhatsapp, message);
}

// Opens WA group invite link (group itself handles sending)
export function buildGroupShareUrl(message: string): string {
  // We can't directly post to a WA group via link API; best we can do is open WA app with the message
  // so the admin can forward it. Using admin number as fallback for the message.
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}

export function buildUPILink(amount: number, orderId: string): string {
  return `upi://pay?pa=${UPI_ID}&pn=${encodeURIComponent(BUSINESS_NAME)}&am=${amount}&tn=${encodeURIComponent(`Order ${orderId}`)}&cu=INR`;
}

export function buildUPIGPayLink(amount: number, orderId: string): string {
  return `gpay://upi/pay?pa=${UPI_ID}&pn=${encodeURIComponent(BUSINESS_NAME)}&am=${amount}&tn=${encodeURIComponent(`Order ${orderId}`)}&cu=INR`;
}

// Sent TO CUSTOMER confirming their order
export function orderConfirmedToCustomer(order: Order): string {
  const items = order.items
    .map(i => `  • ${i.productName}: ${formatQuantity(i.quantity, i.unit)} = ₹${i.totalPrice}`)
    .join('\n');
  return `🙏 *Hare Krishna!* 🪷

Hi *${order.customerName}*, your order is confirmed! 🎉

Order No: *#${order.orderNumber}*

*Items:*
${items}
${order.discount > 0 ? `\nDiscount: -₹${order.discount}` : ''}
*Total: ₹${order.total}*
${order.type === 'sample' ? '\n✅ This is a *FREE SAMPLE* — no payment needed.' : ''}

We will keep you updated on your order.
Thank you for choosing ${BUSINESS_NAME}! 🌿`;
}

// Sent TO CUSTOMER when out for delivery
export function outForDeliveryToCustomer(order: Order): string {
  const upiLink = buildUPILink(order.total, order.orderNumber);
  return `🙏 *Hare Krishna!* 🪷

Hi *${order.customerName}*, your order is on the way! 🚀

Order No: *#${order.orderNumber}*
${order.type === 'sample' ? '\n✅ FREE SAMPLE — no payment needed.' : `\n💳 *Payment Due: ₹${order.total}*

Pay via GPay / PhonePe / any UPI app:
📲 UPI ID: \`${APP_CONFIG.UPI_ID}\`
🔗 Tap to pay (Android): ${upiLink}`}

Thank you for choosing ${BUSINESS_NAME}! 🌿
_Pure • Fresh • Handcrafted with Love_ 🙏`;
}

// Sent TO CUSTOMER after delivery
export function deliveredToCustomer(order: Order, feedbackUrl: string): string {
  return `🙏 *Hare Krishna!* 🪷

Hi *${order.customerName}*, your order has been delivered! 🎉

Order No: *#${order.orderNumber}*

We hope you love our products! 🙏

📝 *Please share your feedback* (takes 30 seconds):
${feedbackUrl}

💬 *Join our WhatsApp group* for offers & updates:
${APP_CONFIG.WHATSAPP_GROUP_LINK}

${BUSINESS_NAME} — Pure & Healthy 🌿`;
}

// Alert sent TO ADMIN when new order arrives — includes console link to action it
export function newOrderAlertToAdmin(order: Order, consoleBaseUrl: string): string {
  const items = order.items
    .map(i => `  • ${i.productName}: ${formatQuantity(i.quantity, i.unit)} = ₹${i.totalPrice}`)
    .join('\n');
  const consoleLink = `${consoleBaseUrl}/admin/orders/${order.id}`;
  return `🔔 *New ${order.type === 'sample' ? 'SAMPLE ' : ''}Order — ${BUSINESS_NAME}*

Order No: *#${order.orderNumber}*
Customer: ${order.customerName}
WhatsApp: ${order.customerWhatsapp}
Place: ${order.customerPlace || '—'}

*Items:*
${items}

*Total: ${order.type === 'sample' ? 'FREE SAMPLE' : `₹${order.total}`}*
${order.notes ? `\nNotes: ${order.notes}\n` : ''}
🔗 Open in console:
${consoleLink}`;
}

// Short alert for the ORDER TRACKING GROUP — just enough info + admin link
export function newOrderAlertToGroup(order: Order, adminBaseUrl: string): string {
  const adminLink = `${adminBaseUrl}/admin/orders/${order.id}`;
  return `🛒 *New ${order.type === 'sample' ? 'Sample ' : ''}Order #${order.orderNumber}*
👤 ${order.customerName} | 📱 ${order.customerWhatsapp} | 📍 ${order.customerPlace || '—'}
💰 ${order.type === 'sample' ? 'FREE SAMPLE' : `₹${order.total}`}

🔗 ${adminLink}`;
}

// Short status update for the group — admin link is the main action
export function statusChangeAlertToGroup(order: Order, newStatus: string, adminBaseUrl: string): string {
  const statusEmoji: Record<string, string> = {
    confirmed: '✅', out_for_delivery: '🚚', delivered: '🎉', cancelled: '❌',
  };
  const statusLabel: Record<string, string> = {
    confirmed: 'Confirmed', out_for_delivery: 'Out for Delivery',
    delivered: 'Delivered', cancelled: 'Cancelled',
  };
  const emoji = statusEmoji[newStatus] ?? '🔄';
  const label = statusLabel[newStatus] ?? newStatus;
  const adminLink = `${adminBaseUrl}/admin/orders/${order.id}`;
  return `${emoji} Order #${order.orderNumber} — *${label}*
👤 ${order.customerName} | 💰 ₹${order.total}

🔗 ${adminLink}`;
}

// Sent TO CUSTOMER when order is cancelled
export function orderCancelledToCustomer(order: Order): string {
  return `❌ *${BUSINESS_NAME}*

Hi *${order.customerName}*, your order *#${order.orderNumber}* has been cancelled.

If you have any questions, please reach out to us on WhatsApp.

Sorry for the inconvenience. We hope to serve you soon! 🙏
${BUSINESS_NAME} — Pure & Healthy 🌿`;
}

// Friendly payment reminder sent to customer
export function paymentReminderToCustomer(order: Order): string {
  const items = order.items
    .map(i => `  • ${i.productName}: ${formatQuantity(i.quantity, i.unit)} = ₹${i.totalPrice}`)
    .join('\n');
  const upiLink = buildUPILink(order.total, order.orderNumber);
  return `🙏 *Hare Krishna!* 🪷

Hi *${order.customerName}*, hope you're enjoying your order! 😊

Just a gentle reminder that payment of *₹${order.total}* is pending for your order *#${order.orderNumber}*.

*Order Summary:*
${items}${order.discount > 0 ? `\nDiscount: -₹${order.discount}` : ''}
*Total Due: ₹${order.total}*

Pay via GPay / PhonePe / any UPI app:
📲 UPI ID: \`${APP_CONFIG.UPI_ID}\`
🔗 Tap to pay (Android): ${upiLink}

Thank you so much! 🙏
_${BUSINESS_NAME} — Pure • Fresh • Handcrafted_`;
}

// Keep old names as aliases so nothing breaks
export const orderPlacedMessage = (order: Order) => newOrderAlertToAdmin(order, typeof window !== 'undefined' ? window.location.origin : '');
export const outForDeliveryMessage = outForDeliveryToCustomer;
export const deliveredMessage = (order: Order) => deliveredToCustomer(order, `${typeof window !== 'undefined' ? window.location.origin : ''}/feedback/${order.id}`);

export function formatQuantity(qty: number, unit: string): string {
  if (unit === 'piece') return `${qty} pc${qty !== 1 ? 's' : ''}`;
  if (unit === 'kg') return `${qty} kg`;
  if (qty >= 1000) return `${(qty / 1000).toFixed(2).replace(/\.?0+$/, '')} kg`;
  return `${qty} g`;
}

export function formatCurrency(amount: number): string {
  return `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

export function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function generateOrderNumber(): string {
  const now = new Date();
  const y = now.getFullYear().toString().slice(2);
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const r = Math.floor(Math.random() * 9000) + 1000;
  return `SKC${y}${m}${d}${r}`;
}

/** Generate a unique referral code from customer name, e.g. "Pavan Naik" → SKC-PAVAN47 */
export function generateReferralCode(name: string): string {
  const slug = name.trim().split(' ')[0].toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6);
  const suffix = Math.floor(Math.random() * 90) + 10; // 10–99
  return `SKC-${slug}${suffix}`;
}

/**
 * Compute referral discount with 3 tiers.
 * Total discount is split: 75% to the referrer (credit added to account), 25% to the new customer (price off).
 *
 * Tiers:
 *   ₹1   – ₹499    → 3%   total, no cap
 *   ₹500 – ₹999    → 5%   total, max ₹50 total
 *   ₹1000+          → 7.5% total, max ₹100 total
 *
 * Split: referrer gets 75%, new customer gets 25%.
 * Returns: { total, customerDiscount (25%), referrerCredit (75%) }
 */
export function computeReferralDiscount(subtotal: number): {
  total: number; customerDiscount: number; referrerCredit: number;
} {
  if (subtotal <= 0) return { total: 0, customerDiscount: 0, referrerCredit: 0 };
  let raw: number;
  if (subtotal < 500) {
    raw = Math.round(subtotal * 0.03);
  } else if (subtotal < 1000) {
    raw = Math.min(Math.round(subtotal * 0.05), 50);
  } else {
    raw = Math.min(Math.round(subtotal * 0.075), 100);
  }
  const referrerCredit   = Math.round(raw * 0.75);  // referrer gets 75%
  const customerDiscount = raw - referrerCredit;     // new customer gets 25%, avoids rounding drift
  return { total: raw, customerDiscount, referrerCredit };
}

/**
 * Compute how much referral credit a returning customer can redeem on an order.
 * Cap: min of (available credit, 10% of subtotal, ₹75 max per order).
 * This is separate from the referral code discount — only one can apply at a time.
 */
export function computeCreditRedemption(availableCredit: number, subtotal: number): number {
  if (availableCredit <= 0 || subtotal <= 0) return 0;
  const cap = Math.min(Math.round(subtotal * 0.10), 75);  // max 10% of order or ₹75
  return Math.min(availableCredit, cap);
}

/**
 * WhatsApp message a customer sends to their friends to refer them.
 * Pre-populates the referral code so the friend just taps the link.
 */
export function referralShareMessage(customerName: string, referralCode: string, storeUrl: string): string {
  const refLink = `${storeUrl}?ref=${referralCode}`;
  return `🙏 *Hare Krishna!* 🪷

Try *Sri Krishna Condiments* — fresh homemade Karnataka condiments (Chutney Powders, Masalas, Health Mixes). Made with love! 🌿

🎁 Use my referral link and get an instant discount on your first order:
👉 ${refLink}

Highly recommended by *${customerName}* 😊`;
}

export function generateBatchNumber(): string {
  const now = new Date();
  const y = now.getFullYear().toString().slice(2);
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const r = Math.floor(Math.random() * 900) + 100;
  return `BATCH${y}${m}${d}-${r}`;
}

export function getMonthRange(date = new Date()): { start: string; end: string } {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59);
  return {
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

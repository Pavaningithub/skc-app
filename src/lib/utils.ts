import type { Order, ReferralTier } from './types';
import { DEFAULT_REFERRAL_CONFIG } from './types';
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

/**
 * Admin-side WA links use api.whatsapp.com/send so the OS prompts to open
 * WhatsApp Business (rather than regular WhatsApp) when both are installed.
 */
export function buildWABusinessUrl(phone: string, message?: string): string {
  const clean = phone.replace(/\D/g, '');
  const number = clean.startsWith('91') ? clean : `91${clean}`;
  const base = `https://api.whatsapp.com/send?phone=${number}`;
  return message ? `${base}&text=${encodeURIComponent(message)}` : base;
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

/** WA message sent to customer requesting payment for a subscription month */
export function subscriptionPaymentRequest(
  customerName: string,
  subNumber: string,
  monthLabel: string,
  amount: number,
  upiId: string,
  isUpfront = false,
  durationMonths = 3
): string {
  const amountLine = isUpfront
    ? `💳 Upfront total (${durationMonths} months): ₹${amount * durationMonths}`
    : `💰 Amount due for ${monthLabel}: ₹${amount}`;
  return (
    `🌿 *Sri Krishna Condiments — Subscription Payment*\n\n` +
    `Hi ${customerName}! Your Health Mix Subscription is confirmed 🎉\n\n` +
    `📋 Sub #${subNumber}\n` +
    `📅 Period: ${monthLabel}\n` +
    `${amountLine}\n\n` +
    `💳 *UPI Payment:*\n` +
    `UPI ID: ${upiId}\n` +
    `GPay / PhonePe / Paytm — pay to this ID\n\n` +
    `Once you pay, please send us the screenshot on WhatsApp.\n` +
    `We'll confirm and start/continue your delivery. 🙏\n\n` +
    `— Sri Krishna Condiments 🪷`
  );
}

// Sent TO CUSTOMER confirming their order
export function orderConfirmedToCustomer(order: Order, referralCode?: string, storeUrl?: string): string {
  const items = order.items
    .map(i => `  • ${i.productName}: ${formatQuantity(i.quantity, i.unit)} = ₹${i.totalPrice}`)
    .join('\n');
  const referralLine = referralCode
    ? `\n\n🎁 *Refer a friend & earn store credit!*\nShare your link: ${storeUrl ?? 'https://YOUR_DOMAIN'}?ref=${referralCode}`
    : '';
  return `🙏 *Hare Krishna!* 🪷

Hi *${order.customerName}*, your order is confirmed! 🎉

Order No: *${order.orderNumber}*

*Items:*
${items}
${order.discount > 0 ? `\nDiscount: -₹${order.discount}` : ''}
*Total: ${order.type === 'sample' && order.total === 0 ? 'FREE SAMPLE' : `₹${order.total}`}*
${order.type === 'sample' && order.total === 0 ? '\n✅ This is a *FREE SAMPLE* — no payment needed.' : order.type === 'sample' && order.total > 0 ? `\n💳 *Sample Charge: ₹${order.total}* — payment due on delivery.` : ''}

We will keep you updated on your order.
Thank you for choosing ${BUSINESS_NAME}! 🌿${referralLine}`;
}

// Sent TO CUSTOMER when out for delivery
export function outForDeliveryToCustomer(order: Order): string {
  return `🙏 *Hare Krishna!* 🪷

Hi *${order.customerName}*, your order is on the way! 🚀

Order No: *${order.orderNumber}*
${order.type === 'sample' && order.total === 0
  ? '\n✅ FREE SAMPLE — no payment needed.'
  : `\n💳 *Payment Due: ₹${order.total}*${order.type === 'sample' ? ' (sample charge)' : ''}

Pay via GPay / PhonePe / any UPI app:
📲 UPI ID: *${APP_CONFIG.UPI_ID}*`}

Thank you for choosing ${BUSINESS_NAME}! 🌿
_Pure • Fresh • Handcrafted with Love_ 🙏`;
}

// Sent TO CUSTOMER after delivery
export function deliveredToCustomer(order: Order, feedbackUrl: string): string {
  return `🙏 *Hare Krishna!* 🪷

Hi *${order.customerName}*, your order has been delivered! 🎉

Order No: *${order.orderNumber}*

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

Order No: *${order.orderNumber}*
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

Hi *${order.customerName}*, your order *${order.orderNumber}* has been cancelled.

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

Just a gentle reminder that payment of *₹${order.total}* is pending for your order *${order.orderNumber}*.

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
export const deliveredMessage = (order: Order) => deliveredToCustomer(order, `https://YOUR_DOMAIN/feedback/${order.id}`);

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

/** Generate subscription order number — SUB prefix to distinguish from regular orders */
export function generateSubscriptionOrderNumber(): string {
  const now = new Date();
  const y = now.getFullYear().toString().slice(2);
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const r = Math.floor(Math.random() * 9000) + 1000;
  return `SUB${y}${m}${d}${r}`;
}

/** Generate a unique referral code from customer name, e.g. "Pavan Naik" → SKC-PAVAN47 */
export function generateReferralCode(name: string): string {
  const slug = name.trim().split(' ')[0].toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6);
  const suffix = Math.floor(Math.random() * 90) + 10; // 10–99
  return `SKC-${slug}${suffix}`;
}

/**
 * Compute referral discount from dynamic tiers.
 * tiers: sorted by minOrder ascending (gaps/overlaps not validated here — admin saves valid data).
 * splitReferrerPct: % of total going to referrer (rest to friend as discount).
 */
export function computeReferralDiscountFromTiers(
  subtotal: number,
  tiers: ReferralTier[],
  splitReferrerPct: number,
): { total: number; customerDiscount: number; referrerCredit: number } {
  if (subtotal <= 0 || tiers.length === 0)
    return { total: 0, customerDiscount: 0, referrerCredit: 0 };

  // Find the matching tier (last one whose minOrder ≤ subtotal)
  const tier = [...tiers]
    .sort((a, b) => a.minOrder - b.minOrder)
    .reverse()
    .find(t => subtotal >= t.minOrder && (t.maxOrder === null || subtotal < t.maxOrder));

  if (!tier) return { total: 0, customerDiscount: 0, referrerCredit: 0 };

  let raw = Math.floor(subtotal * (tier.pct / 100));
  if (tier.cap !== null) raw = Math.min(raw, tier.cap);

  const referrerCredit   = Math.floor(raw * (splitReferrerPct / 100));
  const customerDiscount = raw - referrerCredit;
  return { total: raw, customerDiscount, referrerCredit };
}

/**
 * Backward-compatible wrapper using default hardcoded tiers.
 * All new code should use computeReferralDiscountFromTiers with live config.
 */
export function computeReferralDiscount(subtotal: number): {
  total: number; customerDiscount: number; referrerCredit: number;
} {
  return computeReferralDiscountFromTiers(
    subtotal,
    DEFAULT_REFERRAL_CONFIG.tiers,
    DEFAULT_REFERRAL_CONFIG.splitReferrerPct,
  );
}

/**
 * Compute how much referral credit a returning customer can redeem on an order.
 * Cap: min of (available credit, 10% of subtotal, ₹75 max per order).
 * This is separate from the referral code discount — only one can apply at a time.
 */
export function computeCreditRedemption(
  availableCredit: number,
  subtotal: number,
  redemptionPct = 10,   // % of subtotal that can be redeemed (default: 10%)
  redemptionCap = 75,   // hard ₹ cap per order (default: ₹75)
): number {
  if (availableCredit <= 0 || subtotal <= 0) return 0;
  const cap = Math.min(Math.floor(subtotal * redemptionPct / 100), redemptionCap);
  return Math.min(availableCredit, cap);
}

/**
 * WhatsApp message a customer sends to their friends to refer them.
 * topTierHint: optional string like 'up to ₹25 off on orders ₹1000+'
 */
export function referralShareMessage(
  customerName: string,
  referralCode: string,
  storeUrl: string,
  topTierHint?: string,
): string {
  const refLink = `${storeUrl}?ref=${referralCode}`;
  const discountLine = topTierHint
    ? `🎁 Use my referral link and get *${topTierHint}* on your first order:`
    : `🎁 Use my referral link and get an instant discount on your first order:`;
  return `🙏 *Hare Krishna!* 🪷

Try *Sri Krishna Condiments* 🌿 — fresh homemade Karnataka condiments (Chutney Powders, Masalas, Health Mixes). Made with love!

${discountLine}
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

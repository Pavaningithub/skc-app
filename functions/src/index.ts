import {setGlobalOptions} from "firebase-functions";
import {onDocumentCreated} from "firebase-functions/v2/firestore";
import {defineSecret} from "firebase-functions/params";
import * as logger from "firebase-functions/logger";

setGlobalOptions({maxInstances: 10, region: "asia-south1"});

const TELEGRAM_BOT_TOKEN = defineSecret("TELEGRAM_BOT_TOKEN");
const TELEGRAM_CHAT_ID = defineSecret("TELEGRAM_CHAT_ID");

const ADMIN_BASE_URL = "https://skctreats.in/admin/orders";
const ADMIN_SUBS_URL = "https://skctreats.in/admin/subscriptions";
const WA_GROUP_LINK = "https://chat.whatsapp.com/GnLnmfvY8gqJpxu6EcVkkL";

interface OrderItem {
  productName: string;
  quantity: number;
  unit: string;
  total: number;
}

interface Order {
  orderNumber: string;
  customerName: string;
  customerWhatsapp: string;
  customerPlace: string;
  items: OrderItem[];
  subtotal: number;
  discount: number;
  total: number;
  referralCodeUsed?: string;
  notes?: string;
  type?: string;
}

async function sendTelegram(token: string, chatId: string, text: string, buttons?: object[][]): Promise<void> {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
  };
  if (buttons && buttons.length > 0) {
    body.reply_markup = {inline_keyboard: buttons};
  }
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Telegram API error: ${err}`);
  }
}

// Fires whenever a new document is created in the 'orders' collection
export const notifyNewOrder = onDocumentCreated(
  {
    document: "orders/{orderId}",
    secrets: [TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID],
    region: "asia-south1",
  },
  async (event) => {
    const order = event.data?.data() as Order | undefined;
    const orderId = event.params.orderId;

    if (!order) {
      logger.warn("notifyNewOrder: no order data", {orderId});
      return;
    }

    // Format items list — no pricing
    const itemLines = (order.items ?? [])
      .map((i) => `  • ${i.productName} × ${i.quantity} ${i.unit}`)
      .join("\n");

    // Format phone for display
    const phone = order.customerWhatsapp
      ? `+91 ${order.customerWhatsapp.slice(0, 5)} ${order.customerWhatsapp.slice(5)}`
      : "—";

    // Build message
    const isSample = order.type === "sample";
    const emoji = isSample ? "🎁" : "🛒";
    const orderLabel = isSample ? "Sample Request" : "New Order";
    const adminLink = `${ADMIN_BASE_URL}/${orderId}`;

    // ── Telegram message (HTML) ───────────────────────────────────────────────
    const telegramLines = [
      `${emoji} <b>${orderLabel} — ${order.orderNumber}</b>`,
      "",
      `👤 <b>${order.customerName}</b>`,
      `📞 ${phone}`,
      `📍 ${order.customerPlace || "—"}`,
      "",
      "<b>Items:</b>",
      itemLines,
      order.notes ? `📝 ${order.notes}` : "",
      "",
      `💰 ${isSample ? "FREE SAMPLE" : `₹${order.total}`}`,
    ].filter(Boolean).join("\n");

    // ── WA group message — short plain text so URL stays under Telegram's 2048-char button limit ──
    const shortName = order.customerName.slice(0, 10);
    const waLines = [
      `${emoji} ${orderLabel} — ${order.orderNumber}`,
      `👤 ${shortName}  📞 ${phone}`,
      `📍 ${order.customerPlace || "—"}`,
      itemLines,
      `💰 ${isSample ? "FREE SAMPLE" : `₹${order.total}`}`,
      order.notes ? `📝 ${order.notes}` : "",
    ].filter(Boolean).join("\n");

    const waUrl = `https://wa.me/?text=${encodeURIComponent(waLines)}`;

    // ── Inline keyboard buttons ───────────────────────────────────────────────
    const buttons = [
      [{text: "📋 Open in Admin", url: adminLink}],
      [
        {text: "📲 Share to WA Group", url: waUrl},
        {text: "🔗 Join WA Group", url: WA_GROUP_LINK},
      ],
    ];

    try {
      await sendTelegram(
        TELEGRAM_BOT_TOKEN.value(),
        TELEGRAM_CHAT_ID.value(),
        telegramLines,
        buttons
      );
      logger.info("Telegram notification sent", {orderId, orderNumber: order.orderNumber});
    } catch (err) {
      logger.error("Failed to send Telegram notification", {orderId, err});
    }
  }
);

interface SubscriptionItem {
  productName: string;
  quantity: number;
  unit: string;
  totalPrice: number;
}

interface SubscriptionDoc {
  subscriptionNumber?: string;
  customerName: string;
  customerWhatsapp: string;
  customerPlace?: string;
  items: SubscriptionItem[];
  duration: string;
  paymentMode?: string;
  discountPercent: number;
  baseAmount: number;
  discountedAmount: number;
  startDate: string;
  endDate: string;
  notes?: string;
}

// Fires whenever a new document is created in the 'subscriptions' collection
export const notifyNewSubscription = onDocumentCreated(
  {
    document: "subscriptions/{subId}",
    secrets: [TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID],
    region: "asia-south1",
  },
  async (event) => {
    const sub = event.data?.data() as SubscriptionDoc | undefined;
    const subId = event.params.subId;

    if (!sub) {
      logger.warn("notifyNewSubscription: no data", {subId});
      return;
    }

    const phone = sub.customerWhatsapp
      ? `+91 ${sub.customerWhatsapp.slice(0, 5)} ${sub.customerWhatsapp.slice(5)}`
      : "—";

    const durationMonths = sub.duration === "6months" ? 6 : 3;
    const paymentLabel = sub.paymentMode === "monthly" ? "Monthly" : "Upfront";
    const subNum = sub.subscriptionNumber ?? subId.slice(0, 8).toUpperCase();

    const itemLines = (sub.items ?? [])
      .map((i) => `  • ${i.productName} × ${i.quantity}g — ₹${i.totalPrice}/mo`)
      .join("\n");

    const adminLink = `${ADMIN_SUBS_URL}`;

    const telegramText = [
      `🌿 <b>New Subscription — ${subNum}</b>`,
      "",
      `👤 <b>${sub.customerName}</b>`,
      `📞 ${phone}`,
      sub.customerPlace ? `📍 ${sub.customerPlace}` : "",
      "",
      `📅 Plan: <b>${durationMonths}-Month | ${paymentLabel}</b>`,
      `🏷 Discount: ${sub.discountPercent}%`,
      "",
      "<b>Products / Month:</b>",
      itemLines,
      "",
      `💰 Monthly: ₹${sub.discountedAmount}  (was ₹${sub.baseAmount})`,
      sub.paymentMode === "upfront"
        ? `💳 Upfront total: ₹${sub.discountedAmount * durationMonths}`
        : `📅 Pay ₹${sub.discountedAmount} each month`,
      sub.notes ? `📝 ${sub.notes}` : "",
    ].filter(Boolean).join("\n");

    const buttons = [
      [{text: "📋 Open Subscriptions", url: adminLink}],
    ];

    try {
      await sendTelegram(
        TELEGRAM_BOT_TOKEN.value(),
        TELEGRAM_CHAT_ID.value(),
        telegramText,
        buttons
      );
      logger.info("Subscription Telegram notification sent", {subId, subNum});
    } catch (err) {
      logger.error("Failed to send subscription Telegram notification", {subId, err});
    }
  }
);

import * as admin from "firebase-admin";
import {setGlobalOptions} from "firebase-functions";
import {onDocumentCreated} from "firebase-functions/v2/firestore";
import {onRequest} from "firebase-functions/v2/https";
import {defineSecret, defineString} from "firebase-functions/params";
import * as logger from "firebase-functions/logger";

admin.initializeApp();
const db = admin.firestore();

setGlobalOptions({maxInstances: 10, region: "asia-south1"});

const TELEGRAM_BOT_TOKEN = defineSecret("TELEGRAM_BOT_TOKEN");
const TELEGRAM_CHAT_ID = defineSecret("TELEGRAM_CHAT_ID");
const UPI_ID_PARAM = defineString("UPI_ID", {default: ""});
const WA_GROUP_LINK_PARAM = defineString("WA_GROUP_LINK", {default: ""});
const APP_DOMAIN_PARAM = defineString("APP_DOMAIN", {default: ""});


const ADMIN_BASE_URL = () => `https://${APP_DOMAIN_PARAM.value()}/admin/orders`;
const ADMIN_SUBS_URL = () => `https://${APP_DOMAIN_PARAM.value()}/admin/subscriptions`;
const STORE_URL = () => `https://${APP_DOMAIN_PARAM.value()}`;

// ─── Shared types ────────────────────────────────────────────────────────────

interface OrderItem {
  productName: string;
  quantity: number;
  unit: string;
  total: number;
  customizationNote?: string;
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
  status?: string;
  paymentStatus?: string;
  referralCodeUsed?: string;
  notes?: string;
  type?: string;
}

type InlineButton = {text: string; callback_data?: string; url?: string};

// ─── Telegram helpers ─────────────────────────────────────────────────────────

async function sendTelegram(
  token: string,
  chatId: string,
  text: string,
  buttons?: InlineButton[][]
): Promise<{message_id: number} | null> {
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
  const json = (await res.json()) as {ok: boolean; result?: {message_id: number}};
  return json.result ?? null;
}

async function editTelegramMessage(
  token: string,
  chatId: string,
  messageId: number,
  text: string,
  buttons?: InlineButton[][]
): Promise<void> {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "HTML",
  };
  if (buttons && buttons.length > 0) {
    body.reply_markup = {inline_keyboard: buttons};
  }
  await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify(body),
  });
}

async function answerCallbackQuery(token: string, callbackQueryId: string, text?: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({callback_query_id: callbackQueryId, text, show_alert: false}),
  });
}

// ─── Order message builder ────────────────────────────────────────────────────

const STATUS_EMOJI: Record<string, string> = {
  pending: "🕐",
  confirmed: "✅",
  out_for_delivery: "🚚",
  delivered: "🎉",
  cancelled: "❌",
};
const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  out_for_delivery: "Out for Delivery",
  delivered: "Delivered",
  cancelled: "Cancelled",
};
const PAY_EMOJI: Record<string, string> = {pending: "💸", paid: "💰", na: "🎁"};
const PAY_LABEL: Record<string, string> = {pending: "Unpaid", paid: "Paid", na: "N/A"};

function buildOrderTelegramText(order: Order, orderId: string, isNew = false): string {
  const itemLines = (order.items ?? [])
    .map((i) => {
      const note = i.customizationNote ? ` (${i.customizationNote})` : "";
      return `  • ${i.productName} × ${i.quantity} ${i.unit}${note}`;
    })
    .join("\n");

  const phone = order.customerWhatsapp
    ? `+91 ${order.customerWhatsapp.slice(0, 5)} ${order.customerWhatsapp.slice(5)}`
    : "—";

  const isSample = order.type === "sample";
  const emoji = isSample ? "🎁" : "🛒";
  const orderLabel = isSample ? "Sample Request" : "New Order";
  const headerLabel = isNew ? orderLabel : "Order";

  const status = order.status ?? "pending";
  const payStatus = order.paymentStatus ?? (isSample && order.total === 0 ? "na" : "pending");
  const statusLine = `📋 Status: <b>${STATUS_EMOJI[status] ?? "🔄"} ${STATUS_LABEL[status] ?? status}</b>`;
  const payLine = `💳 Payment: <b>${PAY_EMOJI[payStatus] ?? "💸"} ${PAY_LABEL[payStatus] ?? payStatus}</b>`;

  return [
    `${emoji} <b>${headerLabel} — ${order.orderNumber}</b>`,
    "",
    `👤 <b>${order.customerName}</b>`,
    `📞 ${phone}`,
    `📍 ${order.customerPlace || "—"}`,
    "",
    "<b>Items:</b>",
    itemLines,
    order.notes ? `\n📝 <b>Note:</b> ${order.notes}` : null,
    isSample ? "\n🎁 FREE SAMPLE" : `\n💰 Total: ₹${order.total}`,
    "",
    statusLine,
    payLine,
  ].filter((l) => l !== null && l !== undefined).join("\n");
}

function buildOrderActionButtons(orderId: string, order: Order): InlineButton[][] {
  const isSample = order.type === "sample";
  const adminLink = `${ADMIN_BASE_URL()}/${orderId}`;

  // WA group share line
  const phone = order.customerWhatsapp ?? "";
  const waGroupLines = [
    `${isSample ? "🎁" : "🛒"} ${isSample ? "Sample" : "Order"} — ${order.orderNumber}`,
    `👤 ${order.customerName}  📞 +91 ${phone.slice(0, 5)} ${phone.slice(5)}`,
    `📍 ${order.customerPlace || "—"}`,
    (order.items ?? []).map((i) => `  • ${i.productName} × ${i.quantity} ${i.unit}`).join("\n"),
    isSample ? "🎁 FREE SAMPLE" : `💰 ₹${order.total}`,
  ].filter(Boolean).join("\n");
  const waGroupUrl = `https://wa.me/?text=${encodeURIComponent(waGroupLines)}`;

  // WA direct customer message — use wa.me (more reliable than api.whatsapp.com/send on mobile)
  const buildWaCustomerUrl = (msg: string) =>
    phone ? `https://wa.me/91${phone}?text=${encodeURIComponent(msg)}` : null;

  const upiId = UPI_ID_PARAM.value();

  // Items list for confirmed message
  const itemsList = (order.items ?? [])
    .map((i) => `  • ${i.productName}: ${i.quantity}${i.unit !== "piece" ? "g" : " pc"}`)
    .join("\n");
  const discountLine = (order.discount ?? 0) > 0 ? `\nDiscount: -₹${order.discount}` : "";

  // ── Message templates (mirrors utils.ts exactly) ──────────────────────────

  const confirmedMsg = [
    "🙏 *Hare Krishna!* 🪷",
    "",
    `Hi *${order.customerName}*, your order is confirmed! 🎉`,
    "",
    `Order No: *#${order.orderNumber}*`,
    "",
    "*Items:*",
    itemsList,
    discountLine,
    `*Total: ${order.type === "sample" && order.total === 0 ? "FREE SAMPLE" : `₹${order.total}`}*`,
    "",
    "We will keep you updated on your order.",
    `Thank you for choosing Sri Krishna Condiments! 🌿`,
  ].filter((l) => l !== null).join("\n");

  const ofdPayBlock = order.type === "sample" && order.total === 0
    ? "\n✅ FREE SAMPLE — no payment needed."
    : `\n💳 *Payment Due: ₹${order.total}*\n\nPay via GPay / PhonePe / any UPI app:\n📲 UPI ID: *${upiId}*`;

  const ofdMsg = [
    "🙏 *Hare Krishna!* 🪷",
    "",
    `Hi *${order.customerName}*, your order is on the way! 🚀`,
    "",
    `Order No: *#${order.orderNumber}*`,
    ofdPayBlock,
    "",
    "Thank you for choosing Sri Krishna Condiments! 🌿",
    "_Pure • Fresh • Handcrafted with Love_ 🙏",
  ].join("\n");

  const deliveredMsg = [
    "🙏 *Hare Krishna!* 🪷",
    "",
    `Hi *${order.customerName}*, your order has been delivered! 🎉`,
    "",
    `Order No: *#${order.orderNumber}*`,
    "",
    "We hope you love our products! 🙏",
    "",
    "📝 *Please share your feedback* (takes 30 seconds):",
    `${STORE_URL()}/feedback/${orderId}`,
    "",
    "💬 *Join our WhatsApp group* for offers & updates:",
    WA_GROUP_LINK_PARAM.value() || "(ask us for the group link!)",
    "",
    "Sri Krishna Condiments — Pure & Healthy 🌿",
  ].join("\n");

  const cancelledMsg = [
    "❌ *Sri Krishna Condiments*",
    "",
    `Hi *${order.customerName}*, your order *#${order.orderNumber}* has been cancelled.`,
    "",
    "If you have any questions, please reach out to us on WhatsApp.",
    "",
    "Sorry for the inconvenience. We hope to serve you soon! 🙏",
    "Sri Krishna Condiments — Pure & Healthy 🌿",
  ].join("\n");

  const waConfirmedUrl = buildWaCustomerUrl(confirmedMsg);
  const waOfdUrl = buildWaCustomerUrl(ofdMsg);
  const waDeliveredUrl = buildWaCustomerUrl(deliveredMsg);
  const waCancelledUrl = buildWaCustomerUrl(cancelledMsg);

  const rows: InlineButton[][] = [];

  // Row 1: Status transitions
  rows.push([
    {text: "✅ Confirm", callback_data: `STATUS:${orderId}:confirmed`},
    {text: "🚚 Out for Delivery", callback_data: `STATUS:${orderId}:out_for_delivery`},
  ]);
  rows.push([
    {text: "🎉 Delivered", callback_data: `STATUS:${orderId}:delivered`},
    {text: "❌ Cancel", callback_data: `STATUS:${orderId}:cancelled`},
  ]);

  // Row 2: Payment status
  if (!isSample || order.total > 0) {
    rows.push([
      {text: "💰 Mark Paid", callback_data: `PAY:${orderId}:paid`},
      {text: "💸 Mark Unpaid", callback_data: `PAY:${orderId}:pending`},
    ]);
  }

  // Row 3: WA notify customer (deep links that open WA with pre-filled message)
  const waButtons: InlineButton[] = [];
  if (waConfirmedUrl) waButtons.push({text: "📲 WA: Confirmed", url: waConfirmedUrl});
  if (waOfdUrl) waButtons.push({text: "📲 WA: OFD + Pay", url: waOfdUrl});
  if (waButtons.length > 0) rows.push(waButtons);

  const waButtons2: InlineButton[] = [];
  if (waDeliveredUrl) waButtons2.push({text: "📲 WA: Delivered", url: waDeliveredUrl});
  if (waCancelledUrl) waButtons2.push({text: "📲 WA: Cancelled", url: waCancelledUrl});
  if (waButtons2.length > 0) rows.push(waButtons2);

  // Row 4: Admin + WA group
  rows.push([
    {text: "📋 Admin Panel", url: adminLink},
    {text: "📢 Share to WA Group", url: waGroupUrl},
  ]);

  return rows;
}

// ─── Firestore trigger: new order → Telegram notification ────────────────────

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

    const telegramText = buildOrderTelegramText(order, orderId, true);
    const buttons = buildOrderActionButtons(orderId, order);

    try {
      const result = await sendTelegram(
        TELEGRAM_BOT_TOKEN.value(),
        TELEGRAM_CHAT_ID.value(),
        telegramText,
        buttons
      );

      // Store the Telegram message_id so the webhook can edit it later
      if (result?.message_id) {
        await db.collection("orders").doc(orderId).update({
          telegramMessageId: result.message_id,
        });
      }

      logger.info("Telegram notification sent", {orderId, orderNumber: order.orderNumber});
    } catch (err) {
      logger.error("Failed to send Telegram notification", {orderId, err});
    }
  }
);

// ─── HTTP webhook: Telegram → Firestore (button tap handler) ─────────────────
//
// Register this URL with Telegram once after deploying:
//   curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://asia-south1-skc-app-9c73a.cloudfunctions.net/telegramWebhook"
//
// Callback data format:
//   STATUS:{orderId}:{newStatus}  — update order status
//   PAY:{orderId}:{payStatus}     — update payment status

export const telegramWebhook = onRequest(
  {
    secrets: [TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID],
    region: "asia-south1",
  },
  async (req, res) => {
    // Telegram always sends POST with JSON body
    if (req.method !== "POST") {
      res.status(200).send("OK");
      return;
    }

    const update = req.body as {
      callback_query?: {
        id: string;
        from: {first_name?: string; username?: string};
        message?: {message_id: number; chat: {id: number}};
        data?: string;
      };
    };

    const cq = update.callback_query;
    if (!cq?.data) {
      res.status(200).send("OK");
      return;
    }

    const token = TELEGRAM_BOT_TOKEN.value();
    // Use the actual chat id from the callback message (more reliable than the stored secret)
    const callbackChatId = String(cq.message?.chat?.id ?? TELEGRAM_CHAT_ID.value());
    const callbackId = cq.id;
    const adminName = cq.from.first_name ?? cq.from.username ?? "Admin";
    const messageId = cq.message?.message_id;

    try {
      // Use limit=3 so the orderId (which may be long) isn't accidentally split further
      const parts = cq.data.split(":", 3);
      const action = parts[0];
      const orderId = parts[1];
      const value = parts[2];
      if (!action || !orderId || !value) {
        await answerCallbackQuery(token, callbackId, "❓ Unknown action");
        res.status(200).send("OK");
        return;
      }

      // Fetch order from Firestore
      const orderRef = db.collection("orders").doc(orderId);
      const orderSnap = await orderRef.get();
      if (!orderSnap.exists) {
        await answerCallbackQuery(token, callbackId, "❌ Order not found");
        res.status(200).send("OK");
        return;
      }
      const order = orderSnap.data() as Order;

      let toastMessage = "";
      const now = new Date().toISOString();

      if (action === "STATUS") {
        const validStatuses = ["pending", "confirmed", "out_for_delivery", "delivered", "cancelled"];
        if (!validStatuses.includes(value)) {
          await answerCallbackQuery(token, callbackId, "❓ Unknown status");
          res.status(200).send("OK");
          return;
        }
        // Mirror services.ts updateStatus: set deliveredAt when delivered
        await orderRef.update({
          status: value,
          updatedAt: now,
          ...(value === "delivered" ? {deliveredAt: now} : {}),
        });
        order.status = value;
        toastMessage = `${STATUS_EMOJI[value] ?? "🔄"} ${order.orderNumber} → ${STATUS_LABEL[value] ?? value} (by ${adminName})`;
      } else if (action === "PAY") {
        const validPay = ["pending", "paid", "na"];
        if (!validPay.includes(value)) {
          await answerCallbackQuery(token, callbackId, "❓ Unknown payment status");
          res.status(200).send("OK");
          return;
        }
        // Mirror services.ts updatePayment: update order then recalc customer pendingAmount
        await orderRef.update({paymentStatus: value, updatedAt: now});
        order.paymentStatus = value;
        // Recalculate customer pendingAmount so the admin panel stays in sync
        const customerId = (orderSnap.data() as {customerId?: string}).customerId;
        if (customerId) {
          const ordersSnap = await db.collection("orders")
            .where("customerId", "==", customerId)
            .get();
          const pendingTotal = ordersSnap.docs
            .map((d) => d.data() as {paymentStatus?: string; total?: number})
            .filter((o) => o.paymentStatus === "pending")
            .reduce((sum, o) => sum + (o.total ?? 0), 0);
          await db.collection("customers").doc(customerId).update({
            pendingAmount: Math.max(0, pendingTotal),
          });
        }
        toastMessage = `${PAY_EMOJI[value] ?? "💸"} ${order.orderNumber} payment → ${PAY_LABEL[value] ?? value} (by ${adminName})`;
      } else {
        await answerCallbackQuery(token, callbackId, "❓ Unknown action");
        res.status(200).send("OK");
        return;
      }

      // Answer the callback immediately to remove loading spinner
      await answerCallbackQuery(token, callbackId, toastMessage);

      // Edit the original message to reflect the new state
      if (messageId) {
        const updatedText = buildOrderTelegramText(order, orderId);
        const updatedButtons = buildOrderActionButtons(orderId, order);
        await editTelegramMessage(token, callbackChatId, messageId, updatedText, updatedButtons);
      }

      logger.info("Telegram webhook processed", {action, orderId, value, adminName});
    } catch (err) {
      logger.error("telegramWebhook error", {err});
      await answerCallbackQuery(token, callbackId, "❌ Error processing action").catch(() => undefined);
    }

    res.status(200).send("OK");
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

    const adminLink = `${ADMIN_SUBS_URL()}`;

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

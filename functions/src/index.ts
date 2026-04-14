import * as admin from "firebase-admin";
import {setGlobalOptions} from "firebase-functions";
import {onDocumentCreated} from "firebase-functions/v2/firestore";
import {onRequest} from "firebase-functions/v2/https";
import {defineSecret} from "firebase-functions/params";
import * as logger from "firebase-functions/logger";

admin.initializeApp();
const db = admin.firestore();

setGlobalOptions({maxInstances: 10, region: "asia-south1"});

const TELEGRAM_BOT_TOKEN = defineSecret("TELEGRAM_BOT_TOKEN");
const TELEGRAM_CHAT_ID = defineSecret("TELEGRAM_CHAT_ID");

const ADMIN_BASE_URL = "https://YOUR_DOMAIN/admin/orders";
const ADMIN_SUBS_URL = "https://YOUR_DOMAIN/admin/subscriptions";
const WA_GROUP_LINK = "https://chat.whatsapp.com/***REMOVED***";
const STORE_URL = "https://YOUR_DOMAIN";
const UPI_ID = process.env.UPI_ID ?? "***REMOVED***";

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
    order.notes ? `\n📝 <b>Note:</b> ${order.notes}` : "",
    isSample ? "\n🎁 FREE SAMPLE" : `\n💰 Total: ₹${order.total}`,
    "",
    statusLine,
    payLine,
  ].filter((l) => !!l).join("\n");
}

function buildOrderActionButtons(orderId: string, order: Order): InlineButton[][] {
  const isSample = order.type === "sample";
  const adminLink = `${ADMIN_BASE_URL}/${orderId}`;

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

  // WA direct customer message (status update)
  const buildWaCustomerUrl = (msg: string) =>
    phone ? `https://api.whatsapp.com/send?phone=91${phone}&text=${encodeURIComponent(msg)}` : null;

  const upiLink = `upi://pay?pa=${UPI_ID}&pn=SriKrishnaCondiments&am=${order.total}&tn=${encodeURIComponent("Order " + order.orderNumber)}&cu=INR`;

  const confirmedMsg = `🙏 *Hare Krishna!* 🪷\n\nHi *${order.customerName}*, your order *#${order.orderNumber}* is confirmed! ✅\n\nWe will keep you updated. Thank you for choosing Sri Krishna Condiments! 🌿`;
  const ofdMsg = `🙏 *Hare Krishna!* 🪷\n\nHi *${order.customerName}*, your order *#${order.orderNumber}* is out for delivery! 🚚\n\n💳 *Payment Due: ₹${order.total}*\nPay via GPay / PhonePe / any UPI app:\n📲 UPI ID: \`${UPI_ID}\`\n🔗 Tap to pay: ${upiLink}\n\nThank you! 🌿`;
  const deliveredMsg = `🙏 *Hare Krishna!* 🪷\n\nHi *${order.customerName}*, your order *#${order.orderNumber}* has been delivered! 🎉\n\n📝 Please share your feedback: ${STORE_URL}/feedback\n\n💬 Join our WhatsApp group for offers: ${WA_GROUP_LINK}\n\nSri Krishna Condiments — Pure & Healthy 🌿`;
  const cancelledMsg = `❌ *Sri Krishna Condiments*\n\nHi *${order.customerName}*, your order *#${order.orderNumber}* has been cancelled.\n\nSorry for the inconvenience. We hope to serve you soon! 🙏`;

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
    const chatId = TELEGRAM_CHAT_ID.value();
    const callbackId = cq.id;
    const adminName = cq.from.first_name ?? cq.from.username ?? "Admin";
    const messageId = cq.message?.message_id;

    try {
      const [action, orderId, value] = cq.data.split(":");
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

      if (action === "STATUS") {
        const validStatuses = ["pending", "confirmed", "out_for_delivery", "delivered", "cancelled"];
        if (!validStatuses.includes(value)) {
          await answerCallbackQuery(token, callbackId, "❓ Unknown status");
          res.status(200).send("OK");
          return;
        }
        await orderRef.update({
          status: value,
          updatedAt: new Date().toISOString(),
          [`statusHistory.${value}`]: new Date().toISOString(),
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
        await orderRef.update({
          paymentStatus: value,
          updatedAt: new Date().toISOString(),
          ...(value === "paid" ? {paidAt: new Date().toISOString()} : {}),
        });
        order.paymentStatus = value;
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
        await editTelegramMessage(token, chatId, messageId, updatedText, updatedButtons);
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

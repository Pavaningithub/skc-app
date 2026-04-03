import {setGlobalOptions} from "firebase-functions";
import {onDocumentCreated} from "firebase-functions/v2/firestore";
import {defineSecret} from "firebase-functions/params";
import * as logger from "firebase-functions/logger";

setGlobalOptions({maxInstances: 10, region: "asia-south1"});

const TELEGRAM_BOT_TOKEN = defineSecret("TELEGRAM_BOT_TOKEN");
const TELEGRAM_CHAT_ID = defineSecret("TELEGRAM_CHAT_ID");

const ADMIN_BASE_URL = "https://skctreats.in/admin/orders";
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

    // Format items list
    const itemLines = (order.items ?? [])
      .map((i) => `  • ${i.productName} × ${i.quantity} ${i.unit} — ₹${i.total}`)
      .join("\n");

    // Format phone for display
    const phone = order.customerWhatsapp
      ? `+91 ${order.customerWhatsapp.slice(0, 5)} ${order.customerWhatsapp.slice(5)}`
      : "—";

    // Build message
    const isSample = order.type === "sample";
    const emoji = isSample ? "🎁" : "🛒";

    const lines = [
      `${emoji} <b>${isSample ? "Sample Request" : "New Order"} — ${order.orderNumber}</b>`,
      "",
      `👤 <b>${order.customerName}</b>`,
      `📞 ${phone}`,
      `📍 ${order.customerPlace || "—"}`,
      "",
      `<b>Items:</b>`,
      itemLines,
      "",
      `💰 Subtotal: ₹${order.subtotal}`,
      order.discount > 0 ? `🏷️ Discount: −₹${order.discount}${order.referralCodeUsed ? ` (${order.referralCodeUsed})` : ""}` : "",
      `✅ <b>Total: ₹${order.total}</b>`,
      order.notes ? `\n📝 Notes: ${order.notes}` : "",
    ].filter(Boolean).join("\n");

    // Build WhatsApp message to share in group
    const waText = [
      `${emoji} *${isSample ? "Sample Request" : "New Order"} — ${order.orderNumber}*`,
      `👤 ${order.customerName} · ${phone}`,
      `📍 ${order.customerPlace || "—"}`,
      `✅ *Total: ₹${order.total}*`,
      isSample ? "" : `\nPlease note your order and expect delivery soon! 🙏`,
    ].filter(Boolean).join("\n");

    const waUrl = `https://wa.me/?text=${encodeURIComponent(waText)}`;

    // Inline keyboard buttons
    const buttons = [
      [
        {text: "📋 Open in Admin", url: `${ADMIN_BASE_URL}/${orderId}`},
      ],
      [
        {text: "📲 Share to WA Group", url: waUrl},
        {text: "🔗 Join WA Group", url: WA_GROUP_LINK},
      ],
    ];

    try {
      await sendTelegram(
        TELEGRAM_BOT_TOKEN.value(),
        TELEGRAM_CHAT_ID.value(),
        lines,
        buttons
      );
      logger.info("Telegram notification sent", {orderId, orderNumber: order.orderNumber});
    } catch (err) {
      logger.error("Failed to send Telegram notification", {orderId, err});
    }
  }
);

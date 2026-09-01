// ─── Storefront checkout client ──────────────────────────────────────────────
// Order placement runs in the storefront Cloud Function. The browser sends what
// the customer chose; the server prices it from the catalogue and does the
// customer, order, stock and referral-credit writes together.

const REGION = 'asia-south1';

function baseUrl(): string {
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID;
  if (!projectId) throw new Error('VITE_FIREBASE_PROJECT_ID is not set.');
  return `https://${REGION}-${projectId}.cloudfunctions.net/storefront`;
}

export interface PlacedOrder {
  orderId: string;
  orderNumber: string;
  subtotal: number;
  discount: number;
  total: number;
  referralDiscount: number;
  creditUsed: number;
  customerId: string;
}

async function post(path: string, body: unknown): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('Could not reach the store. Please check your connection and try again.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // The server's message is written for the customer — show it as-is.
    throw new Error(String((data as { error?: string }).error ?? 'Could not place the order.'));
  }
  return data as Record<string, unknown>;
}

export async function placeOrder(input: {
  name: string;
  whatsapp: string;
  place?: string;
  notes?: string;
  referralCode?: string;
  useCredit?: boolean;
  items: { productId: string; quantity: number; customizationNote?: string }[];
}): Promise<PlacedOrder> {
  return await post('place-order', input) as unknown as PlacedOrder;
}

export async function requestSample(input: {
  name: string;
  whatsapp: string;
  place?: string;
  notes?: string;
  productIds: string[];
}): Promise<{ orderId: string; orderNumber: string; customerId: string }> {
  return await post('request-sample', input) as unknown as
    { orderId: string; orderNumber: string; customerId: string };
}

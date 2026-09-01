// ─── Storefront checkout ─────────────────────────────────────────────────────
// Placing an order used to happen entirely in the customer's browser: it created
// the order, deducted stock and adjusted referral credit by writing to Firestore
// directly. That required customers, orders and stock to be world-writable, and
// it meant the browser decided what an order cost.
//
// This module does the same work server-side. Prices come from the product
// catalogue, never from the request, and the writes land in one batch.

import * as admin from "firebase-admin";
import {
  computeCreditRedemption, computeReferralDiscountFromTiers, DEFAULT_REFERRAL_CONFIG,
  generateOrderNumber, generateReferralCode, normalizeWhatsapp,
  type ReferralConfig,
} from "./pricing";

export class CheckoutError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export interface CartLineInput {
  productId: string;
  quantity: number;
  customizationNote?: string;
}

export interface PlaceOrderInput {
  name: string;
  whatsapp: string;
  place?: string;
  notes?: string;
  referralCode?: string;
  useCredit?: boolean;
  items: CartLineInput[];
}

interface ProductDoc {
  id: string;
  name: string;
  unit: string;
  pricePerUnit: number;
  minOrderQty?: number;
  isActive: boolean;
  isOnDemand?: boolean;
  handledBy?: string;
}

interface CustomerDoc {
  id: string;
  totalOrders?: number;
  referredBy?: string;
  referralCredit?: number;
  discountPercent?: number;
  discountApplyToNew?: boolean;
}

function nowIso(): string {
  return new Date().toISOString();
}

async function loadReferralConfig(
  db: admin.firestore.Firestore,
): Promise<ReferralConfig> {
  const snap = await db.doc("settings/referral_config").get();
  if (!snap.exists) return DEFAULT_REFERRAL_CONFIG;
  return {...DEFAULT_REFERRAL_CONFIG, ...(snap.data() as Partial<ReferralConfig>)};
}

async function findCustomerByWhatsapp(
  db: admin.firestore.Firestore, whatsapp: string,
): Promise<CustomerDoc | null> {
  const snap = await db.collection("customers")
    .where("whatsapp", "==", whatsapp).limit(1).get();
  if (snap.empty) return null;
  return {id: snap.docs[0].id, ...snap.docs[0].data()} as CustomerDoc;
}

/**
 * Price the cart from the catalogue. A request naming a product that is missing,
 * inactive, or below its minimum order quantity is rejected rather than quietly
 * repriced, so the customer is told instead of being surprised at delivery.
 */
async function priceCart(
  db: admin.firestore.Firestore, items: CartLineInput[],
): Promise<{lines: Record<string, unknown>[]; subtotal: number; hasOnDemand: boolean}> {
  if (!Array.isArray(items) || items.length === 0) {
    throw new CheckoutError(400, "Your cart is empty.");
  }
  if (items.length > 30) {
    throw new CheckoutError(400, "An order can contain at most 30 different products.");
  }

  const snaps = await Promise.all(items.map((i) =>
    db.collection("products").doc(String(i.productId ?? "")).get()));

  const lines: Record<string, unknown>[] = [];
  let subtotal = 0;
  let hasOnDemand = false;

  items.forEach((item, idx) => {
    const snap = snaps[idx];
    if (!snap.exists) {
      throw new CheckoutError(400, `A product in your cart is no longer available.`);
    }
    const p = {id: snap.id, ...snap.data()} as ProductDoc;
    if (!p.isActive) {
      throw new CheckoutError(400, `"${p.name}" is no longer available.`);
    }
    const qty = Number(item.quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new CheckoutError(400, `Invalid quantity for "${p.name}".`);
    }
    if (p.minOrderQty && qty < p.minOrderQty) {
      throw new CheckoutError(400,
        `"${p.name}" has a minimum order of ${p.minOrderQty} ${p.unit}.`);
    }
    // The price comes from the catalogue — never from the request.
    const totalPrice = Math.round(p.pricePerUnit * qty * 100) / 100;
    subtotal += totalPrice;
    if (p.isOnDemand) hasOnDemand = true;

    lines.push({
      productId: p.id,
      productName: p.name,
      unit: p.unit,
      quantity: qty,
      pricePerUnit: p.pricePerUnit,
      totalPrice,
      customizationNote: String(item.customizationNote ?? "").slice(0, 500),
      isOnDemand: p.isOnDemand === true,
      handledBy: p.handledBy ?? "Sree Lakshmi",
    });
  });

  return {lines, subtotal: Math.round(subtotal), hasOnDemand};
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

export async function placeOrder(
  db: admin.firestore.Firestore, input: PlaceOrderInput,
): Promise<PlacedOrder> {
  const name = String(input.name ?? "").trim();
  if (!name || name.length > 100) {
    throw new CheckoutError(400, "Please enter your name.");
  }
  const whatsapp = normalizeWhatsapp(input.whatsapp);
  if (whatsapp.length !== 10) {
    throw new CheckoutError(400, "Enter a valid 10-digit WhatsApp number.");
  }
  const place = String(input.place ?? "").trim().slice(0, 200);

  const [{lines, subtotal, hasOnDemand}, config, existing] = await Promise.all([
    priceCart(db, input.items),
    loadReferralConfig(db),
    findCustomerByWhatsapp(db, whatsapp),
  ]);

  const batch = db.batch();
  const iso = nowIso();

  // ── Customer ──────────────────────────────────────────────────────────────
  let customerId: string;
  if (existing) {
    customerId = existing.id;
  } else {
    const ref = db.collection("customers").doc();
    customerId = ref.id;
    batch.set(ref, {
      name, whatsapp, place,
      totalOrders: 0, totalSpent: 0, pendingAmount: 0,
      joinedWhatsappGroup: false,
      referralCode: generateReferralCode(name),
      referralCredit: 0,
      createdAt: iso,
    });
  }

  // ── Referral / credit ─────────────────────────────────────────────────────
  let referralCodeUsed: string | undefined;
  let referralDiscount = 0;
  let referrerCredit = 0;
  let referrerId: string | undefined;
  let creditUsed = 0;

  const entered = String(input.referralCode ?? "").trim().toUpperCase();
  if (entered) {
    // A referral code is first-order only, and cannot be self-referral.
    const isReturning = !!existing && ((existing.totalOrders ?? 0) > 0 || !!existing.referredBy);
    if (!isReturning) {
      const refSnap = await db.collection("customers")
        .where("referralCode", "==", entered).limit(1).get();
      const referrer = refSnap.empty ? null : refSnap.docs[0];
      if (referrer && referrer.id !== customerId) {
        const split = computeReferralDiscountFromTiers(
          subtotal, config.tiers, config.splitReferrerPct);
        referralCodeUsed = entered;
        referralDiscount = split.customerDiscount;
        referrerId = referrer.id;
        referrerCredit = split.referrerCredit;
      }
    }
    // An invalid code is not an error — the order is placed at full price,
    // matching what the storefront already did.
  } else if (input.useCredit === true && existing) {
    creditUsed = computeCreditRedemption(
      existing.referralCredit ?? 0, subtotal,
      config.creditRedemptionPct, config.creditRedemptionCap);
  }

  // A standing customer discount overrides referral and credit.
  const standingPct = existing?.discountPercent ?? 0;
  const standingDiscount = standingPct > 0 && existing?.discountApplyToNew !== false ?
    Math.round(subtotal * standingPct / 100) : 0;
  const discount = standingDiscount > 0 ? standingDiscount : referralDiscount + creditUsed;
  if (standingDiscount > 0) {
    referralDiscount = 0;
    creditUsed = 0;
    referrerCredit = 0;
    referrerId = undefined;
    referralCodeUsed = undefined;
  }
  const total = Math.max(0, subtotal - discount);

  // ── Order ─────────────────────────────────────────────────────────────────
  const orderRef = db.collection("orders").doc();
  const orderNumber = generateOrderNumber();
  batch.set(orderRef, {
    orderNumber, type: "regular", customerId,
    customerName: name, customerWhatsapp: whatsapp, customerPlace: place,
    items: lines,
    subtotal, discount, total,
    status: "pending", paymentStatus: "pending",
    notes: String(input.notes ?? "").slice(0, 1000),
    hasOnDemandItems: hasOnDemand,
    ...(referralCodeUsed ? {referralCodeUsed} : {}),
    referralDiscount, creditUsed,
    deliveryCharge: 0,
    createdAt: iso, updatedAt: iso,
  });

  // ── Stock ─────────────────────────────────────────────────────────────────
  // Stocked items only; on-demand products are made after the order.
  const stocked = lines.filter((l) => l.isOnDemand !== true);
  const stockSnaps = await Promise.all(stocked.map((l) =>
    db.collection("stock").where("productId", "==", l.productId).limit(1).get()));
  stocked.forEach((line, i) => {
    const snap = stockSnaps[i];
    const qty = Number(line.quantity);
    if (!snap.empty) {
      batch.update(snap.docs[0].ref, {
        // Allowed to go negative so a deficit stays visible to the admin.
        quantityAvailable: admin.firestore.FieldValue.increment(-qty),
        updatedAt: iso,
      });
    } else {
      batch.set(db.collection("stock").doc(), {
        productId: line.productId,
        productName: line.productName,
        unit: line.unit,
        quantityAvailable: -qty,
        lowStockThreshold: 0,
        updatedAt: iso,
      });
    }
  });

  // ── Customer totals, credit movements ─────────────────────────────────────
  const customerRef = db.collection("customers").doc(customerId);
  const customerUpdate: Record<string, unknown> = {
    totalOrders: admin.firestore.FieldValue.increment(1),
    totalSpent: admin.firestore.FieldValue.increment(total),
    pendingAmount: admin.firestore.FieldValue.increment(total),
    name, place,
  };
  if (creditUsed > 0) {
    customerUpdate.referralCredit = admin.firestore.FieldValue.increment(-creditUsed);
  }
  if (referralCodeUsed) customerUpdate.referredBy = referralCodeUsed;
  batch.set(customerRef, customerUpdate, {merge: true});

  if (referrerId && referrerCredit > 0) {
    batch.update(db.collection("customers").doc(referrerId), {
      referralCredit: admin.firestore.FieldValue.increment(referrerCredit),
    });
  }

  await batch.commit();

  return {
    orderId: orderRef.id, orderNumber, subtotal, discount, total,
    referralDiscount, creditUsed, customerId,
  };
}

// ─── Storefront write API ────────────────────────────────────────────────────
// The only way an anonymous browser may create orders. Public by necessity —
// customers have no login — but it decides prices, so a crafted request cannot
// buy anything for less than the catalogue says.

import * as admin from "firebase-admin";
import type {Request} from "firebase-functions/v2/https";
import type {Response} from "express";
import {CheckoutError, placeOrder, type PlaceOrderInput} from "./place";
import {generateOrderNumber, generateReferralCode, normalizeWhatsapp} from "./pricing";

/** One free sample per phone number, ever. */
async function hasHadSample(
  db: admin.firestore.Firestore, whatsapp: string,
): Promise<boolean> {
  const snap = await db.collection("orders")
    .where("customerWhatsapp", "==", whatsapp)
    .where("type", "==", "sample").limit(1).get();
  return !snap.empty;
}

async function requestSample(
  db: admin.firestore.Firestore, body: Record<string, unknown>, sampleCharge: number,
): Promise<Record<string, unknown>> {
  const name = String(body.name ?? "").trim();
  if (!name || name.length > 100) throw new CheckoutError(400, "Please enter your name.");
  const whatsapp = normalizeWhatsapp(body.whatsapp);
  if (whatsapp.length !== 10) {
    throw new CheckoutError(400, "Enter a valid 10-digit WhatsApp number.");
  }
  const ids = Array.isArray(body.productIds) ? body.productIds.map(String) : [];
  if (!ids.length) throw new CheckoutError(400, "Please select at least one product.");
  if (ids.length > 5) throw new CheckoutError(400, "Please select at most 5 products.");

  if (await hasHadSample(db, whatsapp)) {
    throw new CheckoutError(409,
      "This number has already requested a sample. Each number is eligible for one sample only.");
  }

  const snaps = await Promise.all(ids.map((id) => db.collection("products").doc(id).get()));
  const items = snaps.map((s) => {
    if (!s.exists) throw new CheckoutError(400, "A selected product is no longer available.");
    const p = s.data() as {name: string; unit: string; isActive: boolean; handledBy?: string};
    if (!p.isActive) throw new CheckoutError(400, `"${p.name}" is no longer available.`);
    return {
      productId: s.id, productName: p.name, unit: p.unit,
      quantity: 50, pricePerUnit: 0, totalPrice: 0,
      customizationNote: "", isOnDemand: false,
      handledBy: p.handledBy ?? "Sree Lakshmi",
    };
  });

  const iso = new Date().toISOString();
  const batch = db.batch();

  const found = await db.collection("customers")
    .where("whatsapp", "==", whatsapp).limit(1).get();
  let customerId: string;
  if (found.empty) {
    const ref = db.collection("customers").doc();
    customerId = ref.id;
    batch.set(ref, {
      name, whatsapp, place: String(body.place ?? "").trim().slice(0, 200),
      totalOrders: 0, totalSpent: 0, pendingAmount: 0,
      joinedWhatsappGroup: false,
      referralCode: generateReferralCode(name),
      referralCredit: 0, createdAt: iso,
    });
  } else {
    customerId = found.docs[0].id;
  }

  const orderRef = db.collection("orders").doc();
  const orderNumber = generateOrderNumber();
  batch.set(orderRef, {
    orderNumber, type: "sample", customerId,
    customerName: name, customerWhatsapp: whatsapp,
    customerPlace: String(body.place ?? "").trim().slice(0, 200),
    items,
    subtotal: sampleCharge, discount: 0, total: sampleCharge,
    status: "pending",
    paymentStatus: sampleCharge > 0 ? "pending" : "na",
    notes: `Sample request: ${items.map((i) => i.productName).join(", ")}` +
      (body.notes ? `. ${String(body.notes).slice(0, 500)}` : ""),
    hasOnDemandItems: false,
    referralDiscount: 0, creditUsed: 0, deliveryCharge: 0,
    createdAt: iso, updatedAt: iso,
  });

  await batch.commit();
  return {orderId: orderRef.id, orderNumber, customerId};
}

export async function serveStorefront(
  req: Request, res: Response, db: admin.firestore.Firestore, sampleCharge: number,
): Promise<void> {
  res.set("Cache-Control", "no-store");
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({error: "Use POST."});
    return;
  }

  const path = (req.path || "/").replace(/^\/+|\/+$/g, "");
  const body = (req.body ?? {}) as Record<string, unknown>;

  try {
    if (path === "place-order") {
      res.status(200).json(await placeOrder(db, body as unknown as PlaceOrderInput));
      return;
    }
    if (path === "request-sample") {
      res.status(200).json(await requestSample(db, body, sampleCharge));
      return;
    }
    res.status(404).json({error: `Unknown route "${path}". Available: place-order, request-sample.`});
  } catch (err) {
    if (err instanceof CheckoutError) {
      res.status(err.status).json({error: err.message});
      return;
    }
    res.status(500).json({error: "Could not place the order. Please try again."});
  }
}

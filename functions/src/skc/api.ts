// ─── SKC assistant API ───────────────────────────────────────────────────────
// A small, token-authenticated JSON API over the bills / raw-material / costing
// data. It contains no AI: it is the durable interface any assistant (the SKC
// MCP server, a future tool, or a plain script) uses to read and write SKC data.
//
// Auth: send the shared token as `Authorization: Bearer <token>` or `X-SKC-Token`.
// Routes are POST or GET on /skcApi/<route>.

import * as admin from "firebase-admin";
import {timingSafeEqual} from "crypto";
import type {Request} from "firebase-functions/v2/https";
import type {Response} from "express";
import {
  billImpact, costProduct, materialTrends, rateHistory, shopRound, suggestMargin,
} from "./analysis";
import {applyBill, type BillInput} from "./bills";
import * as store from "./store";
import type {Product, ProductRecipe, Unit} from "./types";

export const DEFAULT_TARGET_MARGIN_PCT = 25;

type Json = Record<string, unknown>;

class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function str(v: unknown, field: string): string {
  if (typeof v !== "string" || !v.trim()) {
    throw new ApiError(400, `"${field}" is required and must be a non-empty string.`);
  }
  return v.trim();
}

function num(v: unknown, field: string, fallback?: number): number {
  if (v === undefined || v === null || v === "") {
    if (fallback !== undefined) return fallback;
    throw new ApiError(400, `"${field}" is required and must be a number.`);
  }
  const n = typeof v === "number" ? v : parseFloat(String(v));
  if (!Number.isFinite(n)) throw new ApiError(400, `"${field}" must be a number, got "${String(v)}".`);
  return n;
}

function unit(v: unknown, field: string): Unit {
  const s = String(v ?? "").toLowerCase();
  if (s === "gram" || s === "g") return "gram";
  if (s === "kg" || s === "kilogram") return "kg";
  if (s === "piece" || s === "pc" || s === "pcs") return "piece";
  throw new ApiError(400, `"${field}" must be one of: gram, kg, piece (got "${String(v)}").`);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Round every number in a payload so responses stay readable. */
function tidy<T>(value: T): T {
  if (typeof value === "number") return round2(value) as unknown as T;
  if (Array.isArray(value)) return value.map(tidy) as unknown as T;
  if (value && typeof value === "object") {
    const out: Json = {};
    for (const [k, v] of Object.entries(value as Json)) out[k] = tidy(v);
    return out as unknown as T;
  }
  return value;
}

// ─── Routes ──────────────────────────────────────────────────────────────────

async function listRawMaterials(db: admin.firestore.Firestore): Promise<Json> {
  const sheet = await store.getCostSheet(db);
  return {
    count: sheet.materials.length,
    materials: sheet.materials.map((m) => {
      const history = rateHistory(m.id, sheet);
      const latest = history[history.length - 1];
      return {
        materialId: m.id,
        nameEn: m.nameEn,
        nameKn: m.nameKn,
        brand: m.brand,
        billName: m.billName,
        unit: m.unit,
        latestRatePerKg: latest?.perKg ?? 0,
        latestDate: latest?.batch.date ?? null,
        purchaseCount: history.length,
      };
    }),
    batches: sheet.batches.map((b) => ({
      batchId: b.id, batchNumber: b.batchNumber, date: b.date, totalSpend: b.totalSpend ?? 0,
    })),
  };
}

async function rawMaterialTrends(
  db: admin.firestore.Firestore, q: Json,
): Promise<Json> {
  const sheet = await store.getCostSheet(db);
  const minChangePct = num(q.minChangePct, "minChangePct", 0);
  const limit = num(q.limit, "limit", 100);
  const all = materialTrends(sheet)
    .filter((t) => t.purchaseCount > 0)
    .filter((t) => Math.abs(t.changePct) >= minChangePct)
    .sort((a, b) => b.changePct - a.changePct);
  const rising = all.filter((t) => t.changePct > 0);
  const falling = all.filter((t) => t.changePct < 0);
  return {
    asOf: sheet.updatedAt,
    materialsTracked: all.length,
    risingCount: rising.length,
    fallingCount: falling.length,
    biggestIncrease: rising[0] ?? null,
    biggestDecrease: falling[falling.length - 1] ?? null,
    trends: all.slice(0, limit),
  };
}

async function materialHistory(db: admin.firestore.Firestore, q: Json): Promise<Json> {
  const sheet = await store.getCostSheet(db);
  const id = str(q.materialId, "materialId");
  const material = sheet.materials.find((m) => m.id === id);
  if (!material) {
    throw new ApiError(404,
      `No raw material with id "${id}". Call raw-materials to list valid ids.`);
  }
  const history = rateHistory(id, sheet);
  return {
    materialId: id,
    nameEn: material.nameEn,
    nameKn: material.nameKn,
    unit: material.unit,
    history: history.map((h) => ({
      batchNumber: h.batch.batchNumber, date: h.batch.date, ratePerKg: h.perKg,
    })),
  };
}

async function loadCostingContext(db: admin.firestore.Firestore) {
  const [sheet, recipes, products] = await Promise.all([
    store.getCostSheet(db), store.getRecipes(db), store.getProducts(db),
  ]);
  return {sheet, recipes, products, productById: new Map(products.map((p) => [p.id, p]))};
}

async function productCosting(db: admin.firestore.Firestore, q: Json): Promise<Json> {
  const {sheet, recipes, productById} = await loadCostingContext(db);
  const productId = typeof q.productId === "string" ? q.productId.trim() : "";
  const scoped: ProductRecipe[] = productId ?
    recipes.filter((r) => r.productId === productId || r.productName === productId) :
    recipes;
  if (productId && !scoped.length) {
    throw new ApiError(404,
      `No recipe for product "${productId}". Products with recipes: ` +
      `${recipes.map((r) => r.productName).join(", ") || "(none yet)"}.`);
  }
  const costings = scoped
    .map((r) => costProduct(r, sheet, productById.get(r.productId)))
    .sort((a, b) => a.productName.localeCompare(b.productName));
  return {
    count: costings.length,
    productsWithoutRecipe: [...productById.values()]
      .filter((p) => p.isActive && !recipes.some((r) => r.productId === p.id))
      .map((p) => ({productId: p.id, name: p.name})),
    costings,
  };
}

async function marginSuggestions(db: admin.firestore.Firestore, q: Json): Promise<Json> {
  const {sheet, recipes, productById} = await loadCostingContext(db);
  const target = num(q.targetMarginPct, "targetMarginPct", DEFAULT_TARGET_MARGIN_PCT);
  const productId = typeof q.productId === "string" ? q.productId.trim() : "";
  const scoped = productId ?
    recipes.filter((r) => r.productId === productId || r.productName === productId) :
    recipes;
  const suggestions = scoped
    .map((r) => suggestMargin(costProduct(r, sheet, productById.get(r.productId)), target))
    .sort((a, b) => (a.currentMarginPct ?? 999) - (b.currentMarginPct ?? 999));
  return {
    targetMarginPct: target,
    underTarget: suggestions.filter(
      (s) => s.currentMarginPct !== null && s.currentMarginPct < target).length,
    suggestions,
  };
}

async function impact(db: admin.firestore.Firestore, q: Json): Promise<Json> {
  const {sheet, recipes, products} = await loadCostingContext(db);
  let materialIds: string[] | undefined;
  if (typeof q.purchaseId === "string" && q.purchaseId.trim()) {
    const snap = await db.collection("rawMaterialPurchases").doc(q.purchaseId.trim()).get();
    if (!snap.exists) throw new ApiError(404, `No bill with id "${q.purchaseId}".`);
    const items = (snap.data()?.items ?? []) as {rawMaterialId?: string}[];
    materialIds = items.map((i) => i.rawMaterialId).filter((v): v is string => !!v);
  } else if (Array.isArray(q.materialIds)) {
    materialIds = q.materialIds.map(String);
  }
  return {
    scope: materialIds ? "bill" : "all-materials",
    ...billImpact(sheet, recipes, products, materialIds,
      num(q.thresholdPct, "thresholdPct", 2)),
  };
}

async function listBills(db: admin.firestore.Firestore, q: Json): Promise<Json> {
  const limit = num(q.limit, "limit", 20);
  const from = typeof q.from === "string" ? q.from : "";
  const to = typeof q.to === "string" ? q.to : "";
  let bills = await store.getPurchases(db, 500);
  if (from) bills = bills.filter((b) => (b.date || "") >= from);
  if (to) bills = bills.filter((b) => (b.date || "") <= to);
  const totalSpend = bills.reduce((s, b) => s + (b.totalAmount || 0), 0);
  return {
    count: bills.length,
    totalSpend,
    bills: bills.slice(0, limit).map((b) => ({
      purchaseId: b.id,
      date: b.date,
      supplierName: b.supplierName ?? null,
      totalAmount: b.totalAmount,
      itemCount: b.items?.length ?? 0,
      enteredBy: b.enteredBy,
      notes: b.notes,
      items: b.items,
    })),
  };
}

/** The reportable half of a bill result — drops the raw sheet/items payloads. */
function billReport(result: ReturnType<typeof applyBill>): Json {
  const {sheet: _sheet, purchaseItems: _purchaseItems, ...report} = result;
  void _sheet; void _purchaseItems;
  return report as unknown as Json;
}

async function recordBill(db: admin.firestore.Firestore, body: Json): Promise<Json> {
  const rawItems = Array.isArray(body.items) ? body.items : [];
  if (!rawItems.length) {
    throw new ApiError(400, "\"items\" must be a non-empty array of bill lines.");
  }
  const bill: BillInput = {
    date: str(body.date, "date"),
    supplierName: typeof body.supplierName === "string" ? body.supplierName : undefined,
    notes: typeof body.notes === "string" ? body.notes : "",
    enteredBy: typeof body.enteredBy === "string" ? body.enteredBy : "assistant",
    batchNumber: typeof body.batchNumber === "string" ? body.batchNumber : undefined,
    billPhotoUrl: typeof body.billPhotoUrl === "string" ? body.billPhotoUrl : undefined,
    items: rawItems.map((raw, i) => {
      const it = raw as Json;
      return {
        name: str(it.name, `items[${i}].name`),
        quantity: num(it.quantity, `items[${i}].quantity`),
        unit: unit(it.unit, `items[${i}].unit`),
        totalCost: it.totalCost === undefined ? undefined : num(it.totalCost, `items[${i}].totalCost`),
        unitCost: it.unitCost === undefined ? undefined : num(it.unitCost, `items[${i}].unitCost`),
        materialId: typeof it.materialId === "string" ? it.materialId : undefined,
      };
    }),
  };

  const {sheet, recipes, products} = await loadCostingContext(db);
  const result = applyBill(bill, sheet, recipes, products);
  const dryRun = body.dryRun !== false; // default to preview — a human confirms

  if (!result.lines.length) {
    throw new ApiError(400,
      `No usable bill lines. ${result.warnings.join(" ") || "Check names, quantities and costs."}`);
  }

  if (dryRun) {
    return {...billReport(result), dryRun: true,
      note: "Nothing was saved. Re-send with dryRun:false to persist this bill."};
  }

  await store.saveCostSheet(db, result.sheet);
  const purchaseId = await store.addPurchase(db, {
    date: bill.date,
    supplierName: bill.supplierName,
    items: result.purchaseItems,
    totalAmount: result.totalAmount,
    billPhotoUrl: bill.billPhotoUrl,
    notes: bill.notes ?? "",
    enteredBy: bill.enteredBy ?? "assistant",
    batchId: result.batchId,
    createdAt: store.nowIso(),
  });
  if (body.createExpense !== false) {
    await store.addExpense(db, {
      category: "raw_material",
      description: `Raw material bill${bill.supplierName ? ` — ${bill.supplierName}` : ""} (${result.batchNumber})`,
      amount: result.totalAmount,
      date: bill.date,
      purchaseId,
    });
  }
  await store.logAction(db,
    `Bill ${result.batchNumber} recorded — ₹${Math.round(result.totalAmount)}, ` +
    `${result.lines.length} items`, purchaseId, bill.supplierName);

  return {...billReport(result), dryRun: false, purchaseId, saved: true};
}

async function addRawMaterial(db: admin.firestore.Firestore, body: Json): Promise<Json> {
  const sheet = await store.getCostSheet(db);
  const nameEn = typeof body.nameEn === "string" ? body.nameEn.trim() : "";
  const nameKn = typeof body.nameKn === "string" ? body.nameKn.trim() : "";
  if (!nameEn && !nameKn) {
    throw new ApiError(400, "Provide at least one of \"nameEn\" or \"nameKn\".");
  }
  const row = {
    id: store.uid(),
    nameEn,
    nameKn,
    unit: body.unit ? unit(body.unit, "unit") : ("kg" as Unit),
    brand: typeof body.brand === "string" ? body.brand : undefined,
    billName: typeof body.billName === "string" ? body.billName : undefined,
  };
  await store.saveCostSheet(db, {...sheet, materials: [...sheet.materials, row]});
  return {created: true, material: row};
}

async function setProductPrice(db: admin.firestore.Firestore, body: Json): Promise<Json> {
  const productId = str(body.productId, "productId");
  const price = num(body.pricePerUnit, "pricePerUnit");
  if (price <= 0) throw new ApiError(400, "\"pricePerUnit\" must be greater than zero.");
  const products = await store.getProducts(db);
  const product = products.find((p) => p.id === productId);
  if (!product) {
    throw new ApiError(404,
      `No product with id "${productId}". Call products to list valid ids.`);
  }
  if (body.dryRun !== false) {
    return {
      dryRun: true, productId, name: product.name, unit: product.unit,
      currentPricePerUnit: product.pricePerUnit, proposedPricePerUnit: price,
      note: "Nothing was saved. Re-send with dryRun:false to apply this price.",
    };
  }
  await store.updateProductPrice(db, productId, price);
  await store.logAction(db,
    `Price of ${product.name} changed ₹${product.pricePerUnit} → ₹${price} per ${product.unit}`,
    productId, product.name);
  return {
    saved: true, productId, name: product.name,
    previousPricePerUnit: product.pricePerUnit, pricePerUnit: price, unit: product.unit,
  };
}

async function listProducts(db: admin.firestore.Firestore): Promise<Json> {
  const [products, recipes] = await Promise.all([store.getProducts(db), store.getRecipes(db)]);
  const withRecipe = new Set(recipes.map((r) => r.productId));
  return {
    count: products.length,
    products: products.map((p: Product) => ({
      productId: p.id,
      name: p.name,
      nameKannada: p.nameKannada ?? null,
      unit: p.unit,
      pricePerUnit: p.pricePerUnit,
      isActive: p.isActive,
      category: p.category ?? null,
      hasRecipe: withRecipe.has(p.id),
    })),
  };
}

async function summary(db: admin.firestore.Firestore, q: Json): Promise<Json> {
  const to = typeof q.to === "string" && q.to ? q.to : new Date().toISOString().slice(0, 10);
  const from = typeof q.from === "string" && q.from ? q.from :
    new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const inRange = (d?: string) => !!d && d.slice(0, 10) >= from && d.slice(0, 10) <= to;

  const [ordersSnap, expensesSnap, bills, sheet, recipes, products] = await Promise.all([
    db.collection("orders").get(),
    db.collection("expenses").get(),
    store.getPurchases(db, 500),
    store.getCostSheet(db),
    store.getRecipes(db),
    store.getProducts(db),
  ]);

  const orders = ordersSnap.docs.map((d) => d.data() as
    {total?: number; status?: string; createdAt?: string});
  const periodOrders = orders.filter((o) => inRange(o.createdAt) && o.status !== "cancelled");
  const revenue = periodOrders.reduce((s, o) => s + (o.total || 0), 0);

  const expenses = expensesSnap.docs.map((d) => d.data() as
    {amount?: number; date?: string; category?: string});
  const periodExpenses = expenses.filter((e) => inRange(e.date));
  const expenseTotal = periodExpenses.reduce((s, e) => s + (e.amount || 0), 0);
  const byCategory: Record<string, number> = {};
  for (const e of periodExpenses) {
    byCategory[e.category || "other"] = (byCategory[e.category || "other"] || 0) + (e.amount || 0);
  }

  const periodBills = bills.filter((b) => inRange(b.date));
  const productById = new Map(products.map((p) => [p.id, p]));
  const costings = recipes.map((r) => costProduct(r, sheet, productById.get(r.productId)));
  const underTarget = costings.filter(
    (c) => c.currentMarginPct !== null && c.currentMarginPct < DEFAULT_TARGET_MARGIN_PCT);

  return {
    from, to,
    orders: periodOrders.length,
    revenue,
    expenses: expenseTotal,
    profit: revenue - expenseTotal,
    marginPct: revenue > 0 ? ((revenue - expenseTotal) / revenue) * 100 : 0,
    expensesByCategory: byCategory,
    bills: {
      count: periodBills.length,
      totalSpend: periodBills.reduce((s, b) => s + (b.totalAmount || 0), 0),
      latestDate: periodBills[0]?.date ?? null,
    },
    pricingAlerts: underTarget.map((c) => ({
      productName: c.productName,
      currentMarginPct: c.currentMarginPct,
      suggestedPricePerKg: shopRound(c.suggestedPricePerKg),
      currentPricePerKg: c.currentPricePerKg,
    })),
  };
}

// ─── Dispatch ────────────────────────────────────────────────────────────────

type Handler = (db: admin.firestore.Firestore, input: Json) => Promise<Json>;

const READ_ROUTES: Record<string, Handler> = {
  "raw-materials": (db) => listRawMaterials(db),
  "raw-material-trends": rawMaterialTrends,
  "material-history": materialHistory,
  "product-costing": productCosting,
  "margin-suggestions": marginSuggestions,
  "bill-impact": impact,
  "bills": listBills,
  "products": (db) => listProducts(db),
  "summary": summary,
};

const WRITE_ROUTES: Record<string, Handler> = {
  "record-bill": recordBill,
  "add-raw-material": addRawMaterial,
  "set-product-price": setProductPrice,
};

export const ROUTES = {
  read: Object.keys(READ_ROUTES),
  write: Object.keys(WRITE_ROUTES),
};

/**
 * Handle one API request. Exported separately from the Cloud Function so it can
 * be exercised directly in tests or from the emulator shell.
 */
export async function handle(
  db: admin.firestore.Firestore,
  route: string,
  input: Json,
  method: string,
): Promise<Json> {
  const read: Handler | undefined = READ_ROUTES[route];
  const write: Handler | undefined = WRITE_ROUTES[route];
  if (!read && !write) {
    throw new ApiError(404,
      `Unknown route "${route}". Available: ${[...ROUTES.read, ...ROUTES.write].join(", ")}.`);
  }
  if (!read && method !== "POST") {
    throw new ApiError(405, `Route "${route}" changes data and must be called with POST.`);
  }
  const handler = read || write;
  return tidy(await handler(db, input));
}

export function authorize(req: Request, expectedToken: string): void {
  if (!expectedToken) {
    throw new ApiError(500,
      "SKC_API_TOKEN is not configured. Set it with: firebase functions:secrets:set SKC_API_TOKEN");
  }
  const header = req.get("authorization") || "";
  const bearer = /^Bearer\s+(.+)$/i.exec(header)?.[1];
  const supplied = (bearer || req.get("x-skc-token") || "").trim();
  if (!supplied) {
    throw new ApiError(401,
      "Missing token. Send it as \"Authorization: Bearer <token>\" or the X-SKC-Token header.");
  }
  const a = Buffer.from(supplied);
  const b = Buffer.from(expectedToken);
  const ok = a.length === b.length && timingSafeEqual(a, b);
  if (!ok) throw new ApiError(403, "Invalid token.");
}

export async function serve(
  req: Request, res: Response, db: admin.firestore.Firestore, token: string,
): Promise<void> {
  res.set("Cache-Control", "no-store");
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }
  try {
    authorize(req, token);
    const path = (req.path || "/").replace(/^\/+|\/+$/g, "");
    if (!path || path === "routes") {
      res.status(200).json({service: "skc-assistant-api", routes: ROUTES});
      return;
    }
    const input: Json = {
      ...(req.query as Json),
      ...(req.method === "POST" && req.body && typeof req.body === "object" ?
        req.body as Json : {}),
    };
    res.status(200).json(await handle(db, path, input, req.method));
  } catch (err) {
    const status = err instanceof ApiError ? err.status : 500;
    const message = err instanceof Error ? err.message : "Unexpected error.";
    res.status(status).json({error: message, status});
  }
}

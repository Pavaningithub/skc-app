// ─── Firestore access for the SKC assistant API ──────────────────────────────

import * as admin from "firebase-admin";
import type {
  Product, ProductRecipe, RawMaterialCostSheet, RawMaterialPurchase,
} from "./types";

const RAW_COST_DOC = "settings/raw_material_costs";

export const EMPTY_SHEET: RawMaterialCostSheet = {
  materials: [], batches: [], cells: {}, updatedAt: "",
};

export function nowIso(): string {
  return new Date().toISOString();
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export async function getCostSheet(
  db: admin.firestore.Firestore,
): Promise<RawMaterialCostSheet> {
  const snap = await db.doc(RAW_COST_DOC).get();
  if (!snap.exists) return {...EMPTY_SHEET};
  const data = snap.data() as Partial<RawMaterialCostSheet>;
  return {
    materials: data.materials ?? [],
    batches: data.batches ?? [],
    cells: data.cells ?? {},
    updatedAt: data.updatedAt ?? "",
  };
}

export async function saveCostSheet(
  db: admin.firestore.Firestore,
  sheet: RawMaterialCostSheet,
): Promise<void> {
  await db.doc(RAW_COST_DOC).set({...sheet, updatedAt: nowIso()});
}

export async function getRecipes(
  db: admin.firestore.Firestore,
): Promise<ProductRecipe[]> {
  const snap = await db.collection("productRecipes").get();
  return snap.docs.map((d) => ({...(d.data() as ProductRecipe), id: d.id}));
}

export async function getProducts(
  db: admin.firestore.Firestore,
): Promise<Product[]> {
  const snap = await db.collection("products").get();
  return snap.docs.map((d) => ({id: d.id, ...(d.data() as Omit<Product, "id">)}));
}

export async function getPurchases(
  db: admin.firestore.Firestore,
  limit = 50,
): Promise<RawMaterialPurchase[]> {
  const snap = await db.collection("rawMaterialPurchases").get();
  return snap.docs
    .map((d) => ({id: d.id, ...(d.data() as Omit<RawMaterialPurchase, "id">)}))
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
    .slice(0, limit);
}

export async function addPurchase(
  db: admin.firestore.Firestore,
  purchase: Omit<RawMaterialPurchase, "id">,
): Promise<string> {
  const ref = await db.collection("rawMaterialPurchases").add(purchase);
  return ref.id;
}

export async function addExpense(
  db: admin.firestore.Firestore,
  expense: {
    category: string; description: string; amount: number;
    date: string; purchaseId?: string;
  },
): Promise<string> {
  const ref = await db.collection("expenses").add({...expense, createdAt: nowIso()});
  return ref.id;
}

export async function updateProductPrice(
  db: admin.firestore.Firestore,
  productId: string,
  pricePerUnit: number,
): Promise<void> {
  await db.collection("products").doc(productId)
    .update({pricePerUnit, updatedAt: nowIso()});
}

export async function saveRecipe(
  db: admin.firestore.Firestore,
  recipe: ProductRecipe,
): Promise<void> {
  await db.collection("productRecipes").doc(recipe.productId)
    .set({...recipe, updatedAt: nowIso()});
}

export async function logAction(
  db: admin.firestore.Firestore,
  label: string,
  entityId?: string,
  entityLabel?: string,
): Promise<void> {
  await db.collection("adminActivity").add({
    type: "expense_added",
    label,
    entityId: entityId ?? null,
    entityLabel: entityLabel ?? null,
    source: "assistant",
    createdAt: nowIso(),
  });
}

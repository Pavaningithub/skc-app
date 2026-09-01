// ─── Recording a raw-material bill into the cost sheet ───────────────────────
// One bill becomes: a rawMaterialPurchases doc, one batch column on the cost
// sheet, one cell per line item, and (optionally) an expense row. Every write
// can be previewed first with dryRun so a human reviews before it lands.

import {
  billImpact, cellValueFor, latestCostPerGram, matchMaterial, pctChange,
} from "./analysis";
import type {
  BatchColumn, Product, ProductRecipe, RawMaterialCostSheet, RawMaterialPurchaseItem,
  RawMaterialRow, Unit,
} from "./types";
import {uid} from "./store";

const KANNADA = /[ಀ-೿]/;

export interface BillLineInput {
  /** Name as spoken or printed on the bill — Kannada or English. */
  name: string;
  quantity: number;
  unit: Unit;
  /** Total ₹ paid for this line. Provide this or unitCost. */
  totalCost?: number;
  /** ₹ per gram/kg/piece. Used when totalCost is absent. */
  unitCost?: number;
  /** Skip name matching by naming the cost-sheet row directly. */
  materialId?: string;
}

export interface BillInput {
  date: string; // YYYY-MM-DD
  supplierName?: string;
  notes?: string;
  enteredBy?: string;
  batchNumber?: string;
  billPhotoUrl?: string;
  items: BillLineInput[];
}

export interface ResolvedLine {
  name: string;
  materialId: string;
  materialNameEn: string;
  materialNameKn: string;
  /** True when no existing cost-sheet row matched and a new one was created. */
  isNewMaterial: boolean;
  quantity: number;
  unit: Unit;
  totalCost: number;
  newRatePerKg: number;
  previousRatePerKg: number;
  changePct: number;
}

export interface BillResult {
  dryRun: boolean;
  purchaseId?: string;
  batchId: string;
  batchNumber: string;
  date: string;
  supplierName?: string;
  totalAmount: number;
  lines: ResolvedLine[];
  newMaterials: string[];
  warnings: string[];
  impact: ReturnType<typeof billImpact>;
  /** The sheet after applying the bill — caller persists it when not a dry run. */
  sheet: RawMaterialCostSheet;
  purchaseItems: RawMaterialPurchaseItem[];
}

function nextBatchNumber(sheet: RawMaterialCostSheet): string {
  const nums = sheet.batches
    .map((b) => /^B(\d+)$/i.exec(b.batchNumber || ""))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => parseInt(m[1], 10));
  return `B${(nums.length ? Math.max(...nums) : sheet.batches.length) + 1}`;
}

/**
 * Apply a bill to a cost sheet. Pure: returns the new sheet and a full
 * before/after report; it never writes to Firestore itself.
 */
export function applyBill(
  bill: BillInput,
  sheetIn: RawMaterialCostSheet,
  recipes: ProductRecipe[],
  products: Product[],
): BillResult {
  const warnings: string[] = [];
  const materials: RawMaterialRow[] = [...sheetIn.materials];
  const cells: Record<string, number> = {...sheetIn.cells};

  // Snapshot rates before the bill lands, so we can report the real delta.
  const before = new Map<string, number>();
  for (const m of materials) before.set(m.id, latestCostPerGram(m.id, sheetIn) * 1000);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(bill.date)) {
    warnings.push(`Date "${bill.date}" is not YYYY-MM-DD — using it as given.`);
  }

  const existing = bill.batchNumber ?
    sheetIn.batches.find((b) => b.batchNumber === bill.batchNumber) : undefined;
  const batch: BatchColumn = existing ?
    {...existing, date: bill.date} :
    {
      id: uid(),
      batchNumber: bill.batchNumber || nextBatchNumber(sheetIn),
      date: bill.date,
    };

  const lines: ResolvedLine[] = [];
  const newMaterials: string[] = [];
  const purchaseItems: RawMaterialPurchaseItem[] = [];

  for (const item of bill.items) {
    const name = (item.name || "").trim();
    if (!name) {
      warnings.push("Skipped a line with no material name.");
      continue;
    }
    if (!item.quantity || item.quantity <= 0) {
      warnings.push(`Skipped "${name}" — quantity must be greater than zero.`);
      continue;
    }
    const totalCost = item.totalCost ?? (item.unitCost ?? 0) * item.quantity;
    if (!totalCost || totalCost <= 0) {
      warnings.push(`Skipped "${name}" — needs either totalCost or unitCost.`);
      continue;
    }

    let row = item.materialId ?
      materials.find((m) => m.id === item.materialId) ?? null :
      matchMaterial(name, materials);
    let isNew = false;
    if (!row) {
      const kn = KANNADA.test(name);
      row = {
        id: uid(),
        nameEn: kn ? "" : name,
        nameKn: kn ? name : "",
        unit: item.unit === "piece" ? "piece" : "kg",
        billName: name,
      };
      materials.push(row);
      newMaterials.push(name);
      isNew = true;
    }

    const newRate = cellValueFor(item.quantity, item.unit, totalCost);
    const prevRate = before.get(row.id) ?? 0;
    cells[`${row.id}__${batch.id}`] = newRate;

    lines.push({
      name,
      materialId: row.id,
      materialNameEn: row.nameEn,
      materialNameKn: row.nameKn,
      isNewMaterial: isNew,
      quantity: item.quantity,
      unit: item.unit,
      totalCost,
      newRatePerKg: newRate,
      previousRatePerKg: prevRate,
      changePct: pctChange(prevRate, newRate),
    });

    purchaseItems.push({
      rawMaterialId: row.id,
      rawMaterialName: row.nameKn || row.nameEn || name,
      quantity: item.quantity,
      unit: item.unit,
      unitCost: totalCost / item.quantity,
      totalCost,
    });
  }

  const totalAmount = lines.reduce((s, l) => s + l.totalCost, 0);
  const batches = existing ?
    sheetIn.batches.map((b) => (b.id === batch.id ? {...batch, totalSpend: totalAmount} : b)) :
    [...sheetIn.batches, {...batch, totalSpend: totalAmount}];

  const sheet: RawMaterialCostSheet = {
    materials, batches, cells, updatedAt: sheetIn.updatedAt,
  };

  return {
    dryRun: true,
    batchId: batch.id,
    batchNumber: batch.batchNumber,
    date: bill.date,
    supplierName: bill.supplierName,
    totalAmount,
    lines,
    newMaterials,
    warnings,
    impact: billImpact(sheet, recipes, products, lines.map((l) => l.materialId)),
    sheet,
    purchaseItems,
  };
}

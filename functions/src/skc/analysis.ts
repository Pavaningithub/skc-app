// ─── Pure costing / analysis functions ───────────────────────────────────────
// No Firestore, no HTTP — everything here is deterministic and unit-testable.
// The costing math mirrors src/pages/admin/ProductCostingPage.tsx exactly so the
// admin UI and this API can never disagree.

import type {
  BatchColumn, Product, ProductRecipe, RawMaterialCostSheet, RawMaterialRow, Unit,
} from "./types";

/** Batches in chronological order (date asc, original array position as tie-break). */
export function orderedBatches(sheet: RawMaterialCostSheet): BatchColumn[] {
  return sheet.batches
    .map((b, i) => ({b, i}))
    .sort((x, y) => x.b.date.localeCompare(y.b.date) || x.i - y.i)
    .map(({b}) => b);
}

/**
 * Every recorded rate for a material, oldest first.
 * Cell values are stored per kg (or per piece); we also expose per gram.
 */
export function rateHistory(
  materialId: string,
  sheet: RawMaterialCostSheet,
): {batch: BatchColumn; perKg: number; perGram: number}[] {
  return orderedBatches(sheet)
    .map((batch) => ({batch, perKg: sheet.cells[`${materialId}__${batch.id}`] ?? 0}))
    .filter((r) => r.perKg > 0)
    .map((r) => ({...r, perGram: r.perKg / 1000}));
}

/** Latest known cost per gram for a material (0 if never purchased). */
export function latestCostPerGram(materialId: string, sheet: RawMaterialCostSheet): number {
  const h = rateHistory(materialId, sheet);
  return h.length ? h[h.length - 1].perGram : 0;
}

/** Cost per gram from the purchase before the latest one (0 if only one). */
export function previousCostPerGram(materialId: string, sheet: RawMaterialCostSheet): number {
  const h = rateHistory(materialId, sheet);
  return h.length >= 2 ? h[h.length - 2].perGram : 0;
}

export function pctChange(from: number, to: number): number {
  if (!from) return 0;
  return ((to - from) / from) * 100;
}

// ─── Raw material trends ─────────────────────────────────────────────────────

export interface MaterialTrend {
  materialId: string;
  nameEn: string;
  nameKn: string;
  unit: Unit;
  brand?: string;
  latestPerKg: number;
  previousPerKg: number;
  changePerKg: number;
  changePct: number;
  latestBatchNumber?: string;
  latestDate?: string;
  previousDate?: string;
  purchaseCount: number;
  minPerKg: number;
  maxPerKg: number;
  avgPerKg: number;
}

export function materialTrends(sheet: RawMaterialCostSheet): MaterialTrend[] {
  return sheet.materials.map((m) => {
    const h = rateHistory(m.id, sheet);
    const rates = h.map((r) => r.perKg);
    const latest = h[h.length - 1];
    const prev = h[h.length - 2];
    const latestPerKg = latest?.perKg ?? 0;
    const previousPerKg = prev?.perKg ?? 0;
    return {
      materialId: m.id,
      nameEn: m.nameEn,
      nameKn: m.nameKn,
      unit: m.unit,
      brand: m.brand,
      latestPerKg,
      previousPerKg,
      changePerKg: previousPerKg ? latestPerKg - previousPerKg : 0,
      changePct: pctChange(previousPerKg, latestPerKg),
      latestBatchNumber: latest?.batch.batchNumber,
      latestDate: latest?.batch.date,
      previousDate: prev?.batch.date,
      purchaseCount: h.length,
      minPerKg: rates.length ? Math.min(...rates) : 0,
      maxPerKg: rates.length ? Math.max(...rates) : 0,
      avgPerKg: rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : 0,
    };
  });
}

// ─── Product costing ─────────────────────────────────────────────────────────

export interface CostedIngredient {
  materialId: string;
  materialName: string;
  quantityGrams: number;
  costPerGram: number;
  cost: number;
  /** Share of this product's raw-material cost, 0-100. */
  sharePct: number;
  /** Cost using the previous purchase rate (0 when there is no earlier rate). */
  previousCost: number;
  hasRate: boolean;
}

export interface ProductCosting {
  productId: string;
  productName: string;
  yieldKg: number;
  piecesPerKg?: number;
  ingredients: CostedIngredient[];
  rawMaterialCost: number;
  overheads: {label: string; type: "fixed" | "pct"; value: number; cost: number}[];
  overheadCost: number;
  totalCost: number;
  profitType: "fixed" | "pct";
  profitValue: number;
  profitAmount: number;
  suggestedPricePerKg: number;
  suggestedPricePerPiece: number | null;
  /** Price currently live on the storefront, normalised to ₹/kg. */
  currentPricePerKg: number | null;
  currentPricePerUnit: number | null;
  currentUnit: Unit | null;
  /** Actual margin at the current selling price, as % of cost. 0 cost -> null. */
  currentMarginPct: number | null;
  /** ₹/kg the current price is short of (positive) or above (negative) the suggestion. */
  priceGapPerKg: number | null;
  /** Suggested price/kg using the previous purchase rates — shows bill impact. */
  previousSuggestedPricePerKg: number;
  costChangePerKg: number;
  costChangePct: number;
  missingRates: string[];
}

function costPerKgFor(unit: Unit, pricePerUnit: number): number {
  // Storefront prices are per gram / per kg / per piece.
  if (unit === "gram") return pricePerUnit * 1000;
  if (unit === "kg") return pricePerUnit;
  return pricePerUnit; // piece — not comparable per kg, handled by the caller
}

export function costProduct(
  recipe: ProductRecipe,
  sheet: RawMaterialCostSheet,
  product?: Product,
): ProductCosting {
  const yieldKg = recipe.yieldKg || 1;
  const byId = new Map<string, RawMaterialRow>(sheet.materials.map((m) => [m.id, m]));

  const priced = recipe.ingredients.map((ing) => {
    const costPerGram = latestCostPerGram(ing.materialId, sheet);
    const prevPerGram = previousCostPerGram(ing.materialId, sheet) || costPerGram;
    return {
      materialId: ing.materialId,
      materialName: byId.get(ing.materialId)?.nameEn || ing.materialName,
      quantityGrams: ing.quantityGrams,
      costPerGram,
      cost: costPerGram * ing.quantityGrams,
      previousCost: prevPerGram * ing.quantityGrams,
      hasRate: costPerGram > 0,
      sharePct: 0,
    };
  });

  const rawMaterialCost = priced.reduce((s, i) => s + i.cost, 0);
  const prevRawCost = priced.reduce((s, i) => s + i.previousCost, 0);
  const ingredients: CostedIngredient[] = priced.map((i) => ({
    ...i,
    sharePct: rawMaterialCost > 0 ? (i.cost / rawMaterialCost) * 100 : 0,
  }));

  const overheads = recipe.overheads.map((o) => ({
    label: o.label,
    type: o.type,
    value: o.value || 0,
    cost: o.type === "fixed" ? (o.value || 0) : rawMaterialCost * (o.value || 0) / 100,
  }));
  const overheadCost = overheads.reduce((s, o) => s + o.cost, 0);
  const totalCost = rawMaterialCost + overheadCost;

  const profitOf = (base: number) =>
    recipe.profitType === "fixed" ? recipe.profitValue : base * recipe.profitValue / 100;
  const profitAmount = profitOf(totalCost);
  const suggestedPricePerKg = (totalCost + profitAmount) / yieldKg;

  const prevOverhead = recipe.overheads.reduce(
    (s, o) => s + (o.type === "fixed" ? (o.value || 0) : prevRawCost * (o.value || 0) / 100), 0);
  const prevTotal = prevRawCost + prevOverhead;
  const previousSuggestedPricePerKg = (prevTotal + profitOf(prevTotal)) / yieldKg;

  const costPerKg = totalCost / yieldKg;
  let currentPricePerKg: number | null = null;
  let currentMarginPct: number | null = null;
  if (product && product.pricePerUnit > 0) {
    if (product.unit === "piece") {
      currentPricePerKg = recipe.piecesPerKg ?
        product.pricePerUnit * recipe.piecesPerKg : null;
    } else {
      currentPricePerKg = costPerKgFor(product.unit, product.pricePerUnit);
    }
    if (currentPricePerKg !== null && costPerKg > 0) {
      currentMarginPct = ((currentPricePerKg - costPerKg) / costPerKg) * 100;
    }
  }

  return {
    productId: recipe.productId,
    productName: recipe.productName,
    yieldKg,
    piecesPerKg: recipe.piecesPerKg,
    ingredients,
    rawMaterialCost,
    overheads,
    overheadCost,
    totalCost,
    profitType: recipe.profitType,
    profitValue: recipe.profitValue,
    profitAmount,
    suggestedPricePerKg,
    suggestedPricePerPiece: recipe.piecesPerKg ?
      suggestedPricePerKg / recipe.piecesPerKg : null,
    currentPricePerKg,
    currentPricePerUnit: product?.pricePerUnit ?? null,
    currentUnit: product?.unit ?? null,
    currentMarginPct,
    priceGapPerKg: currentPricePerKg === null ?
      null : suggestedPricePerKg - currentPricePerKg,
    previousSuggestedPricePerKg,
    costChangePerKg: suggestedPricePerKg - previousSuggestedPricePerKg,
    costChangePct: pctChange(previousSuggestedPricePerKg, suggestedPricePerKg),
    missingRates: ingredients.filter((i) => !i.hasRate).map((i) => i.materialName),
  };
}

// ─── Margin suggestion ───────────────────────────────────────────────────────

export interface MarginSuggestion {
  productId: string;
  productName: string;
  costPerKg: number;
  currentPricePerKg: number | null;
  currentMarginPct: number | null;
  targetMarginPct: number;
  suggestedPricePerKg: number;
  suggestedPricePerPiece: number | null;
  /** Suggested price rounded to a shop-friendly figure. */
  roundedPricePerKg: number;
  changeFromCurrentPct: number | null;
  reason: string;
}

/** Round to the nearest ₹5 for prices under ₹500/kg, else nearest ₹10. */
export function shopRound(value: number): number {
  const step = value < 500 ? 5 : 10;
  return Math.round(value / step) * step;
}

export function suggestMargin(c: ProductCosting, targetMarginPct: number): MarginSuggestion {
  const costPerKg = c.totalCost / (c.yieldKg || 1);
  const suggested = costPerKg * (1 + targetMarginPct / 100);
  const reasons: string[] = [];
  if (c.missingRates.length) {
    reasons.push(`Missing purchase rates for: ${c.missingRates.join(", ")} — cost is understated.`);
  }
  if (c.currentMarginPct !== null && c.currentMarginPct < targetMarginPct) {
    reasons.push(
      `Current margin ${c.currentMarginPct.toFixed(1)}% is below the ${targetMarginPct}% target.`);
  } else if (c.currentMarginPct !== null) {
    reasons.push(`Current margin ${c.currentMarginPct.toFixed(1)}% already meets the target.`);
  } else {
    reasons.push("No live storefront price to compare against.");
  }
  if (Math.abs(c.costChangePct) >= 1) {
    reasons.push(
      `Raw-material cost moved ${c.costChangePct >= 0 ? "up" : "down"} ` +
      `${Math.abs(c.costChangePct).toFixed(1)}% since the previous purchase.`);
  }
  return {
    productId: c.productId,
    productName: c.productName,
    costPerKg,
    currentPricePerKg: c.currentPricePerKg,
    currentMarginPct: c.currentMarginPct,
    targetMarginPct,
    suggestedPricePerKg: suggested,
    suggestedPricePerPiece: c.piecesPerKg ? suggested / c.piecesPerKg : null,
    roundedPricePerKg: shopRound(suggested),
    changeFromCurrentPct: c.currentPricePerKg ?
      pctChange(c.currentPricePerKg, suggested) : null,
    reason: reasons.join(" "),
  };
}

// ─── Bill impact ─────────────────────────────────────────────────────────────

export interface BillImpact {
  materialsChanged: {
    materialId: string;
    name: string;
    previousPerKg: number;
    newPerKg: number;
    changePct: number;
  }[];
  productsAffected: {
    productId: string;
    productName: string;
    previousCostPerKg: number;
    newCostPerKg: number;
    costChangePerKg: number;
    costChangePct: number;
    currentPricePerKg: number | null;
    currentMarginPct: number | null;
    marginBefore: number | null;
    needsPriceReview: boolean;
  }[];
}

/**
 * Which products are affected by the most recent rate changes, and by how much.
 * `materialIds` limits the analysis to the materials on one bill; omit for all.
 */
export function billImpact(
  sheet: RawMaterialCostSheet,
  recipes: ProductRecipe[],
  products: Product[],
  materialIds?: string[],
  reviewThresholdPct = 2,
): BillImpact {
  const scope = materialIds && materialIds.length ? new Set(materialIds) : null;
  const trends = materialTrends(sheet).filter(
    (t) => (!scope || scope.has(t.materialId)) && t.previousPerKg > 0 && t.changePerKg !== 0);

  const productById = new Map(products.map((p) => [p.id, p]));
  const affected = recipes
    .filter((r) => !scope || r.ingredients.some((i) => scope.has(i.materialId)))
    .map((r) => {
      const c = costProduct(r, sheet, productById.get(r.productId));
      const yieldKg = c.yieldKg || 1;
      const newCostPerKg = c.totalCost / yieldKg;
      const prevCostPerKg = newCostPerKg - (c.costChangePerKg /
        (1 + (c.profitType === "pct" ? c.profitValue / 100 : 0)));
      const marginBefore = c.currentPricePerKg !== null && prevCostPerKg > 0 ?
        ((c.currentPricePerKg - prevCostPerKg) / prevCostPerKg) * 100 : null;
      return {
        productId: c.productId,
        productName: c.productName,
        previousCostPerKg: prevCostPerKg,
        newCostPerKg,
        costChangePerKg: newCostPerKg - prevCostPerKg,
        costChangePct: pctChange(prevCostPerKg, newCostPerKg),
        currentPricePerKg: c.currentPricePerKg,
        currentMarginPct: c.currentMarginPct,
        marginBefore,
        needsPriceReview:
          Math.abs(pctChange(prevCostPerKg, newCostPerKg)) >= reviewThresholdPct ||
          (c.priceGapPerKg !== null && c.priceGapPerKg > 0),
      };
    })
    .filter((p) => p.costChangePerKg !== 0 || p.needsPriceReview)
    .sort((a, b) => Math.abs(b.costChangePct) - Math.abs(a.costChangePct));

  return {
    materialsChanged: trends.map((t) => ({
      materialId: t.materialId,
      name: t.nameEn || t.nameKn,
      previousPerKg: t.previousPerKg,
      newPerKg: t.latestPerKg,
      changePct: t.changePct,
    })),
    productsAffected: affected,
  };
}

// ─── Material matching (bill line -> cost sheet row) ─────────────────────────

function norm(s: string): string {
  return s.toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/**
 * Find the cost-sheet row a bill line refers to. Matches on the English name,
 * the Kannada name, or the name as printed on the bill — exact first, then
 * containment. Returns null when nothing matches confidently.
 */
export function matchMaterial(
  name: string,
  materials: RawMaterialRow[],
): RawMaterialRow | null {
  const n = norm(name);
  if (!n) return null;
  const keys = (m: RawMaterialRow) => [m.nameEn, m.nameKn, m.billName]
    .filter((v): v is string => !!v).map(norm);

  for (const m of materials) if (keys(m).includes(n)) return m;
  const partial = materials.filter((m) =>
    keys(m).some((k) => k.length >= 3 && (k.includes(n) || n.includes(k))));
  return partial.length === 1 ? partial[0] : null;
}

/** Convert a bill line's price into the cost-sheet cell value (₹ per kg / piece). */
export function cellValueFor(
  quantity: number, unit: Unit, totalCost: number,
): number {
  if (!quantity || quantity <= 0) return 0;
  const perUnit = totalCost / quantity;
  if (unit === "gram") return perUnit * 1000;
  return perUnit; // kg -> per kg, piece -> per piece
}

// ─── Shared costing helpers ──────────────────────────────────────────────────
// Used by the Product Costing page (what a product costs to make) and by
// Analytics (what the goods actually sold cost to make). Keeping one copy means
// the two screens can never quote different numbers for the same product.

import type { Order, ProductRecipe, RawMaterialCostSheet } from './types';

// Firestore documents are cast to these types without validation, so a doc
// saved before a field existed arrives with it undefined. Reading such a field
// as an array would throw during render and blank the whole page, so every
// access below tolerates it being absent.

/** Batches oldest first — cost-sheet columns are not guaranteed to be in date order. */
function orderedBatches(sheet: RawMaterialCostSheet) {
  return (sheet?.batches ?? [])
    .map((b, i) => ({ b, i }))
    .sort((x, y) => x.b.date.localeCompare(y.b.date) || x.i - y.i)
    .map(({ b }) => b);
}

/** Latest recorded cost per gram for a material. 0 when never purchased. */
export function latestCostPerGram(materialId: string, sheet: RawMaterialCostSheet): number {
  const batches = orderedBatches(sheet);
  const cells = sheet?.cells ?? {};
  for (let i = batches.length - 1; i >= 0; i--) {
    const perKg = cells[`${materialId}__${batches[i].id}`];
    if (perKg && perKg > 0) return perKg / 1000;
  }
  return 0;
}

export interface RecipeCost {
  rawMaterialCost: number;
  overheadCost: number;
  /** Raw + overheads for one batch. Excludes profit — this is cost, not price. */
  totalCost: number;
  costPerKg: number;
  costPerPiece: number | null;
  /** Ingredients with no purchase rate yet; cost is understated while non-empty. */
  missingRates: string[];
}

export function recipeCost(recipe: ProductRecipe, sheet: RawMaterialCostSheet): RecipeCost {
  const missingRates: string[] = [];
  const rawMaterialCost = (recipe?.ingredients ?? []).reduce((sum, ing) => {
    const perGram = latestCostPerGram(ing.materialId, sheet);
    if (perGram <= 0) missingRates.push(ing.materialName);
    return sum + perGram * ing.quantityGrams;
  }, 0);

  const overheadCost = (recipe?.overheads ?? []).reduce((sum, o) => (
    o.type === 'fixed' ? sum + (o.value || 0) : sum + rawMaterialCost * (o.value || 0) / 100
  ), 0);

  const totalCost = rawMaterialCost + overheadCost;
  const yieldKg = recipe?.yieldKg || 1;
  const costPerKg = totalCost / yieldKg;

  return {
    rawMaterialCost,
    overheadCost,
    totalCost,
    costPerKg,
    costPerPiece: recipe.piecesPerKg ? costPerKg / recipe.piecesPerKg : null,
    missingRates,
  };
}

/** What one order line cost to make. null when it cannot be costed. */
function lineCost(
  item: Order['items'][number],
  costs: Map<string, RecipeCost>,
): number | null {
  const c = costs.get(item?.productId);
  if (!c || !Number.isFinite(c.costPerKg) || c.costPerKg <= 0) return null;
  if (!Number.isFinite(item?.quantity)) return null;
  if (item.unit === 'gram') return (c.costPerKg / 1000) * item.quantity;
  if (item.unit === 'kg') return c.costPerKg * item.quantity;
  // Per-piece products need piecesPerKg on the recipe to convert.
  return c.costPerPiece !== null && Number.isFinite(c.costPerPiece)
    ? c.costPerPiece * item.quantity : null;
}

export interface CogsResult {
  /** Cost of the goods sold, across lines that could be costed. */
  cogs: number;
  /** Revenue from lines that could be costed. */
  coveredRevenue: number;
  /** Revenue from lines with no usable recipe — excluded from the margin. */
  uncoveredRevenue: number;
  /** Share of revenue the margin is actually based on, 0-100. */
  coveragePct: number;
  /** Gross profit on the covered portion only. */
  grossProfit: number;
  /** Gross margin as a % of covered revenue. null when nothing is covered. */
  grossMarginPct: number | null;
  /** Products seen in orders that have no recipe, so cannot be costed. */
  productsWithoutRecipe: string[];
}

/**
 * Cost of goods sold across a set of orders, using the latest purchase rates.
 *
 * Only lines whose product has a usable recipe are counted, on both sides of
 * the ratio — mixing uncosted revenue into the numerator would inflate the
 * margin. coveragePct says how much of the revenue the figure rests on.
 */
export function computeCogs(
  orders: Order[],
  recipes: ProductRecipe[],
  sheet: RawMaterialCostSheet,
): CogsResult {
  const costs = new Map<string, RecipeCost>();
  for (const r of recipes ?? []) {
    if (r?.productId) costs.set(r.productId, recipeCost(r, sheet));
  }

  let cogs = 0;
  let coveredRevenue = 0;
  let uncoveredRevenue = 0;
  const missing = new Set<string>();

  for (const order of orders ?? []) {
    for (const item of order?.items ?? []) {
      const cost = lineCost(item, costs);
      if (cost === null) {
        uncoveredRevenue += item.totalPrice || 0;
        if (!costs.has(item.productId)) missing.add(item.productName);
        continue;
      }
      cogs += cost;
      coveredRevenue += item.totalPrice || 0;
    }
  }

  const totalRevenue = coveredRevenue + uncoveredRevenue;
  const grossProfit = coveredRevenue - cogs;

  return {
    cogs,
    coveredRevenue,
    uncoveredRevenue,
    coveragePct: totalRevenue > 0 ? (coveredRevenue / totalRevenue) * 100 : 0,
    grossProfit,
    grossMarginPct: coveredRevenue > 0 ? (grossProfit / coveredRevenue) * 100 : null,
    productsWithoutRecipe: [...missing].sort(),
  };
}

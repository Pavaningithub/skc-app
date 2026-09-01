#!/usr/bin/env node
// ─── SKC MCP server ──────────────────────────────────────────────────────────
// Exposes Sri Krishna Condiments bill, raw-material-cost and product-costing
// data as MCP tools, so any MCP-capable assistant can read and update it. All
// the analysis lives in the SKC backend (functions/src/skc); this server is a
// thin, typed bridge — swap the assistant, keep the data.
//
// Configuration (environment):
//   SKC_API_URL    https://asia-south1-<project>.cloudfunctions.net/skcApi
//   SKC_API_TOKEN  the value of the SKC_API_TOKEN Firebase secret

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { callApi, readConfig, type SkcConfig } from "./client.js";

const server = new McpServer({ name: "skc-mcp-server", version: "1.0.0" });

let cachedConfig: SkcConfig | null = null;
function config(): SkcConfig {
  if (!cachedConfig) cachedConfig = readConfig();
  return cachedConfig;
}

type ToolResult = {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

/** Run an API call and shape it into an MCP tool result. */
async function run(
  route: string,
  params: Record<string, unknown>,
  method: "GET" | "POST" = "GET",
): Promise<ToolResult> {
  try {
    const data = await callApi(config(), route, params, method);
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      structuredContent: data as Record<string, unknown>,
    };
  } catch (err) {
    return {
      content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
      isError: true,
    };
  }
}

const READ_ONLY = {
  readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true,
} as const;
const WRITES = {
  readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true,
} as const;

// ─── Raw materials ───────────────────────────────────────────────────────────

server.registerTool("skc_list_raw_materials", {
  title: "List SKC raw materials",
  description: `List every raw material tracked on the SKC cost sheet, with its latest purchase rate.

Use this first when you need a materialId, or to check whether a material a bill mentions already exists (names may be in Kannada or English).

Returns: { count, materials: [{ materialId, nameEn, nameKn, brand, billName, unit, latestRatePerKg, latestDate, purchaseCount }], batches: [{ batchId, batchNumber, date, totalSpend }] }`,
  inputSchema: {},
  annotations: READ_ONLY,
}, async () => run("raw-materials", {}));

server.registerTool("skc_raw_material_trends", {
  title: "Raw material cost trends",
  description: `Show how each raw material's cost moved between its two most recent purchases — this is the "which costs went up?" question.

Args:
  - minChangePct (number, optional): only include materials whose cost moved at least this much, in either direction. Default 0 (all).
  - limit (number, optional): maximum materials to return. Default 100.

Returns: { asOf, materialsTracked, risingCount, fallingCount, biggestIncrease, biggestDecrease, trends: [{ materialId, nameEn, nameKn, latestPerKg, previousPerKg, changePerKg, changePct, latestDate, previousDate, purchaseCount, minPerKg, maxPerKg, avgPerKg }] }, sorted by changePct descending.

Use when: "which raw materials got costlier?", "ಯಾವ ಸಾಮಾನು ದುಬಾರಿ ಆಗಿದೆ?"`,
  inputSchema: {
    minChangePct: z.number().min(0).optional()
      .describe("Only report materials that moved at least this percent"),
    limit: z.number().int().min(1).max(500).optional().describe("Max rows to return"),
  },
  annotations: READ_ONLY,
}, async (args) => run("raw-material-trends", args));

server.registerTool("skc_material_history", {
  title: "Purchase-rate history for one material",
  description: `Full rate history for a single raw material, oldest purchase first.

Args:
  - materialId (string): id from skc_list_raw_materials.

Returns: { materialId, nameEn, nameKn, unit, history: [{ batchNumber, date, ratePerKg }] }

Use when someone asks how a specific item's price has moved over time.`,
  inputSchema: {
    materialId: z.string().min(1).describe("Material id from skc_list_raw_materials"),
  },
  annotations: READ_ONLY,
}, async (args) => run("material-history", args));

server.registerTool("skc_add_raw_material", {
  title: "Add a raw material to the cost sheet",
  description: `Create a new raw-material row. Only needed when skc_record_bill could not match a name and you want to control the naming; recording a bill creates missing materials automatically.

Args:
  - nameEn (string, optional): English name. At least one of nameEn/nameKn is required.
  - nameKn (string, optional): Kannada name.
  - unit ('gram'|'kg'|'piece', optional): default 'kg'.
  - brand (string, optional), billName (string, optional): name as printed on bills.

Returns: { created: true, material: { materialId, nameEn, nameKn, unit, brand, billName } }`,
  inputSchema: {
    nameEn: z.string().optional().describe("English name, e.g. 'Groundnut'"),
    nameKn: z.string().optional().describe("Kannada name, e.g. 'ಕಡಲೆಕಾಯಿ'"),
    unit: z.enum(["gram", "kg", "piece"]).optional().describe("Purchase unit, default kg"),
    brand: z.string().optional().describe("Brand, e.g. 'PREMIA'"),
    billName: z.string().optional().describe("Exact name printed on the supplier bill"),
  },
  annotations: WRITES,
}, async (args) => run("add-raw-material", args, "POST"));

// ─── Bills ───────────────────────────────────────────────────────────────────

const billItem = z.object({
  name: z.string().min(1).describe("Material name as spoken or printed — Kannada or English"),
  quantity: z.number().positive().describe("Quantity purchased, in the given unit"),
  unit: z.enum(["gram", "kg", "piece"]).describe("Unit the quantity is expressed in"),
  totalCost: z.number().positive().optional().describe("Total rupees paid for this line"),
  unitCost: z.number().positive().optional().describe("Rupees per unit — used only if totalCost is absent"),
  materialId: z.string().optional().describe("Skip name matching by naming the cost-sheet row directly"),
});

server.registerTool("skc_record_bill", {
  title: "Record a raw-material bill",
  description: `Record one supplier bill: it becomes a purchase record, a new batch column on the cost sheet, one rate per line item, and a raw_material expense entry.

DEFAULTS TO A PREVIEW. dryRun is true unless you pass false, so you can show the parsed bill and its cost impact to the person first and only save after they confirm. Always preview, read the result back to them, then re-send with dryRun:false.

Args:
  - date (string): bill date, YYYY-MM-DD.
  - items (array): each { name, quantity, unit, totalCost } — give totalCost (what was actually paid) whenever you have it.
  - supplierName (string, optional), notes (string, optional), enteredBy (string, optional)
  - batchNumber (string, optional): reuse an existing batch column instead of creating one.
  - billPhotoUrl (string, optional): Firebase Storage URL of the bill photo.
  - createExpense (boolean, optional): also write an expense row. Default true.
  - dryRun (boolean, optional): default true (preview only).

Returns: { dryRun, purchaseId?, batchNumber, date, totalAmount, lines: [{ name, materialId, isNewMaterial, quantity, unit, totalCost, newRatePerKg, previousRatePerKg, changePct }], newMaterials, warnings, impact: { materialsChanged, productsAffected } }

Check newMaterials and warnings in the preview — a material appearing as new usually means a spelling variant that should be matched to an existing row via materialId instead.`,
  inputSchema: {
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Bill date, YYYY-MM-DD"),
    items: z.array(billItem).min(1).describe("Line items on the bill"),
    supplierName: z.string().optional().describe("Shop or supplier name"),
    notes: z.string().optional().describe("Any note to store with the bill"),
    enteredBy: z.string().optional().describe("Who provided the bill"),
    batchNumber: z.string().optional().describe("Existing batch column to update"),
    billPhotoUrl: z.string().optional().describe("Storage URL of the bill photo"),
    createExpense: z.boolean().optional().describe("Also record an expense row (default true)"),
    dryRun: z.boolean().optional().describe("Preview without saving (default true)"),
  },
  annotations: WRITES,
}, async (args) => run("record-bill", args, "POST"));

server.registerTool("skc_list_bills", {
  title: "List recorded bills",
  description: `List raw-material bills, newest first, with their line items.

Args:
  - from (string, optional), to (string, optional): YYYY-MM-DD date range filter.
  - limit (number, optional): default 20.

Returns: { count, totalSpend, bills: [{ purchaseId, date, supplierName, totalAmount, itemCount, enteredBy, notes, items }] }`,
  inputSchema: {
    from: z.string().optional().describe("Earliest bill date, YYYY-MM-DD"),
    to: z.string().optional().describe("Latest bill date, YYYY-MM-DD"),
    limit: z.number().int().min(1).max(200).optional().describe("Max bills to return"),
  },
  annotations: READ_ONLY,
}, async (args) => run("bills", args));

server.registerTool("skc_bill_impact", {
  title: "Cost impact of a bill on products",
  description: `Show which products got more or less expensive because raw-material rates changed, and which need a price review.

Args:
  - purchaseId (string, optional): scope to the materials on one recorded bill (from skc_list_bills).
  - materialIds (string[], optional): scope to specific materials instead.
  - thresholdPct (number, optional): cost move that counts as needing review. Default 2.
  Omit all three to analyse every material's latest change.

Returns: { scope, materialsChanged: [{ materialId, name, previousPerKg, newPerKg, changePct }], productsAffected: [{ productId, productName, previousCostPerKg, newCostPerKg, costChangePerKg, costChangePct, currentPricePerKg, currentMarginPct, marginBefore, needsPriceReview }] }`,
  inputSchema: {
    purchaseId: z.string().optional().describe("Bill id from skc_list_bills"),
    materialIds: z.array(z.string()).optional().describe("Specific material ids to scope to"),
    thresholdPct: z.number().min(0).optional().describe("Cost move % that flags a price review"),
  },
  annotations: READ_ONLY,
}, async (args) => run("bill-impact", args));

// ─── Costing and pricing ─────────────────────────────────────────────────────

server.registerTool("skc_product_costing", {
  title: "Product cost breakdown",
  description: `Full cost breakdown per product from its recipe and the latest raw-material rates — the same maths the admin Product Costing page shows.

Args:
  - productId (string, optional): a product id or exact product name. Omit for every product with a recipe.

Returns: { count, productsWithoutRecipe: [{ productId, name }], costings: [{ productId, productName, yieldKg, piecesPerKg, ingredients: [{ materialName, quantityGrams, costPerGram, cost, sharePct, hasRate }], rawMaterialCost, overheads, overheadCost, totalCost, profitAmount, suggestedPricePerKg, suggestedPricePerPiece, currentPricePerKg, currentMarginPct, priceGapPerKg, previousSuggestedPricePerKg, costChangePerKg, costChangePct, missingRates }] }

missingRates lists ingredients with no purchase rate yet — the cost is understated until those are bought and recorded. Mention this whenever it is non-empty.`,
  inputSchema: {
    productId: z.string().optional().describe("Product id or exact product name"),
  },
  annotations: READ_ONLY,
}, async (args) => run("product-costing", args));

server.registerTool("skc_margin_suggestions", {
  title: "Suggested selling prices",
  description: `Suggest a selling price per product for a target margin, and flag products currently priced below it.

Args:
  - targetMarginPct (number, optional): margin over cost to aim for. Default 30 — chosen so that orders carrying a referral, subscription or family discount still clear a real margin.
  - productId (string, optional): limit to one product.

Returns: { targetMarginPct, underTarget, suggestions: [{ productId, productName, costPerKg, currentPricePerKg, currentMarginPct, targetMarginPct, suggestedPricePerKg, suggestedPricePerPiece, roundedPricePerKg, changeFromCurrentPct, reason }] }, worst margin first.

roundedPricePerKg is the shop-friendly figure (nearest ₹5 under ₹500/kg, else ₹10) — quote that one to people. This only suggests; use skc_set_product_price to actually change a price.`,
  inputSchema: {
    targetMarginPct: z.number().min(0).max(500).optional().describe("Target margin over cost, % (default 30)"),
    productId: z.string().optional().describe("Product id or exact product name"),
  },
  annotations: READ_ONLY,
}, async (args) => run("margin-suggestions", args));

server.registerTool("skc_list_products", {
  title: "List SKC products",
  description: `List all products with their live storefront price and whether a costing recipe exists.

Returns: { count, products: [{ productId, name, nameKannada, unit, pricePerUnit, isActive, category, hasRecipe }] }

Products with hasRecipe:false cannot be costed — their recipe must be entered in the admin Product Costing page first.`,
  inputSchema: {},
  annotations: READ_ONLY,
}, async () => run("products", {}));

server.registerTool("skc_set_product_price", {
  title: "Change a product's selling price",
  description: `Update the live storefront price of a product.

DEFAULTS TO A PREVIEW. dryRun is true unless you pass false. This price is what customers see on skctreats.in, so always show the current price and the proposed price and get an explicit yes before sending dryRun:false.

Args:
  - productId (string): id from skc_list_products.
  - pricePerUnit (number): new price in the product's own unit (per gram / per kg / per piece — check the unit field, prices are often per gram).
  - dryRun (boolean, optional): default true.

Returns: { dryRun|saved, productId, name, unit, currentPricePerUnit/previousPricePerUnit, pricePerUnit }`,
  inputSchema: {
    productId: z.string().min(1).describe("Product id from skc_list_products"),
    pricePerUnit: z.number().positive().describe("New price in the product's own unit"),
    dryRun: z.boolean().optional().describe("Preview without saving (default true)"),
  },
  annotations: WRITES,
}, async (args) => run("set-product-price", args, "POST"));


server.registerTool("skc_set_recipe", {
  title: "Create or update a product recipe",
  description: `Set what a product is made of: the raw materials and quantities for one batch, the overheads, and the profit target. Product costing and price suggestions are impossible without a recipe.

DEFAULTS TO A PREVIEW. dryRun is true unless you pass false. The preview costs the recipe immediately, so you can read back the resulting price per kg before saving.

Args:
  - productId (string): product id or exact product name, from skc_list_products.
  - ingredients (array, optional): [{ name, quantityGrams }] — quantities for ONE batch of yieldKg, not per kg. Replaces the whole ingredient list; omit to keep the current one. Names are matched against the cost sheet (Kannada, English, or bill name); an unmatched name is an error, because an ingredient with no purchase rate can never be costed — add it with skc_add_raw_material or record a bill containing it first.
  - yieldKg (number, optional): kg of finished product one batch makes. Default 1. If 1 kg of input yields only 900 g sold, set 0.9 — otherwise you price against weight you never sell.
  - piecesPerKg (number, optional): for products sold by piece, e.g. 54 laddus per kg.
  - overheads (array, optional): [{ label, type: 'fixed'|'pct', value }] — 'fixed' is rupees per batch, 'pct' is a percent of raw-material cost. Replaces the whole list. A new recipe starts with Labour, Gas, Packaging and Delivery at ₹0.
  - profitType ('fixed'|'pct', optional) and profitValue (number, optional): profit on top of total cost. Defaults to 30%.
  - dryRun (boolean, optional): default true.

Returns: { dryRun|saved, productId, productName, isNew, recipe: {...}, costing: { rawMaterialCost, overheadCost, totalCost, profitAmount, suggestedPricePerKg, suggestedPricePerPiece, currentPricePerKg, currentMarginPct, missingRates } }

Setting a recipe does not change the selling price — use skc_set_product_price for that.`,
  inputSchema: {
    productId: z.string().min(1).describe("Product id or exact name from skc_list_products"),
    ingredients: z.array(z.object({
      name: z.string().optional().describe("Material name — Kannada, English, or as printed on bills"),
      materialId: z.string().optional().describe("Cost-sheet row id, instead of matching by name"),
      quantityGrams: z.number().positive().describe("Grams used per batch of yieldKg"),
    })).optional().describe("Full ingredient list for one batch; omit to keep the current one"),
    yieldKg: z.number().positive().optional().describe("Kg of finished product per batch"),
    piecesPerKg: z.number().positive().optional().describe("Pieces per kg, for per-piece products"),
    overheads: z.array(z.object({
      label: z.string().min(1).describe("e.g. Labour, Gas, Packaging, Delivery"),
      type: z.enum(["fixed", "pct"]).describe("'fixed' = ₹ per batch, 'pct' = % of raw cost"),
      value: z.number().min(0).describe("Rupees or percent, per the type"),
    })).optional().describe("Full overhead list; omit to keep the current one"),
    profitType: z.enum(["fixed", "pct"]).optional().describe("Profit as rupees or percent of cost"),
    profitValue: z.number().min(0).optional().describe("Profit amount or percent"),
    dryRun: z.boolean().optional().describe("Preview without saving (default true)"),
  },
  annotations: WRITES,
}, async (args) => run("set-recipe", args, "POST"));

// ─── Summary ─────────────────────────────────────────────────────────────────

server.registerTool("skc_business_summary", {
  title: "Business summary for a period",
  description: `Revenue, expenses, profit, bill spend and pricing alerts for a date range.

Args:
  - from (string, optional), to (string, optional): YYYY-MM-DD. Defaults to the last 30 days.

Returns: { from, to, orders, revenue, expenses, profit, marginPct, expensesByCategory, bills: { count, totalSpend, latestDate }, pricingAlerts: [{ productName, currentMarginPct, suggestedPricePerKg, currentPricePerKg }] }

Use for "how did this month go?" and month-on-month comparisons (call twice with different ranges).`,
  inputSchema: {
    from: z.string().optional().describe("Start date, YYYY-MM-DD"),
    to: z.string().optional().describe("End date, YYYY-MM-DD"),
  },
  annotations: READ_ONLY,
}, async (args) => run("summary", args));

// ─── Start ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout is the MCP channel — diagnostics must go to stderr.
  console.error("skc-mcp-server ready");
}

main().catch((err) => {
  console.error("skc-mcp-server failed to start:", err);
  process.exit(1);
});

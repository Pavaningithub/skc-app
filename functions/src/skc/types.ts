// ─── SKC domain types (server-side mirror of src/lib/types.ts) ────────────────
// Kept local to the functions codebase because functions/ compiles with its own
// tsconfig and cannot import from the Vite app's src/.

export type Unit = "gram" | "kg" | "piece";

export interface RawMaterialRow {
  id: string;
  nameEn: string;
  nameKn: string;
  unit: Unit;
  brand?: string;
  billName?: string;
}

export interface BatchColumn {
  id: string;
  batchNumber: string;
  date: string; // YYYY-MM-DD
  totalSpend?: number;
}

export interface RawMaterialCostSheet {
  materials: RawMaterialRow[];
  batches: BatchColumn[];
  /** key = `${materialId}__${batchId}`, value = cost per kg (or per piece) */
  cells: Record<string, number>;
  updatedAt: string;
}

export interface RecipeIngredient {
  materialId: string;
  materialName: string;
  quantityGrams: number;
}

export interface RecipeOverhead {
  id: string;
  label: string;
  type: "fixed" | "pct";
  value: number;
}

export interface ProductRecipe {
  id: string;
  productId: string;
  productName: string;
  yieldKg: number;
  piecesPerKg?: number;
  ingredients: RecipeIngredient[];
  overheads: RecipeOverhead[];
  profitType: "fixed" | "pct";
  profitValue: number;
  updatedAt: string;
}

export interface Product {
  id: string;
  name: string;
  nameKannada?: string;
  unit: Unit;
  pricePerUnit: number;
  isActive: boolean;
  category?: string;
}

export interface RawMaterialPurchaseItem {
  rawMaterialId?: string;
  rawMaterialName: string;
  quantity: number;
  unit: Unit;
  unitCost: number;
  totalCost: number;
}

export interface RawMaterialPurchase {
  id: string;
  date: string;
  supplierName?: string;
  items: RawMaterialPurchaseItem[];
  totalAmount: number;
  billPhotoUrl?: string;
  notes: string;
  enteredBy: string;
  batchId?: string; // cost-sheet batch column this bill created/updated
  createdAt: string;
}

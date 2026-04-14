import { useState, useEffect, useMemo } from 'react';
import { useRef } from 'react';
import { Plus, Trash2, X, Search, ChevronDown, ChevronUp, IndianRupee, CloudUpload } from 'lucide-react';
import toast from 'react-hot-toast';
import { productsService, rawMaterialCostSheetService, productRecipeService } from '../../lib/services';
import type { Product } from '../../lib/types';
import type {
  RawMaterialCostSheet, ProductRecipe, RecipeIngredient,
} from '../../lib/types';

function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }

// Get cost per gram for a material from the latest batch in the sheet
function latestCostPerGram(matId: string, sheet: RawMaterialCostSheet): number {
  if (sheet.batches.length === 0) return 0;
  // Walk batches newest-last, pick most recent non-zero entry
  for (let i = sheet.batches.length - 1; i >= 0; i--) {
    const val = sheet.cells[`${matId}__${sheet.batches[i].id}`];
    if (val && val > 0) return val / 1000; // stored as /kg → convert to /gram
  }
  return 0;
}

function emptyRecipe(productId: string, productName: string): ProductRecipe {
  return {
    id: productId,
    productId,
    productName,
    yieldKg: 1,
    piecesPerKg: undefined,
    ingredients: [],
    overheads: [
      { id: uid(), label: 'Labour', type: 'fixed', value: 0 },
      { id: uid(), label: 'Gas', type: 'fixed', value: 0 },
      { id: uid(), label: 'Delivery', type: 'fixed', value: 0 },
    ],
    profitType: 'pct',
    profitValue: 20,
    updatedAt: '',
  };
}

// ── RecipeEditor (for one product) ────────────────────────────────────────────
function RecipeEditor({
  recipe: initial,
  sheet,
  onSave,
  onDelete,
}: {
  recipe: ProductRecipe;
  sheet: RawMaterialCostSheet;
  onSave: (r: ProductRecipe) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [recipe, setRecipe] = useState<ProductRecipe>(initial);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'pending'>('saved');
  const [expanded, setExpanded] = useState(false);
  const autosaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recipeRef = useRef<ProductRecipe>(initial);

  // New ingredient form
  const [addIngMat, setAddIngMat] = useState('');
  const [addIngQty, setAddIngQty] = useState('');

  useEffect(() => { setRecipe(initial); recipeRef.current = initial; }, [initial.productId]);

  function mutate(updater: (r: ProductRecipe) => ProductRecipe) {
    setRecipe(prev => {
      const next = updater(prev);
      recipeRef.current = next;
      setSaveState('pending');
      if (autosaveRef.current) clearTimeout(autosaveRef.current);
      autosaveRef.current = setTimeout(async () => {
        setSaveState('saving');
        try { await onSave(recipeRef.current); setSaveState('saved'); }
        catch { setSaveState('pending'); }
      }, 1500);
      return next;
    });
  }

  function addIngredient() {
    if (!addIngMat) return toast.error('Select a material');
    const qty = parseFloat(addIngQty);
    if (!qty || qty <= 0) return toast.error('Enter quantity in grams');
    const mat = sheet.materials.find(m => m.id === addIngMat);
    if (!mat) return;
    const ing: RecipeIngredient = { materialId: mat.id, materialName: mat.nameEn, quantityGrams: qty };
    mutate(r => ({ ...r, ingredients: [...r.ingredients, ing] }));
    setAddIngMat('');
    setAddIngQty('');
  }

  function removeIngredient(matId: string) {
    mutate(r => ({ ...r, ingredients: r.ingredients.filter(i => i.materialId !== matId) }));
  }

  function updateIngQty(matId: string, qty: number) {
    mutate(r => ({ ...r, ingredients: r.ingredients.map(i => i.materialId === matId ? { ...i, quantityGrams: qty } : i) }));
  }

  function updateOverhead(id: string, field: 'label' | 'type' | 'value', val: string | number) {
    mutate(r => ({ ...r, overheads: r.overheads.map(o => o.id === id ? { ...o, [field]: val } : o) }));
  }

  function addOverhead() {
    mutate(r => ({ ...r, overheads: [...r.overheads, { id: uid(), label: 'Other', type: 'fixed' as const, value: 0 }] }));
  }

  function removeOverhead(id: string) {
    mutate(r => ({ ...r, overheads: r.overheads.filter(o => o.id !== id) }));
  }

  // ── Cost calculation ──────────────────────────────────────────────────────
  const rawMaterialCost = recipe.ingredients.reduce((sum, ing) => {
    const costPerGram = latestCostPerGram(ing.materialId, sheet);
    return sum + costPerGram * ing.quantityGrams;
  }, 0);

  const overheadCost = recipe.overheads.reduce((sum, o) => {
    if (o.type === 'fixed') return sum + (o.value || 0);
    return sum + rawMaterialCost * (o.value || 0) / 100;
  }, 0);

  const totalBeforeProfit = rawMaterialCost + overheadCost;

  const profitAmount = recipe.profitType === 'fixed'
    ? recipe.profitValue
    : totalBeforeProfit * recipe.profitValue / 100;

  const suggestedTotal = totalBeforeProfit + profitAmount;
  const pricePerKg = suggestedTotal / (recipe.yieldKg || 1);
  const pricePerPiece = recipe.piecesPerKg ? pricePerKg / recipe.piecesPerKg : null;

  const hasRates = sheet.batches.length > 0;

  return (
    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
      {/* Header row */}
      <div
        className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-gray-50"
        onClick={() => setExpanded(e => !e)}>
        <div className="flex items-center gap-3">
          {expanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
          <div>
            <p className="font-semibold text-gray-800">{recipe.productName}</p>
            <p className="text-xs text-gray-400">
              {recipe.ingredients.length} ingredient{recipe.ingredients.length !== 1 ? 's' : ''}
              {recipe.piecesPerKg ? ` · ~${recipe.piecesPerKg} pcs/kg` : ''}
            </p>
          </div>
        </div>
        <div className="text-right">
          {hasRates ? (
            <>
              <p className="text-sm font-bold text-orange-600">₹{Math.ceil(pricePerKg)}/kg</p>
              {pricePerPiece && <p className="text-xs text-gray-500">≈ ₹{Math.ceil(pricePerPiece)}/pc</p>}
            </>
          ) : (
            <p className="text-xs text-gray-400">Add batch costs first</p>
          )}
        </div>
      </div>

      {!expanded ? null : (
        <div className="border-t border-gray-100 p-4 space-y-5">
          {/* Yield settings */}
          <div className="flex items-center gap-4 flex-wrap">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Yield (kg per batch)</label>
              <input type="number" min="0.1" step="0.1" value={recipe.yieldKg}
                onChange={e => mutate(r => ({ ...r, yieldKg: parseFloat(e.target.value) || 1 }))}
                className="w-24 border border-gray-200 rounded-xl px-3 py-1.5 text-sm outline-none focus:border-orange-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Pieces per kg (optional)</label>
              <input type="number" min="0" step="1" value={recipe.piecesPerKg ?? ''}
                onChange={e => mutate(r => ({ ...r, piecesPerKg: parseInt(e.target.value) || undefined }))}
                placeholder="e.g. 54"
                className="w-24 border border-gray-200 rounded-xl px-3 py-1.5 text-sm outline-none focus:border-orange-400"
              />
            </div>
          </div>

          {/* Ingredients table */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">🧂 Ingredients (per {recipe.yieldKg}kg batch)</p>
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-50 text-xs text-gray-500">
                  <th className="text-left px-3 py-2 border border-gray-100 font-medium">Material</th>
                  <th className="text-right px-3 py-2 border border-gray-100 font-medium">Qty (g)</th>
                  <th className="text-right px-3 py-2 border border-gray-100 font-medium">Rate (₹/kg)</th>
                  <th className="text-right px-3 py-2 border border-gray-100 font-medium">Cost (₹)</th>
                  <th className="w-8 border border-gray-100"></th>
                </tr>
              </thead>
              <tbody>
                {recipe.ingredients.map(ing => {
                  const costPg = latestCostPerGram(ing.materialId, sheet);
                  const cost = costPg * ing.quantityGrams;
                  return (
                    <tr key={ing.materialId} className="hover:bg-gray-50">
                      <td className="px-3 py-2 border border-gray-100">
                        <p>{ing.materialName}</p>
                        {(() => { const m = sheet.materials.find(x => x.id === ing.materialId); return m?.nameKn ? <p className="text-xs text-gray-400">{m.nameKn}</p> : null; })()}
                      </td>
                      <td className="px-3 py-2 border border-gray-100 text-right">
                        <input type="number" min="1" value={ing.quantityGrams}
                          onChange={e => updateIngQty(ing.materialId, parseFloat(e.target.value) || 0)}
                          className="w-20 text-right border border-gray-200 rounded-lg px-2 py-0.5 text-sm outline-none focus:border-orange-400"
                        />
                      </td>
                      <td className="px-3 py-2 border border-gray-100 text-right text-gray-500">
                        {costPg > 0 ? `₹${Math.round(costPg * 1000)}` : <span className="text-gray-300 text-xs">no rate</span>}
                      </td>
                      <td className={`px-3 py-2 border border-gray-100 text-right font-medium ${cost > 0 ? 'text-gray-800' : 'text-gray-300'}`}>
                        {cost > 0 ? `₹${cost.toFixed(2)}` : '—'}
                      </td>
                      <td className="px-2 py-2 border border-gray-100 text-center">
                        <button onClick={() => removeIngredient(ing.materialId)} className="text-gray-300 hover:text-red-400">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {/* Add ingredient row */}
                <tr className="bg-blue-50/50">
                  <td className="px-3 py-2 border border-gray-100">
                    <select value={addIngMat} onChange={e => setAddIngMat(e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-2 py-1 text-sm outline-none focus:border-orange-400 bg-white">
                      <option value="">+ Add material…</option>
                      {sheet.materials
                        .filter(m => !recipe.ingredients.find(i => i.materialId === m.id))
                        .map(m => <option key={m.id} value={m.id}>{m.nameEn}{m.nameKn ? ` (${m.nameKn})` : ''}</option>)
                      }
                    </select>
                  </td>
                  <td className="px-3 py-2 border border-gray-100">
                    <input type="number" min="1" placeholder="grams"
                      value={addIngQty} onChange={e => setAddIngQty(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && addIngredient()}
                      className="w-20 text-right border border-gray-200 rounded-lg px-2 py-1 text-sm outline-none focus:border-orange-400"
                    />
                  </td>
                  <td className="border border-gray-100" />
                  <td className="border border-gray-100" />
                  <td className="px-2 border border-gray-100">
                    <button onClick={addIngredient} className="text-blue-500 hover:text-blue-700">
                      <Plus className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
                {/* Raw material subtotal */}
                <tr className="bg-gray-50 font-semibold text-sm">
                  <td colSpan={3} className="px-3 py-2 border border-gray-200 text-right text-gray-600">Raw material subtotal</td>
                  <td className="px-3 py-2 border border-gray-200 text-right text-gray-800">₹{rawMaterialCost.toFixed(2)}</td>
                  <td className="border border-gray-200" />
                </tr>
              </tbody>
            </table>
          </div>

          {/* Overheads */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">⚙️ Overheads</p>
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-50 text-xs text-gray-500">
                  <th className="text-left px-3 py-2 border border-gray-100 font-medium">Label</th>
                  <th className="text-center px-3 py-2 border border-gray-100 font-medium">Type</th>
                  <th className="text-right px-3 py-2 border border-gray-100 font-medium">Value</th>
                  <th className="text-right px-3 py-2 border border-gray-100 font-medium">Cost (₹)</th>
                  <th className="w-8 border border-gray-100"></th>
                </tr>
              </thead>
              <tbody>
                {recipe.overheads.map(o => {
                  const cost = o.type === 'fixed' ? o.value : rawMaterialCost * o.value / 100;
                  return (
                    <tr key={o.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 border border-gray-100">
                        <input value={o.label} onChange={e => updateOverhead(o.id, 'label', e.target.value)}
                          className="w-full border border-gray-200 rounded-lg px-2 py-0.5 text-sm outline-none focus:border-orange-400"
                        />
                      </td>
                      <td className="px-3 py-2 border border-gray-100 text-center">
                        <select value={o.type} onChange={e => updateOverhead(o.id, 'type', e.target.value)}
                          className="border border-gray-200 rounded-lg px-2 py-0.5 text-sm outline-none focus:border-orange-400 bg-white">
                          <option value="fixed">₹ Fixed</option>
                          <option value="pct">% of raw cost</option>
                        </select>
                      </td>
                      <td className="px-3 py-2 border border-gray-100 text-right">
                        <input type="number" min="0" value={o.value}
                          onChange={e => updateOverhead(o.id, 'value', parseFloat(e.target.value) || 0)}
                          className="w-20 text-right border border-gray-200 rounded-lg px-2 py-0.5 text-sm outline-none focus:border-orange-400"
                        />
                        <span className="text-xs text-gray-400 ml-1">{o.type === 'pct' ? '%' : '₹'}</span>
                      </td>
                      <td className="px-3 py-2 border border-gray-100 text-right font-medium text-gray-700">
                        ₹{cost.toFixed(2)}
                      </td>
                      <td className="px-2 py-2 border border-gray-100 text-center">
                        <button onClick={() => removeOverhead(o.id)} className="text-gray-300 hover:text-red-400">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
                <tr>
                  <td colSpan={5} className="px-3 py-1.5 border border-gray-100">
                    <button onClick={addOverhead} className="text-xs text-blue-500 hover:underline flex items-center gap-1">
                      <Plus className="w-3 h-3" /> Add overhead row
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Profit + summary */}
          <div className="bg-orange-50 border border-orange-100 rounded-2xl p-4 space-y-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">💰 Profit Margin</p>
            <div className="flex items-center gap-3 flex-wrap">
              <select value={recipe.profitType}
                onChange={e => mutate(r => ({ ...r, profitType: e.target.value as 'fixed' | 'pct' }))}
                className="border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-orange-400 bg-white">
                <option value="pct">% of total cost</option>
                <option value="fixed">₹ Fixed amount</option>
              </select>
              <input type="number" min="0" value={recipe.profitValue}
                onChange={e => mutate(r => ({ ...r, profitValue: parseFloat(e.target.value) || 0 }))}
                className="w-24 border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-orange-400"
              />
              <span className="text-sm text-gray-500">= ₹{profitAmount.toFixed(2)} profit</span>
            </div>

            {/* Final cost breakdown */}
            <div className="grid grid-cols-2 gap-2 text-sm pt-1 border-t border-orange-100">
              <div className="text-gray-500">Raw materials</div>
              <div className="text-right font-medium">₹{rawMaterialCost.toFixed(2)}</div>
              <div className="text-gray-500">Overheads</div>
              <div className="text-right font-medium">₹{overheadCost.toFixed(2)}</div>
              <div className="text-gray-500">Profit</div>
              <div className="text-right font-medium">₹{profitAmount.toFixed(2)}</div>
              <div className="font-bold text-gray-700 border-t border-orange-200 pt-1">Total ({recipe.yieldKg}kg batch)</div>
              <div className="text-right font-bold text-gray-800 border-t border-orange-200 pt-1">₹{suggestedTotal.toFixed(2)}</div>
            </div>

            <div className="flex gap-4 flex-wrap pt-1 border-t border-orange-100">
              <div className="text-center">
                <p className="text-xs text-gray-500">Selling price / kg</p>
                <p className="text-2xl font-bold text-orange-600">₹{Math.ceil(pricePerKg)}</p>
              </div>
              {pricePerPiece && (
                <div className="text-center">
                  <p className="text-xs text-gray-500">Per piece (~{recipe.piecesPerKg} pcs/kg)</p>
                  <p className="text-2xl font-bold text-orange-600">₹{Math.ceil(pricePerPiece)}</p>
                </div>
              )}
              {!hasRates && (
                <p className="text-xs text-amber-600 self-center">⚠️ Add costs in Raw Material Costs page to see actual prices</p>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 justify-between items-center">
            <button onClick={() => { if (confirm('Delete this recipe?')) onDelete(); }}
              className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-600">
              <Trash2 className="w-3.5 h-3.5" /> Delete recipe
            </button>
            <span className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl font-medium ${
              saveState === 'saving' ? 'text-orange-500 bg-orange-50' :
              saveState === 'pending' ? 'text-amber-600 bg-amber-50' :
              'text-green-600 bg-green-50'
            }`}>
              <CloudUpload className="w-3.5 h-3.5" />
              {saveState === 'saving' ? 'Saving…' : saveState === 'pending' ? 'Unsaved…' : 'All saved'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function ProductCostingPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [sheet, setSheet] = useState<RawMaterialCostSheet>({ materials: [], batches: [], cells: {}, updatedAt: '' });
  const [recipes, setRecipes] = useState<ProductRecipe[]>([]);
  const [search, setSearch] = useState('');
  const [showOnlyWithRecipe, setShowOnlyWithRecipe] = useState(false);

  useEffect(() => {
    productsService.getAll().then(setProducts);
    rawMaterialCostSheetService.get().then(s => { if (s) setSheet(s); });
    const u1 = rawMaterialCostSheetService.subscribe(setSheet);
    const u2 = productRecipeService.subscribe(setRecipes);
    return () => { u1(); u2(); };
  }, []);

  async function saveRecipe(recipe: ProductRecipe) {
    await productRecipeService.save(recipe);
    setRecipes(prev => {
      const exists = prev.find(r => r.productId === recipe.productId);
      if (exists) return prev.map(r => r.productId === recipe.productId ? recipe : r);
      return [...prev, recipe];
    });
  }

  async function deleteRecipe(productId: string) {
    await productRecipeService.delete(productId);
    setRecipes(prev => prev.filter(r => r.productId !== productId));
    toast.success('Recipe deleted');
  }

  const filteredProducts = useMemo(() => {
    return products
      .filter(p => {
        const matchSearch = !search ||
          p.name.toLowerCase().includes(search.toLowerCase()) ||
          (p.nameKannada || '').includes(search);
        const hasRecipe = recipes.some(r => r.productId === p.id);
        const matchFilter = !showOnlyWithRecipe || hasRecipe;
        return matchSearch && matchFilter;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [products, recipes, search, showOnlyWithRecipe]);

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold text-gray-800 flex items-center gap-2">
            <IndianRupee className="w-5 h-5 text-orange-500" /> Product Costing
          </h1>
          <p className="text-xs text-gray-400 mt-0.5">
            Set ingredient quantities per batch → auto-calculates selling price from Raw Material Costs
          </p>
        </div>
        <a href="/admin/raw-material-costs" className="text-xs text-orange-500 border border-orange-200 px-3 py-1.5 rounded-lg hover:bg-orange-50">
          📦 Raw Material Costs →
        </a>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap items-center">
        <div className="relative flex-1 min-w-[160px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search products…"
            className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-xl text-sm outline-none focus:border-orange-400"
          />
        </div>
        <button onClick={() => setShowOnlyWithRecipe(v => !v)}
          className={`text-xs px-3 py-2 rounded-xl border font-medium transition-colors ${
            showOnlyWithRecipe ? 'bg-orange-100 text-orange-700 border-orange-300' : 'bg-white text-gray-600 border-gray-200'
          }`}>
          📋 With recipe only
        </button>
        <p className="text-xs text-gray-400 ml-auto">
          {recipes.length}/{products.length} products have recipes
        </p>
      </div>

      {sheet.materials.length === 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 text-sm text-amber-700">
          ⚠️ No raw materials found. <a href="/admin/raw-material-costs" className="underline font-medium">Add raw materials and batch costs first →</a>
        </div>
      )}

      {/* Product list */}
      <div className="space-y-2">
        {filteredProducts.map(product => {
          const existing = recipes.find(r => r.productId === product.id);
          const recipe = existing ?? emptyRecipe(product.id, product.name);
          return (
            <RecipeEditor
              key={product.id}
              recipe={recipe}
              sheet={sheet}
              onSave={saveRecipe}
              onDelete={() => deleteRecipe(product.id)}
            />
          );
        })}
        {filteredProducts.length === 0 && (
          <div className="text-center text-gray-400 py-12">
            <p className="text-3xl mb-2">🔍</p>
            <p className="text-sm">No products match your filter.</p>
          </div>
        )}
      </div>
    </div>
  );
}

import { useState, useEffect, useMemo } from 'react';
import { Megaphone, Copy, Check, Users, ChevronDown, ChevronUp, Sparkles, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { productsService, customersService } from '../../lib/services';
import { APP_CONFIG } from '../../config';
import { buildWABusinessUrl } from '../../lib/utils';
import type { Product, Customer } from '../../lib/types';

// ─── Types ────────────────────────────────────────────────────────────────────
interface AnnouncedItem {
  productId: string;
  productName: string;
  unit: string;
  pricePerUnit: number;
  displayPrice: string;   // human-readable, e.g. "₹300/250g" or "₹25/pc"
  highlightQty: string;   // e.g. "250g", "500g", "1 kg", "5 pcs"
  highlightPrice: number; // price for that qty
}

const OCCASIONS = [
  'Ugadi', 'Rama Navami', 'Akshaya Tritiya', 'Eid', 'Vishu',
  'Rath Yatra', 'Ganesh Chaturthi', 'Navaratri', 'Diwali',
  'Sankranti', 'Pongal', 'Holi', 'Christmas', 'New Year',
  'Custom occasion…',
];

const EMOJI_MAP: Record<string, string> = {
  'Chutney Powder': '🌿', 'Health Mix': '🌾', 'Masala': '🌶️',
  'Sweets': '🍯', 'Other': '🛒', 'Spices': '🧂',
  'Snacks': '🥜', 'Pickles': '🫙',
};

function productEmoji(category: string) {
  return EMOJI_MAP[category] ?? '🛒';
}

function formatDisplayPrice(product: Product): { display: string; highlightQty: string; highlightPrice: number } {
  if (product.unit === 'gram') {
    const qty = product.minOrderQty || 250;
    const price = Math.round(product.pricePerUnit * qty);
    return {
      display: `₹${price}/${qty}g`,
      highlightQty: qty >= 1000 ? `${qty / 1000} kg` : `${qty}g`,
      highlightPrice: price,
    };
  }
  if (product.unit === 'kg') {
    const price = product.pricePerUnit;
    return { display: `₹${price}/kg`, highlightQty: '1 kg', highlightPrice: price };
  }
  // piece
  const price = product.pricePerUnit;
  const min = product.minOrderQty || 1;
  return {
    display: `₹${price}/pc`,
    highlightQty: `${min} pc${min !== 1 ? 's' : ''}`,
    highlightPrice: Math.round(price * min),
  };
}

// ─── WhatsApp message builder ─────────────────────────────────────────────────
function buildAnnouncementMessage(opts: {
  occasion: string;
  intro: string;
  items: AnnouncedItem[];
  closingNote: string;
  includeOrderCta: boolean;
  includeGroupLink: boolean;
}): string {
  const { occasion, intro, items, closingNote, includeOrderCta, includeGroupLink } = opts;

  const itemLines = items
    .map(i => `  ${productEmoji('')}*${i.productName}*\n     ${i.displayPrice}  |  ${i.highlightQty} = ₹${i.highlightPrice}`)
    .join('\n\n');

  const orderCta = includeOrderCta
    ? `\n📲 *To order, reply here or WhatsApp us:*\n+${APP_CONFIG.WHATSAPP_NUMBER.replace(/^91/, '91 ')}\n`
    : '';

  const groupLine = includeGroupLink && APP_CONFIG.WHATSAPP_GROUP_LINK
    ? `\n🔔 *Join our WhatsApp group for updates:*\n${APP_CONFIG.WHATSAPP_GROUP_LINK}\n`
    : '';

  return `🎉 *${occasion} Special — ${APP_CONFIG.BUSINESS_NAME}* 🎉

${intro}

━━━━━━━━━━━━━━━━━━━━
🛒 *Available Products:*
━━━━━━━━━━━━━━━━━━━━

${itemLines}

━━━━━━━━━━━━━━━━━━━━
${closingNote ? `📝 ${closingNote}\n\n` : ''}${orderCta}${groupLine}🙏 *${APP_CONFIG.BUSINESS_NAME}*
_Pure • Fresh • Handcrafted_`.trim();
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function AnnouncementsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);

  // Form state
  const [occasion, setOccasion] = useState('');
  const [customOccasion, setCustomOccasion] = useState('');
  const [intro, setIntro] = useState('');
  const [closingNote, setClosingNote] = useState('');
  const [includeOrderCta, setIncludeOrderCta] = useState(true);
  const [includeGroupLink, setIncludeGroupLink] = useState(true);
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set());

  // UI state
  const [copied, setCopied] = useState(false);
  const [showDM, setShowDM] = useState(false);
  const [dmSearch, setDmSearch] = useState('');
  const [sentDMs, setSentDMs] = useState<Set<string>>(new Set());

  useEffect(() => {
    setLoadingProducts(true);
    Promise.all([
      productsService.getActive(),
      customersService.getAll(),
    ]).then(([ps, cs]) => {
      setProducts(ps);
      setCustomers(cs);
    }).finally(() => setLoadingProducts(false));
  }, []);

  // Auto-generate intro when occasion changes
  useEffect(() => {
    const occ = occasion === 'Custom occasion…' ? customOccasion : occasion;
    if (!occ) { setIntro(''); return; }
    setIntro(
      `This ${occ}, we're excited to bring you our handcrafted specials! ` +
      `Made fresh in small batches — order now while stocks last. 🌿`
    );
  }, [occasion, customOccasion]);

  const effectiveOccasion = occasion === 'Custom occasion…' ? customOccasion : occasion;

  // Build announced items from selected products
  const announcedItems: AnnouncedItem[] = useMemo(() => {
    return products
      .filter(p => selectedProductIds.has(p.id))
      .map(p => {
        const { display, highlightQty, highlightPrice } = formatDisplayPrice(p);
        return {
          productId: p.id,
          productName: p.name,
          unit: p.unit,
          pricePerUnit: p.pricePerUnit,
          displayPrice: display,
          highlightQty,
          highlightPrice,
        };
      });
  }, [products, selectedProductIds]);

  const message = useMemo(() => {
    if (!effectiveOccasion || announcedItems.length === 0) return '';
    return buildAnnouncementMessage({
      occasion: effectiveOccasion,
      intro,
      items: announcedItems,
      closingNote,
      includeOrderCta,
      includeGroupLink,
    });
  }, [effectiveOccasion, intro, announcedItems, closingNote, includeOrderCta, includeGroupLink]);

  function toggleProduct(id: string) {
    setSelectedProductIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelectedProductIds(new Set(products.map(p => p.id)));
  }

  function selectNone() {
    setSelectedProductIds(new Set());
  }

  async function copyMessage() {
    if (!message) return;
    await navigator.clipboard.writeText(message);
    setCopied(true);
    toast.success('Message copied to clipboard!');
    setTimeout(() => setCopied(false), 2500);
  }

  function openBroadcast() {
    // WhatsApp broadcast-style: open wa.me with the message so admin can paste/send
    window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(message)}`, '_blank');
  }

  const filteredCustomers = customers.filter(c =>
    c.name.toLowerCase().includes(dmSearch.toLowerCase()) ||
    c.whatsapp.includes(dmSearch)
  );

  // Group products by category
  const byCategory = useMemo(() => {
    const map: Record<string, Product[]> = {};
    products.forEach(p => {
      if (!map[p.category]) map[p.category] = [];
      map[p.category].push(p);
    });
    return map;
  }, [products]);

  return (
    <div className="p-4 md:p-6 space-y-5 animate-fade-in max-w-3xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-orange-100 rounded-xl flex items-center justify-center flex-shrink-0">
          <Megaphone className="w-5 h-5 text-orange-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-800 font-display">Announcements</h1>
          <p className="text-sm text-gray-500">Create festival / occasion specials & DM customers</p>
        </div>
      </div>

      {/* Step 1 — Occasion */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Step 1 — Occasion / Festival</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {OCCASIONS.map(o => (
            <button key={o}
              onClick={() => setOccasion(o)}
              className={`px-3 py-2 rounded-xl text-sm font-medium border transition-all text-left
                ${occasion === o
                  ? 'bg-orange-500 text-white border-orange-500'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-orange-300'}`}>
              {o}
            </button>
          ))}
        </div>
        {occasion === 'Custom occasion…' && (
          <input
            type="text"
            value={customOccasion}
            onChange={e => setCustomOccasion(e.target.value)}
            placeholder="e.g. Summer Sale, Birthday Special…"
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-orange-400"
          />
        )}
      </div>

      {/* Step 2 — Select Products */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Step 2 — Select Products</p>
          <div className="flex gap-2">
            <button onClick={selectAll} className="text-xs text-orange-500 hover:underline">All</button>
            <span className="text-gray-300">|</span>
            <button onClick={selectNone} className="text-xs text-gray-400 hover:underline">None</button>
          </div>
        </div>
        {loadingProducts ? (
          <div className="flex justify-center py-6">
            <div className="w-6 h-6 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          Object.entries(byCategory).map(([cat, catProducts]) => (
            <div key={cat}>
              <p className="text-xs text-gray-400 font-semibold mb-1.5">
                {productEmoji(cat)} {cat}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {catProducts.map(p => {
                  const { display, highlightQty, highlightPrice } = formatDisplayPrice(p);
                  const selected = selectedProductIds.has(p.id);
                  return (
                    <button key={p.id} onClick={() => toggleProduct(p.id)}
                      className={`flex items-start gap-3 p-3 rounded-xl border text-left transition-all
                        ${selected
                          ? 'bg-orange-50 border-orange-400 ring-1 ring-orange-300'
                          : 'border-gray-200 hover:border-orange-200'}`}>
                      <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 mt-0.5
                        ${selected ? 'bg-orange-500 border-orange-500' : 'border-gray-300'}`}>
                        {selected && <Check className="w-3 h-3 text-white" />}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-800 truncate">{p.name}</p>
                        <p className="text-xs text-gray-500">{display}</p>
                        <p className="text-xs text-orange-600 font-medium">{highlightQty} = ₹{highlightPrice}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))
        )}
        {selectedProductIds.size > 0 && (
          <p className="text-xs text-orange-600 font-medium">{selectedProductIds.size} product{selectedProductIds.size !== 1 ? 's' : ''} selected</p>
        )}
      </div>

      {/* Step 3 — Customise message */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Step 3 — Customise Message</p>
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Opening line</label>
          <textarea value={intro} onChange={e => setIntro(e.target.value)} rows={2}
            placeholder="Intro text for the announcement…"
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-orange-400 resize-none" />
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Closing note <span className="text-gray-400">(optional)</span></label>
          <input type="text" value={closingNote} onChange={e => setClosingNote(e.target.value)}
            placeholder="e.g. Pre-order by April 5 for timely delivery"
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-orange-400" />
        </div>
        <div className="flex gap-4 flex-wrap">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={includeOrderCta} onChange={e => setIncludeOrderCta(e.target.checked)}
              className="w-4 h-4 accent-orange-500" />
            <span className="text-sm text-gray-700">Include "How to order" CTA</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={includeGroupLink} onChange={e => setIncludeGroupLink(e.target.checked)}
              className="w-4 h-4 accent-orange-500" />
            <span className="text-sm text-gray-700">Include WhatsApp group link</span>
          </label>
        </div>
      </div>

      {/* Generated Message Preview */}
      {message ? (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-orange-500" />
              <p className="text-sm font-semibold text-gray-800">Generated Message</p>
            </div>
            <button onClick={() => setSelectedProductIds(new Set())}
              className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1">
              <RefreshCw className="w-3 h-3" /> Reset
            </button>
          </div>

          {/* Message preview */}
          <div className="bg-[#e5ddd5] p-4">
            <div className="bg-white rounded-xl p-4 text-sm text-gray-800 whitespace-pre-wrap font-mono leading-relaxed shadow-sm max-h-80 overflow-y-auto">
              {message}
            </div>
          </div>

          {/* Actions */}
          <div className="p-4 flex flex-col sm:flex-row gap-2">
            <button onClick={copyMessage}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all
                ${copied
                  ? 'bg-green-500 text-white'
                  : 'bg-orange-500 hover:bg-orange-600 text-white'}`}>
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copied ? 'Copied!' : 'Copy Message'}
            </button>
            <button onClick={openBroadcast}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold border border-green-300 text-green-700 hover:bg-green-50 transition-colors">
              📲 Share via WhatsApp
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-gray-50 border border-dashed border-gray-200 rounded-xl p-8 text-center text-gray-400">
          <Megaphone className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm">Select an occasion and at least one product to preview the message</p>
        </div>
      )}

      {/* DM All Customers */}
      {message && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <button onClick={() => setShowDM(s => !s)}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-orange-500" />
              <span className="text-sm font-semibold text-gray-800">DM Customers Individually</span>
              <span className="text-xs bg-orange-100 text-orange-600 px-2 py-0.5 rounded-full">{customers.length} customers</span>
            </div>
            {showDM ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
          </button>

          {showDM && (
            <div className="border-t border-gray-100 p-4 space-y-3">
              <p className="text-xs text-gray-500">
                Tap <strong>Send</strong> next to each customer to open WhatsApp with the message pre-filled.
                Their number acts as the unique link. Mark sent to track progress.
              </p>

              {/* Search */}
              <input type="text" placeholder="Search customer…" value={dmSearch}
                onChange={e => setDmSearch(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-orange-400" />

              {/* Progress */}
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                  <div
                    className="bg-green-500 h-1.5 rounded-full transition-all"
                    style={{ width: `${customers.length ? (sentDMs.size / customers.length) * 100 : 0}%` }}
                  />
                </div>
                <span>{sentDMs.size} / {customers.length} sent</span>
              </div>

              {/* Customer list */}
              <div className="space-y-1.5 max-h-96 overflow-y-auto pr-1">
                {filteredCustomers.map(c => {
                  const waUrl = buildWABusinessUrl(c.whatsapp, message);
                  const sent = sentDMs.has(c.id);
                  return (
                    <div key={c.id}
                      className={`flex items-center gap-3 p-3 rounded-xl border transition-all
                        ${sent ? 'bg-green-50 border-green-200' : 'bg-white border-gray-100'}`}>
                      <div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center flex-shrink-0">
                        <span className="text-xs font-bold text-orange-600">{c.name.charAt(0).toUpperCase()}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">{c.name}</p>
                        <p className="text-xs text-gray-500">📱 {c.whatsapp}{c.place ? ` · 📍 ${c.place}` : ''}</p>
                      </div>
                      {sent ? (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-green-600 font-medium flex items-center gap-1">
                            <Check className="w-3 h-3" /> Sent
                          </span>
                          <button onClick={() => setSentDMs(prev => { const n = new Set(prev); n.delete(c.id); return n; })}
                            className="text-xs text-gray-400 hover:text-gray-600">undo</button>
                        </div>
                      ) : (
                        <a href={waUrl} target="_blank" rel="noreferrer"
                          onClick={() => setSentDMs(prev => new Set(prev).add(c.id))}
                          className="flex items-center gap-1.5 bg-green-500 hover:bg-green-600 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors flex-shrink-0">
                          📲 Send
                        </a>
                      )}
                    </div>
                  );
                })}
              </div>

              {sentDMs.size === customers.length && customers.length > 0 && (
                <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-center">
                  <p className="text-sm font-semibold text-green-700">🎉 All customers notified!</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

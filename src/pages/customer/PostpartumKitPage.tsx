import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Plus, Minus, ShoppingBag, Gift, ExternalLink, ArrowLeft, Check } from 'lucide-react';
import toast from 'react-hot-toast';
import { productsService, kitConfigService, giftCardService, generateGiftCardCode, ordersService, customersService } from '../../lib/services';
import { DEFAULT_KIT_CONFIG } from '../../lib/types';
import { formatCurrency, generateOrderNumber, normalizeWhatsapp } from '../../lib/utils';
import type { Product, PostpartumKitConfig, KitCartItem, GiftCard } from '../../lib/types';

interface KitItem {
  product: Product;
  qty: number;          // in minOrderQty steps
  included: boolean;    // for optional products
}

const MAX_QTY_STEPS = 10;

function defaultQtyForProduct(p: Product): number {
  return p.minOrderQty > 0 ? p.minOrderQty : (p.unit === 'gram' ? 250 : 1);
}

export default function PostpartumKitPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redeemCode = (searchParams.get('redeem') || '').toUpperCase().trim();

  const [config, setConfig] = useState<PostpartumKitConfig>(DEFAULT_KIT_CONFIG);
  const [products, setProducts] = useState<Product[]>([]);
  const [kitItems, setKitItems] = useState<KitItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<'order' | 'gift' | 'redeem'>('order');

  // Gift card form state
  const [giftForm, setGiftForm] = useState({
    buyerName: '', buyerWhatsapp: '', recipientName: '', type: 'virtual' as 'physical' | 'virtual',
  });
  const [submittingGift, setSubmittingGift] = useState(false);
  const [giftSubmitted, setGiftSubmitted] = useState<GiftCard | null>(null);

  // Order form state
  const [orderForm, setOrderForm] = useState({ name: '', whatsapp: '', place: '' });
  const [submittingOrder, setSubmittingOrder] = useState(false);
  const [showOrderForm, setShowOrderForm] = useState(false);

  // Redeem flow
  const [redeemCard, setRedeemCard] = useState<GiftCard | null>(null);
  const [redeemError, setRedeemError] = useState('');

  useEffect(() => {
    async function load() {
      const [cfg, prods] = await Promise.all([
        kitConfigService.get(),
        productsService.getAll?.() ?? new Promise<Product[]>(res => {
          productsService.subscribe((all: Product[]) => res(all))();
        }),
      ]);
      if (cfg) setConfig(cfg);
      setProducts(prods as Product[]);
    }
    load().finally(() => setLoading(false));
  }, []);

  // Also subscribe to kit config for live admin changes
  useEffect(() => {
    const unsub = kitConfigService.subscribe(cfg => setConfig(cfg));
    return () => unsub();
  }, []);

  // Subscribe to products
  useEffect(() => {
    const unsub = productsService.subscribe((prods: Product[]) => setProducts(prods));
    return () => unsub();
  }, []);

  // Build kit items when products load
  useEffect(() => {
    const kitProds = products.filter(p => p.isActive && (p.kitRole === 'mandatory' || p.kitRole === 'optional'));
    const mandatory = kitProds.filter(p => p.kitRole === 'mandatory');
    const optional = kitProds.filter(p => p.kitRole === 'optional');

    setKitItems([
      ...mandatory.map(p => ({ product: p, qty: defaultQtyForProduct(p), included: true })),
      ...optional.map(p => ({ product: p, qty: defaultQtyForProduct(p), included: true })),
    ]);
  }, [products]);

  // If redeem code in URL, load the gift card
  useEffect(() => {
    if (!redeemCode) return;
    setMode('redeem');
    giftCardService.getByCode(redeemCode).then(card => {
      if (!card) { setRedeemError('Gift card not found.'); return; }
      if (card.status === 'inactive') { setRedeemError('This gift card has not been activated yet. Please contact us.'); return; }
      if (card.status === 'redeemed') { setRedeemError('This gift card has already been redeemed.'); return; }
      setRedeemCard(card);
      // Pre-populate kit items from card
      if (card.kitItems.length > 0) {
        setKitItems(prev => prev.map(ki => {
          const cardItem = card.kitItems.find(ci => ci.productId === ki.product.id);
          if (cardItem) return { ...ki, qty: cardItem.quantity, included: true };
          return ki;
        }));
      }
    });
  }, [redeemCode]);

  const includedItems = kitItems.filter(ki => ki.included);
  const kitTotal = includedItems.reduce((sum, ki) => sum + ki.product.pricePerUnit * ki.qty, 0);

  function adjustQty(productId: string, delta: number) {
    setKitItems(prev => prev.map(ki => {
      if (ki.product.id !== productId) return ki;
      const step = ki.product.minOrderQty > 0 ? ki.product.minOrderQty : (ki.product.unit === 'gram' ? 50 : 1);
      const newQty = Math.max(step, Math.min(step * MAX_QTY_STEPS, ki.qty + delta * step));
      return { ...ki, qty: newQty };
    }));
  }

  function toggleItem(productId: string) {
    setKitItems(prev => prev.map(ki =>
      ki.product.id === productId && ki.product.kitRole === 'optional'
        ? { ...ki, included: !ki.included }
        : ki
    ));
  }

  function qtyLabel(ki: KitItem) {
    const { product, qty } = ki;
    if (product.unit === 'gram') {
      if (qty >= 1000) return `${qty / 1000}kg`;
      return `${qty}g`;
    }
    if (product.unit === 'kg') return `${qty}kg`;
    return `${qty} pc${qty !== 1 ? 's' : ''}`;
  }

  function buildKitCartItems(): KitCartItem[] {
    return includedItems.map(ki => ({
      productId: ki.product.id,
      productName: ki.product.name,
      unit: ki.product.unit,
      quantity: ki.qty,
      pricePerUnit: ki.product.pricePerUnit,
      totalPrice: ki.product.pricePerUnit * ki.qty,
      kitRole: ki.product.kitRole as 'mandatory' | 'optional',
    }));
  }

  // ── Place Order directly ───────────────────────────────────────────────────
  async function placeOrder() {
    const name = orderForm.name.trim();
    const wa = normalizeWhatsapp(orderForm.whatsapp.trim());
    if (!name) return toast.error('Please enter your name');
    if (!wa || wa.length < 10) return toast.error('Please enter a valid WhatsApp number');
    if (includedItems.length === 0) return toast.error('Select at least one product');

    setSubmittingOrder(true);
    try {
      const orderItems = includedItems.map(ki => ({
        productId: ki.product.id,
        productName: ki.product.name,
        unit: ki.product.unit,
        quantity: ki.qty,
        pricePerUnit: ki.product.pricePerUnit,
        totalPrice: ki.product.pricePerUnit * ki.qty,
      }));

      // Find or create customer
      const existingCustomer = await customersService.getByWhatsapp(wa);
      const resolvedCustomerId = existingCustomer?.id ?? await customersService.upsert({
        name, whatsapp: wa, place: orderForm.place.trim(),
        createdAt: new Date().toISOString(),
        joinedWhatsappGroup: false,
      });

      const orderNumber = generateOrderNumber();
      const orderId = await ordersService.add({
        orderNumber,
        customerName: name,
        customerWhatsapp: wa,
        customerPlace: orderForm.place.trim(),
        customerId: resolvedCustomerId,
        items: orderItems,
        subtotal: kitTotal,
        discount: 0,
        total: kitTotal,
        referralDiscount: 0,
        creditUsed: 0,
        deliveryCharge: 0,
        hasOnDemandItems: false,
        paymentStatus: 'pending' as const,
        status: 'pending' as const,
        notes: `Postpartum Kit order${redeemCard ? ` (Gift Card: ${redeemCard.code})` : ''}`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        type: 'regular' as const,
      });

      // If redeeming a gift card, mark it redeemed
      if (redeemCard) {
        await giftCardService.redeem(redeemCard.id, name, orderId);
      }

      navigate(`/order-confirmation/${orderId}`);
    } finally { setSubmittingOrder(false); }
  }

  // ── Request Gift Card ───────────────────────────────────────────────────────
  async function submitGiftRequest() {
    const name = giftForm.buyerName.trim();
    const wa = normalizeWhatsapp(giftForm.buyerWhatsapp.trim());
    if (!name) return toast.error('Please enter your name');
    if (!wa || wa.length < 10) return toast.error('Please enter your WhatsApp number');
    if (includedItems.length === 0) return toast.error('Select at least one product');

    setSubmittingGift(true);
    try {
      const code = generateGiftCardCode();
      const cardData: Omit<GiftCard, 'id'> = {
        code,
        status: 'inactive',
        type: giftForm.type,
        buyerName: name,
        buyerWhatsapp: wa,
        ...(giftForm.recipientName.trim() ? { recipientName: giftForm.recipientName.trim() } : {}),
        kitItems: buildKitCartItems(),
        kitTotal,
        createdAt: new Date().toISOString(),
      };
      const newId = await giftCardService.add(cardData);
      setGiftSubmitted({ id: newId, ...cardData });
    } finally { setSubmittingGift(false); }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#fdf5e6' }}>
        <div className="w-10 h-10 border-4 border-orange-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!config.isActive) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4 text-center" style={{ background: '#fdf5e6' }}>
        <p className="text-5xl mb-4">👶</p>
        <h1 className="text-2xl font-bold" style={{ color: '#3d1c02' }}>Coming Soon</h1>
        <p className="text-gray-500 mt-2">Our Postpartum Care Kit will be available soon. Check back later!</p>
        <Link to="/" className="mt-6 text-sm text-orange-600 underline">← Back to store</Link>
      </div>
    );
  }

  const kitProds = products.filter(p => p.isActive && (p.kitRole === 'mandatory' || p.kitRole === 'optional'));

  return (
    <div className="min-h-screen pb-24" style={{ background: '#fdf5e6' }}>
      {/* Header */}
      <div className="sticky top-0 z-10 px-4 pt-4 pb-3 flex items-center gap-3" style={{ background: '#fdf5e6' }}>
        <Link to="/" className="p-2 rounded-full bg-white/70">
          <ArrowLeft className="w-5 h-5" style={{ color: '#3d1c02' }} />
        </Link>
        <div>
          <h1 className="text-lg font-bold leading-tight" style={{ color: '#3d1c02' }}>👶 {config.title}</h1>
          <p className="text-xs text-gray-500">{config.tagline}</p>
        </div>
      </div>

      <div className="px-4 space-y-5 max-w-lg mx-auto">
        {/* Description card */}
        <div className="bg-white rounded-2xl p-4 border border-orange-100">
          <p className="text-sm text-gray-700 leading-relaxed">{config.description}</p>
          {config.instagramUrl && (
            <a href={config.instagramUrl} target="_blank" rel="noreferrer"
              className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-orange-600">
              <ExternalLink className="w-3.5 h-3.5" /> Watch video
            </a>
          )}
        </div>

        {/* Redeem banner */}
        {mode === 'redeem' && (
          <div className={`rounded-2xl p-4 border ${redeemError ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'}`}>
            {redeemError ? (
              <p className="text-sm text-red-600 font-semibold">❌ {redeemError}</p>
            ) : redeemCard ? (
              <div>
                <p className="text-sm font-bold text-green-700">🎁 Gift Card Detected!</p>
                <p className="text-xs text-green-600 mt-0.5">Code: <code className="font-mono tracking-wider">{redeemCard.code}</code></p>
                {redeemCard.recipientName && <p className="text-xs text-gray-500 mt-1">For: {redeemCard.recipientName}</p>}
                <p className="text-xs text-gray-500 mt-0.5">Customize your kit below, then place your order.</p>
              </div>
            ) : (
              <p className="text-sm text-gray-500">Checking gift card…</p>
            )}
          </div>
        )}

        {/* Mode toggle */}
        {mode !== 'redeem' && (
          <div className="flex bg-white rounded-2xl border border-gray-100 p-1 gap-1">
            <button onClick={() => setMode('order')}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
                mode === 'order' ? 'text-white' : 'text-gray-600 hover:bg-gray-50'
              }`}
              style={mode === 'order' ? { background: '#c8821a' } : {}}>
              <ShoppingBag className="w-4 h-4" /> Order for Myself
            </button>
            <button onClick={() => setMode('gift')}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
                mode === 'gift' ? 'text-white' : 'text-gray-600 hover:bg-gray-50'
              }`}
              style={mode === 'gift' ? { background: '#c8821a' } : {}}>
              <Gift className="w-4 h-4" /> Buy as Gift Card
            </button>
          </div>
        )}

        {/* Product list */}
        {kitProds.length === 0 ? (
          <div className="text-center text-gray-400 py-8">
            <p className="text-3xl mb-2">🧺</p>
            <p className="text-sm">Kit products are being set up. Please check back soon!</p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Customize your kit</p>
            {kitItems.map(ki => {
              const step = ki.product.minOrderQty > 0 ? ki.product.minOrderQty : (ki.product.unit === 'gram' ? 50 : 1);
              const isOptional = ki.product.kitRole === 'optional';
              return (
                <div key={ki.product.id}
                  className={`bg-white rounded-2xl border p-4 transition-opacity ${!ki.included ? 'opacity-50' : ''}`}
                  style={{ borderColor: ki.included ? '#e5e7eb' : '#e5e7eb' }}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-sm" style={{ color: '#3d1c02' }}>{ki.product.name}</p>
                        {!isOptional ? (
                          <span className="text-xs bg-red-50 text-red-600 px-2 py-0.5 rounded-full font-medium">🔒 Included</span>
                        ) : (
                          <span className="text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded-full font-medium">Optional</span>
                        )}
                      </div>
                      {ki.product.description && (
                        <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{ki.product.description}</p>
                      )}
                      {ki.product.videoUrl && (
                        <a href={ki.product.videoUrl} target="_blank" rel="noreferrer"
                          className="text-xs text-orange-500 flex items-center gap-1 mt-1">
                          <ExternalLink className="w-3 h-3" /> How to use
                        </a>
                      )}
                    </div>
                    {isOptional && (
                      <button onClick={() => toggleItem(ki.product.id)}
                        className={`flex-shrink-0 w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-colors ${
                          ki.included
                            ? 'border-green-500 bg-green-500 text-white'
                            : 'border-gray-300 bg-white'
                        }`}>
                        {ki.included && <Check className="w-3.5 h-3.5" />}
                      </button>
                    )}
                  </div>

                  {ki.included && (
                    <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-50">
                      <p className="text-sm font-bold" style={{ color: '#c8821a' }}>
                        {formatCurrency(ki.product.pricePerUnit * ki.qty)}
                      </p>
                      <div className="flex items-center gap-2">
                        <button onClick={() => adjustQty(ki.product.id, -1)}
                          disabled={ki.qty <= step}
                          className="w-8 h-8 rounded-full bg-orange-50 flex items-center justify-center disabled:opacity-30">
                          <Minus className="w-4 h-4 text-orange-600" />
                        </button>
                        <span className="text-sm font-semibold w-12 text-center">{qtyLabel(ki)}</span>
                        <button onClick={() => adjustQty(ki.product.id, 1)}
                          disabled={ki.qty >= step * MAX_QTY_STEPS}
                          className="w-8 h-8 rounded-full bg-orange-50 flex items-center justify-center disabled:opacity-30">
                          <Plus className="w-4 h-4 text-orange-600" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Total */}
        {includedItems.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 px-4 py-3 flex items-center justify-between">
            <p className="text-sm text-gray-500">{includedItems.length} product{includedItems.length !== 1 ? 's' : ''} selected</p>
            <p className="text-lg font-bold" style={{ color: '#3d1c02' }}>Total: {formatCurrency(kitTotal)}</p>
          </div>
        )}

        {/* ── Order Form ── */}
        {(mode === 'order' || mode === 'redeem') && (
          <>
            {!showOrderForm ? (
              <button
                onClick={() => setShowOrderForm(true)}
                disabled={includedItems.length === 0 || (mode === 'redeem' && !!redeemError)}
                className="w-full py-4 rounded-2xl text-white font-bold text-base disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: '#c8821a' }}>
                <ShoppingBag className="inline w-5 h-5 mr-2" />
                {mode === 'redeem' ? 'Redeem Gift Card' : 'Order This Kit'} — {formatCurrency(kitTotal)}
              </button>
            ) : (
              <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-4">
                <p className="font-semibold text-gray-800 text-sm">Your Details</p>
                {[
                  { label: 'Your Name *', key: 'name', placeholder: 'Full name', type: 'text' },
                  { label: 'WhatsApp Number *', key: 'whatsapp', placeholder: '9XXXXXXXXX', type: 'tel' },
                  { label: 'Your Area / Place', key: 'place', placeholder: 'e.g. Bangalore, Whitefield', type: 'text' },
                ].map(f => (
                  <div key={f.key}>
                    <label className="block text-xs font-medium text-gray-500 mb-1">{f.label}</label>
                    <input type={f.type} value={orderForm[f.key as keyof typeof orderForm]}
                      onChange={e => setOrderForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                      placeholder={f.placeholder}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-orange-400"
                    />
                  </div>
                ))}
                <button onClick={placeOrder} disabled={submittingOrder}
                  className="w-full py-3 rounded-xl text-white font-bold text-sm disabled:opacity-50"
                  style={{ background: '#c8821a' }}>
                  {submittingOrder ? 'Placing order…' : `✅ Place Order — ${formatCurrency(kitTotal)}`}
                </button>
              </div>
            )}
          </>
        )}

        {/* ── Gift Card Form ── */}
        {mode === 'gift' && (
          <>
            {giftSubmitted ? (
              <div className="bg-green-50 border border-green-200 rounded-2xl p-5 text-center space-y-2">
                <p className="text-3xl">🎉</p>
                <p className="font-bold text-green-700 text-lg">Gift Card Requested!</p>
                <p className="text-sm text-gray-600">
                  We'll reach out on WhatsApp to confirm payment and send your gift card.
                </p>
                {giftSubmitted.type === 'virtual' && (
                  <p className="text-xs text-gray-500">
                    Once activated, your recipient can use the card at <code className="font-mono">/kit?redeem={giftSubmitted.code}</code>
                  </p>
                )}
                <p className="text-sm font-mono text-gray-700 bg-white rounded-xl px-4 py-2 border border-gray-100">
                  {giftSubmitted.code}
                </p>
                <button onClick={() => { setGiftSubmitted(null); setMode('order'); }}
                  className="text-sm text-orange-600 underline mt-2">
                  Back to kit
                </button>
              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-4">
                <p className="font-semibold text-gray-800 text-sm">Gift Card Details</p>
                {[
                  { label: 'Your Name (Buyer) *', key: 'buyerName', placeholder: 'Your full name' },
                  { label: 'Your WhatsApp *', key: 'buyerWhatsapp', placeholder: '9XXXXXXXXX' },
                  { label: 'Recipient Name (optional)', key: 'recipientName', placeholder: 'For: e.g. Priya' },
                ].map(f => (
                  <div key={f.key}>
                    <label className="block text-xs font-medium text-gray-500 mb-1">{f.label}</label>
                    <input value={giftForm[f.key as keyof typeof giftForm] as string}
                      onChange={e => setGiftForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                      placeholder={f.placeholder}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-orange-400"
                    />
                  </div>
                ))}
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Card Type</label>
                  <div className="flex gap-3">
                    {(['virtual', 'physical'] as const).map(t => (
                      <label key={t} className="flex items-center gap-2 cursor-pointer">
                        <input type="radio" name="giftType" value={t}
                          checked={giftForm.type === t}
                          onChange={() => setGiftForm(prev => ({ ...prev, type: t }))}
                          className="accent-orange-500" />
                        <span className="text-sm text-gray-700 capitalize">
                          {t === 'virtual' ? '📲 Virtual (printable link)' : '📦 Physical Card (posted)'}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
                <div className="bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
                  <p className="text-xs text-amber-700">
                    💰 <strong>Kit Total: {formatCurrency(kitTotal)}</strong> — Payment confirmation via WhatsApp.
                    Card is activated after payment is received.
                  </p>
                </div>
                <button onClick={submitGiftRequest} disabled={submittingGift}
                  className="w-full py-3 rounded-xl text-white font-bold text-sm disabled:opacity-50"
                  style={{ background: '#c8821a' }}>
                  {submittingGift ? 'Submitting…' : `🎁 Request Gift Card — ${formatCurrency(kitTotal)}`}
                </button>
              </div>
            )}
          </>
        )}

        {/* Disclaimer */}
        <p className="text-xs text-gray-400 text-center px-2 pb-4">
          ⚠️ {config.disclaimer}
        </p>
      </div>
    </div>
  );
}

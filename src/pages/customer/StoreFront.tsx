import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ShoppingCart, Star, Plus, Minus,
  Trash2, X, MessageCircle, Users, ChevronRight, Flame,
  Search
} from 'lucide-react';
import toast from 'react-hot-toast';
import { productsService, feedbackService, ordersService, customersService, stockService } from '../../lib/services';
import { generateOrderNumber, formatCurrency } from '../../lib/utils';
import { APP_CONFIG } from '../../config';
import type { Product, Feedback, OrderItem, Order } from '../../lib/types';

interface CartItem extends OrderItem {}

export default function StoreFront() {
  const navigate = useNavigate();
  const [products, setProducts]         = useState<Product[]>([]);
  const [testimonials, setTestimonials] = useState<Feedback[]>([]);
  const [feedbackStats, setFeedbackStats] = useState<{ total: number; avg: number } | null>(null);
  const [siteStats, setSiteStats]       = useState<{ customers: number; orders: number; holige: number } | null>(null);
  const [cart, setCart]                 = useState<CartItem[]>([]);
  const [loading, setLoading]           = useState(true);
  const [showCart, setShowCart]         = useState(false);
  const [showOrderForm, setShowOrderForm]   = useState(false);
  const [showSampleForm, setShowSampleForm] = useState(false);
  const [activeCategory, setActiveCategory] = useState('All');
  const [searchQuery, setSearchQuery]       = useState('');
  const [submitting, setSubmitting]     = useState(false);
  // Sample: max 2 products, only powders + Dry Fruit Laddu
  const [sampleSelected, setSampleSelected] = useState<Product[]>([]);
  const [sampleStep, setSampleStep]     = useState<'pick' | 'contact'>('pick');  const [orderForm, setOrderForm] = useState({ name: '', whatsapp: '', place: '', notes: '' });

  useEffect(() => { load(); }, []);

  // Real-time testimonials — always shows latest public feedback
  useEffect(() => {
    return feedbackService.subscribe(all => {
      const pub = all.filter(f => f.isPublic);
      // already sorted newest-first by service
      setTestimonials(pub.slice(0, 10));
      if (pub.length > 0) {
        const avg = pub.reduce((s, f) => s + f.rating, 0) / pub.length;
        setFeedbackStats({ total: pub.length, avg: Math.round(avg * 10) / 10 });
      }
    });
  }, []);

  async function load() {
    setLoading(true);
    try {
      const [p, allOrders, allCustomers] = await Promise.all([
        productsService.getActive(),
        ordersService.getAll(),
        customersService.getAll(),
      ]);
      setProducts(p);
      const HOLIGE_BASE = 444;
      const holigeDelivered = allOrders
        .filter(o => o.status === 'delivered')
        .flatMap(o => o.items)
        .filter(i => i.productName.toLowerCase().includes('holige') || i.productName.toLowerCase().includes('obbattu'))
        .reduce((sum, i) => sum + i.quantity, 0);
      setSiteStats({
        orders:    allOrders.filter(o => o.status !== 'cancelled').length,
        customers: allCustomers.length,
        holige:    HOLIGE_BASE + holigeDelivered,
      });
    } finally { setLoading(false); }
  }

  const categories = ['All', ...Array.from(new Set(products.map(p => p.category)))];

  const filtered = products
    .filter(p => activeCategory === 'All' || p.category === activeCategory)
    .filter(p => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return p.name.toLowerCase().includes(q)
        || (p.nameKannada && p.nameKannada.toLowerCase().includes(q))
        || p.category.toLowerCase().includes(q)
        || (p.description && p.description.toLowerCase().includes(q));
    })
    .sort((a, b) => {
      // Always: popular first, then by sortOrder
      if (a.isPopular && !b.isPopular) return -1;
      if (!a.isPopular && b.isPopular) return 1;
      return (a.sortOrder ?? 999) - (b.sortOrder ?? 999);
    });

  function addToCart(product: Product, qty: number, note?: string) {
    setCart(prev => {
      const idx = prev.findIndex(i => i.productId === product.id && i.customizationNote === (note ?? ''));
      if (idx >= 0) {
        const u = [...prev];
        u[idx].quantity  += qty;
        u[idx].totalPrice = u[idx].quantity * product.pricePerUnit;
        return u;
      }
      return [...prev, {
        productId: product.id, productName: product.name,
        unit: product.unit, quantity: qty,
        pricePerUnit: product.pricePerUnit, totalPrice: qty * product.pricePerUnit,
        customizationNote: note ?? '',
        isOnDemand: product.isOnDemand ?? false,
      }];
    });
    toast.success(`${product.name} added!`, { duration: 1200, icon: '🛒' });
  }

  function updateCartItem(idx: number, qty: number) {
    if (qty <= 0) setCart(p => p.filter((_, i) => i !== idx));
    else setCart(p => p.map((item, i) => i === idx
      ? { ...item, quantity: qty, totalPrice: qty * item.pricePerUnit }
      : item
    ));
  }

  const cartTotal = cart.reduce((s, i) => s + i.totalPrice, 0);
  const cartCount = cart.length;
  const hasOnDemand = cart.some(i => i.isOnDemand);

  // Products eligible for sampling: any active product EXCEPT occasion-only (Sweets category) and made-fresh (isOnDemand)
  const sampleEligible = products.filter(p =>
    p.category !== 'Sweets' && !p.isOnDemand
  );

  function toggleSample(product: Product) {
    setSampleSelected(prev => {
      const already = prev.find(p => p.id === product.id);
      if (already) return prev.filter(p => p.id !== product.id);
      if (prev.length >= 2) return [prev[1], product]; // drop oldest, keep last + new
      return [...prev, product];
    });
  }

  function openSampleForm() {
    setSampleSelected([]);
    setSampleStep('pick');
    setOrderForm({ name: '', whatsapp: '', place: '', notes: '' });
    setShowSampleForm(true);
  }

  async function handlePlaceOrder() {
    if (!orderForm.name.trim())  return toast.error('Please enter your name');
    const wa = orderForm.whatsapp.replace(/\D/g, '');
    if (wa.length < 10)          return toast.error('Enter a valid WhatsApp number');
    if (cart.length === 0)       return toast.error('Your cart is empty');
    setSubmitting(true);
    try {
      let customerId: string | undefined;
      const existing = await customersService.getByWhatsapp(wa);
      if (existing) customerId = existing.id;
      else customerId = await customersService.upsert({
        name: orderForm.name.trim(), whatsapp: wa,
        place: orderForm.place.trim(), joinedWhatsappGroup: false,
        createdAt: new Date().toISOString(),
      });

      const orderNumber = generateOrderNumber();
      const order: Omit<Order, 'id'> = {
        orderNumber, type: 'regular', customerId,
        customerName: orderForm.name.trim(), customerWhatsapp: wa,
        customerPlace: orderForm.place.trim(),
        items: cart, subtotal: cartTotal, discount: 0, total: cartTotal,
        status: 'pending', paymentStatus: 'pending',
        notes: orderForm.notes,
        hasOnDemandItems: hasOnDemand,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };

      const orderId = await ordersService.add(order);
      for (const item of cart) await stockService.deduct(item.productId, item.quantity);
      if (customerId) await customersService.updateAfterOrder(customerId, cartTotal, 'pending');

      setCart([]); setShowOrderForm(false);
      toast.success('Order placed! 🎉');
      navigate(`/order-confirmation/${orderId}`);
    } catch (err) { console.error('Order error:', err); toast.error('Something went wrong: ' + (err instanceof Error ? err.message : String(err))); }
    finally { setSubmitting(false); }
  }

  async function handleSampleRequest() {
    if (!orderForm.name.trim()) return toast.error('Please enter your name');
    const wa = orderForm.whatsapp.replace(/\D/g, '');
    if (wa.length < 10)         return toast.error('Enter a valid WhatsApp number');
    if (sampleSelected.length === 0) return toast.error('Please select at least one product');
    setSubmitting(true);
    try {
      let customerId: string | undefined;
      const existing = await customersService.getByWhatsapp(wa);
      if (existing) customerId = existing.id;
      else customerId = await customersService.upsert({
        name: orderForm.name.trim(), whatsapp: wa,
        place: orderForm.place.trim(), joinedWhatsappGroup: false,
        createdAt: new Date().toISOString(),
      });

      const orderNumber = generateOrderNumber();
      const sampleItems = sampleSelected.map(p => ({
        productId: p.id, productName: p.name,
        unit: p.unit as 'gram', quantity: 50, pricePerUnit: 0, totalPrice: 0,
        customizationNote: '', isOnDemand: false,
      }));
      const order: Omit<Order, 'id'> = {
        orderNumber, type: 'sample', customerId,
        customerName: orderForm.name.trim(), customerWhatsapp: wa,
        customerPlace: orderForm.place.trim(),
        items: sampleItems,
        subtotal: 0, discount: 0, total: 0,
        status: 'pending', paymentStatus: 'na',
        notes: `Sample request: ${sampleSelected.map(p => p.name).join(', ')}${orderForm.notes ? '. ' + orderForm.notes : ''}`,
        hasOnDemandItems: false,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      const orderId = await ordersService.add(order);
      setShowSampleForm(false);
      toast.success("Sample request received! We'll contact you soon. 🎁");
      navigate(`/order-confirmation/${orderId}`);
    } catch (err) { console.error('Sample error:', err); toast.error('Something went wrong: ' + (err instanceof Error ? err.message : String(err))); }
    finally { setSubmitting(false); }
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'linear-gradient(160deg, #7b1500 0%, #c45c00 60%, #2e7d32 100%)' }}>
      <div className="text-center">
        <div className="text-5xl mb-4 animate-bounce">🪷</div>
        <p className="font-bold text-white text-lg mb-1" style={{ fontFamily: 'Poppins, sans-serif' }}>Sri Krishna Condiments</p>
        <p className="text-sm" style={{ color: '#ffd700' }}>🙏 Hare Krishna…</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-white font-sans">

      {/* Header */}
      <header className="sticky top-0 z-40 shadow-sm" style={{ background: 'linear-gradient(90deg, #7b1500 0%, #c45c00 60%, #7b1500 100%)' }}>
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            {/* Sacred tilak/lotus icon */}
            <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 text-xl"
              style={{ background: 'rgba(255,255,255,0.15)', border: '1.5px solid rgba(255,215,0,0.5)' }}>
              🪷
            </div>
            <div className="min-w-0">
              <p className="font-bold text-sm leading-tight text-white" style={{ fontFamily: 'Poppins, sans-serif', letterSpacing: '0.3px' }}>
                Sri Krishna Condiments
              </p>
              <p className="text-xs leading-tight" style={{ color: '#ffd700', letterSpacing: '0.5px' }}>🙏 Pure · Fresh · Made with Love</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button onClick={() => setShowCart(true)}
              className="relative w-11 h-11 rounded-full flex items-center justify-center"
              style={{ background: 'rgba(255,255,255,0.15)', border: '1.5px solid rgba(255,215,0,0.4)' }}>
              <ShoppingCart className="w-5 h-5 text-white" />
              {cartCount > 0 && (
                <span className="absolute -top-1 -right-1 w-5 h-5 bg-yellow-400 text-yellow-900 text-xs rounded-full flex items-center justify-center font-bold">
                  {cartCount}
                </span>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <div className="relative overflow-hidden" style={{ background: 'linear-gradient(160deg, #7b1500 0%, #c45c00 40%, #e8762a 70%, #2e7d32 100%)' }}>
        {/* Decorative pattern */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          {/* Lotus petals pattern */}
          {[...Array(8)].map((_, i) => (
            <div key={i} className="absolute opacity-10 text-white select-none"
              style={{
                left: `${(i * 13 + 5) % 100}%`,
                top: `${(i * 17 + 10) % 100}%`,
                fontSize: i % 2 === 0 ? '40px' : '28px',
                transform: `rotate(${i * 45}deg)`,
              }}>🪷</div>
          ))}
        </div>

        <div className="relative max-w-5xl mx-auto px-4 py-10 md:py-14">
          {/* Sacred greeting */}
          <div className="text-center mb-6">
            <div className="inline-flex items-center gap-2 rounded-full px-5 py-2 mb-4 text-sm font-semibold"
              style={{ background: 'rgba(255,215,0,0.18)', border: '1px solid rgba(255,215,0,0.4)', color: '#ffd700' }}>
              🙏 Hare Krishna — Hare Rama 🙏
            </div>
            <h1 className="text-3xl md:text-4xl font-bold text-white mb-1.5"
              style={{ fontFamily: 'Poppins, sans-serif', textShadow: '0 2px 8px rgba(0,0,0,0.3)' }}>
              ಶ್ರೀ ಕೃಷ್ಣ ಕಾಂಡಿಮೆಂಟ್ಸ್
            </h1>
            <p className="text-white/90 font-medium mb-1" style={{ letterSpacing: '1px' }}>Sri Krishna Condiments</p>
            <p className="text-white/70 text-sm mb-6 max-w-sm mx-auto">
              Authentic Karnataka &amp; Andhra flavours — Chutney Powders, Masalas &amp; Health Mixes made at home with love &amp; devotion.
            </p>
          </div>

          {/* Trust badges */}
          <div className="flex flex-wrap justify-center gap-2 mb-6">
            {[
              { icon: '🌿', text: 'No Preservatives' },
              { icon: '🏠', text: 'Home Made' },
              { icon: '✨', text: 'Small Batch' },
              { icon: '❤️', text: 'Made with Love' },
            ].map(b => (
              <span key={b.text}
                className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full"
                style={{ background: 'rgba(255,255,255,0.15)', color: '#fff', border: '1px solid rgba(255,255,255,0.25)' }}>
                {b.icon} {b.text}
              </span>
            ))}
          </div>

          <div className="flex gap-3 justify-center flex-wrap">
            <button
              onClick={() => document.getElementById('products')?.scrollIntoView({ behavior: 'smooth' })}
              className="font-bold px-7 py-3 rounded-2xl text-sm shadow-lg"
              style={{ background: '#ffd700', color: '#7b1500', boxShadow: '0 4px 15px rgba(255,215,0,0.4)' }}>
              🛍️ Shop Now
            </button>
            <button
              onClick={openSampleForm}
              className="border-2 text-white font-semibold px-7 py-3 rounded-2xl text-sm"
              style={{ borderColor: 'rgba(255,255,255,0.5)', background: 'rgba(255,255,255,0.1)' }}>
              🎁 Free Sample
            </button>
          </div>
        </div>
      </div>

      {/* ── Social Proof Stats Strip ─────────────────────────────────────── */}
      {siteStats && (
        <div className="py-5" style={{ background: 'linear-gradient(90deg, #7b1500 0%, #c45c00 50%, #7b1500 100%)' }}>
          <div className="max-w-5xl mx-auto px-4">
            <div className="grid grid-cols-3 divide-x divide-white/20">
              {[
                { value: siteStats.customers,        suffix: '+', label: 'Happy Customers',   icon: '😊' },
                { value: siteStats.orders,           suffix: '+', label: 'Orders Placed',      icon: '📦' },
                { value: siteStats.holige,           suffix: '+', label: 'Holige Served 🪔',   icon: '🍯' },
              ].map(stat => (
                <div key={stat.label} className="flex flex-col items-center py-1 px-2 text-center">
                  <span className="text-xl mb-0.5">{stat.icon}</span>
                  <span className="text-2xl md:text-3xl font-bold" style={{ color: '#ffd700', fontFamily: 'Poppins, sans-serif' }}>
                    {stat.value}{stat.suffix}
                  </span>
                  <span className="text-xs text-white/80 font-medium mt-0.5 leading-tight">{stat.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Festival Special: Holige Banner ─────────────────────────────── */}
      {siteStats && siteStats.holige > 0 && (
        <div className="mx-4 my-4 rounded-2xl overflow-hidden shadow-md"
          style={{ background: 'linear-gradient(135deg, #7b1500 0%, #c45c00 50%, #e8a000 100%)', border: '2px solid rgba(255,215,0,0.4)' }}>
          <div className="px-5 py-4 flex items-center gap-4">
            <div className="text-4xl flex-shrink-0">🍯</div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className="text-xs font-bold px-2 py-0.5 rounded-full"
                  style={{ background: 'rgba(255,215,0,0.25)', color: '#ffd700', border: '1px solid rgba(255,215,0,0.4)' }}>
                  🎉 Festival Special
                </span>
              </div>
              <p className="text-white font-bold text-base leading-snug">
                Holige / Obbattu — Made Fresh! 🪔
              </p>
              <p className="text-white/80 text-xs mt-0.5">
                <span className="font-bold" style={{ color: '#ffd700' }}>{siteStats.holige}+</span> Holige served to happy families &amp; counting!
              </p>
              <p className="text-white/70 text-xs mt-1">
                Authentic Karnataka style · Made with ghee &amp; love · Order now for your family 🙏
              </p>
            </div>
            <button
              onClick={() => {
                setActiveCategory('All');
                setSearchQuery('holige');
                document.getElementById('products')?.scrollIntoView({ behavior: 'smooth' });
              }}
              className="flex-shrink-0 text-xs font-bold px-3 py-2 rounded-xl"
              style={{ background: '#ffd700', color: '#7b1500' }}>
              Order Now
            </button>
          </div>
        </div>
      )}

      {/* ── Testimonials Marquee ────────────────────────────────────────── */}
      {testimonials.length > 0 && (
        <div className="py-6 overflow-hidden" style={{ background: '#fff4eb', borderTop: '1px solid #f0d9c8' }}>
          <div className="text-center mb-4 px-4">
            <h2 className="text-base font-bold mb-1" style={{ color: '#c45c00', fontFamily: 'Poppins, sans-serif' }}>What Our Customers Say ✨</h2>
            {feedbackStats && (
              <div className="flex items-center justify-center gap-3 flex-wrap">
                <span className="flex items-center gap-1 text-xs font-semibold" style={{ color: '#92400e' }}>
                  <Star className="w-3.5 h-3.5" style={{ fill: '#f59e0b', color: '#f59e0b' }} />
                  {feedbackStats.avg} avg rating
                </span>
                <span className="text-gray-300 text-xs">•</span>
                <span className="text-xs font-semibold" style={{ color: '#92400e' }}>
                  💬 {feedbackStats.total}+ happy reviews
                </span>
              </div>
            )}
          </div>
          {/* Marquee container */}
          <div className="relative">
            <div className="flex gap-4 animate-marquee" style={{ width: 'max-content' }}>
              {[...testimonials, ...testimonials].map((t, i) => (
                <div key={i} className="bg-white rounded-2xl p-4 shadow-sm flex-shrink-0 w-72"
                  style={{ border: '1px solid #f0d9c8' }}>
                  <div className="flex items-center gap-1 mb-2">
                    {[1,2,3,4,5].map(s => (
                      <Star key={s} className="w-3.5 h-3.5"
                        style={{ fill: s <= t.rating ? '#f59e0b' : '#e5e7eb', color: s <= t.rating ? '#f59e0b' : '#e5e7eb' }} />
                    ))}
                  </div>
                  <p className="text-xs text-gray-700 italic leading-relaxed">"{t.whatYouLiked}"</p>
                  <p className="text-xs font-semibold mt-2" style={{ color: '#c45c00' }}>— {t.customerName}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Subscription + WhatsApp ─────────────────────────────────────── */}
      <div className="max-w-5xl mx-auto px-4 py-6 grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* Subscription */}
        <SubscriptionBanner healthProducts={products.filter(p => p.category === 'Health Mix')} />

        {/* WhatsApp CTAs */}
        <div className="space-y-3">
          <h2 className="text-sm font-bold" style={{ color: '#2e7d32' }}>Stay Connected</h2>
          <a href={APP_CONFIG.WHATSAPP_GROUP_LINK} target="_blank" rel="noreferrer"
            className="flex items-center justify-between bg-white rounded-2xl px-4 py-3 shadow-sm"
            style={{ border: '1px solid #c8e6c9' }}>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: '#25d366' }}>
                <Users className="w-5 h-5 text-white" />
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-800">Join Our WhatsApp Group</p>
                <p className="text-xs text-gray-500">Offers, new products &amp; updates</p>
              </div>
            </div>
            <ChevronRight className="w-5 h-5 text-gray-400" />
          </a>
          <a href={APP_CONFIG.WHATSAPP_CHANNEL_LINK} target="_blank" rel="noreferrer"
            className="flex items-center justify-between bg-white rounded-2xl px-4 py-3 shadow-sm"
            style={{ border: '1px solid #c8e6c9' }}>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: '#075e54' }}>
                <MessageCircle className="w-5 h-5 text-white" />
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-800">Follow Our Channel</p>
                <p className="text-xs text-gray-500">Latest news &amp; announcements</p>
              </div>
            </div>
            <ChevronRight className="w-5 h-5 text-gray-400" />
          </a>
          {/* Free sample CTA card */}
          <button onClick={openSampleForm}
            className="w-full flex items-center gap-3 bg-white rounded-2xl px-4 py-3 shadow-sm text-left"
            style={{ border: '1.5px dashed #c45c00' }}>
            <div className="w-9 h-9 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
              style={{ background: '#fff4eb' }}>🎁</div>
            <div>
              <p className="text-sm font-semibold text-gray-800">Request a Free Sample</p>
              <p className="text-xs text-gray-500">Try before you buy — 50g of 2 products</p>
            </div>
            <ChevronRight className="w-5 h-5 text-gray-400 ml-auto" />
          </button>
        </div>
      </div>

      {/* ── Products Section (scroll target) ─────────────────────────────── */}
      <div id="products" className="max-w-5xl mx-auto px-4 pt-6 pb-28">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-xl font-bold" style={{ color: '#7b1500', fontFamily: 'Poppins, sans-serif' }}>🌿 Our Products</h2>
        </div>
        <p className="text-xs text-gray-400 mb-4">Tap any product to add to cart · Made fresh in small batches 🙏</p>
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search products…"
            className="w-full pl-9 pr-4 py-2.5 rounded-xl border text-sm outline-none bg-white"
            style={{ borderColor: '#e0d0c0' }}
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Category tabs + Sort toggle */}
        <div className="flex items-center gap-2 mb-4">
          <div className="flex gap-2 overflow-x-auto pb-1 flex-1 -mr-1">
            {categories.map(cat => (
              <button key={cat} onClick={() => setActiveCategory(cat)}
                className="flex-shrink-0 px-4 py-1.5 rounded-full text-sm font-medium transition-colors"
                style={activeCategory === cat
                  ? { background: '#c45c00', color: '#fff' }
                  : { background: '#f5f5f5', color: '#666' }}>
                {cat}
              </button>
            ))}
          </div>

        </div>

        {/* Search result count */}
        {searchQuery.trim() && (
          <p className="text-xs text-gray-500 mb-3">
            {filtered.length === 0
              ? 'No products found'
              : `${filtered.length} product${filtered.length !== 1 ? 's' : ''} found`}
          </p>
        )}

        {/* On-demand notice */}
        {filtered.some(p => p.isOnDemand) && (
          <div className="mb-4 flex items-start gap-2 rounded-xl px-4 py-3 text-xs"
            style={{ background: '#fff8e1', border: '1px solid #ffe082' }}>
            <Flame className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: '#f59e0b' }} />
            <span className="text-amber-800">
              Products marked <strong>🔥 Made Fresh on Order</strong> are prepared after your order. Delivery may take 1–2 extra days.
            </span>
          </div>
        )}

        {/* Product grid — 2 col mobile, 3 col tablet, 4 col desktop */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {filtered.map(product => (
            <ProductCard key={product.id} product={product} onAddToCart={addToCart} />
          ))}
          {filtered.length === 0 && (
            <div className="col-span-3 sm:col-span-4 text-center py-16 text-gray-400">
              <span className="text-5xl mb-3 block">🌿</span>
              <p>No products in this category</p>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <footer className="py-8 text-center" style={{ background: 'linear-gradient(160deg, #7b1500 0%, #2d1a00 100%)' }}>
        <div className="max-w-md mx-auto px-4">
          <div className="flex justify-center items-center gap-2 mb-2">
            <span className="text-2xl">🪷</span>
            <span className="font-bold text-white text-base" style={{ fontFamily: 'Poppins, sans-serif' }}>Sri Krishna Condiments</span>
          </div>
          <p className="text-xs mb-1" style={{ color: '#ffd700' }}>🙏 Hare Krishna — Pure · Fresh · Made with Devotion 🌿</p>
          <p className="text-xs mt-3" style={{ color: '#d4a574' }}>
            WhatsApp:{' '}
            <a href={`https://wa.me/${APP_CONFIG.WHATSAPP_NUMBER}`}
              className="underline" style={{ color: '#25d366' }}>
              {APP_CONFIG.WHATSAPP_DISPLAY}
            </a>
            {' · '}
            <a href={`https://wa.me/${APP_CONFIG.WHATSAPP_NUMBER2}`}
              className="underline" style={{ color: '#25d366' }}>
              {APP_CONFIG.WHATSAPP_DISPLAY2}
            </a>
          </p>
          <a href="/admin/login" className="block mt-5 text-xs" style={{ color: '#555' }}>Admin Login</a>
        </div>
      </footer>

      {/* Sticky cart bar */}
      {cartCount > 0 && !showCart && !showOrderForm && !showSampleForm && (
        <div className="fixed bottom-0 left-0 right-0 z-30 p-3">
          <div className="max-w-lg mx-auto">
            <button onClick={() => setShowCart(true)}
              className="w-full flex items-center justify-between text-white font-bold px-5 py-4 rounded-2xl shadow-2xl"
              style={{ background: 'linear-gradient(90deg, #7b1500 0%, #c45c00 100%)', boxShadow: '0 8px 24px rgba(196,92,0,0.5)' }}>
              <span className="flex items-center gap-2">
                <span className="bg-yellow-400 text-yellow-900 rounded-xl px-2.5 py-0.5 text-sm font-bold">{cartCount}</span>
                <span className="text-sm">item{cartCount > 1 ? 's' : ''} in cart</span>
              </span>
              <span className="text-sm">View Cart 🛒</span>
              <span className="font-bold text-yellow-300">{formatCurrency(cartTotal)}</span>
            </button>
          </div>
        </div>
      )}

      {/* Cart Drawer */}
      {showCart && (
        <>
          <div className="fixed inset-0 bg-black/50 z-50" onClick={() => setShowCart(false)} />
          <div className="fixed right-0 top-0 bottom-0 w-full sm:w-96 bg-white z-50 flex flex-col shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: '#f0d9c8' }}>
              <h2 className="font-bold text-gray-800 text-lg">Your Cart</h2>
              <button onClick={() => setShowCart(false)} className="p-2 hover:bg-gray-100 rounded-xl">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {cart.length === 0 && (
                <div className="text-center py-16 text-gray-400">
                  <ShoppingCart className="w-14 h-14 mx-auto mb-3 text-gray-300" />
                  <p className="font-medium">Your cart is empty</p>
                </div>
              )}
              {cart.map((item, i) => (
                <div key={i} className="flex items-start gap-3 bg-gray-50 rounded-2xl p-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800 truncate">{item.productName}</p>
                    {item.isOnDemand && (
                      <span className="text-xs font-medium" style={{ color: '#f59e0b' }}>🔥 Made Fresh on Order</span>
                    )}
                    <p className="text-xs text-gray-500 mt-0.5">₹{item.pricePerUnit}/{item.unit}</p>
                    {item.customizationNote && (
                      <p className="text-xs text-blue-600 mt-0.5 bg-blue-50 rounded px-1.5 py-0.5">
                        Note: {item.customizationNote}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <p className="text-sm font-bold" style={{ color: '#c45c00' }}>₹{item.totalPrice.toFixed(0)}</p>
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => updateCartItem(i, item.quantity - (item.unit === 'piece' ? 1 : 50))}
                        className="w-7 h-7 rounded-lg border flex items-center justify-center bg-white" style={{ borderColor: '#e0e0e0' }}>
                        <Minus className="w-3 h-3 text-gray-600" />
                      </button>
                      <span className="text-sm font-medium w-12 text-center">
                        {item.quantity}{item.unit === 'piece' ? '' : 'g'}
                      </span>
                      <button onClick={() => updateCartItem(i, item.quantity + (item.unit === 'piece' ? 1 : 50))}
                        className="w-7 h-7 rounded-lg border flex items-center justify-center bg-white" style={{ borderColor: '#e0e0e0' }}>
                        <Plus className="w-3 h-3 text-gray-600" />
                      </button>
                      <button onClick={() => updateCartItem(i, 0)} className="w-7 h-7 flex items-center justify-center hover:bg-red-50 rounded-lg">
                        <Trash2 className="w-4 h-4 text-red-400" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {cart.length > 0 && (
              <div className="border-t p-4 space-y-3" style={{ borderColor: '#f0d9c8' }}>
                {hasOnDemand && (
                  <div className="text-xs rounded-xl px-3 py-2" style={{ background: '#fff8e1', color: '#b45309' }}>
                    🔥 Contains on-demand items. Allow 1–2 extra days.
                  </div>
                )}
                <div className="flex justify-between items-center">
                  <span className="text-gray-600 text-sm">Total ({cartCount} items)</span>
                  <span className="text-xl font-bold" style={{ color: '#c45c00' }}>{formatCurrency(cartTotal)}</span>
                </div>
                <button
                  onClick={() => { setShowCart(false); setShowOrderForm(true); setOrderForm({ name: '', whatsapp: '', place: '', notes: '' }); }}
                  className="w-full text-white font-semibold py-3.5 rounded-2xl text-sm"
                  style={{ background: '#c45c00' }}>
                  Proceed to Order →
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {/* Order Modal */}
      {showOrderForm && (
        <OrderFormModal
          isSample={false}
          cart={cart}
          cartTotal={cartTotal}
          form={orderForm}
          setForm={setOrderForm}
          submitting={submitting}
          onClose={() => setShowOrderForm(false)}
          onSubmit={handlePlaceOrder}
        />
      )}

      {/* Sample Modal */}
      {showSampleForm && (
        <SampleModal
          products={sampleEligible}
          selected={sampleSelected}
          onToggle={toggleSample}
          step={sampleStep}
          setStep={setSampleStep}
          form={orderForm}
          setForm={setOrderForm}
          submitting={submitting}
          onClose={() => setShowSampleForm(false)}
          onSubmit={handleSampleRequest}
        />
      )}
    </div>
  );
}

// ─── Subscription Banner (Health Mix products) ───────────────────────────────
function SubscriptionBanner({ healthProducts }: { healthProducts: Product[] }) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [plan, setPlan] = useState<3 | 6>(6);

  const toggle = (id: string) =>
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const discount = plan === 6 ? 0.10 : 0.05;
  const selectedProducts = healthProducts.filter(p => selectedIds.includes(p.id));

  // Build WhatsApp message
  const waMessage = selectedProducts.length === 0
    ? `Hi! I'm interested in the Health Mix Subscription (${plan} months). Can you share more details?`
    : [
        `Hi! I'd like to subscribe to the following Health Mix products for ${plan} months:`,
        ...selectedProducts.map(p => `• ${p.name} — 250g/month`),
        ``,
        `Plan: ${plan}-month | ${plan === 6 ? '10%' : '5%'} off`,
        `Please confirm pricing and delivery dates.`,
      ].join('\n');

  return (
    <div className="mt-8 mb-2 rounded-2xl overflow-hidden"
      style={{ background: 'linear-gradient(135deg, #1b5e20 0%, #2e7d32 60%, #388e3c 100%)', border: '1px solid #1b5e20' }}>
      <div className="px-5 pt-5 pb-4 text-white">

        {/* Header */}
        <div className="flex items-center gap-2 mb-1">
          <span className="text-2xl">🌿</span>
          <div>
            <h3 className="font-bold text-base leading-tight">Health Mix Subscription</h3>
            <p className="text-green-200 text-xs">Lock in today's price — even if raw material costs rise</p>
          </div>
        </div>

        {/* Plan selector */}
        <div className="grid grid-cols-2 gap-2 my-4">
          {([3, 6] as const).map(m => (
            <button key={m} onClick={() => setPlan(m)}
              className={`rounded-xl p-3 text-center border-2 transition-all relative ${plan === m ? 'border-yellow-300 bg-white/20' : 'border-white/20 bg-white/10'}`}>
              {m === 6 && (
                <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-yellow-400 text-yellow-900 text-xs font-bold px-2 py-0.5 rounded-full whitespace-nowrap">
                  BEST VALUE
                </div>
              )}
              <div className="text-xl font-bold">{m} Months</div>
              <div className="text-xs mt-0.5 text-green-200">
                Save <span className="text-yellow-300 font-bold">{m === 6 ? '10%' : '5%'}</span>
              </div>
              <div className="text-xs text-white/60 mt-1">{m} deliveries, price locked</div>
            </button>
          ))}
        </div>

        {/* Product picker */}
        <p className="text-xs text-green-200 mb-2 font-medium">Choose your health products:</p>
        {healthProducts.length === 0 ? (
          <p className="text-xs text-white/60 mb-3">Loading products…</p>
        ) : (
          <div className="space-y-2 mb-4">
            {healthProducts.map(p => {
              const isSelected = selectedIds.includes(p.id);
              const pricePerMonth = Math.round(p.pricePerUnit * 250);
              const discountedPrice = Math.round(pricePerMonth * (1 - discount));
              return (
                <button key={p.id} onClick={() => toggle(p.id)}
                  className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 text-left transition-all ${
                    isSelected ? 'border-yellow-300 bg-white/20' : 'border-white/15 bg-white/10 hover:border-white/40'
                  }`}>
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                    isSelected ? 'border-yellow-300 bg-yellow-300' : 'border-white/40'
                  }`}>
                    {isSelected && <span className="text-green-900 text-xs font-bold">✓</span>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold">{p.name}</p>
                    {p.nameKannada && <p className="text-xs text-green-200">{p.nameKannada}</p>}
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-xs line-through text-white/50">₹{pricePerMonth}</div>
                    <div className="text-sm font-bold text-yellow-300">₹{discountedPrice}<span className="text-xs font-normal text-green-200">/mo</span></div>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Delivery info */}
        <div className="flex items-center gap-2 text-xs text-green-100 mb-4">
          <span>📅</span>
          <span>Delivered <strong className="text-white">every month, 1st–5th</strong> — fresh batch at your door</span>
        </div>

        {/* Feature pills */}
        <div className="flex flex-wrap gap-2 mb-4">
          {['✅ Fixed price', '🏠 Home delivery', '🔒 Price protection', '📲 WhatsApp updates'].map(f => (
            <span key={f} className="text-xs bg-white/15 rounded-full px-2.5 py-1">{f}</span>
          ))}
        </div>

        {/* CTA */}
        <a href={`https://wa.me/${APP_CONFIG.WHATSAPP_NUMBER}?text=${encodeURIComponent(waMessage)}`}
          target="_blank" rel="noreferrer"
          className="flex items-center justify-center gap-2 w-full py-3 rounded-xl font-bold text-sm"
          style={{ background: '#25d366', color: '#fff' }}>
          <span>💬</span>
          {selectedProducts.length > 0
            ? `Subscribe — ${selectedProducts.length} product${selectedProducts.length > 1 ? 's' : ''}, ${plan} months`
            : 'Ask about Subscription'}
        </a>
      </div>
    </div>
  );
}

// ─── Product Card (Swiggy/Zomato-style 2-col) ────────────────────────────────
function ProductCard({ product, onAddToCart }: {
  product: Product;
  onAddToCart: (p: Product, qty: number, note?: string) => void;
}) {
  const isOccasion = product.category === 'Sweets';
  const qtyStep  = product.unit === 'piece' ? 1 : product.unit === 'kg' ? 0.25 : 250;
  const minQty   = product.minOrderQty && product.minOrderQty > 0 ? product.minOrderQty : qtyStep;
  const [qty, setQty]       = useState(minQty);
  const [showDetail, setShowDetail] = useState(false);
  const price = qty * product.pricePerUnit;

  const qtyLabel = product.unit === 'piece'
    ? `${qty} pc${qty !== 1 ? 's' : ''}`
    : product.unit === 'kg'
      ? qty < 1 ? `${Math.round(qty * 1000)}g` : `${qty}kg`
      : qty >= 1000 ? `${qty / 1000}kg` : `${qty}g`;

  const priceDisplay = product.unit === 'gram'
    ? `₹${Math.round(product.pricePerUnit * 250)}/250g`
    : product.unit === 'kg'
      ? `₹${product.pricePerUnit}/kg`
      : `₹${product.pricePerUnit}/pc`;

  // Category → emoji
  const catEmoji: Record<string, string> = {
    'Chutney Powder': '🌶️', 'Health Mix': '💪', 'Masala': '🍛',
    'Sweets': '🍬', 'Snacks': '🍘', 'Other': '🧺',
  };
  const emoji = catEmoji[product.category] ?? '🌿';

  return (
    <>
      <div
        className="bg-white rounded-2xl overflow-hidden flex flex-col cursor-pointer active:scale-95 transition-transform"
        style={{ border: '1px solid #f0e8e0', boxShadow: '0 2px 8px rgba(196,92,0,0.07)' }}
        onClick={() => setShowDetail(true)}
      >
        {/* Illustration area */}
        <div className="relative flex items-center justify-center pt-4 pb-2 px-3"
          style={{ background: 'linear-gradient(135deg, #fff8f2 0%, #fff4e6 100%)', minHeight: 72 }}>
          <span className="text-4xl select-none">{emoji}</span>
          {product.isPopular && (
            <span className="absolute top-2 right-2 text-xs font-bold px-1.5 py-0.5 rounded-full"
              style={{ background: '#fef3c7', color: '#d97706', fontSize: '9px' }}>⭐ Popular</span>
          )}
          {product.isOnDemand && (
            <span className="absolute top-2 left-2 text-xs font-bold px-1.5 py-0.5 rounded-full"
              style={{ background: '#fff3e0', color: '#e65100', fontSize: '9px' }}>🔥 Fresh</span>
          )}
          {isOccasion && (
            <span className="absolute top-2 left-2 text-xs font-bold px-1.5 py-0.5 rounded-full"
              style={{ background: '#fce7f3', color: '#be185d', fontSize: '9px' }}>🎉 Special</span>
          )}
        </div>

        {/* Info */}
        <div className="px-3 pt-2 pb-1 flex-1">
          <h3 className="font-bold text-gray-800 text-sm leading-tight">{product.name}</h3>
          {product.nameKannada && (
            <p className="text-xs mt-0.5" style={{ color: '#b07040', fontFamily: 'sans-serif' }}>{product.nameKannada}</p>
          )}
          {product.description && (
            <p className="text-xs text-gray-400 mt-1 leading-snug line-clamp-2">{product.description}</p>
          )}
          <p className="font-bold text-sm mt-2" style={{ color: '#c45c00' }}>{priceDisplay}</p>
        </div>

        {/* Add button */}
        <div className="px-3 pb-3 pt-1">
          <button
            onClick={e => { e.stopPropagation(); setShowDetail(true); }}
            className="w-full font-bold py-2 rounded-xl text-sm flex items-center justify-center gap-1"
            style={{ background: '#fff4eb', color: '#c45c00', border: '1.5px solid #e8c4a0' }}>
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        </div>
      </div>

      {showDetail && (
        <ProductDetailSheet
          product={product}
          qty={qty} setQty={setQty}
          qtyStep={qtyStep} minQty={minQty}
          qtyLabel={qtyLabel} price={price}
          priceDisplay={priceDisplay}
          onClose={() => setShowDetail(false)}
          onAddToCart={onAddToCart}
        />
      )}
    </>
  );
}

// ─── Product Detail Sheet (bottom sheet on tap) ───────────────────────────────
function ProductDetailSheet({ product, qty, setQty, qtyStep, minQty, qtyLabel, price, priceDisplay, onClose, onAddToCart }: {
  product: Product; qty: number; setQty: React.Dispatch<React.SetStateAction<number>>;
  qtyStep: number; minQty: number; qtyLabel: string; price: number; priceDisplay: string;
  onClose: () => void; onAddToCart: (p: Product, qty: number, note?: string) => void;
}) {
  const [note, setNote]   = useState('');
  const [showNote, setShowNote] = useState(false);
  const isOccasion = product.category === 'Sweets';
  const descLong = (product.description?.length ?? 0) > 80;
  const [showFullDesc, setShowFullDesc] = useState(false);

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end justify-center" onClick={onClose}>
      <div className="bg-white rounded-t-3xl w-full max-w-md p-5 space-y-4"
        style={{ maxHeight: '85dvh', overflowY: 'auto' }}
        onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="font-bold text-gray-800 text-lg">{product.name}</h2>
              {product.isPopular && <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: '#fef3c7', color: '#d97706' }}>⭐ Popular</span>}
            </div>
            {product.nameKannada && <p className="text-sm" style={{ color: '#888' }}>{product.nameKannada}</p>}
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-xl flex-shrink-0">
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {/* Badges */}
        <div className="flex gap-2 flex-wrap">
          <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: '#fff4eb', color: '#c45c00' }}>{product.category}</span>
          {isOccasion && <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ background: '#fce7f3', color: '#be185d' }}>🎉 Occasions only</span>}
          {product.isOnDemand && <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ background: '#fff8e1', color: '#b45309' }}>🔥 Made Fresh on Order</span>}
        </div>

        {/* Description */}
        {product.description && (
          <div>
            <p className={`text-sm text-gray-600 leading-relaxed ${showFullDesc ? '' : 'line-clamp-3'}`}>{product.description}</p>
            {descLong && (
              <button onClick={() => setShowFullDesc(s => !s)} className="text-xs font-medium mt-0.5" style={{ color: '#c45c00' }}>
                {showFullDesc ? 'Show less ▲' : 'Read more ▼'}
              </button>
            )}
          </div>
        )}

        {/* Occasion notice */}
        {isOccasion && (
          <div className="rounded-xl p-3 text-sm" style={{ background: '#fce7f3', color: '#9d174d' }}>
            🎉 Min order: {minQty} pcs. For bulk orders (50+ pcs), please{' '}
            <a href={`https://wa.me/${APP_CONFIG.WHATSAPP_NUMBER}`} target="_blank" rel="noreferrer" className="underline font-semibold">contact us on WhatsApp</a>.
          </div>
        )}

        <p className="text-2xl font-bold" style={{ color: '#c45c00' }}>
          {priceDisplay}
          {(product.unit === 'gram' || product.unit === 'kg') && (
            <span className="text-sm font-normal text-gray-400 ml-2">= ₹{Math.round(price)} for {qtyLabel}</span>
          )}
        </p>

        {/* Qty selector */}
        <div className="flex items-center gap-3">
          <button onClick={() => setQty(q => Math.max(minQty, q - qtyStep))}
            className="w-10 h-10 rounded-xl flex items-center justify-center border text-lg font-bold" style={{ borderColor: '#e0d0c0' }}>
            <Minus className="w-4 h-4 text-gray-600" />
          </button>
          <span className="flex-1 text-center font-bold text-gray-800 text-lg">{qtyLabel}</span>
          <button onClick={() => setQty(q => q + qtyStep)}
            className="w-10 h-10 rounded-xl flex items-center justify-center border" style={{ borderColor: '#e0d0c0' }}>
            <Plus className="w-4 h-4 text-gray-600" />
          </button>
        </div>
        {product.unit === 'gram' && (
          <p className="text-xs text-gray-400 text-center -mt-2">Min {minQty}g · steps of {qtyStep}g</p>
        )}
        {product.unit === 'kg' && (
          <p className="text-xs text-gray-400 text-center -mt-2">Min {minQty < 1 ? `${Math.round(minQty*1000)}g` : `${minQty}kg`} · steps of {qtyStep < 1 ? `${Math.round(qtyStep*1000)}g` : `${qtyStep}kg`}</p>
        )}

        {/* Customization */}
        {product.allowCustomization && (
          <div>
            <button onClick={() => setShowNote(s => !s)} className="text-xs underline" style={{ color: '#c45c00' }}>
              {showNote ? '− Hide' : '+ Add'} special instructions
            </button>
            {showNote && (
              <textarea value={note} onChange={e => setNote(e.target.value)}
                placeholder={product.customizationHint || 'Special instructions…'}
                rows={2} maxLength={150}
                className="mt-2 w-full border rounded-xl px-3 py-2 text-sm outline-none resize-none"
                style={{ borderColor: '#e0d0c0' }} />
            )}
          </div>
        )}

        <button
          onClick={() => { onAddToCart(product, qty, note); onClose(); }}
          className="w-full flex items-center justify-between text-white font-bold py-3.5 px-5 rounded-2xl text-sm"
          style={{ background: '#c45c00' }}>
          <span>Add to Cart</span>
          <span>₹{Math.round(price)}</span>
        </button>
      </div>
    </div>
  );
}

// ─── Sample Modal (2-step: pick products → contact info) ─────────────────────
function SampleModal({ products, selected, onToggle, step, setStep, form, setForm, submitting, onClose, onSubmit }: {
  products: Product[]; selected: Product[];
  onToggle: (p: Product) => void;
  step: 'pick' | 'contact'; setStep: (s: 'pick' | 'contact') => void;
  form: { name: string; whatsapp: string; place: string; notes: string };
  setForm: React.Dispatch<React.SetStateAction<{ name: string; whatsapp: string; place: string; notes: string }>>;
  submitting: boolean; onClose: () => void; onSubmit: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center">
      <div className="bg-white rounded-t-3xl sm:rounded-2xl w-full max-w-md flex flex-col" style={{ maxHeight: '92dvh' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b flex-shrink-0" style={{ borderColor: '#f0d9c8' }}>
          <div>
            <h2 className="font-bold text-gray-800 text-base">
              {step === 'pick' ? '🎁 Free Sample — Pick 2 Products' : '📋 Your Details'}
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {step === 'pick'
                ? `${selected.length}/2 selected · 50g of each, free delivery`
                : 'We\'ll reach you on WhatsApp to arrange delivery'}
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-xl">
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {step === 'pick' ? (
          <>
            {/* Step 1: Product picker */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              <p className="text-xs text-gray-400 mb-3">
                Tap to select up to 2 products. Selecting a 3rd auto-removes the oldest.
              </p>
              {products.map(p => {
                const isSelected = selected.some(s => s.id === p.id);
                return (
                  <button key={p.id}
                    onClick={() => onToggle(p)}
                    className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 text-left transition-all ${
                      isSelected ? 'border-orange-400 bg-orange-50' : 'border-gray-100 hover:border-orange-200'
                    }`}>
                    <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                      isSelected ? 'border-orange-500 bg-orange-500' : 'border-gray-300'
                    }`}>
                      {isSelected && <span className="text-white text-xs font-bold">✓</span>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-800">{p.name}</p>
                      {p.nameKannada && <p className="text-xs text-gray-400">{p.nameKannada}</p>}
                    </div>
                    <span className="text-xs text-gray-400 flex-shrink-0">50g</span>
                  </button>
                );
              })}
            </div>
            {/* Footer */}
            <div className="p-4 border-t flex-shrink-0" style={{ borderColor: '#f0d9c8' }}>
              {selected.length > 0 && (
                <div className="mb-3 flex gap-2 flex-wrap">
                  {selected.map(p => (
                    <span key={p.id} className="text-xs px-2 py-1 rounded-full font-medium flex items-center gap-1"
                      style={{ background: '#fff4eb', color: '#c45c00' }}>
                      {p.name}
                      <button onClick={() => onToggle(p)} className="ml-1 text-gray-400 hover:text-red-400">×</button>
                    </span>
                  ))}
                </div>
              )}
              <button
                onClick={() => setStep('contact')}
                disabled={selected.length === 0}
                className="w-full text-white font-bold py-3.5 rounded-2xl text-sm disabled:opacity-40"
                style={{ background: '#c45c00' }}>
                {selected.length === 0 ? 'Select at least 1 product' : `Next — Enter your details →`}
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Step 2: Contact form */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              <div className="rounded-xl p-3 text-sm flex items-start gap-2" style={{ background: '#e8f5e9', color: '#2e7d32' }}>
                <span className="text-lg">🎁</span>
                <div>
                  <strong>Your sample:</strong>{' '}
                  {selected.map(p => p.name).join(' + ')} — 50g each, free delivery!
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Your Name <span className="text-red-400">*</span></label>
                <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Full name"
                  className="w-full border rounded-xl px-4 py-3 text-sm outline-none" style={{ borderColor: '#e0d0c0' }} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">WhatsApp Number <span className="text-red-400">*</span></label>
                <input type="tel" value={form.whatsapp} onChange={e => setForm(f => ({ ...f, whatsapp: e.target.value }))}
                  placeholder="10-digit number"
                  className="w-full border rounded-xl px-4 py-3 text-sm outline-none" style={{ borderColor: '#e0d0c0' }} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Your Area / Place</label>
                <input type="text" value={form.place} onChange={e => setForm(f => ({ ...f, place: e.target.value }))}
                  placeholder="e.g. Bangalore, JP Nagar"
                  className="w-full border rounded-xl px-4 py-3 text-sm outline-none" style={{ borderColor: '#e0d0c0' }} />
              </div>
              <div className="text-xs rounded-xl px-4 py-3" style={{ background: '#f5f5f5', color: '#666' }}>
                📱 We'll WhatsApp you to arrange delivery.<br />
                🔒 Your number is never shared.
              </div>
            </div>
            <div className="p-4 border-t flex-shrink-0 space-y-2" style={{ borderColor: '#f0d9c8' }}>
              <button onClick={onSubmit} disabled={submitting}
                className="w-full text-white font-bold py-3.5 rounded-2xl text-sm disabled:opacity-50"
                style={{ background: '#c45c00' }}>
                {submitting ? 'Sending…' : '🎁 Request Free Sample'}
              </button>
              <button onClick={() => setStep('pick')} className="w-full text-gray-500 text-sm py-1">
                ← Change products
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Order Form Modal ─────────────────────────────────────────────────────────
function OrderFormModal({
  isSample, cart, cartTotal, form, setForm, submitting, onClose, onSubmit
}: {
  isSample: boolean;
  cart: CartItem[];
  cartTotal: number;
  form: { name: string; whatsapp: string; place: string; notes: string };
  setForm: React.Dispatch<React.SetStateAction<{ name: string; whatsapp: string; place: string; notes: string }>>;
  submitting: boolean;
  onClose: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white rounded-t-3xl sm:rounded-2xl w-full max-w-md max-h-[95vh] overflow-y-auto flex flex-col">
        <div className="sticky top-0 bg-white px-5 py-4 border-b flex items-center justify-between rounded-t-3xl"
          style={{ borderColor: '#f0d9c8' }}>
          <div>
            <h2 className="font-bold text-gray-800">
              {isSample ? '🎁 Request Free Sample' : '🛍️ Place Your Order'}
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {isSample ? 'No payment needed' : `Total: ₹${cartTotal}`}
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-xl">
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>
        <div className="p-5 space-y-4 flex-1">
          {isSample && (
            <div className="rounded-xl p-3 text-sm" style={{ background: '#e8f5e9', color: '#2e7d32' }}>
              <strong>🎁 Free Sample!</strong> Get 50–100g delivered at no cost. We’ll reach you on WhatsApp.
            </div>
          )}
          {!isSample && cart.length > 0 && (
            <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid #f0d9c8' }}>
              {cart.map((item, i) => (
                <div key={i} className={`flex justify-between items-center px-4 py-2.5 text-sm ${i > 0 ? 'border-t' : ''}`}
                  style={{ borderColor: '#f9e8d8' }}>
                  <span className="text-gray-700 flex-1 truncate mr-2">
                    {item.productName}
                    <span className="text-gray-400 ml-1 text-xs">
                      ×{item.quantity}{item.unit !== 'piece' ? 'g' : ''}
                    </span>
                  </span>
                  <span className="font-semibold" style={{ color: '#c45c00' }}>₹{item.totalPrice.toFixed(0)}</span>
                </div>
              ))}
              <div className="flex justify-between items-center px-4 py-2.5 font-bold text-sm"
                style={{ background: '#fff4eb', borderTop: '1px solid #f0d9c8' }}>
                <span>Total</span>
                <span style={{ color: '#c45c00' }}>₹{cartTotal}</span>
              </div>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Your Name <span className="text-red-400">*</span>
            </label>
            <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Full name"
              className="w-full border rounded-xl px-4 py-3 text-sm outline-none" style={{ borderColor: '#e0d0c0' }} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              WhatsApp Number <span className="text-red-400">*</span>
            </label>
            <input type="tel" value={form.whatsapp} onChange={e => setForm(f => ({ ...f, whatsapp: e.target.value }))}
              placeholder="10-digit number"
              className="w-full border rounded-xl px-4 py-3 text-sm outline-none" style={{ borderColor: '#e0d0c0' }} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Your Area / Place</label>
            <input type="text" value={form.place} onChange={e => setForm(f => ({ ...f, place: e.target.value }))}
              placeholder="e.g. Bangalore, JP Nagar"
              className="w-full border rounded-xl px-4 py-3 text-sm outline-none" style={{ borderColor: '#e0d0c0' }} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              {isSample ? 'Why are you interested? (optional)' : 'Special instructions (optional)'}
            </label>
            <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              rows={2}
              placeholder={isSample ? 'Tell us about yourself…' : 'Delivery notes, customizations…'}
              className="w-full border rounded-xl px-4 py-3 text-sm outline-none resize-none"
              style={{ borderColor: '#e0d0c0' }} />
          </div>
          <div className="text-xs rounded-xl px-4 py-3" style={{ background: '#f5f5f5', color: '#666' }}>
            📱 Order updates will be sent on WhatsApp.<br />
            {!isSample && <>💳 Pay via GPay / PhonePe / UPI after confirmation.<br /></>}
            🔒 We never share your number with anyone.
          </div>
        </div>
        <div className="sticky bottom-0 bg-white px-5 pb-6 pt-3 border-t" style={{ borderColor: '#f0d9c8' }}>
          <button onClick={onSubmit} disabled={submitting}
            className="w-full text-white font-bold py-3.5 rounded-2xl text-sm disabled:opacity-50"
            style={{ background: '#c45c00' }}>
            {submitting ? 'Sending…' : isSample ? '🎁 Request Sample' : '✅ Place Order'}
          </button>
        </div>
      </div>
    </div>
  );
}

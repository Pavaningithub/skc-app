import { useEffect, useState, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ShoppingCart, Star, Plus, Minus,
  Trash2, X, Flame,
  Search
} from 'lucide-react';
import toast from 'react-hot-toast';
import { productsService, feedbackService, ordersService, customersService, stockService, subscriptionsService } from '../../lib/services';
import { generateOrderNumber, generateSubscriptionOrderNumber, formatCurrency, computeReferralDiscountFromTiers, computeCreditRedemption, normalizeWhatsapp } from '../../lib/utils';
import { useReferralConfig } from '../../lib/useReferralConfig';
import { useSubscriptionConfig } from '../../lib/useSubscriptionConfig';
import { useFeatureFlags } from '../../lib/useFeatureFlags';
import { APP_CONFIG } from '../../config';
import type { Product, Feedback, OrderItem, Order } from '../../lib/types';

interface CartItem extends OrderItem {}

export default function StoreFront() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // ?ref=SKC-XXXXX pre-filled from the share link
  const urlRefCode = (searchParams.get('ref') || '').toUpperCase().trim();

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
  const [sampleStep, setSampleStep]     = useState<'pick' | 'contact'>('pick');
  const [samplePhoneError, setSamplePhoneError] = useState('');   // inline duplicate error
  const [sampleCheckingPhone, setSampleCheckingPhone] = useState(false);
  const [orderForm, setOrderForm] = useState({ name: '', whatsapp: '', place: '', notes: '', referralCode: urlRefCode });
  // Referral: customer's own code shown after phone lookup, and validated referrer
  const [myReferralCode, setMyReferralCode] = useState<string | null>(null);
  const [isReturningCustomer, setIsReturningCustomer] = useState(false); // true = has prior orders, referral code blocked
  const [availableCredit, setAvailableCredit] = useState(0);  // ₹ credit balance from referring others
  const [useCredit, setUseCredit] = useState(false);          // customer toggled credit redemption on
  const [referralDiscount, setReferralDiscount] = useState(0);
  const [referralError, setReferralError] = useState('');
  const [standingDiscount, setStandingDiscount] = useState(0); // auto-applied from customer's discountApplyToNew
  const { config: referralConfig } = useReferralConfig();
  const { flags: featureFlags } = useFeatureFlags();
  const [scrolledPastHero, setScrolledPastHero] = useState(false);
  const [marqueesPaused, setMarqueesPaused] = useState(false);
  const [dismissedLaunches, setDismissedLaunches] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('skc_dismissed_launches') ?? '[]'); } catch { return []; }
  });
  const headerRef = useRef<HTMLElement>(null);

  useEffect(() => { load(); }, []);

  // Show floating CTA pill only after hero CTA buttons have scrolled out of view (~400px)
  useEffect(() => {
    const onScroll = () => setScrolledPastHero(window.scrollY > 400);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // When the order form opens and there's a URL ref code, auto-validate it
  useEffect(() => {
    if (!showOrderForm || !urlRefCode) return;
    (async () => {
      try {
        const referrer = await customersService.getByReferralCode(urlRefCode);
        if (referrer) {
          const disc = computeReferralDiscountFromTiers(cartTotal, referralConfig.tiers, referralConfig.splitReferrerPct);
          setReferralDiscount(disc.customerDiscount);
          setReferralError('');
        } else {
          setReferralError('Referral code in link is invalid');
        }
      } catch { /* silent */ }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showOrderForm]);

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
      // Load products first — unblock the UI immediately
      const p = await productsService.getActive();
      setProducts(p);
    } finally { setLoading(false); }

    // Load stats in the background after products are shown — uses aggregate counts (no full fetch)
    try {
      const stats = await ordersService.getSiteStats();
      setSiteStats({ orders: stats.orders, customers: stats.customers, holige: 444 });
    } catch { /* stats are non-critical, fail silently */ }
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
    // Compute the true step/minimum the same way ProductCard does
    const qtyStep = product.unit === 'piece' ? 1 : product.unit === 'kg' ? 0.25 : product.minOrderQty || 250;
    const rawMin  = product.minOrderQty && product.minOrderQty > 0 ? product.minOrderQty : qtyStep;
    const minQty  = product.unit === 'kg' && rawMin >= 100 ? rawMin / 1000 : rawMin;

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
        minOrderQty: minQty,
        customizationNote: note ?? '',
        isOnDemand: product.isOnDemand ?? false,
      }];
    });
    toast.success(`${product.name} added!`, { duration: 1200, icon: '🛒' });
  }

  function updateCartItem(idx: number, qty: number) {
    setCart(p => {
      const item = p[idx];
      const step = item?.minOrderQty ?? (item?.unit === 'piece' ? 1 : 250);
      const min  = step; // minimum = one step
      if (qty < min) return p.filter((_, i) => i !== idx); // remove if below minimum
      return p.map((it, i) => i === idx
        ? { ...it, quantity: qty, totalPrice: qty * it.pricePerUnit }
        : it
      );
    });
  }

  const cartTotal = cart.reduce((s, i) => s + i.totalPrice, 0);
  const cartCount = cart.length;
  const hasOnDemand = cart.some(i => i.isOnDemand);

  // New launches: active, within date window, not dismissed by this customer
  const today = new Date().toISOString().slice(0, 10);
  const activeLaunches = products.filter(p =>
    p.isNewLaunch &&
    p.isActive &&
    (!p.newLaunchUntil || p.newLaunchUntil >= today) &&
    !dismissedLaunches.includes(p.id)
  );
  const bannerLaunch = activeLaunches[0] ?? null; // show most-recent undismissed launch

  function dismissLaunch(productId: string) {
    const updated = [...dismissedLaunches, productId];
    setDismissedLaunches(updated);
    try { localStorage.setItem('skc_dismissed_launches', JSON.stringify(updated)); } catch {}
  }

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
    setSamplePhoneError('');
    setOrderForm({ name: '', whatsapp: '', place: '', notes: '', referralCode: '' });
    setShowSampleForm(true);
  }

  async function handleSamplePhoneChange(raw: string) {
    setOrderForm(f => ({ ...f, whatsapp: raw }));
    const digits = raw.replace(/\D/g, '').replace(/^(91|0)/, '').slice(0, 10);
    if (digits.length === 10) {
      setSampleCheckingPhone(true);
      try {
        const already = await ordersService.hasSampleByWhatsapp(digits);
        setSamplePhoneError(already
          ? 'This number has already requested a sample. Each number is eligible for one sample only.'
          : '');
      } finally {
        setSampleCheckingPhone(false);
      }
    } else {
      setSamplePhoneError('');
    }
  }

  async function handlePlaceOrder() {
    if (!orderForm.name.trim())  return toast.error('Please enter your name');
    const wa = normalizeWhatsapp(orderForm.whatsapp);
    if (wa.length !== 10)        return toast.error('Enter a valid 10-digit WhatsApp number');
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

      // Referral code discount (first order only) — mutually exclusive with credit redemption
      let referralCodeUsed: string | undefined;
      let referralDiscountAmt = 0;
      let referrerCreditAmt = 0;
      let referrerId: string | undefined;
      let creditUsedAmt = 0;

      const enteredCode = orderForm.referralCode.trim().toUpperCase();
      if (enteredCode) {
        // Final authoritative validation (UI already blocked bad codes pre-submit, this is the safety net)
        const isReturning = existing && (existing.totalOrders > 0 || existing.referredBy);
        const referrer = isReturning ? null : await customersService.getByReferralCode(enteredCode);
        const isSelfReferral = referrer && referrer.id === customerId;

        if (!isReturning && referrer && !isSelfReferral) {
          // Valid referral — apply discount
          referralCodeUsed = enteredCode;
          const split = computeReferralDiscountFromTiers(cartTotal, referralConfig.tiers, referralConfig.splitReferrerPct);
          referralDiscountAmt = split.customerDiscount;
          referrerId = referrer.id;
          referrerCreditAmt = split.referrerCredit;
        }
        // If invalid for any reason — fall through, order placed at full price (UI already warned them)
      } else if (useCredit && existing && (existing.referralCredit ?? 0) > 0) {
        // Credit redemption — returning customers only, capped by config
        creditUsedAmt = computeCreditRedemption(existing.referralCredit ?? 0, cartTotal, referralConfig.creditRedemptionPct, referralConfig.creditRedemptionCap);
      }

      // Standing discount takes priority — if active, ignore referral and credit
      const standingDiscountAmt = standingDiscount > 0 ? Math.round(cartTotal * standingDiscount / 100) : 0;
      const totalDiscountAmt = standingDiscountAmt > 0 ? standingDiscountAmt : (referralDiscountAmt + creditUsedAmt);
      const finalTotal = Math.max(0, cartTotal - totalDiscountAmt);
      const orderNumber = generateOrderNumber();
      const order: Omit<Order, 'id'> = {
        orderNumber, type: 'regular', customerId,
        customerName: orderForm.name.trim(), customerWhatsapp: wa,
        customerPlace: orderForm.place.trim(),
        items: cart, subtotal: cartTotal,
        discount: totalDiscountAmt, total: finalTotal,
        status: 'pending', paymentStatus: 'pending',
        notes: orderForm.notes,
        hasOnDemandItems: hasOnDemand,
        ...(referralCodeUsed ? { referralCodeUsed } : {}),
        referralDiscount: referralDiscountAmt,
        creditUsed: creditUsedAmt,
        deliveryCharge: 0,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };

      const orderId = await ordersService.add(order);
      for (const item of cart) {
        if (!item.isOnDemand) await stockService.deduct(item.productId, item.quantity, { productName: item.productName, unit: item.unit });
      }
      if (customerId) await customersService.updateAfterOrder(customerId, finalTotal, 'pending');

      // Deduct redeemed credit from customer balance (must happen before navigate)
      if (customerId && creditUsedAmt > 0) {
        await customersService.deductReferralCredit(customerId, creditUsedAmt);
      }

      // Credit the referrer with their share and lock in this customer's referredBy
      if (referrerId && referrerCreditAmt > 0) {
        await customersService.addReferralCredit(referrerId, referrerCreditAmt);
      }
      if (customerId && referralCodeUsed) {
        // Mark this customer as "referred by X" so they can't use another code later
        await customersService.update(customerId, { referredBy: referralCodeUsed });
      }

      // Navigate first to avoid storefront flash, then clear state
      navigate(`/order-confirmation/${orderId}`);
      setCart([]); setShowOrderForm(false);
      setMyReferralCode(null); setIsReturningCustomer(false); setReferralDiscount(0); setReferralError(''); setStandingDiscount(0);
      setUseCredit(false);
      setOrderForm({ name: '', whatsapp: '', place: '', notes: '', referralCode: '' });
      toast.success('Order placed! 🎉');
    } catch (err) { console.error('Order error:', err); toast.error('Something went wrong: ' + (err instanceof Error ? err.message : String(err))); }
    finally { setSubmitting(false); }
  }

  async function handleSampleRequest() {
    if (!orderForm.name.trim()) return toast.error('Please enter your name');
    const wa = normalizeWhatsapp(orderForm.whatsapp);
    if (wa.length !== 10)       return toast.error('Enter a valid 10-digit WhatsApp number');
    if (sampleSelected.length === 0) return toast.error('Please select at least one product');
    setSubmitting(true);
    try {
      // Guard: belt-and-suspenders check in case inline validation was bypassed
      const alreadyRequested = await ordersService.hasSampleByWhatsapp(wa);
      if (alreadyRequested) { setSubmitting(false); return; }

      let customerId: string | undefined;
      const existing = await customersService.getByWhatsapp(wa);
      if (existing) customerId = existing.id;
      else customerId = await customersService.upsert({
        name: orderForm.name.trim(), whatsapp: wa,
        place: orderForm.place.trim(), joinedWhatsappGroup: false,
        createdAt: new Date().toISOString(),
      });

      const orderNumber = generateOrderNumber();
      const charge = APP_CONFIG.SAMPLE_CHARGE;
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
        subtotal: charge, discount: 0, total: charge,
        status: 'pending',
        paymentStatus: charge > 0 ? 'pending' : 'na',
        notes: `Sample request: ${sampleSelected.map(p => p.name).join(', ')}${orderForm.notes ? '. ' + orderForm.notes : ''}`,
        hasOnDemandItems: false,
        referralDiscount: 0,
        creditUsed: 0,
        deliveryCharge: 0,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      const orderId = await ordersService.add(order);
      navigate(`/order-confirmation/${orderId}`);
      setShowSampleForm(false);
      toast.success("Sample request received! We'll contact you soon. 🎁");
    } catch (err) { console.error('Sample error:', err); toast.error('Something went wrong: ' + (err instanceof Error ? err.message : String(err))); }
    finally { setSubmitting(false); }
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'linear-gradient(160deg, #3d1c02 0%, #7a4010 50%, #c8821a 100%)' }}>
      <div className="text-center">
        <div className="text-6xl mb-4 animate-bounce">🪈</div>
        <p className="font-bold text-white text-lg mb-1" style={{ fontFamily: 'Georgia, serif', letterSpacing: '1px' }}>Sri Krishna Condiments</p>
        <p className="text-sm italic" style={{ color: '#ffd700' }}>Where Taste Meets Tradition…</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen font-sans" style={{ background: '#fdf5e6' }}>

      {/* Header — slides up out of view when scrolled past hero */}
      <header ref={headerRef}
        className="sticky top-0 z-40 shadow-md transition-transform duration-300"
        style={{
          background: 'linear-gradient(90deg, #3d1c02 0%, #7a4010 50%, #3d1c02 100%)',
          borderBottom: '2px solid #c8821a',
          transform: scrolledPastHero ? 'translateY(-110%)' : 'translateY(0)',
        }}>
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 text-2xl"
              style={{ background: 'rgba(200,130,26,0.25)', border: '2px solid #c8821a' }}>
              🪈
            </div>
            <div className="min-w-0">
              <p className="font-bold text-sm leading-tight text-white" style={{ fontFamily: 'Georgia, serif', letterSpacing: '0.5px' }}>SKC</p>
              <p className="text-xs leading-tight italic" style={{ color: '#ffd700' }}>Where Taste Meets Tradition</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <a href={APP_CONFIG.WHATSAPP_GROUP_LINK} target="_blank" rel="noreferrer"
              className="hidden sm:flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-full"
              style={{ color: '#ffd700', border: '1px solid rgba(200,130,26,0.5)' }}
              title="Join our WhatsApp Group">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>
              Group
            </a>
            <a href={APP_CONFIG.WHATSAPP_CHANNEL_LINK} target="_blank" rel="noreferrer"
              className="hidden sm:flex items-center text-xs font-medium px-2.5 py-1.5 rounded-full"
              style={{ color: '#ffd700', border: '1px solid rgba(200,130,26,0.5)' }}
              title="Follow our WhatsApp Channel">
              Channel
            </a>
            {APP_CONFIG.WHATSAPP_COMMUNITY_URL && (
              <a href={APP_CONFIG.WHATSAPP_COMMUNITY_URL} target="_blank" rel="noreferrer"
                className="hidden sm:flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-full"
                style={{ color: '#3d1c02', background: '#c8821a' }}
                title="Join our WhatsApp Community">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>
                Community
              </a>
            )}
            <a href="/my-orders"
              className="hidden sm:flex items-center text-xs font-medium px-3 py-1.5 rounded-full"
              style={{ color: '#ffd700', border: '1px solid rgba(200,130,26,0.5)' }}>
              My Account
            </a>
            <button onClick={() => setShowCart(true)}
              className="relative w-11 h-11 rounded-full flex items-center justify-center"
              style={{ background: 'rgba(200,130,26,0.25)', border: '1.5px solid #c8821a' }}>
              <ShoppingCart className="w-5 h-5 text-white" />
              {cartCount > 0 && (
                <span className="absolute -top-1 -right-1 w-5 h-5 text-xs rounded-full flex items-center justify-center font-bold"
                  style={{ background: '#c8821a', color: '#3d1c02' }}>
                  {cartCount}
                </span>
              )}
            </button>
          </div>
        </div>
        {/* Mobile nav row */}
        <div className="sm:hidden flex gap-2 px-4 pb-2 flex-wrap">
          <a href={APP_CONFIG.WHATSAPP_GROUP_LINK} target="_blank" rel="noreferrer"
            className="text-xs font-medium px-3 py-1 rounded-full flex items-center gap-1"
            style={{ color: '#ffd700', border: '1px solid rgba(200,130,26,0.5)' }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>
            WA Group
          </a>
          <a href={APP_CONFIG.WHATSAPP_CHANNEL_LINK} target="_blank" rel="noreferrer"
            className="text-xs font-medium px-3 py-1 rounded-full"
            style={{ color: '#ffd700', border: '1px solid rgba(200,130,26,0.5)' }}>
            Channel
          </a>
          {APP_CONFIG.WHATSAPP_COMMUNITY_URL && (
            <a href={APP_CONFIG.WHATSAPP_COMMUNITY_URL} target="_blank" rel="noreferrer"
              className="text-xs font-semibold px-3 py-1 rounded-full flex items-center gap-1"
              style={{ color: '#3d1c02', background: '#c8821a' }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>
              Community
            </a>
          )}
          <a href="/my-orders"
            className="text-xs font-medium px-3 py-1 rounded-full"
            style={{ color: '#ffd700', border: '1px solid rgba(200,130,26,0.5)' }}>
            My Account
          </a>
        </div>
      </header>

      {/* ── Floating CTA — top-center on mobile, bottom-right on desktop ── */}
      {scrolledPastHero && !showCart && !showOrderForm && !showSampleForm && (
        <>
          {/* Mobile: slim bar pinned to top */}
          <div
            className="sm:hidden fixed top-0 left-0 right-0 z-[38] flex items-center justify-center gap-2 px-3 py-2"
            style={{
              background: 'linear-gradient(90deg, #3d1c02 0%, #5a2a08 100%)',
              borderBottom: '1.5px solid #c8821a',
              boxShadow: '0 4px 16px rgba(61,28,2,0.5)',
            }}
          >
            <button
              onClick={() => document.getElementById('products')?.scrollIntoView({ behavior: 'smooth' })}
              className="font-bold px-4 py-1.5 rounded-xl text-sm whitespace-nowrap"
              style={{ background: '#c8821a', color: '#fff', border: '1.5px solid #e8c87a' }}>
              🛍️ Shop
            </button>
            {featureFlags.subscriptionBanner && (
              <button
                onClick={() => document.getElementById('subscribe')?.scrollIntoView({ behavior: 'smooth' })}
                className="font-semibold px-4 py-1.5 rounded-xl text-sm whitespace-nowrap border-2 text-white"
                style={{ borderColor: 'rgba(255,255,255,0.4)', background: 'rgba(255,255,255,0.08)' }}>
                📦 Subscribe
              </button>
            )}
            {featureFlags.sampleRequest && (
              <button
                onClick={openSampleForm}
                className="font-semibold px-4 py-1.5 rounded-xl text-sm whitespace-nowrap border-2 text-white"
                style={{ borderColor: 'rgba(255,255,255,0.4)', background: 'rgba(255,255,255,0.08)' }}>
                🎁 Sample
              </button>
            )}
          </div>

          {/* Desktop: stacked column bottom-right */}
          <div
            className="hidden sm:flex fixed right-4 z-[38] flex-col gap-2 transition-all duration-300"
            style={{ bottom: cartCount > 0 ? '88px' : '24px' }}
          >
            <button
              onClick={() => document.getElementById('products')?.scrollIntoView({ behavior: 'smooth' })}
              className="font-bold px-4 py-2 rounded-2xl text-sm shadow-xl whitespace-nowrap"
              style={{ background: '#c8821a', color: '#fff', border: '1.5px solid #e8c87a', boxShadow: '0 4px 20px rgba(200,130,26,0.5)' }}>
              🛍️ Shop
            </button>
            {featureFlags.subscriptionBanner && (
              <button
                onClick={() => document.getElementById('subscribe')?.scrollIntoView({ behavior: 'smooth' })}
                className="font-semibold px-4 py-2 rounded-2xl text-sm shadow-xl whitespace-nowrap"
                style={{ background: '#3d1c02', color: '#ffd700', border: '1.5px solid #c8821a', boxShadow: '0 4px 20px rgba(61,28,2,0.4)' }}>
                📦 Subscribe
              </button>
            )}
            {featureFlags.sampleRequest && (
              <button
                onClick={openSampleForm}
                className="font-semibold px-4 py-2 rounded-2xl text-sm shadow-xl whitespace-nowrap"
                style={{ background: '#3d1c02', color: '#ffd700', border: '1.5px solid #c8821a', boxShadow: '0 4px 20px rgba(61,28,2,0.4)' }}>
                🎁 Sample
              </button>
            )}
          </div>
        </>
      )}
      <div className="relative overflow-hidden" style={{ background: 'linear-gradient(160deg, #3d1c02 0%, #7a4010 40%, #c8821a 75%, #e8a000 100%)' }}>
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

        <div className="relative max-w-4xl mx-auto px-4 py-6 md:py-8">
          {/* Sacred greeting */}
          <div className="text-center mb-4">
            <div className="inline-flex items-center gap-2 rounded-full px-4 py-1 mb-3 text-xs font-semibold"
              style={{ background: 'rgba(255,215,0,0.18)', border: '1px solid rgba(255,215,0,0.4)', color: '#ffd700' }}>
              🙏 Hare Krishna — Hare Rama 🙏
            </div>
            <h1 className="text-2xl md:text-3xl font-bold text-white mb-1"
              style={{ fontFamily: 'Georgia, serif', textShadow: '0 2px 8px rgba(0,0,0,0.3)' }}>
              ಶ್ರೀ ಕೃಷ್ಣ ಕಾಂಡಿಮೆಂಟ್ಸ್
            </h1>
            <p className="text-white/90 font-medium mb-0.5 text-sm" style={{ letterSpacing: '1px' }}>Sri Krishna Condiments</p>
            <p className="text-white/70 text-xs mb-4 max-w-xs mx-auto">
              Authentic Karnataka &amp; Andhra flavours — Chutney Powders, Masalas &amp; Health Mixes made at home with love &amp; devotion.
            </p>
          </div>

          {/* Trust badges — compact inline tags */}
          <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 mb-5">
            {[
              { icon: '🌿', text: 'No Preservatives' },
              { icon: '🏠', text: 'Home Made' },
              { icon: '✨', text: 'Small Batch' },
              { icon: '❤️', text: 'Made with Love' },
            ].map(b => (
              <span key={b.text}
                className="flex items-center gap-1 text-xs font-medium"
                style={{ color: 'rgba(255,255,255,0.75)' }}>
                <span>{b.icon}</span>{b.text}
              </span>
            ))}
          </div>

          <div className="flex gap-3 justify-center flex-wrap">
            <button
              onClick={() => document.getElementById('products')?.scrollIntoView({ behavior: 'smooth' })}
              className="font-bold px-6 py-2.5 rounded-2xl text-sm shadow-lg"
              style={{ background: '#c8821a', color: '#fff', border: '1.5px solid #e8c87a', boxShadow: '0 4px 15px rgba(200,130,26,0.4)' }}>
              🛍️ Shop Now
            </button>
            {featureFlags.subscriptionBanner && (
              <button
                onClick={() => document.getElementById('subscribe')?.scrollIntoView({ behavior: 'smooth' })}
                className="font-semibold px-6 py-2.5 rounded-2xl text-sm border-2 text-white"
                style={{ borderColor: 'rgba(255,255,255,0.5)', background: 'rgba(255,255,255,0.1)' }}>
                📦 Subscribe
              </button>
            )}
            {featureFlags.sampleRequest && (
            <button
              onClick={openSampleForm}
              className="border-2 text-white font-semibold px-6 py-2.5 rounded-2xl text-sm"
              style={{ borderColor: 'rgba(255,255,255,0.5)', background: 'rgba(255,255,255,0.1)' }}>
              🎁 Free Sample
            </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Social Proof Stats Strip ─────────────────────────────────────── */}
      {siteStats && (
        <div className="py-2.5" style={{ background: '#3d1c02', borderBottom: '1px solid rgba(200,130,26,0.5)' }}>
          <div className="max-w-4xl mx-auto px-4">
            <div className="flex items-center justify-center gap-0 divide-x" style={{ borderColor: 'rgba(200,130,26,0.3)' }}>
              {[
                { value: siteStats.customers, suffix: '+', label: 'Happy Customers', icon: '😊' },
                { value: siteStats.orders,    suffix: '+', label: 'Orders Served',    icon: '📦' },
                { value: siteStats.holige,    suffix: '+', label: 'Holige Served 🪔', icon: '🍯' },
              ].map(stat => (
                <div key={stat.label} className="flex items-center gap-1.5 px-4 py-0.5">
                  <span className="text-base leading-none">{stat.icon}</span>
                  <span className="text-sm font-bold leading-none" style={{ color: '#c8821a', fontFamily: 'Georgia, serif' }}>
                    {stat.value}{stat.suffix}
                  </span>
                  <span className="text-xs leading-none" style={{ color: 'rgba(255,255,255,0.65)' }}>{stat.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Festival Special: Holige Banner ─────────────────────────────── */}
      {featureFlags.holigeBanner && siteStats && siteStats.holige > 0 && (
        <div className="mx-4 my-4 rounded-2xl overflow-hidden shadow-md"
          style={{ background: 'linear-gradient(135deg, #3d1c02 0%, #7a4010 50%, #c8821a 100%)', border: '2px solid #c8821a' }}>
          <div className="px-5 py-4 flex items-center gap-4">
            <div className="text-4xl flex-shrink-0">🪘</div>
            <div className="flex-1 min-w-0">
              <span className="text-xs font-bold px-2 py-0.5 rounded-full inline-block mb-1"
                style={{ background: 'rgba(200,130,26,0.3)', color: '#ffd700', border: '1px solid rgba(200,130,26,0.5)' }}>
                🎉 Festival Special
              </span>
              <p className="text-white font-bold text-base leading-snug" style={{ fontFamily: 'Georgia, serif' }}>
                Holige / Obbattu — Made Fresh!
              </p>
              <p className="text-white/80 text-xs mt-0.5">
                <span className="font-bold" style={{ color: '#c8821a' }}>{siteStats.holige}+</span> Holige served to happy families &amp; counting!
              </p>
              <p className="text-white/60 text-xs mt-1">
                Authentic Karnataka style · Made with ghee &amp; love 🙏
              </p>
            </div>
            <button
              onClick={() => {
                setActiveCategory('All');
                setSearchQuery('holige');
                document.getElementById('products')?.scrollIntoView({ behavior: 'smooth' });
              }}
              className="flex-shrink-0 text-xs font-bold px-4 py-2 rounded-full"
              style={{ background: '#c8821a', color: '#fff', border: '1.5px solid #ffd700' }}>
              Order Now
            </button>
          </div>
        </div>
      )}

      {/* ── Testimonials ─────────────────────────────────────────────── */}
      {featureFlags.testimonials && testimonials.length > 0 && (() => {
        const latest = testimonials[0];
        const latestInitials = latest.customerName.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();
        const scrollItems = testimonials.length > 1 ? testimonials.slice(1) : testimonials;
        const avatarColors = ['#128c7e', '#075e54', '#c8821a', '#7a4010', '#34b7f1', '#9c27b0'];
        return (
          <div className="rounded-2xl overflow-hidden mx-4" style={{ background: '#e5ddd5' }}>
            {/* Chat header */}
            <div className="flex items-center gap-3 px-4 py-3 border-b" style={{ borderColor: '#d1c4b8' }}>
              <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: '#c8821a' }}>
                <span className="text-white text-xs font-bold">SKC</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold" style={{ color: '#1a1a1a' }}>Sri Krishna Condiments</p>
                <p className="text-xs" style={{ color: '#667781' }}>
                  {feedbackStats ? `${feedbackStats.total} verified reviews · ⭐ ${feedbackStats.avg} avg` : 'Customer Reviews'}
                </p>
              </div>
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold flex-shrink-0" style={{ background: '#25d366', color: '#fff' }}>
                <Star className="w-3 h-3" style={{ fill: '#fff', color: '#fff' }} /> Verified
              </span>
            </div>

            {/* ── Pinned latest review ── */}
            <div className="px-3 pt-3 pb-2">
              <p className="text-xs font-semibold mb-1.5 px-1" style={{ color: '#667781' }}>📌 Latest review</p>
              <div className="flex items-end gap-2">
                <div className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center mb-0.5" style={{ background: '#c8821a' }}>
                  <span className="text-white text-xs font-bold">{latestInitials}</span>
                </div>
                <div className="relative rounded-2xl rounded-bl-sm px-3 py-2 shadow-sm flex-1" style={{ background: '#fff' }}>
                  <div className="flex items-center justify-between gap-2 mb-0.5 flex-wrap">
                    <span className="text-xs font-bold" style={{ color: '#075e54' }}>{latest.customerName}</span>
                    {latest.orderNumber && (
                      <span className="px-1.5 py-0.5 rounded-full flex-shrink-0"
                        style={{ background: '#e8f5e9', color: '#256029', fontSize: '9px', fontWeight: 700 }}>✓ #{latest.orderNumber}</span>
                    )}
                  </div>
                  <div className="flex gap-0.5 mb-1">
                    {[1,2,3,4,5].map(s => (
                      <Star key={s} className="w-2.5 h-2.5"
                        style={{ fill: s <= latest.rating ? '#f59e0b' : '#e5e7eb', color: s <= latest.rating ? '#f59e0b' : '#e5e7eb' }} />
                    ))}
                  </div>
                  <p className="text-xs leading-snug" style={{ color: '#1a1a1a' }}>"{latest.whatYouLiked}"</p>
                </div>
              </div>
            </div>

            {/* Divider */}
            <div className="mx-4 border-t" style={{ borderColor: '#d1c4b8' }} />

            {/* ── Horizontal scrolling marquee of older reviews ── */}
            <div
              className="overflow-hidden cursor-pointer select-none py-3"
              onPointerDown={() => setMarqueesPaused(true)}
              onPointerUp={() => setMarqueesPaused(false)}
              onPointerLeave={() => setMarqueesPaused(false)}
            >
              <div
                className="flex gap-3 px-3 animate-marquee-reviews"
                style={{ width: 'max-content', animationPlayState: marqueesPaused ? 'paused' : 'running' }}
              >
                {[...scrollItems, ...scrollItems].map((t, i) => {
                  const initials = t.customerName.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();
                  const avatarBg = avatarColors[i % avatarColors.length];
                  return (
                    <div key={i} className="flex-shrink-0 w-56 rounded-2xl px-3 py-2.5 shadow-sm" style={{ background: '#fff' }}>
                      <div className="flex items-center gap-2 mb-1">
                        <div className="w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center" style={{ background: avatarBg }}>
                          <span className="text-white" style={{ fontSize: '9px', fontWeight: 700 }}>{initials}</span>
                        </div>
                        <span className="text-xs font-bold truncate" style={{ color: '#075e54' }}>{t.customerName}</span>
                        {t.orderNumber && (
                          <span className="ml-auto flex-shrink-0 px-1 py-0.5 rounded-full"
                            style={{ background: '#e8f5e9', color: '#256029', fontSize: '8px', fontWeight: 700 }}>✓</span>
                        )}
                      </div>
                      <div className="flex gap-0.5 mb-1">
                        {[1,2,3,4,5].map(s => (
                          <Star key={s} className="w-2.5 h-2.5"
                            style={{ fill: s <= t.rating ? '#f59e0b' : '#e5e7eb', color: s <= t.rating ? '#f59e0b' : '#e5e7eb' }} />
                        ))}
                      </div>
                      <p className="text-xs leading-snug line-clamp-3" style={{ color: '#1a1a1a' }}>"{t.whatYouLiked}"</p>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Products Section (scroll target) ─────────────────────────────── */}
      <div id="products" className="max-w-4xl mx-auto px-4 pt-6 pb-28">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-xl font-bold" style={{ color: '#3d1c02', fontFamily: 'Georgia, serif' }}>🌿 Our Products</h2>
        </div>
        <p className="text-xs text-gray-400 mb-4">Tap any product to add to cart · Made fresh in small batches 🙏</p>

        {/* ── New Launch Banner ── */}
        {bannerLaunch && (
          <div className="mb-4 flex items-center gap-3 rounded-2xl px-4 py-3 relative"
            style={{ background: 'linear-gradient(135deg, #fff8e6, #fff1cc)', border: '1.5px solid #f59e0b' }}>
            <span className="text-2xl flex-shrink-0">🎉</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold" style={{ color: '#92400e' }}>
                🆕 Just Launched — {bannerLaunch.name}!
              </p>
              <p className="text-xs mt-0.5" style={{ color: '#b45309' }}>
                {bannerLaunch.description || 'Fresh off the batch — be the first to try it!'}
              </p>
            </div>
            <button
              onClick={() => dismissLaunch(bannerLaunch.id)}
              className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-full text-amber-600 hover:bg-amber-100 transition-colors"
              aria-label="Dismiss">
              ✕
            </button>
          </div>
        )}

        {/* Referral auto-apply banner — shown when page opened via a referral link */}
        {urlRefCode && (
          <div className="mb-4 flex items-center gap-3 rounded-2xl px-4 py-3"
            style={{ background: 'linear-gradient(135deg, #f0fdf4, #dcfce7)', border: '1px solid #86efac' }}>
            <span className="text-2xl">🎁</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-green-800">Referral discount ready!</p>
              <p className="text-xs text-green-700 mt-0.5">
                Code <span className="font-mono font-bold tracking-widest">{urlRefCode}</span> will be auto-applied at checkout.
                Add items to your cart and place your order!
              </p>
            </div>
            <span className="text-green-500 text-xl">✓</span>
          </div>
        )}
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
                  ? { background: '#c8821a', color: '#fff' }
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

      {/* ── Subscription ─────────────────────────────────────────────── */}
      {featureFlags.subscriptionBanner && (
        <div id="subscribe" className="max-w-4xl mx-auto px-4 pb-6">
          <SubscriptionBanner healthProducts={products.filter(p => p.category === 'Health Mix')} />
        </div>
      )}

      {/* Version badge — fixed bottom-right */}
      <div className="fixed bottom-3 right-3 z-50 flex items-center gap-1.5 px-2.5 py-1 rounded-full shadow-md text-white text-xs font-mono"
        style={{ background: __APP_ENV__ === 'production' ? '#22c55e' : '#3b82f6', opacity: 0.85 }}
        title={__APP_ENV__ === 'production' ? 'Production (Green)' : 'Staging (Blue)'}>
        <span className="w-1.5 h-1.5 rounded-full bg-white/70" />
        v{__APP_VERSION__}{__APP_ENV__ !== 'production' && ` · ${__APP_ENV__}`}
      </div>

      {/* Footer */}
      <footer className="py-8 text-center" style={{ background: 'linear-gradient(160deg, #3d1c02 0%, #1a0a00 100%)' }}>
        <div className="max-w-md mx-auto px-4">
          <div className="flex justify-center items-center gap-2 mb-2">
            <span className="text-2xl">🪷</span>
            <span className="font-bold text-white text-base" style={{ fontFamily: 'Georgia, serif' }}>Sri Krishna Condiments</span>
          </div>
          <p className="text-xs mb-1" style={{ color: '#ffd700' }}>🙏 Hare Krishna — Pure · Fresh · Made with Devotion 🌿</p>
          <p className="text-xs mt-3" style={{ color: 'rgba(255,255,255,0.4)' }}>© 2026 Sri Krishna Condiments. All rights reserved.</p>
        </div>
      </footer>

      {/* Sticky cart bar */}
      {cartCount > 0 && !showCart && !showOrderForm && !showSampleForm && (
        <div className="fixed bottom-0 left-0 right-0 z-30 p-3">
          <div className="max-w-4xl mx-auto">
            <button onClick={() => setShowCart(true)}
              className="w-full flex items-center justify-between text-white font-bold px-5 py-4 rounded-2xl shadow-2xl"
              style={{ background: 'linear-gradient(90deg, #3d1c02 0%, #c8821a 100%)', boxShadow: '0 8px 24px rgba(200,130,26,0.5)' }}>
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
                    <p className="text-sm font-bold" style={{ color: '#c8821a' }}>₹{item.totalPrice.toFixed(0)}</p>
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => updateCartItem(i, item.quantity - (item.minOrderQty ?? (item.unit === 'piece' ? 1 : 250)))}
                        className="w-7 h-7 rounded-lg border flex items-center justify-center bg-white" style={{ borderColor: '#e0e0e0' }}>
                        <Minus className="w-3 h-3 text-gray-600" />
                      </button>
                      <span className="text-sm font-medium w-12 text-center">
                        {item.quantity}{item.unit === 'piece' ? '' : 'g'}
                      </span>
                      <button onClick={() => updateCartItem(i, item.quantity + (item.minOrderQty ?? (item.unit === 'piece' ? 1 : 250)))}
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
                  <span className="text-xl font-bold" style={{ color: '#c8821a' }}>{formatCurrency(cartTotal)}</span>
                </div>
                <button
                  onClick={() => { setShowCart(false); setShowOrderForm(true); setOrderForm({ name: '', whatsapp: '', place: '', notes: '', referralCode: urlRefCode }); }}
                  className="w-full text-white font-semibold py-3.5 rounded-2xl text-sm"
                  style={{ background: '#c8821a' }}>
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
          urlRefCode={urlRefCode}
          myReferralCode={myReferralCode}
          setMyReferralCode={setMyReferralCode}
          isReturningCustomer={isReturningCustomer}
          setIsReturningCustomer={setIsReturningCustomer}
          availableCredit={availableCredit}
          setAvailableCredit={setAvailableCredit}
          useCredit={useCredit}
          setUseCredit={setUseCredit}
          referralDiscount={referralDiscount}
          setReferralDiscount={setReferralDiscount}
          referralError={referralError}
          setReferralError={setReferralError}
          standingDiscount={standingDiscount}
          setStandingDiscount={setStandingDiscount}
          showReferral={featureFlags.referralProgram}
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
          onPhoneChange={handleSamplePhoneChange}
          phoneError={samplePhoneError}
          checkingPhone={sampleCheckingPhone}
          submitting={submitting}
          onClose={() => setShowSampleForm(false)}
          onSubmit={handleSampleRequest}
        />
      )}
    </div>
  );
}

// ─── Subscription Banner (Health Mix products) ───────────────────────────────
const SUB_QTYS = [250, 500, 1000] as const;
type SubQty = typeof SUB_QTYS[number];
function subQtyLabel(g: SubQty) { return g === 1000 ? '1 kg' : `${g} g`; }

function SubscriptionBanner({ healthProducts }: { healthProducts: Product[] }) {
  const navigate = useNavigate();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [quantities, setQuantities] = useState<Record<string, SubQty>>({});
  const [plan, setPlan] = useState<3 | 6>(6);
  const [paymentMode, setPaymentMode] = useState<'upfront' | 'monthly'>('upfront');
  const { config: subConfig } = useSubscriptionConfig();

  // Subscribe form modal state
  const [showForm, setShowForm] = useState(false);
  const [subForm, setSubForm] = useState({ name: '', whatsapp: '', place: '', notes: '' });
  const [subSubmitting, setSubSubmitting] = useState(false);

  const toggle = (id: string) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    setQuantities(prev => ({ ...prev, [id]: prev[id] ?? 250 }));
  };

  const setQty = (id: string, qty: SubQty) =>
    setQuantities(prev => ({ ...prev, [id]: qty }));

  const discountPct = paymentMode === 'upfront'
    ? (plan === 6 ? subConfig.upfrontSixMonthPct : subConfig.upfrontThreeMonthPct)
    : (plan === 6 ? subConfig.monthlySixMonthPct  : subConfig.monthlyThreeMonthPct);
  const discount = discountPct / 100;
  const selectedProducts = healthProducts.filter(p => selectedIds.includes(p.id));

  // Live cost calculations
  const totalBasePerMonth = selectedProducts.reduce((sum, p) => {
    const g = quantities[p.id] ?? 250;
    return sum + Math.round(p.pricePerUnit * g);
  }, 0);
  const totalDiscountedPerMonth = Math.round(totalBasePerMonth * (1 - discount));
  const totalSavingsPerMonth = totalBasePerMonth - totalDiscountedPerMonth;
  const totalForDuration = totalDiscountedPerMonth * plan;
  const totalSavingsForDuration = totalSavingsPerMonth * plan;

  async function handleSubscribe() {
    if (!subForm.name.trim() || !subForm.whatsapp.trim()) {
      toast.error('Please fill in your name and WhatsApp number');
      return;
    }
    const digits = subForm.whatsapp.replace(/\D/g, '').replace(/^(91|0)/, '').slice(0, 10);
    if (digits.length !== 10) {
      toast.error('Enter a valid 10-digit WhatsApp number');
      return;
    }
    if (selectedProducts.length === 0) {
      toast.error('Please select at least one product');
      return;
    }
    setSubSubmitting(true);
    try {
      const items = selectedProducts.map(p => {
        const g = quantities[p.id] ?? 250;
        const basePrice = Math.round(p.pricePerUnit * g);
        const discountedPrice = Math.round(basePrice * (1 - discount));
        return {
          productId: p.id,
          productName: p.name,
          quantity: g,
          unit: 'gram' as const,
          pricePerUnit: p.pricePerUnit,
          totalPrice: discountedPrice,
        };
      });
      const now = new Date();
      const startDate = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString().split('T')[0];
      const endDate = new Date(now.getFullYear(), now.getMonth() + 1 + plan, 0).toISOString().split('T')[0];

      const subId = await subscriptionsService.add({
        subscriptionNumber: generateSubscriptionOrderNumber(),
        customerId: digits,
        customerName: subForm.name.trim(),
        customerWhatsapp: digits,
        ...(subForm.place.trim() ? { customerPlace: subForm.place.trim() } : {}),
        items,
        duration: (plan === 6 ? '6months' : '3months') as import('../../lib/constants').SubscriptionDuration,
        paymentMode,
        discountPercent: discountPct,
        baseAmount: totalBasePerMonth,
        discountedAmount: totalDiscountedPerMonth,
        startDate,
        endDate,
        isActive: false,
        paymentStatus: 'pending',
        ...(subForm.notes.trim() ? { notes: subForm.notes.trim() } : {}),
        createdAt: new Date().toISOString(),
      });
      navigate(`/subscription-confirmation/${subId}`);
    } catch (err) {
      console.error('Subscription submit failed:', err);
      toast.error('Something went wrong. Please try again.');
    } finally {
      setSubSubmitting(false);
    }
  }

  return (
    <>
    <div className="rounded-2xl overflow-hidden"
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

        {/* Payment mode toggle */}
        <div className="grid grid-cols-2 gap-2 my-3">
          {(['upfront', 'monthly'] as const).map(mode => (
            <button key={mode} onClick={() => setPaymentMode(mode)}
              className={`rounded-xl py-2 text-sm font-semibold border-2 transition-all ${
                paymentMode === mode ? 'border-yellow-300 bg-white/20' : 'border-white/20 bg-white/10'
              }`}>
              {mode === 'upfront' ? '💳 Pay Upfront' : '📅 Pay Monthly'}
            </button>
          ))}
        </div>
        <p className="text-xs text-green-200 mb-3">
          {paymentMode === 'upfront'
            ? 'Pay for the full duration at once — higher discount reward'
            : 'Pay each month — flexible, lower discount'}
        </p>

        {/* Plan selector */}
        <div className="grid grid-cols-2 gap-2 mb-4">
          {([3, 6] as const).map(m => {
            const pct = paymentMode === 'upfront'
              ? (m === 6 ? subConfig.upfrontSixMonthPct : subConfig.upfrontThreeMonthPct)
              : (m === 6 ? subConfig.monthlySixMonthPct  : subConfig.monthlyThreeMonthPct);
            return (
              <button key={m} onClick={() => setPlan(m)}
                className={`rounded-xl p-3 text-center border-2 transition-all relative ${plan === m ? 'border-yellow-300 bg-white/20' : 'border-white/20 bg-white/10'}`}>
                {m === 6 && (
                  <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-yellow-400 text-yellow-900 text-xs font-bold px-2 py-0.5 rounded-full whitespace-nowrap">
                    BEST VALUE
                  </div>
                )}
                <div className="text-xl font-bold">{m} Months</div>
                <div className="text-xs mt-0.5 text-green-200">
                  Save <span className="text-yellow-300 font-bold">{pct}%</span>
                </div>
                <div className="text-xs text-white/60 mt-1">{m} deliveries, price locked</div>
              </button>
            );
          })}
        </div>

        {/* Product picker */}
        <p className="text-xs text-green-200 mb-2 font-medium">Choose your health products:</p>
        {healthProducts.length === 0 ? (
          <p className="text-xs text-white/60 mb-3">Loading products…</p>
        ) : (
          <div className="space-y-2 mb-4">
            {healthProducts.map(p => {
              const isSelected = selectedIds.includes(p.id);
              const selectedQty: SubQty = (quantities[p.id] ?? 250) as SubQty;
              const basePrice = Math.round(p.pricePerUnit * selectedQty);
              const discountedPrice = Math.round(basePrice * (1 - discount));
              return (
                <div key={p.id}
                  className={`rounded-xl border-2 overflow-hidden transition-all ${
                    isSelected ? 'border-yellow-300 bg-white/20' : 'border-white/15 bg-white/10'
                  }`}>
                  {/* Product row */}
                  <button onClick={() => toggle(p.id)}
                    className="w-full flex items-center gap-3 p-3 text-left">
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
                      <div className="text-xs line-through text-white/50">₹{basePrice}/mo</div>
                      <div className="text-sm font-bold text-yellow-300">₹{discountedPrice}<span className="text-xs font-normal text-green-200">/mo</span></div>
                    </div>
                  </button>
                  {/* Qty picker */}
                  <div className="flex items-center gap-1 px-3 pb-2.5">
                    <span className="text-xs text-green-200 mr-1">Qty/month:</span>
                    {SUB_QTYS.map(g => (
                      <button key={g}
                        onClick={e => { e.stopPropagation(); setQty(p.id, g); if (!isSelected) toggle(p.id); }}
                        className={`flex-1 py-1 rounded-lg text-xs font-semibold border transition-all ${
                          selectedQty === g && isSelected
                            ? 'border-yellow-300 bg-yellow-300 text-green-900'
                            : 'border-white/25 bg-white/10 text-white/80'
                        }`}>
                        {subQtyLabel(g)}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Live cost summary ── */}
        {selectedProducts.length > 0 && (
          <div className="rounded-xl mb-4 overflow-hidden" style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.15)' }}>
            <div className="px-4 py-3 space-y-1.5">
              <p className="text-xs text-green-200 font-semibold uppercase tracking-wide mb-2">Your Cost Summary</p>
              {/* Per product breakdown */}
              {selectedProducts.map(p => {
                const g = quantities[p.id] ?? 250;
                const base = Math.round(p.pricePerUnit * g);
                const disc = Math.round(base * (1 - discount));
                return (
                  <div key={p.id} className="flex justify-between items-center text-xs">
                    <span className="text-green-100">{p.name} ({subQtyLabel(g as SubQty)})</span>
                    <span className="text-yellow-300 font-semibold">₹{disc}/mo</span>
                  </div>
                );
              })}
              <div className="border-t border-white/15 pt-2 mt-2 space-y-1">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-green-100">Monthly total</span>
                  <div className="text-right">
                    <span className="line-through text-white/40 text-xs mr-1">₹{totalBasePerMonth}</span>
                    <span className="text-white font-bold">₹{totalDiscountedPerMonth}/mo</span>
                  </div>
                </div>
                {paymentMode === 'upfront' ? (
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-green-100">Total upfront ({plan} mo)</span>
                    <span className="text-yellow-300 font-bold text-base">₹{totalForDuration}</span>
                  </div>
                ) : (
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-green-100">Pay monthly for {plan} mo</span>
                    <span className="text-yellow-300 font-bold">₹{totalDiscountedPerMonth}/mo × {plan}</span>
                  </div>
                )}
                <div className="flex justify-between items-center text-xs">
                  <span className="text-green-200">You save vs regular price</span>
                  <span className="text-green-300 font-bold">₹{totalSavingsForDuration} total ({discountPct}% off)</span>
                </div>
              </div>
            </div>
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
        <button
          onClick={() => {
            if (selectedProducts.length === 0) {
              toast.error('Please select at least one product first');
              return;
            }
            setShowForm(true);
          }}
          className="flex items-center justify-center gap-2 w-full py-3 rounded-xl font-bold text-sm transition-opacity"
          style={{ background: selectedProducts.length > 0 ? '#c8821a' : 'rgba(255,255,255,0.2)', color: '#fff' }}>
          {selectedProducts.length > 0
            ? `🛒 Subscribe — ${selectedProducts.length} product${selectedProducts.length > 1 ? 's' : ''}, ${plan} months`
            : 'Select products to subscribe'}
        </button>
      </div>
    </div>

    {/* ── Subscribe contact form modal ── */}
    {showForm && (
      <div className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
        <div className="bg-white rounded-t-3xl sm:rounded-2xl w-full max-w-md flex flex-col" style={{ maxHeight: '95dvh' }}>
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b flex-shrink-0" style={{ borderColor: '#d1fae5' }}>
            <div>
              <h2 className="font-bold text-gray-800">🌿 Confirm Subscription</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                {selectedProducts.length} product{selectedProducts.length > 1 ? 's' : ''} · {plan} months ·{' '}
                {paymentMode === 'upfront' ? `₹${totalForDuration} upfront` : `₹${totalDiscountedPerMonth}/mo`} · {discountPct}% off
              </p>
            </div>
            <button onClick={() => setShowForm(false)} className="p-2 hover:bg-gray-100 rounded-xl">
              <X className="w-5 h-5 text-gray-400" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {/* Order summary */}
            <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #d1fae5' }}>
              {selectedProducts.map((p, i) => {
                const g = quantities[p.id] ?? 250;
                const base = Math.round(p.pricePerUnit * g);
                const disc = Math.round(base * (1 - discount));
                return (
                  <div key={p.id}
                    className={`flex justify-between items-center px-4 py-2.5 text-sm ${i > 0 ? 'border-t' : ''}`}
                    style={{ borderColor: '#ecfdf5' }}>
                    <span className="text-gray-700 flex-1 truncate mr-2">
                      {p.name} <span className="text-gray-400 text-xs">× {subQtyLabel(g as SubQty)}/mo</span>
                    </span>
                    <div className="text-right flex-shrink-0">
                      <span className="line-through text-gray-300 text-xs mr-1">₹{base}</span>
                      <span className="font-semibold text-green-700">₹{disc}/mo</span>
                    </div>
                  </div>
                );
              })}
              <div className="px-4 py-3 space-y-1 border-t" style={{ background: '#f0fdf4', borderColor: '#d1fae5' }}>
                <div className="flex justify-between text-sm font-bold">
                  <span className="text-gray-700">Monthly total</span>
                  <span className="text-green-700">₹{totalDiscountedPerMonth}/mo</span>
                </div>
                {paymentMode === 'upfront' && (
                  <div className="flex justify-between text-sm font-bold">
                    <span className="text-gray-700">Upfront total ({plan} mo)</span>
                    <span className="text-green-800">₹{totalForDuration}</span>
                  </div>
                )}
                <div className="flex justify-between text-xs text-green-600">
                  <span>You save</span>
                  <span className="font-semibold">₹{totalSavingsForDuration} ({discountPct}% off)</span>
                </div>
              </div>
            </div>

            {/* Contact fields */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Your Name <span className="text-red-400">*</span></label>
              <input type="text" value={subForm.name} onChange={e => setSubForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Full name"
                className="w-full border rounded-xl px-4 py-3 text-sm outline-none" style={{ borderColor: '#e0d0c0' }} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">WhatsApp Number <span className="text-red-400">*</span></label>
              <input type="tel" value={subForm.whatsapp} onChange={e => setSubForm(f => ({ ...f, whatsapp: e.target.value }))}
                placeholder="10-digit number"
                className="w-full border rounded-xl px-4 py-3 text-sm outline-none" style={{ borderColor: '#e0d0c0' }} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Your Area / Place</label>
              <input type="text" value={subForm.place} onChange={e => setSubForm(f => ({ ...f, place: e.target.value }))}
                placeholder="e.g. Bangalore, JP Nagar"
                className="w-full border rounded-xl px-4 py-3 text-sm outline-none" style={{ borderColor: '#e0d0c0' }} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Notes (optional)</label>
              <textarea value={subForm.notes} onChange={e => setSubForm(f => ({ ...f, notes: e.target.value }))}
                rows={2} placeholder="Any special requests or questions…"
                className="w-full border rounded-xl px-4 py-3 text-sm outline-none resize-none" style={{ borderColor: '#e0d0c0' }} />
            </div>
            <div className="rounded-xl px-4 py-3 text-xs" style={{ background: '#f0fdf4', color: '#166534' }}>
              📲 We'll WhatsApp you to confirm your subscription &amp; arrange payment.<br />
              🔒 Your details are kept private.
            </div>
          </div>

          <div className="p-4 border-t flex-shrink-0 space-y-2" style={{ borderColor: '#f0d9c8' }}>
            <button onClick={handleSubscribe} disabled={subSubmitting}
              className="w-full text-white font-bold py-3.5 rounded-2xl text-sm disabled:opacity-50 transition-opacity"
              style={{ background: '#1b5e20' }}>
              {subSubmitting ? 'Placing subscription…' : '✅ Confirm Subscription'}
            </button>
            <button onClick={() => setShowForm(false)} className="w-full text-gray-500 text-sm py-1">
              ← Go back
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}


// ─── Product Card (Swiggy/Zomato-style 2-col) ────────────────────────────────
function ProductCard({ product, onAddToCart }: {
  product: Product;
  onAddToCart: (p: Product, qty: number, note?: string) => void;
}) {
  const isOccasion = product.category === 'Sweets';
  const qtyStep  = product.unit === 'piece' ? 1 : product.unit === 'kg' ? 0.25 : 250;
  // Guard: if unit is 'kg' but minOrderQty looks like it was entered in grams (>= 100), convert it
  const rawMinQty = product.minOrderQty && product.minOrderQty > 0 ? product.minOrderQty : qtyStep;
  const minQty    = product.unit === 'kg' && rawMinQty >= 100 ? rawMinQty / 1000 : rawMinQty;
  const [qty, setQty]       = useState(minQty);
  const [showDetail, setShowDetail] = useState(false);
  const [showFact, setShowFact]     = useState(false);
  const price = qty * product.pricePerUnit;

  const todayStr = new Date().toISOString().slice(0, 10);
  const isNewLaunch = product.isNewLaunch && (!product.newLaunchUntil || product.newLaunchUntil >= todayStr);

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
          {isNewLaunch && (
            <span className="absolute top-2 left-2 text-xs font-bold px-1.5 py-0.5 rounded-full"
              style={{ background: '#fef9c3', color: '#854d0e', fontSize: '9px', border: '1px solid #fde047' }}>🆕 New!</span>
          )}
          {!isNewLaunch && product.isOnDemand && (
            <span className="absolute top-2 left-2 text-xs font-bold px-1.5 py-0.5 rounded-full"
              style={{ background: '#fff3e0', color: '#e65100', fontSize: '9px' }}>🔥 Fresh</span>
          )}
          {isOccasion && (
            <span className="absolute top-2 left-2 text-xs font-bold px-1.5 py-0.5 rounded-full"
              style={{ background: '#fce7f3', color: '#be185d', fontSize: '9px' }}>🎉 Special</span>
          )}
          {product.hasGarlicOption && (
            <span className="absolute bottom-2 right-2 text-xs font-bold px-1.5 py-0.5 rounded-full"
              style={{ background: '#fef3c7', color: '#92400e', fontSize: '9px', border: '1px solid #fcd34d' }}>🧄 w/wo garlic</span>
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
          {product.didYouKnow && (
            <button
              className="mt-1.5 flex items-center gap-1 text-left w-full"
              onClick={e => { e.stopPropagation(); setShowFact(f => !f); }}
            >
              <span className="text-xs font-semibold" style={{ color: '#c8821a' }}>💡 Did you know?</span>
              <span className="text-xs" style={{ color: '#c8821a' }}>{showFact ? '▲' : '▼'}</span>
            </button>
          )}
          {showFact && product.didYouKnow && (
            <p className="text-xs leading-snug mt-1 px-2 py-1.5 rounded-lg"
              style={{ background: '#fffbeb', color: '#92400e', border: '1px solid #fde68a' }}>
              {product.didYouKnow}
            </p>
          )}
          <p className="font-bold text-sm mt-2" style={{ color: '#c8821a' }}>{priceDisplay}</p>
        </div>

        {/* Add button */}
        <div className="px-3 pb-3 pt-1">
          <button
            onClick={e => { e.stopPropagation(); setShowDetail(true); }}
            className="w-full font-bold py-2 rounded-xl text-sm flex items-center justify-center gap-1"
            style={{ background: '#fdf5e6', color: '#7a4010', border: '1.5px solid #c8821a' }}>
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
  const [garlic, setGarlic] = useState<'with' | 'without' | ''>(
    product.hasGarlicOption ? 'without' : ''
  );
  const [note, setNote]   = useState('');
  const [showNote, setShowNote] = useState(false);
  const isOccasion = product.category === 'Sweets';
  const descLong = (product.description?.length ?? 0) > 80;
  const [showFullDesc, setShowFullDesc] = useState(false);

  const garlicRequired = !!product.hasGarlicOption && !garlic;

  function handleAddToCart() {
    if (garlicRequired) {
      toast.error('Please choose With or Without Garlic');
      return;
    }
    const garlicLabel = garlic === 'with' ? 'With Garlic' : garlic === 'without' ? 'Without Garlic' : '';
    const fullNote = [garlicLabel, note].filter(Boolean).join(' · ');
    onAddToCart(product, qty, fullNote || undefined);
    onClose();
  }

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
          <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: '#fdf5e6', color: '#7a4010' }}>{product.category}</span>
          {isOccasion && <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ background: '#fce7f3', color: '#be185d' }}>🎉 Occasions only</span>}
          {product.isOnDemand && <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ background: '#fff8e1', color: '#b45309' }}>🔥 Made Fresh on Order</span>}
        </div>

        {/* Description */}
        {product.description && (
          <div>
            <p className={`text-sm text-gray-600 leading-relaxed ${showFullDesc ? '' : 'line-clamp-3'}`}>{product.description}</p>
            {descLong && (
              <button onClick={() => setShowFullDesc(s => !s)} className="text-xs font-medium mt-0.5" style={{ color: '#c8821a' }}>
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

        <p className="text-2xl font-bold" style={{ color: '#c8821a' }}>
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

        {/* Garlic option */}
        {product.hasGarlicOption && (
          <div className="rounded-xl p-3 space-y-2" style={{ background: 'linear-gradient(135deg, #fffbeb, #fef3c7)', border: '1px solid #fcd34d' }}>
            <div className="flex items-center gap-2">
              <span className="text-base">🧄</span>
              <p className="text-sm font-bold text-amber-900">Garlic preference <span className="text-red-500">*</span></p>
            </div>
            <p className="text-xs text-amber-800 leading-relaxed">
              We prepare both versions using <strong>separate utensils &amp; cutleries</strong> — safe for those who avoid garlic for religious or dietary reasons.
            </p>
            <div className="flex gap-4 pt-1">
              {(['without', 'with'] as const).map(opt => (
                <label key={opt}
                  className={`flex items-center gap-2 cursor-pointer px-3 py-2 rounded-xl border-2 flex-1 transition-all ${
                    garlic === opt ? 'border-amber-500 bg-white' : 'border-transparent bg-white/60'
                  }`}>
                  <input type="radio" name={`garlic-${product.id}`} value={opt}
                    checked={garlic === opt} onChange={() => setGarlic(opt)}
                    className="accent-orange-500 w-4 h-4" />
                  <div>
                    <p className="text-sm font-semibold text-gray-800">{opt === 'with' ? '🧄 With Garlic' : '🚫 Without Garlic'}</p>
                    <p className="text-xs text-gray-500">{opt === 'with' ? 'Regular recipe' : 'No garlic added'}</p>
                  </div>
                </label>
              ))}
            </div>
            {garlicRequired && (
              <p className="text-xs text-red-500 font-medium">⚠️ Please choose one to continue</p>
            )}
          </div>
        )}

        {/* Customization */}
        {product.allowCustomization && (
          <div>
            <button onClick={() => setShowNote(s => !s)} className="text-xs underline" style={{ color: '#c8821a' }}>
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
          onClick={handleAddToCart}
          disabled={garlicRequired}
          className="w-full flex items-center justify-between text-white font-bold py-3.5 px-5 rounded-2xl text-sm transition-opacity disabled:opacity-40"
          style={{ background: '#c8821a' }}>
          <span>Add to Cart{garlic ? ` — ${garlic === 'with' ? 'With Garlic' : 'Without Garlic'}` : ''}</span>
          <span>₹{Math.round(price)}</span>
        </button>
      </div>
    </div>
  );
}

// ─── Sample Modal (2-step: pick products → contact info) ─────────────────────
function SampleModal({ products, selected, onToggle, step, setStep, form, setForm, onPhoneChange, phoneError, checkingPhone, submitting, onClose, onSubmit }: {
  products: Product[]; selected: Product[];
  onToggle: (p: Product) => void;
  step: 'pick' | 'contact'; setStep: (s: 'pick' | 'contact') => void;
  form: { name: string; whatsapp: string; place: string; notes: string; referralCode: string };
  setForm: React.Dispatch<React.SetStateAction<{ name: string; whatsapp: string; place: string; notes: string; referralCode: string }>>;
  onPhoneChange: (raw: string) => void;
  phoneError: string;
  checkingPhone: boolean;
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
                      style={{ background: '#fff4eb', color: '#c8821a' }}>
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
                style={{ background: '#c8821a' }}>
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
                <div className="relative">
                  <input type="tel" value={form.whatsapp} onChange={e => onPhoneChange(e.target.value)}
                    placeholder="10-digit number"
                    className={`w-full border rounded-xl px-4 py-3 text-sm outline-none pr-10 ${phoneError ? 'border-red-400 bg-red-50' : ''}`}
                    style={phoneError ? {} : { borderColor: '#e0d0c0' }} />
                  {checkingPhone && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      <div className="w-4 h-4 border-2 border-orange-400 border-t-transparent rounded-full animate-spin" />
                    </div>
                  )}
                </div>
                {phoneError && (
                  <p className="mt-1.5 text-xs text-red-600 flex items-start gap-1">
                    <span className="mt-0.5">⚠️</span> {phoneError}
                  </p>
                )}
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
              <button onClick={onSubmit} disabled={submitting || !!phoneError || checkingPhone}
                className="w-full text-white font-bold py-3.5 rounded-2xl text-sm disabled:opacity-50"
                style={{ background: '#c8821a' }}>
                {submitting ? 'Sending…' : checkingPhone ? 'Checking…' : '🎁 Request Free Sample'}
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
  isSample, cart, cartTotal, form, setForm, submitting, urlRefCode,
  myReferralCode, setMyReferralCode,
  isReturningCustomer, setIsReturningCustomer,
  availableCredit, setAvailableCredit, useCredit, setUseCredit,
  referralDiscount, setReferralDiscount,
  referralError, setReferralError,
  standingDiscount, setStandingDiscount,
  showReferral,
  onClose, onSubmit
}: {
  isSample: boolean;
  cart: CartItem[];
  cartTotal: number;
  form: { name: string; whatsapp: string; place: string; notes: string; referralCode: string };
  setForm: React.Dispatch<React.SetStateAction<{ name: string; whatsapp: string; place: string; notes: string; referralCode: string }>>;
  submitting: boolean;
  urlRefCode?: string;
  myReferralCode: string | null;
  setMyReferralCode: (v: string | null) => void;
  isReturningCustomer: boolean;
  setIsReturningCustomer: (v: boolean) => void;
  availableCredit: number;
  setAvailableCredit: (v: number) => void;
  useCredit: boolean;
  setUseCredit: (v: boolean) => void;
  referralDiscount: number;
  setReferralDiscount: (v: number) => void;
  referralError: string;
  setReferralError: (v: string) => void;
  standingDiscount: number;
  setStandingDiscount: (v: number) => void;
  showReferral: boolean;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const [validatingReferral, setValidatingReferral] = useState(false);
  const [lookingUpPhone, setLookingUpPhone] = useState(false);
  const referralDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { config: referralConfig } = useReferralConfig();

  // Auto-validate referral code 600ms after the user stops typing.
  // Skip if: code came from URL (parent already validated it), submitting, returning customer, or standing discount active.
  useEffect(() => {
    const code = form.referralCode.trim();
    if (!code || isReturningCustomer || standingDiscount > 0 || submitting) return;
    // URL ref code is already validated by the parent useEffect — don't re-validate and risk race conditions
    if (urlRefCode && code === urlRefCode.trim().toUpperCase()) return;
    if (referralDebounceRef.current) clearTimeout(referralDebounceRef.current);
    referralDebounceRef.current = setTimeout(() => { handleReferralCodeBlur(); }, 600);
    return () => { if (referralDebounceRef.current) clearTimeout(referralDebounceRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.referralCode, submitting]);
  const creditDiscount = (isReturningCustomer && useCredit)
    ? computeCreditRedemption(availableCredit, cartTotal, referralConfig.creditRedemptionPct, referralConfig.creditRedemptionCap) : 0;
  const standingDiscountAmt = standingDiscount > 0 ? Math.round(cartTotal * standingDiscount / 100) : 0;
  // Always recompute referral discount live from current cartTotal so preview matches saved order
  const liveReferralDiscount = referralDiscount > 0
    ? computeReferralDiscountFromTiers(cartTotal, referralConfig.tiers, referralConfig.splitReferrerPct).customerDiscount
    : 0;
  const finalTotal = standingDiscountAmt > 0
    ? Math.max(0, cartTotal - standingDiscountAmt)
    : Math.max(0, cartTotal - liveReferralDiscount - creditDiscount);

  // When phone number reaches 10 digits, look up existing customer to show their referral code
  async function handlePhoneChange(raw: string) {
    setForm(f => ({ ...f, whatsapp: raw }));
    const digits = raw.replace(/\D/g, '').replace(/^(91|0)/, '').slice(0, 10);
    if (digits.length === 10 && !isSample) {
      setLookingUpPhone(true);
      try {
        const existing = await customersService.getByWhatsapp(digits);
        setMyReferralCode(existing?.referralCode ?? null);
        // Apply standing discount if enabled for new orders
        if (existing?.discountApplyToNew && (existing?.discountPercent ?? 0) > 0) {
          setStandingDiscount(existing.discountPercent!);
          setReferralDiscount(0); setReferralError(''); // clear referral — standing takes priority
        } else {
          setStandingDiscount(0);
        }
        // Mark as returning if they've already ordered — referral code field will be hidden
        const returning = !!existing && ((existing.totalOrders ?? 0) > 0 || !!existing.referredBy);
        setIsReturningCustomer(returning);
        if (returning) {
          setAvailableCredit(existing?.referralCredit ?? 0);
          setReferralDiscount(0); setReferralError('');
        } else {
          setAvailableCredit(0);
          // Re-validate referral code now that we know the phone — catches self-referral
          if (form.referralCode.trim()) setTimeout(() => handleReferralCodeBlur(), 0);
        }
      } finally { setLookingUpPhone(false); }
    } else {
      setLookingUpPhone(false);
      setMyReferralCode(null);
      setIsReturningCustomer(false);
      setStandingDiscount(0);
    }
  }

  // Validate referral code on blur / when user finishes typing
  async function handleReferralCodeBlur() {
    const code = form.referralCode.trim().toUpperCase();
    if (!code) { setReferralDiscount(0); setReferralError(''); return; }
    // Returning customers can't use a referral code
    if (isReturningCustomer) {
      setReferralError('Referral codes are only valid on your first order');
      setReferralDiscount(0);
      return;
    }
    setValidatingReferral(true);
    try {
      const referrer = await customersService.getByReferralCode(code);
      if (!referrer) {
        setReferralError('Code not found — check and try again');
        setReferralDiscount(0);
        return;
      }
      // Don't let them use their own code (best-effort check using phone)
      const myDigits = form.whatsapp.replace(/\D/g, '').replace(/^(91|0)/, '').slice(0, 10);
      if (referrer.whatsapp === myDigits) {
        setReferralError("You can't use your own referral code");
        setReferralDiscount(0);
        return;
      }
      const disc = computeReferralDiscountFromTiers(cartTotal, referralConfig.tiers, referralConfig.splitReferrerPct);
      setReferralDiscount(disc.customerDiscount);
      setReferralError('');
    } finally { setValidatingReferral(false); }
  }
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
                  <span className="font-semibold" style={{ color: '#c8821a' }}>₹{item.totalPrice.toFixed(0)}</span>
                </div>
              ))}
              <div className="flex justify-between items-center px-4 py-2.5 font-bold text-sm"
                style={{ background: '#fff4eb', borderTop: '1px solid #f0d9c8' }}>
                <span>Total</span>
                <span style={{ color: '#c8821a' }}>₹{cartTotal}</span>
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
            <div className="relative">
              <input type="tel" value={form.whatsapp} onChange={e => handlePhoneChange(e.target.value)}
                placeholder="10-digit number"
                className="w-full border rounded-xl px-4 py-3 text-sm outline-none pr-10" style={{ borderColor: '#e0d0c0' }} />
              {lookingUpPhone && (
                <div className="absolute right-3 top-3.5 w-4 h-4 border-2 border-orange-400 border-t-transparent rounded-full animate-spin" />
              )}
            </div>

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

          {/* Standing discount active — show notice, hide referral code */}
          {!isSample && standingDiscountAmt > 0 && (
            <div className="flex items-start gap-2 rounded-xl px-3 py-2.5 text-xs"
              style={{ background: '#f0fdf4', border: '1px solid #86efac', color: '#166534' }}>
              <span className="text-base leading-none">🏷️</span>
              <span>
                <strong>Special discount active — {standingDiscount}% off applied automatically.</strong> Referral codes are not needed.
              </span>
            </div>
          )}

          {/* Referral Code entry — only for real orders, only for first-time customers, only when no standing discount */}
          {!isSample && !isReturningCustomer && !standingDiscountAmt && showReferral && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                🎟️ Have a referral code? <span className="text-gray-400 font-normal">(first order only)</span>
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={form.referralCode}
                  onChange={e => {
                    setForm(f => ({ ...f, referralCode: e.target.value.toUpperCase() }));
                    setReferralError('');
                    setReferralDiscount(0);
                  }}
                  onBlur={handleReferralCodeBlur}
                  placeholder="e.g. SKC-PAVAN47"
                  maxLength={14}
                  className="w-full border rounded-xl px-4 py-3 text-sm outline-none font-mono tracking-widest uppercase pr-10"
                  style={{ borderColor: referralError ? '#ef4444' : referralDiscount > 0 ? '#22c55e' : '#e0d0c0' }}
                />
                {validatingReferral && (
                  <div className="absolute right-3 top-3.5 w-4 h-4 border-2 border-orange-400 border-t-transparent rounded-full animate-spin" />
                )}
                {!validatingReferral && referralDiscount > 0 && (
                  <span className="absolute right-3 top-3 text-green-500 text-lg">✓</span>
                )}
              </div>
              {referralError && <p className="text-xs text-red-500 mt-1">{referralError}</p>}
              {referralDiscount > 0 && !referralError && (
                <div className="mt-2 rounded-xl px-3 py-2.5 flex items-center justify-between"
                  style={{ background: '#f0fdf4', border: '1px solid #86efac' }}>
                  <span className="text-xs text-green-700 font-medium">🎉 Code <span className="font-mono font-bold tracking-widest">{form.referralCode}</span> applied!</span>
                  <span className="text-sm font-bold text-green-700">−₹{liveReferralDiscount}</span>
                </div>
              )}
              {/* Info box about how referral works */}
              <div className="mt-2 rounded-xl px-3 py-2.5 text-xs" style={{ background: '#fdf5e6', color: '#7a4010' }}>
                <p className="font-semibold mb-1">🎟️ First order only — your discount is applied automatically at checkout.</p>
                <p style={{ color: '#7a4010' }}>💡 The person who shared this code also earns store credit — it's a win-win!</p>
              </div>
            </div>
          )}

          {/* Credit redemption — only for returning customers who have earned referral credit, and no standing discount */}
          {!isSample && isReturningCustomer && availableCredit > 0 && !standingDiscountAmt && (
            <div>
              <div className="rounded-2xl px-4 py-3 flex items-center justify-between gap-3 cursor-pointer"
                style={{ background: useCredit ? '#f0fdf4' : '#fdf5e6', border: `1px solid ${useCredit ? '#86efac' : '#f0d9c8'}` }}
                onClick={() => setUseCredit(!useCredit)}>
                <div className="flex-1">
                  <p className="text-sm font-semibold" style={{ color: useCredit ? '#166534' : '#7a4010' }}>
                    💰 Use my referral credit
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: useCredit ? '#15803d' : '#a06030' }}>
                    You have <strong>₹{availableCredit}</strong> credit —
                    save up to <strong>₹{computeCreditRedemption(availableCredit, cartTotal, referralConfig.creditRedemptionPct, referralConfig.creditRedemptionCap)}</strong> on this order
                    <span className="text-gray-400 ml-1">(max {referralConfig.creditRedemptionPct}% of order or ₹{referralConfig.creditRedemptionCap})</span>
                  </p>
                </div>
                <div className={`w-11 h-6 rounded-full transition-colors flex-shrink-0 relative ${useCredit ? 'bg-green-500' : 'bg-gray-300'}`}>
                  <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${useCredit ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </div>
              </div>
              {useCredit && (
                <div className="mt-1.5 rounded-xl px-3 py-2 text-xs" style={{ background: '#f0fdf4', border: '1px solid #86efac' }}>
                  <p className="text-green-700">✅ <strong>₹{computeCreditRedemption(availableCredit, cartTotal, referralConfig.creditRedemptionPct, referralConfig.creditRedemptionCap)}</strong> credit will be deducted from your balance after order is placed.</p>
                  <p className="text-green-600 mt-0.5">Remaining balance: ₹{Math.max(0, availableCredit - computeCreditRedemption(availableCredit, cartTotal, referralConfig.creditRedemptionPct, referralConfig.creditRedemptionCap))}</p>
                </div>
              )}
            </div>
          )}

          {/* Returning customer with no credit — show their referral code to keep sharing */}
          {!isSample && isReturningCustomer && availableCredit === 0 && myReferralCode && (
            <div className="rounded-xl px-3 py-2.5 text-xs" style={{ background: '#fdf5e6', color: '#7a4010' }}>
              <p className="font-semibold mb-0.5">💡 Earn store credit!</p>
              <p>Share your code <span className="font-mono font-bold">{myReferralCode}</span> with friends. When they order using your link, <strong>they get a discount</strong> and <strong>you earn store credit</strong> (up to ₹75 per referral)!</p>
            </div>
          )}

          {/* Updated total showing any active discount */}
          {!isSample && (standingDiscountAmt > 0 || liveReferralDiscount > 0 || (useCredit && creditDiscount > 0)) && (
            <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid #86efac', background: '#f0fdf4' }}>
              <div className="flex justify-between items-center px-4 py-2.5 text-sm border-b" style={{ borderColor: '#bbf7d0' }}>
                <span className="text-gray-500">Subtotal</span>
                <span className="font-medium">₹{cartTotal}</span>
              </div>
              {standingDiscountAmt > 0 && (
                <div className="flex justify-between items-center px-4 py-2.5 text-sm border-b" style={{ borderColor: '#bbf7d0' }}>
                  <span className="text-green-600">🏷️ Your special discount ({standingDiscount}%)</span>
                  <span className="font-semibold text-green-600">−₹{standingDiscountAmt}</span>
                </div>
              )}
              {!standingDiscountAmt && liveReferralDiscount > 0 && (
                <div className="flex justify-between items-center px-4 py-2.5 text-sm border-b" style={{ borderColor: '#bbf7d0' }}>
                  <span className="text-green-600">🎟️ Referral (<span className="font-mono font-bold tracking-wide">{form.referralCode}</span>)</span>
                  <span className="font-semibold text-green-600">−₹{liveReferralDiscount}</span>
                </div>
              )}
              {!standingDiscountAmt && useCredit && creditDiscount > 0 && (
                <div className="flex justify-between items-center px-4 py-2.5 text-sm border-b" style={{ borderColor: '#bbf7d0' }}>
                  <span className="text-green-600">💰 Credit redeemed</span>
                  <span className="font-semibold text-green-600">−₹{creditDiscount}</span>
                </div>
              )}
              <div className="flex justify-between items-center px-4 py-2.5 font-bold text-sm">
                <span>You pay</span>
                <span style={{ color: '#c8821a' }}>₹{finalTotal}</span>
              </div>
            </div>
          )}

          <div className="text-xs rounded-xl px-4 py-3" style={{ background: '#f5f5f5', color: '#666' }}>
            📱 Order updates will be sent on WhatsApp.<br />
            {!isSample && <>💳 Pay via GPay / PhonePe / UPI after confirmation.<br /></>}
            {!isSample && <>🚚 <strong>₹20 delivery charge</strong> for orders below ₹1000 or delivery beyond 10 km — charged after delivery, we'll inform you in advance.<br /></>}
            🔒 We never share your number with anyone.
          </div>
        </div>
        <div className="sticky bottom-0 bg-white px-5 pb-6 pt-3 border-t" style={{ borderColor: '#f0d9c8' }}>
          {referralError && form.referralCode.trim() && (
            <p className="text-center text-sm text-red-500 mb-2 font-medium">⚠️ Fix or remove the referral code to place your order.</p>
          )}
          <button onClick={onSubmit} disabled={submitting || validatingReferral || !!(referralError && form.referralCode.trim())}
            className="w-full text-white font-bold py-3.5 rounded-2xl text-sm disabled:opacity-50"
            style={{ background: '#c8821a' }}>
            {validatingReferral ? 'Validating code…' : submitting ? 'Sending…' : isSample ? '🎁 Request Sample' : `✅ Place Order${(standingDiscountAmt > 0 || liveReferralDiscount > 0 || (useCredit && creditDiscount > 0)) ? ` · ₹${finalTotal}` : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}

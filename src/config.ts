// ╔══════════════════════════════════════════════════════════════════╗
// ║           SRI KRISHNA CONDIMENTS — APP CONFIGURATION           ║
// ║   Edit this file to update business details, pricing rules etc. ║
// ╚══════════════════════════════════════════════════════════════════╝

export const APP_CONFIG = {
  // ── Business Details ────────────────────────────────────────
  BUSINESS_NAME:        'Sri Krishna Condiments',
  BUSINESS_TAGLINE:     'Where Taste Meets Tradition',
  BUSINESS_DESCRIPTION: 'Handcrafted health foods — Chutney Powders, Masalas & more. Made fresh in small batches.',

  // ── Contact (from env) ─────────────────────────────────────
  WHATSAPP_NUMBER:      import.meta.env.VITE_WHATSAPP_NUMBER  as string,   // with country code, no +
  WHATSAPP_DISPLAY:     import.meta.env.VITE_WHATSAPP_DISPLAY  as string,

  // ── Payments (from env) ────────────────────────────────────
  UPI_ID:               import.meta.env.VITE_UPI_ID      as string,
  UPI_NUMBER:           import.meta.env.VITE_UPI_NUMBER   as string,
  UPI_DISPLAY:          import.meta.env.VITE_UPI_DISPLAY  as string,

  // ── Admin Security (from env) ────────────────────────────────
  DEFAULT_ADMIN_PIN:    import.meta.env.VITE_ADMIN_PIN   as string,

  // ── Subscription Discounts (static fallback — live values come from Firestore via admin) ──
  SUBSCRIPTION_UPFRONT_3M_PCT:  7,    // upfront payment, 3-month plan
  SUBSCRIPTION_UPFRONT_6M_PCT:  10,   // upfront payment, 6-month plan
  SUBSCRIPTION_MONTHLY_3M_PCT:  3,    // monthly payment, 3-month plan
  SUBSCRIPTION_MONTHLY_6M_PCT:  5,    // monthly payment, 6-month plan

  // ── Stock Alerts ─────────────────────────────────────────────────
  DEFAULT_LOW_STOCK_GRAMS:  500,        // Alert when stock < 500g
  DEFAULT_LOW_STOCK_PIECES: 5,          // Alert when stock < 5 pieces

  // ── Sample Orders ────────────────────────────────────────────────────
  SAMPLE_SIZE_OPTIONS: ['50g', '100g'],  // Available sample sizes
  SAMPLE_MESSAGE:      'Free sample — no payment required',

  // Flat charge for all sample requests (set to 0 for free, e.g. 50 to enable ₹50 charge)
  // When non-zero: payment is required, paymentStatus becomes 'unpaid', UPI link is shown
  SAMPLE_CHARGE: 0,

  // ── WhatsApp Links (from env) ──────────────────────────────────
  SHOW_WHATSAPP_GROUP_LINK:   true,
  WHATSAPP_GROUP_LINK:        import.meta.env.VITE_WA_GROUP_LINK     as string,
  WHATSAPP_CHANNEL_LINK:      import.meta.env.VITE_WA_CHANNEL_LINK   as string,
  // WhatsApp Community (invite link — set in Vercel env, never in source)
  WHATSAPP_COMMUNITY_URL:     import.meta.env.VITE_WA_COMMUNITY_URL  || '',
  // Internal group for order tracking (admins only)
  ORDER_TRACKING_GROUP_LINK:  import.meta.env.VITE_WA_TRACKING_LINK  as string,
  WHATSAPP_GROUP_DISPLAY:     'Join Our WhatsApp Group for Offers & Updates',
  WHATSAPP_CHANNEL_DISPLAY:   'Follow Our WhatsApp Channel',

  // ── Social Media (from env — leave empty to hide) ─────────────────────────
  INSTAGRAM_URL:              import.meta.env.VITE_INSTAGRAM_URL || '',
  FACEBOOK_URL:               import.meta.env.VITE_FACEBOOK_URL  || '',

  // ── Storefront UI ────────────────────────────────────────────────
  MAX_TESTIMONIALS_ON_HOME: 8,

  // ── Order Notifications ──────────────────────────────────────────
  // Stages that trigger WhatsApp notification to customer
  NOTIFY_ON: {
    ORDER_PLACED:      true,
    CONFIRMED:         true,
    OUT_FOR_DELIVERY:  true,
    DELIVERED:         true,
  },

  // ── Currency ─────────────────────────────────────────────────────
  CURRENCY_SYMBOL:      '₹',
  CURRENCY_LOCALE:      'en-IN',

  // ── Product Categories ────────────────────────────────────────────
  PRODUCT_CATEGORIES: [
    'Chutney Powder',
    'Masala',
    'Health Mix',
    'Spices',
    'Pickles',
    'Snacks',
    'Sweets',
    'Other',
  ],

  // ── Expense Categories ────────────────────────────────────────────
  EXPENSE_CATEGORIES: {
    raw_material: 'Raw Material',
    gas:          'Gas / Fuel',
    labour:       'Labour',
    delivery:     'Delivery',
    packaging:    'Packaging',
    other:        'Other',
  } as Record<string, string>,

  // ── On-Demand Products ───────────────────────────────────────
  ON_DEMAND_BADGE:     'Made Fresh on Order 🔥',
  ON_DEMAND_NOTE:      'This product is prepared fresh after your order. Delivery may take 1–2 extra days.',

  // ── Domain / Subdomains ────────────────────────────────────────────────────
  // Used for generating correct store URLs in WhatsApp messages etc.
  STORE_URL:           import.meta.env.VITE_APP_DOMAIN
                         ? `https://${import.meta.env.VITE_APP_DOMAIN}`
                         : (typeof window !== 'undefined' ? window.location.origin : 'https://skctreats.in'),
};

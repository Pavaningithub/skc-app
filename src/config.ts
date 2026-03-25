// ╔══════════════════════════════════════════════════════════════════╗
// ║           SRI KRISHNA CONDIMENTS — APP CONFIGURATION           ║
// ║   Edit this file to update business details, pricing rules etc. ║
// ╚══════════════════════════════════════════════════════════════════╝

export const APP_CONFIG = {
  // ── Business Details ────────────────────────────────────────────
  BUSINESS_NAME:        'Sri Krishna Condiments',
  BUSINESS_TAGLINE:     'Pure, Fresh & Handcrafted',
  BUSINESS_DESCRIPTION: 'Handcrafted health foods — Chutney Powders, Masalas & more. Made fresh in small batches.',

  // ── Contact ─────────────────────────────────────────────────────
  WHATSAPP_NUMBER:      '919731874874',   // Admin WhatsApp (with country code, no +)
  WHATSAPP_DISPLAY:     '+91 97318 74874',
  WHATSAPP_NUMBER2:     '917090650064',
  WHATSAPP_DISPLAY2:    '+91 70906 50064',

  // ── Payments ────────────────────────────────────────────────────
  UPI_ID:               '9742760099@upi',
  UPI_NUMBER:           '9742760099',
  UPI_DISPLAY:          '9742760099 (GPay / PhonePe / UPI)',

  // ── Admin Security ───────────────────────────────────────────────
  DEFAULT_ADMIN_PIN:    '2315',          // Change after first login via Settings

  // ── Subscription Discounts ───────────────────────────────────────
  SUBSCRIPTION_3M_DISCOUNT_PCT: 5,      // 5% off for 3-month plan
  SUBSCRIPTION_6M_DISCOUNT_PCT: 10,     // 10% off for 6-month plan

  // ── Stock Alerts ─────────────────────────────────────────────────
  DEFAULT_LOW_STOCK_GRAMS:  500,        // Alert when stock < 500g
  DEFAULT_LOW_STOCK_PIECES: 5,          // Alert when stock < 5 pieces

  // ── Sample Orders ────────────────────────────────────────────────
  SAMPLE_SIZE_OPTIONS: ['50g', '100g'],  // Available sample sizes
  SAMPLE_MESSAGE:      'Free sample — no payment required',

  // ── WhatsApp Links ────────────────────────────────────────────
  SHOW_WHATSAPP_GROUP_LINK:   true,
  WHATSAPP_GROUP_LINK:        'https://chat.whatsapp.com/GnLnmfvY8gqJpxu6EcVkkL',
  WHATSAPP_CHANNEL_LINK:      'https://whatsapp.com/channel/0029VbBxnQ8BlHpdsWMhZV2T',
  // Internal group for order tracking (admins only)
  ORDER_TRACKING_GROUP_LINK:  'https://chat.whatsapp.com/LSsTi0rKfvHBsYXCbDgcHp',
  WHATSAPP_GROUP_DISPLAY:     'Join Our WhatsApp Group for Offers & Updates',
  WHATSAPP_CHANNEL_DISPLAY:   'Follow Our WhatsApp Channel',

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

  // ── On-Demand Products ───────────────────────────────────────────
  ON_DEMAND_BADGE:     'Made Fresh on Order 🔥',
  ON_DEMAND_NOTE:      'This product is prepared fresh after your order. Delivery may take 1–2 extra days.',
} as const;

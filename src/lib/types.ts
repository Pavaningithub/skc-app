import type { Unit, OrderStatus, PaymentStatus, OrderType, ExpenseCategory, SubscriptionDuration, SubscriptionStatus } from "./constants";

// ─── Admin User ──────────────────────────────────────────────────────────────
type AdminRole = 'owner' | 'operator';
export interface AdminUser {
  id: string;
  username: string;       // login handle, e.g. "pavan"
  displayName: string;    // shown in UI, e.g. "Pavan"
  role: AdminRole;
  pin: string;            // 4-digit PIN
  mustChangePin: boolean; // force change on first login
  createdAt: string;
  updatedAt: string;
}

// ─── Referral Config ────────────────────────────────────────────────────────
export interface ReferralTier {
  minOrder: number;          // ₹ minimum order (inclusive)
  maxOrder: number | null;   // ₹ maximum order (exclusive), null = unlimited
  pct: number;               // total discount % (e.g. 7.5)
  cap: number | null;        // max total ₹ discount, null = no cap
}

export interface ReferralConfig {
  tiers: ReferralTier[];         // sorted by minOrder ascending
  splitReferrerPct: number;      // % of total going to referrer (e.g. 75), rest goes to friend
  creditRedemptionPct: number;   // % of order redeemable as credit (e.g. 10)
  creditRedemptionCap: number;   // max ₹ redeemable per order (e.g. 75)
  updatedAt?: string;
}

// Default tiers (used if Firestore doc doesn't exist yet)
export const DEFAULT_REFERRAL_CONFIG: ReferralConfig = {
  tiers: [
    { minOrder: 1,    maxOrder: 500,  pct: 3,   cap: null },
    { minOrder: 500,  maxOrder: 1000, pct: 5,   cap: 50   },
    { minOrder: 1000, maxOrder: null, pct: 7.5, cap: 100  },
  ],
  splitReferrerPct: 75,
  creditRedemptionPct: 10,
  creditRedemptionCap: 75,
};

// ─── Product ─────────────────────────────────────────────────────────────────
export interface Product {
  id: string;
  name: string;
  nameKannada?: string;          // Kannada name (optional)
  description: string;
  unit: Unit;
  pricePerUnit: number;           // price per gram / per kg / per piece
  minOrderQty: number;            // minimum quantity per order (grams/pieces)
  category: string;
  imageUrl?: string;
  isActive: boolean;
  isOnDemand: boolean;            // prepared fresh after order placed
  isPopular?: boolean;            // show "Popular" badge and rank higher
  allowCustomization: boolean;    // allow customer notes/customization
  customizationHint?: string;     // hint text shown to customer
  hasGarlicOption?: boolean;      // show With Garlic / Without Garlic radio
  stockId?: string;
  sortOrder: number;              // for manual ordering in storefront
  isNewLaunch?: boolean;          // show "New!" badge and launch banner on storefront
  newLaunchUntil?: string;        // ISO date — badge/banner hidden after this date
  didYouKnow?: string;            // short 1–2 line fact shown on product card (expandable)
  createdAt: string;
  updatedAt: string;
}

// ─── Stock / Inventory ───────────────────────────────────────────────────────
export interface StockItem {
  id: string;
  productId: string;
  productName: string;
  unit: Unit;
  quantityAvailable: number;      // in grams (always store in grams or pieces)
  lowStockThreshold: number;      // alert below this
  updatedAt: string;
}

// ─── Raw Material ─────────────────────────────────────────────────────────────
export interface RawMaterial {
  id: string;
  name: string;                   // Name in Kannada or English
  nameEnglish?: string;           // English translation
  unit: Unit;
  currentStock: number;           // grams or pieces
  costPerUnit: number;            // cost per gram / piece
  lowStockThreshold: number;
  updatedAt: string;
}

// ─── Raw Material Purchase (Bill Entry by wife) ────────────────────────────────
export interface RawMaterialPurchase {
  id: string;
  date: string;
  supplierName?: string;
  items: RawMaterialPurchaseItem[];
  totalAmount: number;
  billPhotoUrl?: string;          // Firebase Storage URL
  notes: string;
  enteredBy: string;              // 'self' | wife name
  createdAt: string;
}

export interface RawMaterialPurchaseItem {
  rawMaterialId?: string;
  rawMaterialName: string;        // In Kannada
  quantity: number;               // grams or pieces
  unit: Unit;
  unitCost: number;
  totalCost: number;
}

// ─── Production Batch ────────────────────────────────────────────────────────
export interface BatchIngredient {
  rawMaterialId: string;
  rawMaterialName: string;
  quantityUsed: number;           // in grams
  costPerGram: number;
}

export interface Batch {
  id: string;
  batchNumber: string;
  productId: string;
  productName: string;
  date: string;
  ingredientsUsed: BatchIngredient[];
  otherExpenses: { label: string; amount: number }[];
  quantityProduced: number;       // grams
  totalCost: number;
  costPerGram: number;
  purchaseId?: string;            // linked raw material purchase
  notes: string;
  createdAt: string;
}

// ─── Customer ────────────────────────────────────────────────────────────────
export interface Customer {
  id: string;
  name: string;
  whatsapp: string;
  place: string;
  totalOrders: number;
  totalSpent: number;
  pendingAmount: number;
  joinedWhatsappGroup: boolean;
  discountPercent?: number;       // standing discount % for close family/friends
  discountApplyToNew?: boolean;   // apply standing discount to new orders automatically
  discountApplyToExisting?: boolean; // (UI flag) last used to apply to existing pending orders
  referralCode?: string;          // unique code this customer shares to refer others, e.g. SKC-PAVAN3
  referredBy?: string;            // referral code used when they first ordered
  referralCredit: number;         // ₹ credit earned by referring others (redeemable on next order)
  createdAt: string;
}

// ─── Order Item ──────────────────────────────────────────────────────────────
export interface OrderItem {
  productId: string;
  productName: string;
  unit: Unit;
  quantity: number;               // grams / pieces
  pricePerUnit: number;
  totalPrice: number;
  minOrderQty?: number;           // minimum qty step for cart adjustments
  customizationNote?: string;     // customer customization request
  isOnDemand?: boolean;           // was it an on-demand product?
  rawMaterialCost?: number;       // for on-demand: actual raw material cost
  profitAmount?: number;          // selling price - raw material cost
  agentMarkup?: number;           // ₹ markup added by agent on top of SKC base price (per unit)
}

// ─── Order ───────────────────────────────────────────────────────────────────
export interface Order {
  id: string;
  orderNumber: string;
  type: OrderType;
  customerId?: string;
  customerName: string;
  customerWhatsapp: string;
  customerPlace: string;
  items: OrderItem[];
  subtotal: number;
  discount: number;
  total: number;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  paymentMethod?: string;
  notes: string;
  subscriptionId?: string;
  subscriptionDuration?: SubscriptionDuration;
  hasOnDemandItems: boolean;
  totalProfit?: number;           // calculated after delivery
  referralCodeUsed?: string;      // referral code entered at checkout
  referralDiscount: number;       // ₹ discount applied from referral code (0 if none)
  creditUsed: number;             // ₹ referral credit redeemed from customer's balance (0 if none)
  deliveryCharge: number;         // ₹20 flat for orders <₹1000 and distance >10km, else 0
  agentId?: string;               // set when order placed via Agent Console
  agentName?: string;             // agent's display name (denormalised)
  agentCommission?: number;       // ₹ commission due to agent on this order
  agentMargin?: number;           // ₹ agent's profit (sellingTotal - skcTotal) — visible to agent only, not shown in admin
  createdAt: string;
  updatedAt: string;
  deliveredAt?: string;
}

// ─── Expense ──────────────────────────────────────────────────────────────────
export interface Expense {
  id: string;
  category: ExpenseCategory;
  description: string;
  amount: number;
  date: string;
  batchId?: string;
  purchaseId?: string;
  createdAt: string;
}

// ─── Subscription ─────────────────────────────────────────────────────────────
export interface MonthlyEntry {
  month: number;          // 1-based: month 1, 2, 3...
  label: string;          // e.g. "May 2026"
  startDate: string;      // ISO — start of this month window (admin-editable)
  endDate: string;        // ISO — end of this month window (+30 days)
  paymentStatus: 'pending' | 'requested' | 'paid';
  deliveryStatus: 'pending' | 'delivered';
  paymentRequestedAt?: string;
  paidAt?: string;
  deliveredAt?: string;
}

export interface Subscription {
  id: string;
  subscriptionNumber?: string;
  customerId: string;
  customerName: string;
  customerWhatsapp: string;
  customerPlace?: string;
  items: OrderItem[];
  duration: SubscriptionDuration;
  paymentMode?: 'upfront' | 'monthly';
  discountPercent: number;
  baseAmount: number;
  discountedAmount: number;
  startDate: string;
  endDate: string;
  isActive: boolean;
  status?: SubscriptionStatus;      // lifecycle status
  paymentStatus: PaymentStatus;
  monthlyTracking?: MonthlyEntry[]; // one entry per month of the subscription
  notes?: string;
  createdAt: string;
}

export interface SubscriptionConfig {
  // Upfront payment (pay full duration in advance)
  upfrontThreeMonthPct: number;   // discount % for 3-month plan, paid upfront
  upfrontSixMonthPct:   number;   // discount % for 6-month plan, paid upfront
  // Monthly payment (pay each month)
  monthlyThreeMonthPct: number;   // discount % for 3-month plan, paid monthly
  monthlySixMonthPct:   number;   // discount % for 6-month plan, paid monthly
  updatedAt?: string;
}

export const DEFAULT_SUBSCRIPTION_CONFIG: SubscriptionConfig = {
  upfrontThreeMonthPct: 7,
  upfrontSixMonthPct:   10,
  monthlyThreeMonthPct: 3,
  monthlySixMonthPct:   5,
};

// ─── Feature Flags ───────────────────────────────────────────────────────────
export interface FeatureFlags {
  // Customer storefront banners & sections
  holigeBanner:       boolean;  // Festival: Holige / Obbattu promotional banner
  subscriptionBanner: boolean;  // Health Mix Subscription plan section
  sampleRequest:      boolean;  // "Free Sample" button & modal
  referralProgram:    boolean;  // Referral code entry in order form
  testimonials:       boolean;  // Customer testimonials marquee
  updatedAt?: string;
}

export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  holigeBanner:       false,  // off by default — enable during festivals
  subscriptionBanner: true,
  sampleRequest:      true,
  referralProgram:    true,
  testimonials:       true,
};

// ─── Agent (Partner / Reseller) ────────────────────────────────────────────────────────────────
export interface Agent {
  id: string;
  name: string;                   // e.g. "Ravi Traders"
  phone: string;                  // 10-digit, used as login username
  agentCode: string;              // e.g. "AGT-RAVI" — unique
  pin: string;                    // 4-6 digit PIN
  mustChangePin: boolean;         // force change on first login
  markupPercent: number;          // max markup % admin sets for this agent (0 = no cap set)
  enforceMarkup: boolean;         // true = agent cannot exceed markupPercent; false = warning-only at 15%
  totalOrders: number;
  totalRevenue: number;           // sum of SKC prices on their orders
  isActive: boolean;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Feedback ────────────────────────────────────────────────────────────────
export interface Feedback {
  id: string;
  orderId: string;
  orderNumber?: string;           // e.g. SKC-1042 — shown on marquee card
  customerId?: string;
  customerName: string;
  customerWhatsapp: string;
  rating: number;                 // 1–5
  whatYouLiked: string;
  improvement: string;
  recommend: boolean;
  isPublic: boolean;              // true if rating >= 4
  createdAt: string;
}

// ─── Loading Facts (shown on storefront load screen) ───────────────────────────
export interface LoadingFact {
  id: string;
  emoji: string;                  // e.g. "🌶️"
  text: string;                   // the fact sentence
  category: 'Food' | 'Health' | 'Homemade' | 'SKC';
  isActive: boolean;
  sortOrder: number;              // lower = shown earlier
  createdAt: string;
  updatedAt: string;
}

// ─── Admin Activity Log ──────────────────────────────────────────────────────
export type AdminActionType =
  | 'order_created'
  | 'order_status_changed'
  | 'payment_marked'
  | 'order_edited'
  | 'order_cancelled'
  | 'order_deleted'
  | 'payment_reminder_sent'
  | 'stock_updated'
  | 'customer_updated'
  | 'expense_added'
  | 'batch_recorded';

export interface AdminAction {
  id: string;
  type: AdminActionType;
  label: string;          // human-readable summary
  entityId?: string;      // orderId / customerId / etc.
  entityLabel?: string;   // e.g. order number or customer name
  createdAt: string;
}

// ─── Dashboard Stats ──────────────────────────────────────────────────────────
export interface DashboardStats {
  pendingOrders: number;
  pendingPayments: number;
  pendingPaymentAmount: number;
  unpaidCustomers: number;
  lowStockItems: number;
  monthlyRevenue: number;
  monthlyExpenses: number;
  monthlyProfit: number;
  totalCustomers: number;
  totalOrdersThisMonth: number;
  topProducts: { name: string; qty: number; revenue: number }[];
  revenueByDay: { date: string; revenue: number }[];
}

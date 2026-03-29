import type { Unit, OrderStatus, PaymentStatus, OrderType, ExpenseCategory, SubscriptionDuration } from "./constants";

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
  stockId?: string;
  sortOrder: number;              // for manual ordering in storefront
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
  discountPercent?: number;       // standing discount % for close family/friends (applied to all future orders)
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
  customizationNote?: string;     // customer customization request
  isOnDemand?: boolean;           // was it an on-demand product?
  rawMaterialCost?: number;       // for on-demand: actual raw material cost
  profitAmount?: number;          // selling price - raw material cost
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
export interface Subscription {
  id: string;
  customerId: string;
  customerName: string;
  customerWhatsapp: string;
  items: OrderItem[];
  duration: SubscriptionDuration;
  discountPercent: number;
  baseAmount: number;
  discountedAmount: number;
  startDate: string;
  endDate: string;
  isActive: boolean;
  paymentStatus: PaymentStatus;
  createdAt: string;
}

// ─── Feedback ────────────────────────────────────────────────────────────────
export interface Feedback {
  id: string;
  orderId: string;
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

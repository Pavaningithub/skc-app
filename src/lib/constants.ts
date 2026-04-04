import { APP_CONFIG } from '../config';

export const WHATSAPP_NUMBER = APP_CONFIG.WHATSAPP_NUMBER;
export const UPI_ID = APP_CONFIG.UPI_ID;
export const UPI_NUMBER = APP_CONFIG.UPI_NUMBER;
export const BUSINESS_NAME = APP_CONFIG.BUSINESS_NAME;
export const ADMIN_PIN_KEY = 'skc_admin_pin';
export const DEFAULT_ADMIN_PIN = APP_CONFIG.DEFAULT_ADMIN_PIN;
export const LOW_STOCK_THRESHOLD_KG = 0.5;

export type Unit = 'gram' | 'kg' | 'piece';

export const UNIT_LABELS: Record<Unit, string> = {
  gram: 'Gram (g)',
  kg: 'Kilogram (kg)',
  piece: 'Piece',
};

export type OrderStatus = 'pending' | 'confirmed' | 'out_for_delivery' | 'delivered' | 'cancelled';

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  out_for_delivery: 'Out for Delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

export const ORDER_STATUS_COLORS: Record<OrderStatus, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  confirmed: 'bg-blue-100 text-blue-800',
  out_for_delivery: 'bg-purple-100 text-purple-800',
  delivered: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
};

export type PaymentStatus = 'pending' | 'paid' | 'na';
export type OrderType = 'regular' | 'sample' | 'subscription';
export type ExpenseCategory = 'raw_material' | 'gas' | 'labour' | 'delivery' | 'packaging' | 'other';

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> =
  APP_CONFIG.EXPENSE_CATEGORIES as Record<ExpenseCategory, string>;

export type SubscriptionDuration = '3months' | '6months';

// Status lifecycle: pending → confirmed → payment_requested → active (each monthly cycle)
export type SubscriptionStatus = 'pending' | 'confirmed' | 'payment_requested' | 'active' | 'in_progress' | 'completed' | 'cancelled';

// Static fallback discounts — live values come from Firestore via useSubscriptionConfig
export const SUBSCRIPTION_DISCOUNTS: Record<SubscriptionDuration, number> = {
  '3months': APP_CONFIG.SUBSCRIPTION_UPFRONT_3M_PCT,
  '6months': APP_CONFIG.SUBSCRIPTION_UPFRONT_6M_PCT,
};

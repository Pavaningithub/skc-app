// ─── Storefront pricing ──────────────────────────────────────────────────────
// Ports of the helpers in src/lib/utils.ts so the server computes totals itself
// rather than trusting whatever the browser sends.

export interface ReferralTier {
  minOrder: number;
  maxOrder: number | null;
  pct: number;
  cap: number | null;
}

export interface ReferralConfig {
  tiers: ReferralTier[];
  splitReferrerPct: number;
  creditRedemptionPct: number;
  creditRedemptionCap: number;
}

export const DEFAULT_REFERRAL_CONFIG: ReferralConfig = {
  tiers: [
    {minOrder: 1, maxOrder: 500, pct: 3, cap: null},
    {minOrder: 500, maxOrder: 1000, pct: 5, cap: 50},
    {minOrder: 1000, maxOrder: null, pct: 7.5, cap: 100},
  ],
  splitReferrerPct: 75,
  creditRedemptionPct: 10,
  creditRedemptionCap: 75,
};

/** Strip country code and non-digits; a valid number is exactly 10 digits. */
export function normalizeWhatsapp(raw: unknown): string {
  return String(raw ?? "").replace(/\D/g, "").replace(/^(91|0)/, "").slice(0, 10);
}

export function generateOrderNumber(now = new Date()): string {
  const y = now.getFullYear().toString().slice(2);
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const r = Math.floor(Math.random() * 9000) + 1000;
  return `SKC${y}${m}${d}${r}`;
}

export function generateReferralCode(name: string): string {
  const slug = name.trim().split(" ")[0].toUpperCase().replace(/[^A-Z]/g, "").slice(0, 6);
  return `SKC-${slug}${Math.floor(Math.random() * 90) + 10}`;
}

export function computeReferralDiscountFromTiers(
  subtotal: number, tiers: ReferralTier[], splitReferrerPct: number,
): {total: number; customerDiscount: number; referrerCredit: number} {
  if (subtotal <= 0 || tiers.length === 0) {
    return {total: 0, customerDiscount: 0, referrerCredit: 0};
  }
  const tier = [...tiers]
    .sort((a, b) => a.minOrder - b.minOrder)
    .reverse()
    .find((t) => subtotal >= t.minOrder && (t.maxOrder === null || subtotal < t.maxOrder));
  if (!tier) return {total: 0, customerDiscount: 0, referrerCredit: 0};

  let raw = Math.floor(subtotal * (tier.pct / 100));
  if (tier.cap !== null) raw = Math.min(raw, tier.cap);
  const referrerCredit = Math.floor(raw * (splitReferrerPct / 100));
  return {total: raw, customerDiscount: raw - referrerCredit, referrerCredit};
}

export function computeCreditRedemption(
  availableCredit: number, subtotal: number,
  redemptionPct = 10, redemptionCap = 75,
): number {
  if (availableCredit <= 0 || subtotal <= 0) return 0;
  const cap = Math.min(Math.floor(subtotal * redemptionPct / 100), redemptionCap);
  return Math.min(availableCredit, cap);
}

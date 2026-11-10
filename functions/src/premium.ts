import { FREE_LIMITS, type PremiumState } from './model.js';

/** The fields of a RevenueCat webhook event that Bloomkin uses. */
export interface RevenueCatEvent {
  type: string;
  app_user_id: string;
  product_id?: string | null;
  expiration_at_ms?: number | null;
  entitlement_ids?: string[] | null;
}

export const PREMIUM_ENTITLEMENT = 'premium';

const ACTIVATING = new Set([
  'INITIAL_PURCHASE',
  'RENEWAL',
  'PRODUCT_CHANGE',
  'UNCANCELLATION',
  'NON_RENEWING_PURCHASE',
  'SUBSCRIPTION_EXTENDED',
  // A cancelled subscription still runs until it expires; EXPIRATION switches it off.
  'CANCELLATION',
  'BILLING_ISSUE',
]);

/**
 * Maps a RevenueCat event to the premium state to store, or null when the event
 * should not change anything (tests, anonymous users, transfers, other entitlements).
 */
export function premiumStateFromEvent(event: RevenueCatEvent, nowMs: number): PremiumState | null {
  if (!event.app_user_id || event.app_user_id.startsWith('$RCAnonymousID')) return null;
  if (event.entitlement_ids && !event.entitlement_ids.includes(PREMIUM_ENTITLEMENT)) return null;

  const expiresAt = event.expiration_at_ms ?? null;
  const productId = event.product_id ?? null;

  if (event.type === 'EXPIRATION') {
    return { active: false, expiresAt, productId };
  }
  if (ACTIVATING.has(event.type)) {
    const active = expiresAt === null || expiresAt > nowMs;
    return { active, expiresAt, productId };
  }
  return null;
}

/** True while a stored premium state is switched on and not past its expiry. */
export function isPremiumActive(premium: Partial<PremiumState> | null | undefined, nowMs: number): boolean {
  if (!premium?.active) return false;
  return premium.expiresAt == null || premium.expiresAt > nowMs;
}

/** True when a free baby already has as many people as the free plan allows. */
export function memberLimitReached(
  premium: Partial<PremiumState> | null | undefined,
  memberCount: number,
  nowMs: number,
): boolean {
  return !isPremiumActive(premium, nowMs) && memberCount >= FREE_LIMITS.members;
}

/** How many photos a log write adds (negative when photos are taken off or the log is deleted). */
export function photoCountChange(
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown> | undefined,
): number {
  const size = (d: Record<string, unknown> | undefined) => (Array.isArray(d?.photos) ? d.photos.length : 0);
  return size(after) - size(before);
}

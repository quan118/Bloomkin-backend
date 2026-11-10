import { describe, expect, it } from 'vitest';
import { isPremiumActive, memberLimitReached, photoCountChange, premiumStateFromEvent } from '../src/premium.js';
import { logNotification, toLocale } from '../src/messages.js';

const NOW = Date.parse('2026-11-01T00:00:00Z');
const NEXT_MONTH = Date.parse('2026-12-01T00:00:00Z');

describe('premiumStateFromEvent', () => {
  const base = { app_user_id: 'uid123', product_id: 'bloomkin_monthly', entitlement_ids: ['premium'] };

  it('activates on a purchase', () => {
    expect(premiumStateFromEvent({ ...base, type: 'INITIAL_PURCHASE', expiration_at_ms: NEXT_MONTH }, NOW)).toEqual({
      active: true,
      expiresAt: NEXT_MONTH,
      productId: 'bloomkin_monthly',
    });
  });

  it('keeps premium after a cancellation until it expires', () => {
    expect(premiumStateFromEvent({ ...base, type: 'CANCELLATION', expiration_at_ms: NEXT_MONTH }, NOW)?.active).toBe(true);
  });

  it('turns premium off on expiration', () => {
    expect(premiumStateFromEvent({ ...base, type: 'EXPIRATION', expiration_at_ms: NOW - 1 }, NOW)?.active).toBe(false);
  });

  it('treats a renewal that already lapsed as inactive', () => {
    expect(premiumStateFromEvent({ ...base, type: 'RENEWAL', expiration_at_ms: NOW - 1 }, NOW)?.active).toBe(false);
  });

  it('ignores anonymous users, other entitlements and unknown events', () => {
    expect(premiumStateFromEvent({ ...base, app_user_id: '$RCAnonymousID:abc', type: 'RENEWAL' }, NOW)).toBeNull();
    expect(premiumStateFromEvent({ ...base, entitlement_ids: ['other'], type: 'RENEWAL' }, NOW)).toBeNull();
    expect(premiumStateFromEvent({ ...base, type: 'TEST' }, NOW)).toBeNull();
  });
});

describe('logNotification', () => {
  it('writes Vietnamese and English text', () => {
    expect(logNotification('vi', { actorName: 'Minh', babyName: 'Bé Bin', type: 'diaper' })).toEqual({
      title: 'Bé Bin',
      body: 'Minh vừa ghi thay tã',
    });
    expect(logNotification('en', { actorName: 'Minh', babyName: 'Bin', type: 'bottle' }).body).toBe(
      'Minh logged a bottle feed',
    );
  });

  it('falls back to English for other locales', () => {
    expect(toLocale('vi-VN')).toBe('vi');
    expect(toLocale('fr')).toBe('en');
    expect(toLocale(undefined)).toBe('en');
  });
});

describe('isPremiumActive', () => {
  it('is on for an active, unexpired subscription or a lifetime purchase', () => {
    expect(isPremiumActive({ active: true, expiresAt: NEXT_MONTH }, NOW)).toBe(true);
    expect(isPremiumActive({ active: true, expiresAt: null }, NOW)).toBe(true);
  });

  it('is off when switched off, expired or missing', () => {
    expect(isPremiumActive({ active: false, expiresAt: NEXT_MONTH }, NOW)).toBe(false);
    expect(isPremiumActive({ active: true, expiresAt: NOW - 1 }, NOW)).toBe(false);
    expect(isPremiumActive(undefined, NOW)).toBe(false);
  });
});

describe('memberLimitReached', () => {
  it('lets a free baby have the owner and one more person', () => {
    expect(memberLimitReached(undefined, 1, NOW)).toBe(false);
    expect(memberLimitReached(undefined, 2, NOW)).toBe(true);
  });

  it('has no limit on a Premium baby', () => {
    expect(memberLimitReached({ active: true, expiresAt: NEXT_MONTH }, 10, NOW)).toBe(false);
  });
});

describe('photoCountChange', () => {
  const photos = (n: number) => ({ photos: Array.from({ length: n }, (_, i) => ({ id: `p${i}` })) });

  it('counts photos added, removed and deleted with the log', () => {
    expect(photoCountChange(undefined, photos(3))).toBe(3);
    expect(photoCountChange(photos(3), photos(1))).toBe(-2);
    expect(photoCountChange(photos(2), undefined)).toBe(-2);
    expect(photoCountChange({ note: 'x' }, { note: 'y' })).toBe(0);
  });
});

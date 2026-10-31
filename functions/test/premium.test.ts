import { describe, expect, it } from 'vitest';
import { premiumStateFromEvent } from '../src/premium.js';
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

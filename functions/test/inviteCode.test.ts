import { describe, expect, it } from 'vitest';
import { INVITE_ALPHABET, generateInviteCode, normalizeInviteCode } from '../src/inviteCode.js';

describe('generateInviteCode', () => {
  it('makes an 8-character code in two groups', () => {
    const code = generateInviteCode();
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  });

  it('never uses look-alike characters', () => {
    for (let i = 0; i < 200; i++) {
      expect(generateInviteCode()).not.toMatch(/[01OIL]/);
    }
  });

  it('uses the random source it is given', () => {
    expect(generateInviteCode(() => 0)).toBe('AAAA-AAAA');
    expect(generateInviteCode((max) => max - 1)).toBe('9999-9999');
    expect(INVITE_ALPHABET).toHaveLength(31);
  });
});

describe('normalizeInviteCode', () => {
  it('accepts what people type', () => {
    expect(normalizeInviteCode('k7qm 2hxa')).toBe('K7QM-2HXA');
    expect(normalizeInviteCode('K7QM2HXA')).toBe('K7QM-2HXA');
    expect(normalizeInviteCode(' k7qm-2hxa ')).toBe('K7QM-2HXA');
  });

  it('rejects wrong lengths and characters', () => {
    expect(normalizeInviteCode('K7QM-2HX')).toBeNull();
    expect(normalizeInviteCode('K7QM-2HXA1')).toBeNull();
    expect(normalizeInviteCode('O7QM-2HXA')).toBeNull();
  });
});

import { randomInt } from 'node:crypto';

// No 0/O, 1/I/L: codes are read aloud and typed by hand.
export const INVITE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const GROUP = 4;

/** A code like "K7QM-2HXA" (8 characters, about 39 bits of randomness). */
export function generateInviteCode(nextInt: (max: number) => number = randomInt): string {
  let raw = '';
  for (let i = 0; i < GROUP * 2; i++) {
    raw += INVITE_ALPHABET[nextInt(INVITE_ALPHABET.length)];
  }
  return `${raw.slice(0, GROUP)}-${raw.slice(GROUP)}`;
}

/** Accepts what people type ("k7qm 2hxa", "K7QM2HXA") and returns the stored form, or null. */
export function normalizeInviteCode(input: string): string | null {
  const raw = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (raw.length !== GROUP * 2) return null;
  for (const ch of raw) {
    if (!INVITE_ALPHABET.includes(ch)) return null;
  }
  return `${raw.slice(0, GROUP)}-${raw.slice(GROUP)}`;
}

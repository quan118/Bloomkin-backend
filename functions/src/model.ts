// Shared names and shapes for the Firestore data model.
// Keep in sync with firestore.rules and the app's src/data/model.ts.

export const RELATIONS = ['mother', 'father', 'grandparent', 'caregiver', 'other'] as const;
export type Relation = (typeof RELATIONS)[number];

export const ROLES = ['owner', 'editor', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

/** Roles an owner can hand out. Ownership itself is never given by invite. */
export const INVITE_ROLES = ['editor', 'viewer'] as const;
export type InviteRole = (typeof INVITE_ROLES)[number];

export const LOG_TYPES = [
  'breastfeed',
  'bottle',
  'pump',
  'sleep',
  'diaper',
  'measurement',
  'temperature',
  'medicine',
  'symptom',
  'note',
  'kick',
  'contraction',
  'moment',
] as const;
export type LogType = (typeof LOG_TYPES)[number];

export const SUPPORTED_LOCALES = ['vi', 'en'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const INVITE_TTL_DAYS = 7;
export const MAX_BABIES_PER_INVITE = 20;

export const paths = {
  user: (uid: string) => `users/${uid}`,
  membership: (uid: string, babyId: string) => `users/${uid}/memberships/${babyId}`,
  memberships: (uid: string) => `users/${uid}/memberships`,
  devices: (uid: string) => `users/${uid}/devices`,
  baby: (babyId: string) => `babies/${babyId}`,
  member: (babyId: string, uid: string) => `babies/${babyId}/members/${uid}`,
  members: (babyId: string) => `babies/${babyId}/members`,
  invite: (code: string) => `invites/${code}`,
} as const;

export interface PremiumState {
  active: boolean;
  /** Milliseconds since epoch, or null for a lifetime purchase. */
  expiresAt: number | null;
  productId: string | null;
}

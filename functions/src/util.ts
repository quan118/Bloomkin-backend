import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import type { z } from 'zod';
import { db } from './admin.js';
import { paths, type Role } from './model.js';

export function requireAuth(req: CallableRequest<unknown>): string {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.');
  return uid;
}

export function parseInput<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new HttpsError('invalid-argument', 'Invalid request.', result.error.issues);
  }
  return result.data;
}

export async function roleOf(babyId: string, uid: string): Promise<Role | null> {
  const snap = await db().doc(paths.member(babyId, uid)).get();
  return snap.exists ? (snap.get('role') as Role) : null;
}

export async function requireOwner(babyId: string, uid: string): Promise<void> {
  if ((await roleOf(babyId, uid)) !== 'owner') {
    throw new HttpsError('permission-denied', 'Only the profile owner can do this.');
  }
}

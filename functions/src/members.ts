import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { db } from './admin.js';
import { INVITE_ROLES, paths } from './model.js';
import { parseInput, requireAuth, requireOwner, roleOf } from './util.js';

const setRoleSchema = z.object({
  babyId: z.string().min(1),
  memberId: z.string().min(1),
  role: z.enum(INVITE_ROLES),
});

/** Owner switches a follower between "editor" (can log) and "viewer" (read only). */
export const setMemberRole = onCall(async (req) => {
  const uid = requireAuth(req);
  const input = parseInput(setRoleSchema, req.data);
  await requireOwner(input.babyId, uid);
  if (input.memberId === uid) throw new HttpsError('failed-precondition', 'The owner keeps the owner role.');

  const memberRef = db().doc(paths.member(input.babyId, input.memberId));
  if (!(await memberRef.get()).exists) throw new HttpsError('not-found', 'Not a follower of this baby.');

  const batch = db().batch();
  batch.update(memberRef, { role: input.role });
  batch.set(db().doc(paths.membership(input.memberId, input.babyId)), { role: input.role }, { merge: true });
  await batch.commit();
  return { ok: true };
});

const removeSchema = z.object({ babyId: z.string().min(1), memberId: z.string().min(1) });

/** Owner removes a follower, or a follower leaves. The owner cannot leave their own baby. */
export const removeMember = onCall(async (req) => {
  const uid = requireAuth(req);
  const input = parseInput(removeSchema, req.data);
  const callerRole = await roleOf(input.babyId, uid);
  const targetRole = await roleOf(input.babyId, input.memberId);

  if (!targetRole) return { ok: true };
  const leavingSelf = input.memberId === uid;
  if (leavingSelf && targetRole === 'owner') {
    throw new HttpsError('failed-precondition', 'Transfer ownership or delete the profile instead.');
  }
  if (!leavingSelf && callerRole !== 'owner') {
    throw new HttpsError('permission-denied', 'Only the profile owner can remove followers.');
  }

  const batch = db().batch();
  batch.delete(db().doc(paths.member(input.babyId, input.memberId)));
  batch.delete(db().doc(paths.membership(input.memberId, input.babyId)));
  await batch.commit();
  return { ok: true };
});

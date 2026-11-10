import { onDocumentCreated, onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { z } from 'zod';
import { auth, bucket, db } from './admin.js';
import { paths, type PremiumState } from './model.js';
import { parseInput, requireAuth, requireOwner } from './util.js';

/** Removes a baby, everything under it, its photos and every follower's membership entry. */
export async function deleteBabyCompletely(babyId: string): Promise<void> {
  const members = await db().collection(paths.members(babyId)).get();
  const writer = db().bulkWriter();
  members.docs.forEach((m) => writer.delete(db().doc(paths.membership(m.id, babyId))));
  await writer.close();

  await db().recursiveDelete(db().doc(paths.baby(babyId)));
  try {
    await bucket().deleteFiles({ prefix: `babies/${babyId}/` });
  } catch (err) {
    logger.warn('Could not delete baby photos', { babyId, err });
  }
}

export const deleteBaby = onCall(async (req) => {
  const uid = requireAuth(req);
  const { babyId } = parseInput(z.object({ babyId: z.string().min(1) }), req.data);
  await requireOwner(babyId, uid);
  await deleteBabyCompletely(babyId);
  return { ok: true };
});

/** A new baby inherits the owner's active Premium, so followers get it too. */
export const onBabyCreated = onDocumentCreated('babies/{babyId}', async (event) => {
  const ownerId = event.data?.get('ownerId') as string | undefined;
  if (!ownerId) return;
  const premium = (await db().doc(paths.user(ownerId)).get()).get('premium') as PremiumState | undefined;
  if (premium?.active) {
    await event.data!.ref.update({ premium: { ...premium, ownerId } });
  }
});

/** Babies that count toward the free limit: everything except ended pregnancies. */
export function countsTowardLimit(stage: unknown): boolean {
  return stage === 'pregnancy' || stage === 'born';
}

/**
 * Keeps `users/{uid}.ownedBabies` up to date. The security rules read it to stop a free
 * account from creating more babies than the free plan allows. It is counted again from
 * scratch each time, so it can't drift.
 */
export const onBabyWritten = onDocumentWritten('babies/{babyId}', async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  const ownerId = (after?.ownerId ?? before?.ownerId) as string | undefined;
  if (!ownerId) return;
  if (before && after && countsTowardLimit(before.stage) === countsTowardLimit(after.stage)) return;

  // Skip owners whose account is being deleted, so their user doc isn't brought back.
  try {
    await auth().getUser(ownerId);
  } catch {
    return;
  }

  const owned = await db().collection('babies').where('ownerId', '==', ownerId).select('stage').get();
  const ownedBabies = owned.docs.filter((d) => countsTowardLimit(d.get('stage'))).length;
  await db().doc(paths.user(ownerId)).set({ ownedBabies }, { merge: true });
});

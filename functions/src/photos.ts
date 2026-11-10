import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import { bucket, db } from './admin.js';
import { paths as dbPaths } from './model.js';
import { photoCountChange } from './premium.js';

function photoIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((p) => (p && typeof p === 'object' ? (p as { id?: unknown }).id : undefined)).filter(
    (id): id is string => typeof id === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(id),
  );
}

/** Storage paths of photos that were on a log before a write and are gone after it. */
export function removedPhotoPaths(
  babyId: string,
  logId: string,
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown> | undefined,
): string[] {
  const kept = new Set(photoIds(after?.photos));
  return photoIds(before?.photos)
    .filter((id) => !kept.has(id))
    .flatMap((id) => [`babies/${babyId}/logs/${logId}/${id}.jpg`, `babies/${babyId}/logs/${logId}/${id}_t.jpg`]);
}

/**
 * Deletes photo files once they are taken off a log, or when the log itself is deleted,
 * and keeps the baby's `photoCount` up to date for the free photo limit.
 */
export const onLogPhotosChanged = onDocumentWritten('babies/{babyId}/logs/{logId}', async (event) => {
  const { babyId, logId } = event.params;
  const before = event.data?.before.data();
  const after = event.data?.after.data();

  const change = photoCountChange(before, after);
  if (change !== 0) {
    await db()
      .doc(dbPaths.baby(babyId))
      .update({ photoCount: FieldValue.increment(change) })
      .catch((err: unknown) => {
        // The baby is being deleted along with its logs.
        if ((err as { code?: number }).code !== 5) throw err; // 5 = NOT_FOUND
      });
  }

  const paths = removedPhotoPaths(babyId, logId, before, after);
  await Promise.all(
    paths.map((path) =>
      bucket()
        .file(path)
        .delete({ ignoreNotFound: true })
        .catch((err: unknown) => logger.warn('Could not delete a log photo', { path, err })),
    ),
  );
});

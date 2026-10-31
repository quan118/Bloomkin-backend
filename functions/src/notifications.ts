import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';
import { db, messaging } from './admin.js';
import { logNotification, toLocale } from './messages.js';
import { LOG_TYPES, paths, type Locale, type LogType } from './model.js';

const STALE_TOKEN_ERRORS = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

/** Tells everyone else who follows a baby that a new log was added. */
export const onLogCreated = onDocumentCreated('babies/{babyId}/logs/{logId}', async (event) => {
  const log = event.data?.data();
  if (!log) return;
  const type = log.type as LogType;
  if (!LOG_TYPES.includes(type)) return;

  const { babyId } = event.params;
  const authorId = log.createdBy as string;

  const [babySnap, membersSnap] = await Promise.all([
    db().doc(paths.baby(babyId)).get(),
    db().collection(paths.members(babyId)).get(),
  ]);
  const babyName = (babySnap.get('name') as string | undefined) ?? '';
  const author = membersSnap.docs.find((m) => m.id === authorId);
  const actorName = (author?.get('displayName') as string | undefined) || '…';

  const recipients = membersSnap.docs.map((m) => m.id).filter((uid) => uid !== authorId);
  await Promise.all(
    recipients.map(async (uid) => {
      const [userSnap, devicesSnap] = await Promise.all([
        db().doc(paths.user(uid)).get(),
        db().collection(paths.devices(uid)).get(),
      ]);
      const muted = (userSnap.get('mutedBabies') as string[] | undefined) ?? [];
      if (muted.includes(babyId) || devicesSnap.empty) return;

      const locale: Locale = toLocale(userSnap.get('locale'));
      const tokens = devicesSnap.docs.map((d) => d.get('token') as string).filter(Boolean);
      if (tokens.length === 0) return;

      const res = await messaging().sendEachForMulticast({
        tokens,
        notification: logNotification(locale, { actorName, babyName, type }),
        data: { babyId, logId: event.params.logId, type },
      });

      const stale = res.responses
        .map((r, i) => (!r.success && STALE_TOKEN_ERRORS.has(r.error?.code ?? '') ? devicesSnap.docs[i] : null))
        .filter((d): d is NonNullable<typeof d> => d !== null);
      await Promise.all(stale.map((d) => d.ref.delete()));
      if (res.failureCount > stale.length) {
        logger.warn('Some push messages failed', { uid, failures: res.failureCount });
      }
    }),
  );
});

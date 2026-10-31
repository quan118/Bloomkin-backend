import { timingSafeEqual } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { db } from './admin.js';
import { paths } from './model.js';
import { premiumStateFromEvent, type RevenueCatEvent } from './premium.js';

/** The exact Authorization header value set in the RevenueCat webhook settings. */
const WEBHOOK_AUTH = defineSecret('REVENUECAT_WEBHOOK_AUTH');

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Receives subscription changes from RevenueCat. The app logs in to RevenueCat with
 * the Firebase uid, so `app_user_id` is the uid. Premium is stored on the user and
 * copied to every baby they own, so everyone following those babies gets it.
 */
export const revenuecatWebhook = onRequest({ secrets: [WEBHOOK_AUTH] }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send('Method not allowed');
    return;
  }
  if (!sameSecret(req.get('authorization') ?? '', WEBHOOK_AUTH.value())) {
    res.status(401).send('Unauthorized');
    return;
  }

  const event = (req.body as { event?: RevenueCatEvent } | undefined)?.event;
  if (!event) {
    res.status(400).send('Missing event');
    return;
  }

  const state = premiumStateFromEvent(event, Date.now());
  if (!state) {
    logger.info('RevenueCat event ignored', { type: event.type });
    res.status(200).send('ignored');
    return;
  }

  const uid = event.app_user_id;
  const owned = await db().collection('babies').where('ownerId', '==', uid).get();
  const batch = db().batch();
  batch.set(
    db().doc(paths.user(uid)),
    { premium: { ...state, updatedAt: FieldValue.serverTimestamp() } },
    { merge: true },
  );
  owned.docs.forEach((b) => batch.update(b.ref, { premium: { ...state, ownerId: uid } }));
  await batch.commit();

  res.status(200).send('ok');
});

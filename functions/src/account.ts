import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { auth, db } from './admin.js';
import { deleteBabyCompletely } from './babies.js';
import { deleteInvitesCreatedBy } from './invites.js';
import { paths } from './model.js';
import { requireAuth } from './util.js';

/**
 * Deletes the signed-in account (required by both app stores):
 * babies they own are deleted for everyone, they leave babies they follow,
 * then their user data and Auth account are removed.
 */
export const deleteAccount = onCall(async (req) => {
  const uid = requireAuth(req);
  const memberships = await db().collection(paths.memberships(uid)).get();

  for (const m of memberships.docs) {
    const babyId = m.id;
    const role = (await db().doc(paths.member(babyId, uid)).get()).get('role');
    if (role === 'owner') {
      await deleteBabyCompletely(babyId);
    } else {
      await db().doc(paths.member(babyId, uid)).delete();
    }
  }

  await deleteInvitesCreatedBy(uid);
  await db().recursiveDelete(db().doc(paths.user(uid)));
  try {
    await auth().deleteUser(uid);
  } catch (err) {
    if ((err as { code?: string }).code !== 'auth/user-not-found') {
      throw new HttpsError('internal', 'Could not delete the sign-in account.');
    }
  }
  return { ok: true };
});

/** Everything the user can see, as JSON, for "Export my data". */
export const exportMyData = onCall(async (req) => {
  const uid = requireAuth(req);
  const user = await db().doc(paths.user(uid)).get();
  const memberships = await db().collection(paths.memberships(uid)).get();

  const babies = await Promise.all(
    memberships.docs.map(async (m) => {
      const ref = db().doc(paths.baby(m.id));
      const [baby, logs, appointments, tasks] = await Promise.all([
        ref.get(),
        ref.collection('logs').get(),
        ref.collection('appointments').get(),
        ref.collection('tasks').get(),
      ]);
      return {
        id: m.id,
        role: m.get('role'),
        profile: baby.data() ?? null,
        logs: logs.docs.map((d) => ({ id: d.id, ...d.data() })),
        appointments: appointments.docs.map((d) => ({ id: d.id, ...d.data() })),
        tasks: tasks.docs.map((d) => ({ id: d.id, ...d.data() })),
      };
    }),
  );

  return { exportedAt: new Date().toISOString(), user: user.data() ?? null, babies };
});

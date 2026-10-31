// End-to-end check of the invite flow against the Auth, Firestore and Functions emulators.
// Run with: npm run test:integration
import { initializeApp, deleteApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth, updateProfile } from 'firebase/auth';
import {
  connectFirestoreEmulator,
  doc,
  getDoc,
  getFirestore,
  serverTimestamp,
  setDoc,
  writeBatch,
} from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions';
import { afterAll, describe, expect, it } from 'vitest';

const PROJECT = process.env.GCLOUD_PROJECT ?? 'demo-bloomkin';
const REGION = 'asia-southeast1';
const apps: FirebaseApp[] = [];

async function signUp(name: string) {
  const app = initializeApp({ projectId: PROJECT, apiKey: 'demo-key' }, `${name}-${Date.now()}`);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const db = getFirestore(app);
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  const fns = getFunctions(app, REGION);
  connectFunctionsEmulator(fns, '127.0.0.1', 5001);

  const cred = await createUserWithEmailAndPassword(auth, `${name}-${Date.now()}@example.com`, 'password123');
  await updateProfile(cred.user, { displayName: name });
  await setDoc(doc(db, 'users', cred.user.uid), { displayName: name, locale: 'vi' });
  return { uid: cred.user.uid, db, call: (fn: string, data: unknown) => httpsCallable(fns, fn)(data) };
}

afterAll(async () => {
  await Promise.all(apps.map((a) => deleteApp(a)));
});

describe('invite flow', () => {
  it('lets an owner invite a partner who can then log', async () => {
    const lan = await signUp('Lan');
    const minh = await signUp('Minh');

    const babyId = `baby-${Date.now()}`;
    const batch = writeBatch(lan.db);
    batch.set(doc(lan.db, 'babies', babyId), {
      name: 'Na',
      stage: 'pregnancy',
      ownerId: lan.uid,
      region: 'asia',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(lan.db, 'babies', babyId, 'members', lan.uid), {
      role: 'owner',
      relation: 'mother',
      displayName: 'Lan',
    });
    batch.set(doc(lan.db, 'users', lan.uid, 'memberships', babyId), { role: 'owner', relation: 'mother' });
    await batch.commit();

    const created = await lan.call('createInvite', { babyIds: [babyId], role: 'editor', relation: 'father' });
    const { code } = created.data as { code: string };
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);

    const preview = await minh.call('previewInvite', { code: code.toLowerCase().replace('-', ' ') });
    expect(preview.data).toMatchObject({ inviterName: 'Lan', role: 'editor', babies: [{ id: babyId, name: 'Na' }] });

    // Minh cannot read the baby before accepting.
    await expect(getDoc(doc(minh.db, 'babies', babyId))).rejects.toThrow();

    const accepted = await minh.call('acceptInvite', { code });
    expect(accepted.data).toEqual({ babyIds: [babyId] });

    const member = await getDoc(doc(minh.db, 'babies', babyId, 'members', minh.uid));
    expect(member.data()).toMatchObject({ role: 'editor', relation: 'father', displayName: 'Minh' });

    await setDoc(doc(minh.db, 'babies', babyId, 'logs', 'l1'), {
      type: 'diaper',
      startedAt: new Date(),
      data: { kind: 'wet' },
      createdBy: minh.uid,
      createdAt: serverTimestamp(),
      updatedBy: minh.uid,
      updatedAt: serverTimestamp(),
    });

    // The same code cannot be used twice.
    const mai = await signUp('Mai');
    await expect(mai.call('acceptInvite', { code })).rejects.toThrow(/invite-used/);

    // Only the owner can change roles.
    await expect(
      minh.call('setMemberRole', { babyId, memberId: lan.uid, role: 'viewer' }),
    ).rejects.toThrow();
    await lan.call('setMemberRole', { babyId, memberId: minh.uid, role: 'viewer' });
    const membership = await getDoc(doc(minh.db, 'users', minh.uid, 'memberships', babyId));
    expect(membership.get('role')).toBe('viewer');
  });
});

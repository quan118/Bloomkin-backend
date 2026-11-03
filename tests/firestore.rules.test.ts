import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, writeBatch, Timestamp, deleteDoc, deleteField } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

let env: RulesTestEnvironment;

const now = () => Timestamp.now();

function babyData(ownerId: string, extra: Record<string, unknown> = {}) {
  return {
    name: 'Na',
    stage: 'pregnancy',
    dueDate: Timestamp.fromDate(new Date('2027-02-16')),
    ownerId,
    region: 'asia',
    createdAt: now(),
    updatedAt: now(),
    ...extra,
  };
}

function logData(createdBy: string, extra: Record<string, unknown> = {}) {
  return {
    type: 'breastfeed',
    startedAt: now(),
    endedAt: null,
    data: { side: 'left' },
    createdBy,
    createdAt: now(),
    updatedBy: createdBy,
    updatedAt: now(),
    ...extra,
  };
}

/** Seeds baby "na" owned by lan, with minh as editor and mai as viewer. */
async function seedBaby() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'babies/na'), babyData('lan'));
    await setDoc(doc(db, 'babies/na/members/lan'), { role: 'owner', relation: 'mother' });
    await setDoc(doc(db, 'babies/na/members/minh'), { role: 'editor', relation: 'father' });
    await setDoc(doc(db, 'babies/na/members/mai'), { role: 'viewer', relation: 'grandparent' });
    await setDoc(doc(db, 'invites/ABCD-EFGH'), { babyIds: ['na'], role: 'editor' });
  });
}

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-bloomkin',
    firestore: { rules: readFileSync(resolve(import.meta.dirname, '../firestore.rules'), 'utf8') },
  });
});

afterAll(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
});

describe('creating a baby', () => {
  it('lets a user create a baby, its owner member and their membership in one batch', async () => {
    const db = env.authenticatedContext('lan').firestore();
    const batch = writeBatch(db);
    batch.set(doc(db, 'babies/b1'), babyData('lan'));
    batch.set(doc(db, 'babies/b1/members/lan'), { role: 'owner', relation: 'mother' });
    batch.set(doc(db, 'users/lan/memberships/b1'), { role: 'owner', relation: 'mother' });
    await assertSucceeds(batch.commit());
  });

  it('rejects a baby without the owner member doc', async () => {
    const db = env.authenticatedContext('lan').firestore();
    await assertFails(setDoc(doc(db, 'babies/b1'), babyData('lan')));
  });

  it('rejects a baby owned by someone else', async () => {
    const db = env.authenticatedContext('lan').firestore();
    const batch = writeBatch(db);
    batch.set(doc(db, 'babies/b1'), babyData('minh'));
    batch.set(doc(db, 'babies/b1/members/lan'), { role: 'owner', relation: 'mother' });
    await assertFails(batch.commit());
  });

  it('rejects a client-set premium flag', async () => {
    const db = env.authenticatedContext('lan').firestore();
    const batch = writeBatch(db);
    batch.set(doc(db, 'babies/b1'), babyData('lan', { premium: { active: true } }));
    batch.set(doc(db, 'babies/b1/members/lan'), { role: 'owner', relation: 'mother' });
    await assertFails(batch.commit());
  });

  it('rejects unknown fields and bad values', async () => {
    const db = env.authenticatedContext('lan').firestore();
    const batch = writeBatch(db);
    batch.set(doc(db, 'babies/b1'), babyData('lan', { stage: 'teenager' }));
    batch.set(doc(db, 'babies/b1/members/lan'), { role: 'owner', relation: 'mother' });
    await assertFails(batch.commit());
  });
});

describe('membership', () => {
  beforeEach(seedBaby);

  it('hides a baby from people who do not follow it', async () => {
    const db = env.authenticatedContext('stranger').firestore();
    await assertFails(getDoc(doc(db, 'babies/na')));
  });

  it('shows a baby to a viewer', async () => {
    const db = env.authenticatedContext('mai').firestore();
    await assertSucceeds(getDoc(doc(db, 'babies/na')));
  });

  it('stops a stranger from making themselves a member', async () => {
    const db = env.authenticatedContext('stranger').firestore();
    await assertFails(setDoc(doc(db, 'babies/na/members/stranger'), { role: 'owner', relation: 'other' }));
  });

  it('stops a member from changing their own role', async () => {
    const db = env.authenticatedContext('mai').firestore();
    await assertFails(updateDoc(doc(db, 'babies/na/members/mai'), { role: 'owner' }));
  });

  it('stops anyone from reading invites directly', async () => {
    const db = env.authenticatedContext('lan').firestore();
    await assertFails(getDoc(doc(db, 'invites/ABCD-EFGH')));
  });

  it('stops the owner from setting premium on the baby', async () => {
    const db = env.authenticatedContext('lan').firestore();
    await assertFails(updateDoc(doc(db, 'babies/na'), { premium: { active: true } }));
  });

  it('lets an editor rename the baby', async () => {
    const db = env.authenticatedContext('minh').firestore();
    await assertSucceeds(updateDoc(doc(db, 'babies/na'), { name: 'Na Na', updatedAt: now() }));
  });

  it('stops a viewer from editing the baby', async () => {
    const db = env.authenticatedContext('mai').firestore();
    await assertFails(updateDoc(doc(db, 'babies/na'), { name: 'X' }));
  });

  it('lets an editor report the birth', async () => {
    const db = env.authenticatedContext('minh').firestore();
    await assertSucceeds(
      updateDoc(doc(db, 'babies/na'), { stage: 'born', birthDate: now(), sex: 'female', updatedAt: now() }),
    );
  });

  it('lets an editor undo a birth reported by mistake', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'babies/na'), { stage: 'born', birthDate: now(), sex: 'female' });
    });
    const editor = env.authenticatedContext('minh').firestore();
    await assertFails(updateDoc(doc(editor, 'babies/na'), { stage: 'ended', updatedAt: now() }));
    await assertSucceeds(
      updateDoc(doc(editor, 'babies/na'), {
        stage: 'pregnancy',
        birthDate: deleteField(),
        sex: deleteField(),
        updatedAt: now(),
      }),
    );
    const viewer = env.authenticatedContext('mai').firestore();
    await assertFails(updateDoc(doc(viewer, 'babies/na'), { stage: 'born', updatedAt: now() }));
  });

  it('lets only the owner end a pregnancy', async () => {
    const editor = env.authenticatedContext('minh').firestore();
    await assertFails(updateDoc(doc(editor, 'babies/na'), { stage: 'ended', updatedAt: now() }));
    const owner = env.authenticatedContext('lan').firestore();
    await assertSucceeds(updateDoc(doc(owner, 'babies/na'), { stage: 'ended', updatedAt: now() }));
  });

  it('lets only the owner resume an ended pregnancy', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'babies/na'), { stage: 'ended' });
    });
    const editor = env.authenticatedContext('minh').firestore();
    await assertFails(updateDoc(doc(editor, 'babies/na'), { stage: 'pregnancy', updatedAt: now() }));
    const owner = env.authenticatedContext('lan').firestore();
    await assertSucceeds(updateDoc(doc(owner, 'babies/na'), { stage: 'pregnancy', updatedAt: now() }));
  });
});

describe('logs', () => {
  beforeEach(seedBaby);

  it('lets an editor add a log', async () => {
    const db = env.authenticatedContext('minh').firestore();
    await assertSucceeds(setDoc(doc(db, 'babies/na/logs/l1'), logData('minh')));
  });

  it('stops a viewer from adding a log', async () => {
    const db = env.authenticatedContext('mai').firestore();
    await assertFails(setDoc(doc(db, 'babies/na/logs/l1'), logData('mai')));
  });

  it('stops a log written in someone else’s name', async () => {
    const db = env.authenticatedContext('minh').firestore();
    await assertFails(setDoc(doc(db, 'babies/na/logs/l1'), logData('lan')));
  });

  it('rejects an unknown log type', async () => {
    const db = env.authenticatedContext('minh').firestore();
    await assertFails(setDoc(doc(db, 'babies/na/logs/l1'), logData('minh', { type: 'dance' })));
  });

  it('lets another editor edit a log but keeps the original author', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'babies/na/logs/l1'), logData('minh'));
    });
    const db = env.authenticatedContext('lan').firestore();
    await assertSucceeds(updateDoc(doc(db, 'babies/na/logs/l1'), { note: 'ok', updatedBy: 'lan', updatedAt: now() }));
    await assertFails(updateDoc(doc(db, 'babies/na/logs/l1'), { createdBy: 'lan', updatedBy: 'lan' }));
  });

  it('accepts a moment with photos', async () => {
    const db = env.authenticatedContext('minh').firestore();
    const photos = [{ id: 'p1', w: 1600, h: 1200 }];
    await assertSucceeds(setDoc(doc(db, 'babies/na/logs/l1'), logData('minh', { type: 'moment', photos, hasPhotos: true })));
  });

  it('rejects more than 6 photos on a log', async () => {
    const db = env.authenticatedContext('minh').firestore();
    const photos = Array.from({ length: 7 }, (_, i) => ({ id: `p${i}`, w: 100, h: 100 }));
    await assertFails(setDoc(doc(db, 'babies/na/logs/l1'), logData('minh', { photos, hasPhotos: true })));
  });

  it('rejects photos that are not a list', async () => {
    const db = env.authenticatedContext('minh').firestore();
    await assertFails(setDoc(doc(db, 'babies/na/logs/l1'), logData('minh', { photos: 'p1', hasPhotos: 'yes' })));
  });

  it('lets a viewer read but not delete logs', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'babies/na/logs/l1'), logData('minh'));
    });
    const db = env.authenticatedContext('mai').firestore();
    await assertSucceeds(getDoc(doc(db, 'babies/na/logs/l1')));
    await assertFails(deleteDoc(doc(db, 'babies/na/logs/l1')));
  });
});

describe('user documents', () => {
  it('lets a user write their own profile but not premium', async () => {
    const db = env.authenticatedContext('lan').firestore();
    await assertSucceeds(setDoc(doc(db, 'users/lan'), { displayName: 'Lan', locale: 'vi' }));
    await assertFails(updateDoc(doc(db, 'users/lan'), { premium: { active: true } }));
  });

  it('hides other people’s profiles', async () => {
    const db = env.authenticatedContext('minh').firestore();
    await assertFails(getDoc(doc(db, 'users/lan')));
  });
});

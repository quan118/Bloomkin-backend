import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { db } from './admin.js';
import { generateInviteCode, normalizeInviteCode } from './inviteCode.js';
import {
  INVITE_ROLES,
  INVITE_TTL_DAYS,
  MAX_BABIES_PER_INVITE,
  RELATIONS,
  paths,
  type InviteRole,
  type Relation,
} from './model.js';
import { parseInput, requireAuth, requireOwner } from './util.js';

interface InviteDoc {
  babyIds: string[];
  role: InviteRole;
  relation: Relation;
  createdBy: string;
  createdAt: Timestamp;
  expiresAt: Timestamp;
  usedBy: string | null;
  usedAt: Timestamp | null;
}

const codeSchema = z.string().transform((value, ctx) => {
  const code = normalizeInviteCode(value);
  if (!code) {
    ctx.addIssue({ code: 'custom', message: 'Invalid invite code.' });
    return z.NEVER;
  }
  return code;
});

const createSchema = z.object({
  babyIds: z.array(z.string().min(1)).min(1).max(MAX_BABIES_PER_INVITE),
  role: z.enum(INVITE_ROLES),
  relation: z.enum(RELATIONS),
});

/** Owner creates a one-time code that adds someone to one or more babies. */
export const createInvite = onCall(async (req) => {
  const uid = requireAuth(req);
  const input = parseInput(createSchema, req.data);
  const babyIds = [...new Set(input.babyIds)];
  for (const babyId of babyIds) await requireOwner(babyId, uid);

  const now = Timestamp.now();
  const expiresAt = Timestamp.fromMillis(now.toMillis() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
  const doc: InviteDoc = {
    babyIds,
    role: input.role,
    relation: input.relation,
    createdBy: uid,
    createdAt: now,
    expiresAt,
    usedBy: null,
    usedAt: null,
  };

  // create() fails if the code already exists, so retry on the (rare) collision.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateInviteCode();
    try {
      await db().doc(paths.invite(code)).create(doc);
      return { code, expiresAt: expiresAt.toMillis() };
    } catch (err) {
      if ((err as { code?: number }).code !== 6) throw err; // 6 = ALREADY_EXISTS
    }
  }
  throw new HttpsError('resource-exhausted', 'Could not create an invite code. Try again.');
});

async function loadValidInvite(code: string): Promise<InviteDoc> {
  const snap = await db().doc(paths.invite(code)).get();
  if (!snap.exists) throw new HttpsError('not-found', 'invite-not-found');
  const invite = snap.data() as InviteDoc;
  if (invite.usedAt) throw new HttpsError('failed-precondition', 'invite-used');
  if (invite.expiresAt.toMillis() < Date.now()) throw new HttpsError('failed-precondition', 'invite-expired');
  return invite;
}

/**
 * Shows who sent an invite and for which babies, before the person accepts.
 * Works without signing in so the app can show it before sign-up.
 */
export const previewInvite = onCall(async (req) => {
  const { code } = parseInput(z.object({ code: codeSchema }), req.data);
  const invite = await loadValidInvite(code);

  const [inviter, ...babies] = await Promise.all([
    db().doc(paths.user(invite.createdBy)).get(),
    ...invite.babyIds.map((id) => db().doc(paths.baby(id)).get()),
  ]);

  return {
    code,
    role: invite.role,
    relation: invite.relation,
    expiresAt: invite.expiresAt.toMillis(),
    inviterName: (inviter?.get('displayName') as string | undefined) ?? null,
    babies: babies
      .filter((b) => b.exists)
      .map((b) => ({ id: b.id, name: b.get('name') as string, stage: b.get('stage') as string })),
  };
});

const acceptSchema = z.object({
  code: codeSchema,
  relation: z.enum(RELATIONS).optional(),
});

/** Adds the signed-in user to every baby in the invite and marks the code as used. */
export const acceptInvite = onCall(async (req) => {
  const uid = requireAuth(req);
  const input = parseInput(acceptSchema, req.data);
  const inviteRef = db().doc(paths.invite(input.code));
  const tokenName = (req.auth?.token.name as string | undefined) ?? null;

  const babyIds = await db().runTransaction(async (tx) => {
    const inviteSnap = await tx.get(inviteRef);
    if (!inviteSnap.exists) throw new HttpsError('not-found', 'invite-not-found');
    const invite = inviteSnap.data() as InviteDoc;
    if (invite.usedAt) throw new HttpsError('failed-precondition', 'invite-used');
    if (invite.expiresAt.toMillis() < Date.now()) throw new HttpsError('failed-precondition', 'invite-expired');
    if (invite.createdBy === uid) throw new HttpsError('failed-precondition', 'own-invite');

    const userSnap = await tx.get(db().doc(paths.user(uid)));
    const memberSnaps = await Promise.all(invite.babyIds.map((id) => tx.get(db().doc(paths.member(id, uid)))));
    const displayName = (userSnap.get('displayName') as string | undefined) ?? tokenName ?? '';
    const relation = input.relation ?? invite.relation;
    const joinedAt = FieldValue.serverTimestamp();

    const added: string[] = [];
    invite.babyIds.forEach((babyId, i) => {
      // Someone who already follows the baby keeps their current role.
      if (memberSnaps[i]?.exists) return;
      tx.set(db().doc(paths.member(babyId, uid)), {
        role: invite.role,
        relation,
        displayName,
        invitedBy: invite.createdBy,
        joinedAt,
      });
      tx.set(db().doc(paths.membership(uid, babyId)), { role: invite.role, relation, joinedAt });
      added.push(babyId);
    });

    tx.update(inviteRef, { usedBy: uid, usedAt: FieldValue.serverTimestamp() });
    return added;
  });

  return { babyIds };
});

/** The person who made an invite can cancel it before it is used. */
export const revokeInvite = onCall(async (req) => {
  const uid = requireAuth(req);
  const { code } = parseInput(z.object({ code: codeSchema }), req.data);
  const ref = db().doc(paths.invite(code));
  const snap = await ref.get();
  if (!snap.exists) return { ok: true };
  const invite = snap.data() as InviteDoc;
  if (invite.createdBy !== uid) throw new HttpsError('permission-denied', 'Not your invite.');
  if (invite.usedAt) throw new HttpsError('failed-precondition', 'invite-used');
  await ref.delete();
  return { ok: true };
});

/** Unused, unexpired invites for a baby, for the owner's "Followers" screen. */
export const listPendingInvites = onCall(async (req) => {
  const uid = requireAuth(req);
  const { babyId } = parseInput(z.object({ babyId: z.string().min(1) }), req.data);
  await requireOwner(babyId, uid);

  const snap = await db()
    .collection('invites')
    .where('babyIds', 'array-contains', babyId)
    .where('usedAt', '==', null)
    .get();
  const now = Date.now();
  return {
    invites: snap.docs
      .map((d) => ({ code: d.id, ...(d.data() as InviteDoc) }))
      .filter((i) => i.expiresAt.toMillis() > now)
      .map((i) => ({ code: i.code, role: i.role, relation: i.relation, expiresAt: i.expiresAt.toMillis() })),
  };
});

/** Used by account deletion. */
export async function deleteInvitesCreatedBy(uid: string): Promise<void> {
  const snap = await db().collection('invites').where('createdBy', '==', uid).get();
  const writer = db().bulkWriter();
  snap.docs.forEach((d) => writer.delete(d.ref));
  await writer.close();
}

# Bloomkin backend

Firebase backend for the Bloomkin app: Firestore and Storage security rules, Cloud Functions, and tests.

| Firebase project | Alias | Use |
| --- | --- | --- |
| `bloomkin-dev` | `dev` (default) | Development and testing |
| `bloomkin-prod` | `prod` | Real users |

## Data model

```
users/{uid}                          profile (displayName, locale, mutedBabies); `premium` is server-only
users/{uid}/memberships/{babyId}     babies this user follows: { role, relation }
users/{uid}/devices/{deviceId}       push tokens: { token, platform }
users/{uid}/private/{doc}            mom's own data (weight, recovery, mood)
babies/{babyId}                      { name, stage, dueDate, birthDate, sex, ownerId, region, premium }
babies/{babyId}/members/{uid}        { role, relation, displayName, joinedAt }
babies/{babyId}/logs/{logId}         { type, startedAt, endedAt, data, note, createdBy, updatedBy, ... }
babies/{babyId}/appointments/{id}    checkups and vaccines
babies/{babyId}/tasks/{id}           shared to-do list
invites/{code}                       server-only
```

Roles are per baby: `owner` (one per baby) > `editor` (can log) > `viewer` (read only).
The app creates a baby, its owner member and the owner's membership in one batch.
Every other membership change goes through a Cloud Function, because it must update
both `babies/{id}/members/{uid}` and `users/{uid}/memberships/{id}`.

## Cloud Functions (region `asia-southeast1`)

| Function | Type | What it does |
| --- | --- | --- |
| `createInvite` | callable | Owner creates a one-time code (7 days) for one or more babies |
| `previewInvite` | callable | Shows inviter, babies and role before accepting |
| `acceptInvite` | callable | Adds the caller to the babies and marks the code used |
| `revokeInvite`, `listPendingInvites` | callable | Manage unused invites |
| `setMemberRole`, `removeMember` | callable | Owner changes roles, removes followers; followers can leave |
| `deleteBaby` | callable | Owner deletes a baby and everything under it |
| `deleteAccount`, `exportMyData` | callable | Store-required account deletion and data export |
| `onBabyCreated` | Firestore trigger | Copies the owner's active Premium to a new baby |
| `onLogCreated` | Firestore trigger | Pushes "Minh logged a diaper change" to the other followers |
| `revenuecatWebhook` | HTTPS | Stores Premium on the user and every baby they own |

## Run locally

Requirements: Node 24.12+, Java (for the emulators), Firebase CLI.

```bash
npm install && npm --prefix functions install
cp functions/.secret.local.example functions/.secret.local   # any value works locally
npm run emulators        # Auth, Firestore, Functions, Storage + UI at http://127.0.0.1:4000
```

## Tests

```bash
npm test                  # everything below
npm --prefix functions test   # unit tests (no emulator)
npm run test:rules        # Firestore rules on the emulator
npm run test:integration  # invite flow through Auth + Firestore + Functions emulators
```

## Deploy

Before the first deploy to a project: create the Firestore database (choose its location once,
it cannot change), enable Authentication providers, enable the Blaze plan, then set the secret:

```bash
firebase functions:secrets:set REVENUECAT_WEBHOOK_AUTH --project dev
npm run deploy:dev
```

If the database is not in `asia-southeast1`, change the region in `functions/src/options.ts` first.

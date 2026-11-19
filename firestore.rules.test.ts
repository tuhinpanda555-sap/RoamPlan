/**
 * Firestore Security Rules Emulator Test Suite (Phase 0 TDD)
 *
 * Designed to execute against the local Firebase Firestore Emulator with
 * @firebase/rules-unit-testing to verify all 12 Dirty Dozen adversarial payloads
 * documented in security_spec.md return PERMISSION_DENIED.
 *
 * Run locally with Firebase CLI:
 *   npm install -D @firebase/rules-unit-testing vitest
 *   firebase emulators:exec --only firestore "npx vitest run firestore.rules.test.ts"
 */

export const DIRTY_DOZEN_SECURITY_CASES = [
  {
    id: 1,
    name: 'Unauthenticated Read of Private Trips',
    actor: null,
    operation: 'list /users/userA/trips',
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Cross-User Trip Read',
    actor: { uid: 'userA', email_verified: true },
    operation: 'list /users/userB/trips',
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Cross-User Profile PII Read',
    actor: { uid: 'userA', email_verified: true },
    operation: 'get /users/userB',
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'Unverified Email Write',
    actor: { uid: 'userA', email_verified: false },
    operation: 'create /users/userA/trips/trip-1',
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Identity Spoofing on Create (ownerUid mismatch)',
    actor: { uid: 'userA', email_verified: true },
    operation: 'create /users/userA/trips/trip-1 { ownerUid: "userB" }',
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'Shadow / Ghost Field Injection (isAdmin: true)',
    actor: { uid: 'userA', email_verified: true },
    operation: 'create /users/userA { ..., isAdmin: true }',
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'Resource / Path ID Poisoning',
    actor: { uid: 'userA', email_verified: true },
    operation: 'create /users/userA/trips/bad$id..123',
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'Value Poisoning on Update (oversized title > 140 chars)',
    actor: { uid: 'userA', email_verified: true },
    operation: 'update /users/userA/trips/trip-1 { title: "x".repeat(500) }',
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'Client Timestamp Forgery (backdated createdAt)',
    actor: { uid: 'userA', email_verified: true },
    operation: 'create /users/userA/trips/trip-1 { createdAt: Timestamp(2020-01-01) }',
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Immutable Field Tampering (changing ownerUid/createdAt)',
    actor: { uid: 'userA', email_verified: true },
    operation: 'update /users/userA/trips/trip-1 { ownerUid: "userB" }',
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Terminal State Bypass (updating archived trip)',
    actor: { uid: 'userA', email_verified: true },
    operation: 'update /users/userA/trips/archived-trip { title: "Reopened" }',
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Booking Confirmation Forgery (status: confirmed)',
    actor: { uid: 'userA', email_verified: true },
    operation: 'create /users/userA/bookingRequests/req-1 { status: "confirmed" }',
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 13,
    name: 'Cross-User Expense Read/Write',
    actor: { uid: 'userA', email_verified: true },
    operation: 'list /users/userB/trips/trip-1/expenses',
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 14,
    name: 'Negative Expense Amount Poisoning',
    actor: { uid: 'userA', email_verified: true },
    operation: 'create /users/userA/trips/trip-1/expenses/exp-1 { amountInr: -500 }',
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 15,
    name: 'Expense Immutable Kind / Item Link Tampering',
    actor: { uid: 'userA', email_verified: true },
    operation: 'update /users/userA/trips/trip-1/expenses/exp-1 { kind: "additional", itineraryItemId: "" }',
    expected: 'PERMISSION_DENIED',
  },
] as const;

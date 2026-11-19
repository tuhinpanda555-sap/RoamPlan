# RoamPlan Firestore Security Specification (Phase 0 TDD)

## 1. Master Source of Truth & Data Invariants
- **User Isolation**: Every private document lives under `/users/{uid}` and carries `ownerUid == request.auth.uid` (or `uid == request.auth.uid` for the profile root).
- **Verified Identity**: All reads/writes on private user collections require `request.auth != null && request.auth.token.email_verified == true`.
- **Master Gate (Relational Sync)**:
  - `/users/{uid}/trips/{tripId}` requires `existsAfter(/databases/$(database)/documents/users/$(uid))` on create and `exists(...)` on update.
  - `/users/{uid}/trips/{tripId}/items/{itemId}` requires `getAfter(/databases/$(database)/documents/users/$(uid)/trips/$(tripId)).data.ownerUid == request.auth.uid` on create/update and `get(...).data.ownerUid == request.auth.uid` on get/delete.
  - `/users/{uid}/trips/{tripId}/expenses/{expenseId}` requires `getAfter(/databases/$(database)/documents/users/$(uid)/trips/$(tripId)).data.ownerUid == request.auth.uid` on create, parent ownership + `status != 'archived'` on update, and parent ownership on get/delete; `amountInr` must be an integer `>= 0` (supports `0` for zero-cost activities) and `kind`/`itineraryItemId` are immutable after creation.
  - `/users/{uid}/bookingRequests/{requestId}` requires `existsAfter(/databases/$(database)/documents/users/$(uid))` and enforces `status == 'requested'` (never `'confirmed'`).
- **Temporal & Immutable Integrity**:
  - `createdAt == request.time` on create; `createdAt == existing().createdAt` and `updatedAt == request.time` on update.
  - `ownerUid`, `id`, and `tripId` are strictly immutable after creation (plus `kind` and `itineraryItemId` on expenses).
  - Once a trip reaches terminal `status == 'archived'`, no subsequent updates are allowed on the trip, its items, or its expenses.
  - Booking enquiries are immutable after creation (clients may read, list their own, create with `status == 'requested'`, or delete — never mutate `status` to `'confirmed'`).

## 2. Adversarial Payloads (Must Return PERMISSION_DENIED)
1. **Unauthenticated Read of Private Trips**: Anonymous request `get` or `list` on `/users/userA/trips`.
2. **Cross-User Trip Read**: Authenticated `userA` attempts `get` or `list` on `/users/userB/trips`.
3. **Cross-User Profile PII Read**: Authenticated `userA` attempts `get` on `/users/userB` (email/name PII leak).
4. **Unverified Email Write**: Authenticated user with `email_verified: false` attempts to create `/users/userA/trips/trip-1`.
5. **Identity Spoofing on Create**: Authenticated `userA` attempts to create `/users/userA/trips/trip-1` with `{ ownerUid: "userB", ... }`.
6. **Shadow / Ghost Field Injection**: Authenticated `userA` includes `{ isAdmin: true }` or `{ confirmed: true }` in a trip, expense, or profile write.
7. **Resource / ID Poisoning**: Authenticated `userA` writes a document ID exceeding 128 chars or containing invalid symbols (`../evil`).
8. **Value Poisoning on Update**: Authenticated `userA` updates `title` with a 500-character string or non-string boolean.
9. **Client Timestamp Forgery**: Authenticated `userA` creates a trip or expense with a backdated `createdAt` instead of `serverTimestamp()` (`request.time`).
10. **Immutable Field Tampering**: Authenticated `userA` attempts to change `ownerUid`, `createdAt`, `kind`, or `itineraryItemId` during an update.
11. **Terminal State Bypass**: Authenticated `userA` attempts to update a trip or expense whose parent trip `status` is `'archived'`.
12. **Booking Confirmation Forgery**: Authenticated `userA` attempts to create `/users/userA/bookingRequests/req-1` with `{ status: "confirmed" }` or update an existing booking request's status.
13. **Cross-User Expense Read/Write**: Authenticated `userA` attempts `list` or `create` on `/users/userB/trips/trip-1/expenses`.
14. **Negative Expense Amount Poisoning**: Authenticated `userA` attempts to create `/users/userA/trips/trip-1/expenses/exp-1` with `{ amountInr: -500 }`.

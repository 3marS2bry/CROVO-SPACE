# CROVO SPACE Firestore Security Specification

## 1. Data Invariants
1. **PII Isolation:** `/users/{userId}` contains `email` and `/comments/{commentId}/private/contact` contains `contactPhone`. Neither may ever be read by non-owners or unauthenticated users (`isOwner(userId) || isAdmin()`).
2. **No Self-Privilege Escalation:** Users creating `/users/{userId}` must have `uid == request.auth.uid == userId`, `role == 'user'`, and `status == 'active'`. Only admins may alter `role`, `status`, or `Comment.isVerified`.
3. **Immutable Audit Fields:** `createdAt`, `authorUid` (on comments), and `uid` (on users) must never change after creation, and `createdAt == request.time` / `updatedAt == request.time` on writes.
4. **Atomic Like Counters (Eight Pillars — Pillar 7):**
   - Creating `/comments/{commentId}/likes/{userId}` MUST occur in a batch that atomically increments `comments/{commentId}.likesCount` by exactly `1` (checked via `existsAfter` / `getAfter`).
   - Deleting `/comments/{commentId}/likes/{userId}` MUST atomically decrement `comments/{commentId}.likesCount` by `1`.
   - Creating or deleting `/tool_likes/{userId}` MUST atomically adjust `/counters/tool.count` by `+1` or `-1` (or initialize `/counters/tool` at `count == 1`).
5. **Document Size & Attachment Bounds:** `avatarDataUrl <= 120000` chars; `attachmentBeforeDataUrl <= 320000` chars; `attachmentAfterDataUrl <= 320000` chars so every comment document stays well below Firestore's 1 MiB limit.
6. **Verified Accounts Only for Writes:** Standard authenticated writes require `request.auth != null && request.auth.token.email_verified == true`.
7. **Approved-Only Public Comment Queries:** Unauthenticated/non-admin `list` queries on `/comments` are restricted by `resource.data.status == 'approved'` (rule-enforced).

## 2. The "Dirty Dozen" Payloads (Expected: PERMISSION_DENIED)
1. **Unverified Email Admin Spoof:** Token has `email: "3mars7bry@gmail.com"` with `email_verified: false` reading `/users/other`.
2. **Self-Admin Escalation on Create:** Signed-in user creates `/users/{uid}` with `role: "admin"`.
3. **Cross-User PII Read:** Signed-in user A tries `get(/users/userB)`.
4. **Shadow Field Injection on Comment Create:** Authenticated user creates `/comments/cmt_1` adding `extraField: "hacked"`.
5. **Pre-Verified Badge Spoof:** Authenticated user creates `/comments/cmt_1` with `isVerified: true`.
6. **Inflated Initial Likes:** Authenticated user creates `/comments/cmt_1` with `likesCount: 999`.
7. **Impersonated Author UID:** User A creates `/comments/cmt_1` with `authorUid: "userB"`.
8. **Forged Timestamp:** User A creates `/comments/cmt_1` with `createdAt: "2020-01-01T00:00:00Z"` instead of `request.time`.
9. **Oversized Poison ID:** User creates `/comments/${"a".repeat(200)}` (`isValidId` rejects > 128 chars).
10. **Orphaned / Non-Atomic Like Increment:** User updates `/comments/cmt_1` setting `likesCount: existing + 5` or `+1` without creating `/comments/cmt_1/likes/{uid}` in the same batch.
11. **Unauthorized Comment Edit:** User B tries updating `/comments/cmt_owned_by_A.content`.
12. **PII Phone Scrape:** Visitor or User B tries reading `/comments/cmt_1/private/contact`.

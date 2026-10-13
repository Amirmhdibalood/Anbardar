# Stage 4 (v1.4.0): users, roles, permissions, audit log

## Goals
- Several people can share one device (owner, manager, seller, storekeeper). Each person signs in with a PIN.
- Permissions are **enforced in the service layer**. The UI only hides or disables controls as a convenience and is never the guard.
- Every state-changing action is written to an append-only audit log **in the same transaction** as the change.
- Single-user installs keep working with no sign-in until the owner turns users on (backward compatible).

## Data (migration 009)
- `users`: `id`, `name`, `role` (`owner|manager|seller|storekeeper`), `pin_hash`, `pin_salt`, `pin_iter`, `failed_attempts`, `locked_until`, `is_active` and the standard timestamps.
  - A unique index on the active name, case-insensitive (`lower(name)`), for users where `is_active=1`.
  - Trigger: the last active owner cannot be deactivated or demoted (`last_owner`).
- `audit_log`: `id`, `at`, `user_id` (nullable for single-user mode or the system), `user_name` (a snapshot), `action` (such as `sale.create`), `entity_type`, `entity_id`, `summary` (Persian, human-readable).
  - Triggers forbid UPDATE and DELETE (`audit_immutable`).
  - Indexed on `at`, `user_id` and `action`.
- Both tables are included in backup dumps. After a restore, the session is cleared and sign-in is required again.

## Roles to permissions (`models/permissions.ts`, a pure table)

| permission | owner | manager | seller | storekeeper |
|---|---|---|---|---|
| sales.create / returns.sale | ✓ | ✓ | ✓ | – |
| sales.cancel | ✓ | ✓ | – | – |
| purchases.create / returns.purchase | ✓ | ✓ | – | ✓ |
| purchases.cancel | ✓ | ✓ | – | – |
| stock.adjust / transfers.create | ✓ | ✓ | – | ✓ |
| products.manage (products, groups, units, warehouses) | ✓ | ✓ | – | ✓ |
| parties.manage | ✓ | ✓ | ✓ | – |
| money.create (receipt/payment, cheques) | ✓ | ✓ | ✓ (receipts only) | – |
| money.cancel / cheques.manage / expenses.manage | ✓ | ✓ | – | – |
| reports.view / costs.view (cost, profit) | ✓ | ✓ | – | – |
| backup.create | ✓ | ✓ | ✓ | ✓ |
| backup.restore / settings.manage / users.manage | ✓ | – | – | – |
| audit.view | ✓ | ✓ | – | – |

The seller's limit on `money.create` (receipts only) is enforced as an argument rule inside the guard.

## Enforcement design
- `services/session.ts` holds the current actor (`{ userId, name, role } | null`) in a module-level store with subscribe, for the UI.
- `services/authz.ts` provides `authorize(tx, permission)`:
  - If the `users` table has no active user (single-user mode), it allows the call, and the audit row has `user_id = NULL` and `user_name = 'مالک'`.
  - Otherwise, a missing actor gives `AppError('auth_required')`.
  - An inactive user, or a role without the permission, gives `AppError('forbidden', "<Persian message naming the action>")`.
  - The actor is re-read from the DB on every call, so a deactivated user is blocked immediately.
- `services/secured.ts` wraps each raw service with `guard(db, factory, rules)`. Every guarded method runs:
  `db.transaction(tx => { actor = authorize(tx, perm); result = factory(tx)[path](...args); audit(tx, actor, action, entity(result,args), summary); return result })`.
  The raw services' own `db.transaction` calls become SAVEPOINTs, so the authorization check, the change and the audit row commit or roll back together.
  Read methods that expose cost or profit (reports, cost columns) require `reports.view`/`costs.view`. Their reads are not audited.
- `appContext` getters (`getSales()`, …) return the guarded services, which is what the UI uses. Raw `create*Service` stay internal (tests and composition).

## PINs and sign-in
- PINs are 4 to 8 digits. The hash is PBKDF2-SHA256 through WebCrypto with a 16-byte random salt and 120k iterations. The comparison is constant-time.
- After 5 wrong PINs the user is locked for 30 s, doubling with each further failure (max 15 min). The lock is stored in the DB.
- The lock screen shows active users (name and role) and a PIN pad. Sign-in, sign-out and failed attempts are audited.
- The app locks on cold start and after 5 minutes in the background (when users are on). A "قفل / تعویض کاربر" action is in the header menu (More page).
- Turning users on (owner): More → «کاربران و دسترسی‌ها» → create the owner with a PIN, then add others. Turning users off again requires the owner and deactivates all other users.

## UI
- `pages/UsersPage.tsx` (users.manage): list, add, change role, reset PIN, deactivate.
- `pages/AuditLogPage.tsx` (audit.view): newest first, filter by user and action group, Jalali time. Paged by 50.
- `hooks/useCan(permission)` hides or disables buttons (cancel, cost/profit, reports tab content, restore, settings).
- Forbidden errors from services show as a Persian toast. The page does not crash.

## Tests
- Unit tests:
  - The permission matrix.
  - authorize: single-user, auth_required, forbidden, a deactivated user mid-session.
  - Guarded services: a forbidden call leaves no data and no audit row; an allowed call writes exactly one audit row in the same transaction (rollback leaves neither).
  - The last-owner trigger. Audit immutability. PIN hash and verify; lockout.
  - Dump/restore includes users and audit.
- e2e (`scripts/e2e-stage4.mjs`, both themes):
  - Enable users and create a seller.
  - As the seller: the sale works; cancel is hidden and blocked; reports are hidden.
  - Lock and switch to the owner. The audit log shows the seller's sale and sign-ins.
  - Wrong-PIN lockout message.
- The device matrix includes stage4.

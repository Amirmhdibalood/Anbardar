# v1.5.0: login options, password recovery, fiscal periods (stage 5)

## A. Login
- **Remember the last user:** only the user id is kept, in localStorage under `anbardar.lastUser.v1`. The PIN is never stored anywhere except as a PBKDF2 hash in `users`.
- **Turning login off:** setting `login_required='0'`.
  - Only the owner can do this, and the owner's PIN is verified first. Turning it back on is allowed in the same way.
  - While login is off, `authz.currentActor()` acts as the **first active owner**, under that owner's own name. The audit log therefore still records a real name.
  - The users stay in place, and turning login back on restores the previous state.
  - Audit actions: `auth.login_off` and `auth.login_on`.
- **Forgot password (two security questions):** table `user_recovery` (one row per user).
  - Each user has two questions (free text) and two answers.
  - The answers are hashed with PBKDF2 and their own salt, after this normalization:
    - trim and collapse whitespace; ZWNJ becomes a space;
    - Arabic ي and ك become Persian ی and ک; ة becomes ه; Arabic diacritics are removed;
    - Persian and Arabic digits become Latin digits; everything is lowercased.
  - Wrong answers are locked out on the same scale as wrong PINs (5 tries, then 30 s, doubling, up to 15 min), with a counter separate from the PIN counter.
  - Correct answers, then a new PIN, then sign-in.
  - Audit actions: `auth.recover`, `auth.recover_fail` and `user.recovery`.
  - Setting or changing the questions always needs **that user's current PIN**. Right after a PIN is created or changed, the PIN is still at hand.
  - After a PIN is created or changed, the app explains this and takes the user to set up the questions. They can skip, with a warning.

## B. Fiscal periods
- Table `fiscal_periods`:
  - Columns: `id`, `name`, `start_day` and `end_day` (Jalali `YYYY-MM-DD`, both inclusive), and `start_at` and `end_at` (ISO, `end_at` exclusive, local midnight), plus `status` (`open`/`closed`), `closed_at` and `closed_by`.
  - Periods never overlap. The default suggestion runs from 1 Farvardin to the last day of Esfand.
- **Lock:** a document whose date falls inside a closed period cannot be created, voided or back-dated into it.
  - This is enforced in the secured service layer (`guard()`), before the raw service runs. Each guarded write rule declares how its document date(s) are found: the input date or now for creates, and the stored document date for voids.
  - It applies to sales, purchases, returns, transfers, money documents, cheque actions, expenses and stock adjustments.
  - Error (Persian): «دوره مالی … بسته است؛ سند با تاریخ داخل آن ثبت یا ابطال نمی‌شود.»
- **Close, in order:** a period can be closed only after it has ended, and only when no earlier period is still open. Closing writes a snapshot of balances as of `end_at` into `fiscal_balances`:
  - party balances (the same effects as the ledger, filtered by date);
  - stock per (product, warehouse);
  - FIFO layers with the remaining quantity and value as of `end_at`;
  - cash = cash receipts − cash payments − expenses.

  Before closing, stock is checked against the sum of the layers.

  The ledgers stay continuous. **No synthetic opening documents are created**, so nothing is counted twice. The snapshot is the carried-forward opening of the next period, shown on the period page and usable by reports.
- **Reopen:** owner only, after a confirmation step, and only for the latest closed period (reverse order). Reopening deletes that period's snapshot.
- Audit actions: `fiscal.create`, `fiscal.close` and `fiscal.reopen`.
- Permission: `fiscal.manage` (owner only).
- Reports: each defined fiscal period appears as a period chip, which applies a custom range.
- **Migration 010** uses `CREATE … IF NOT EXISTS` and is tested on an upgrade from a v1.4.0 database that already holds data.

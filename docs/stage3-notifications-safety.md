# Stage 3 (v1.3.0): in-app notifications and data safety

The scope is deliberately tight. There are no OS or push notifications, no background work, no new permissions, and no new npm dependencies.

## 1. In-app notification center
- **Source = live data, computed on demand** (`services/notificationService.ts`). Nothing is stored except the read state.
  - Cheques: pending cheques with an active document and a due date within 7 days fall into 3 buckets: `overdue` (due before today), `today`, and `soon` (1–7 days).
  - Stock: active products with `quantity <= 0` are `out`. Products with a reorder point > 0 and `quantity <= reorder point` are `low`. Totals cover all warehouses, matching the Home low-stock stat.
- **Stable id = `kind:entity:bucket`** (e.g. `cheque:<id>:today`, `stock:<productId>:low`).
  - Regenerating dedupes by id (one item per cheque or product).
  - When the bucket changes (soon → today → overdue, or low → out), the id changes, so the item becomes unread again. That is intended: the situation got worse.
- **Read state** is persisted in the settings table (`notifications_read`, a JSON array of ids).
  - It is pruned to the ids that still exist on every compute, so it can't grow without bound.
  - It is stored in the DB rather than localStorage so a backup or restore carries it.
- **UI:**
  - A bell sits next to the lamp (top-left of Home and the root tabs) with an unread badge showing 9+ for more than 9.
  - `/notifications` lists items, newest-first by severity then date. Each item has a title, detail and date. Tapping marks it read and opens the related page (cheques → /cheques, stock → /stock?only=attention).
  - The page also offers «همه خوانده شد» and an empty state.
  - The badge refreshes on route change and on window focus.
- Critique: computing on every route change costs 2 small queries. That is fine for a single-shop dataset (the stock overview query is already used by Home).

## 2. Exit backup prompt and first-run warning
- `hasChangesSinceBackup()` compares MAX(updated_at, created_at) across the data tables with `last_backup_at`. It reports false when there is no user data yet (just the seed).
- **Home double-back exit:** if there are changes, a sheet asks «پشتیبان بگیرم؟» with پشتیبان و خروج / خروج بدون پشتیبان / ماندن. Back closes the sheet (it is a dialog). `decideBack` stays pure; the check happens in RootShell.
- **First-run warning:** a one-time card on Home explains that data lives only on this phone and links to the backup page. It is dismissed with a setting (`backup_intro_seen`). The existing stale-backup banner stays as is.

## 3. Idempotent submit
- **UI:** the submit handler is guarded by a ref (not only by state), so 2 taps in the same frame can't both run. The button is disabled while saving.
- **Request key:** every invoice, return and transfer form makes one `requestId` per form instance (money documents already had this).
- **DB guard:** migration 008 adds a nullable `request_id` with a UNIQUE index (NULLs allowed for old rows) to sales_invoices, purchase_invoices, sale_returns, purchase_returns and warehouse_transfers. The service returns the existing document when the same key comes again. That check runs inside the same transaction; the unique index is the last line of defence.

## 4. Invoice print and PDF export
- No dependency. The PDF is drawn on a canvas with the browser's own RTL shaping (`direction = 'rtl'`, the app font), then wrapped as JPEG pages in a minimal hand-written PDF 1.4 (DCTDecode image XObjects, A4).
  - Critique: the text is not selectable. That is accepted, because correct Persian shaping without a font-embedding library is the real goal.
- **Share:** on Android the PDF goes to Filesystem (Cache) and then Share (the system share sheet). On web it is a download.
- **Print-friendly layout:** `/sales/:id/print` and `/purchases/:id/print` are plain white A4 pages with `@media print` rules. The print button calls `window.print()`, which is meaningful on web/desktop; Android uses the PDF share.

## 5. Help icon
- `components/HelpTip.tsx` is a small (?) button that opens a sheet with a short explanation.
- It is used next to: price mode, landed charges, the cheque fields, and the notification page.

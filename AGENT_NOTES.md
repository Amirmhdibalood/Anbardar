# AGENT_NOTES — Anbardar (v1.0.1)

## Stack
React 19 + TypeScript 6 + Vite 8, Capacitor 8 (Android, minSdk 26 / target 36), SQLite via @capacitor-community/sqlite (sql.js on web), react-router 7, CSS Modules, Vazirmatn font bundled. Offline (INTERNET permission removed), allowBackup=false.

## Structure
src/{components,layouts,pages,services,repositories/sqlite,database/migrations,models,styles,utils}, tests/*.test.ts (node --test), scripts/screenshots.mjs (puppeteer), scripts/sizes-check.mjs (full-screen check at 4 sizes), android/.

## Build (box)
. ~/tools/env.sh   # Node 22, Android SDK at ~/tools/android-sdk, JDK 21 system
npm ci && npm run build && npx cap sync android
cd android && ./gradlew assembleDebug        # app/build/outputs/apk/debug
./gradlew assembleRelease                    # unsigned; then zipalign + apksigner (keystore outside repo, alias amb632, PKCS12: key pass = store pass)
Size check: npx vite preview --port 4173 & node scripts/sizes-check.mjs

## v1.0.1 full-screen fix
- layouts.module.css: removed desktop-preview `max-width:640px; margin:0 auto` on .app (empty bands on tablets/landscape); content padding centers on wide screens instead.
- global.css: html/body/#root 100dvh (with 100% fallback), html background = app bg.
- Sheet: max-height in dvh minus safe-top.
- styles.xml + colors.xml: windowBackground = #0F0F14. On Android WebView < 140 Capacitor 8 SystemBars pads the decor view natively by system-bar insets; with background @null those bands showed as empty white/black areas top and bottom.
- capacitor.config.ts: SystemBars.insetsHandling 'css' explicit.

## TODOs
- Verify on a real device with old (<140) and new WebView; light theme still shows dark window bg in the padded bars on old WebView (could set window bg from native per theme).
- Landscape side cutouts: safe-area-inset-left/right not applied.
- package.json engines node>=22.
- Future: Myket billing + trial (see conversation), invoice-level discount UI.

## Stage 1 (v1.1.0): parties and money
- Design and decisions: `docs/parties-and-money.md`. Schema: `src/database/migrations/006_parties_money.ts`.
- Service: `src/services/moneyService.ts`. Repo: `src/repositories/sqlite/moneyRepository.ts`.
- UI: `src/pages/parties/PartiesPage.tsx`, `PartyLedgerPage`, `MoneyFormPage`, `MoneyListPage`, `MoneyDetailPage`, `BalancesPage`, `components/invoice/PaymentSection.tsx` and `InvoicePaymentCard.tsx`.
- Routes: `/more/parties`. `/more/customers` and `/more/suppliers` are the same list, pre-filtered. Also `/parties/:id`, `/money`, `/money/new?kind=&party=&invoice=`, `/money/:id` and `/balances`.
- E2E: `node scripts/e2e-money.mjs` with `npx vite preview --port 4173 --host 0.0.0.0`. Some scripts use 127.0.0.1, so bind all interfaces.
- e2e-purchases section 12 was rewritten for the new parties UX: a row opens the ledger, and edit/delete is under the edit icon.

## v1.1.1: insets, icon, intro
- Insets: the window is edge-to-edge on all APIs (`MainActivity`). The CSS uses `--safe-top/--safe-bottom` = `var(--safe-area-inset-*, env(...))` exactly once (BottomNav, sheet, form footers, `.content` top). Sticky footers must offset `--content-pad-bottom`. Check with `node scripts/insets-check.mjs`.
- To regenerate icons: `python3 scratch/make_icons.py` (writes the res/mipmap-* PNGs and the public/ icons).
- Intro: in `index.html`. E2E: `scripts/e2e-intro.mjs`. Final-frame screenshot: `screenshots/intro-final.png`.

## v1.1.2: Picker, keyboard, back button
- `components/Picker.tsx` replaces every native `<select>` (and the settings radio groups). Test helpers are in `scripts/lib/picker.mjs` (pick/pickAdd/pickedText/pickerOptions). E2E: `scripts/e2e-picker.mjs`.
- The navy "انباردار" bar and the doubled keyboard resize had one root cause. `EdgeToEdge.enable` ran before `super.onCreate`, so the window decor was built with the launch theme (which had an android:background and an ActionBar). Edge-to-edge is now applied AFTER super.onCreate, AppTheme is `DayNight.NoActionBar`, and the manifest has `adjustResize`.
- Keyboard handling, one mechanism only:
  - Native: Capacitor SystemBars pads the WebView by the IME inset and sets `--safe-area-inset-bottom` to 0.
  - Fallback for an overlaying keyboard: `navigation/RootShell.tsx` sets `--kb-inset` = innerHeight − visualViewport.height (0 when the WebView was resized), plus `html.kb-open`, which drops `--safe-bottom`.
  - The focused field is scrolled to the centre. `.content` has scroll-padding so nothing hides under the sticky footer.
- Back button:
  - The logic is `navigation/backButton.ts` (`decideBack`, unit-tested).
  - It listens to `@capacitor/app` backButton, and also to the `anbardar:back` window event for tests. On web, exit fires `anbardar:exit`.
  - The header back button has `data-back-button`. The hardware button clicks it, so the same leave-confirm (`hooks/useLeaveConfirm.tsx`) applies.
  - Its side is the single constant `config/ui.ts` BACK_BUTTON_SIDE='left'.
- Checks: `node scripts/keyboard-back-check.mjs` (fake visualViewport via `scripts/lib/device.mjs`).
- Device matrix: `scripts/walkthrough.sh`. Every e2e suite honours `DEVICE=360x780 INSETS=3btn|gesture KB=open`.
- Never `git checkout` a file with uncommitted work.

## v1.1.3: appearance
- Theme: `models/settings.ts` (ACCENTS, accentDark/accentLight) and `config/themes.ts` (ACCENT_META, FREE_ACCENTS, PREMIUM_ACCENTS_LOCKED).
- Applying it: `services/themeService.ts` applyTheme(mode, accent) and withThemeTransition. CSS tokens live in `styles/themes.css` (`[data-theme][data-accent]`).
- UI: `pages/settings/AppearanceSettings.tsx` and `components/ThemeLamp.tsx`. PageHeader renders the lamp when a page has no back button.

## v1.2.0: stage 2 (units, price mode, landed, cheques)
- Math: `utils/invoiceMath.ts` (prepareInvoice with `factorOf` + `landed`; allocateExact; toBaseQuantity; unitPriceFromTotal).
- Line/unit checks: `services/lineUnits.ts` (checkLines, factorFor, unitLabel). The client never sends the factor; the server resolves it from `product.subUnits`.
- `InvoiceItemInput.quantity` is in the line unit; `InvoiceItem.quantity` is always base (`unitQuantity` / `unitFactor` / `unitId` hold the entered unit).
- Cheques: `services/chequeService.ts` (clear / bounce / spend, list / dueUntil), plus `moneyService.create({ method: 'cheque', cheque })`. UI: `components/ChequeActions.tsx` and `pages/ChequesPage.tsx`.
- DB triggers referencing the items tables must be dropped/recreated around a table rebuild (sqlite rename check).

## v1.3.0: stage 3 (notifications, backup safety, idempotent submit, PDF/print)
- Notifications: `services/notificationService.ts` computes items on demand. Ids are `cheque:<id>:overdue|today|soon` and `stock:<pid>:out|low`, so a bucket change makes the item unread again. Read ids live in setting `notifications_read` and are pruned to live ids. UI pieces are `components/NotificationBell.tsx` + `TopTools.tsx` (bell next to the lamp) and `pages/NotificationsPage.tsx`. `pingNotifications()` refreshes the badge.
- Backup: `services/backupChanges.ts` provides `hasChangesSinceBackup`. When there has never been a backup, the baseline is MIN(schema_migrations.applied_at) + 10s, so seed data is ignored. The exit sheet lives in RootShell. The first-run Home card is controlled by `backup_intro_seen`.
- Idempotency: migration 008 adds `request_id` with a partial UNIQUE index and a lock trigger. `services/requestKey.ts` has find/claim/newRequestId. Forms use a ref lock plus `useRef(newRequestId())`.
- PDF: `utils/pdf.ts` (minimal PDF 1.4, JPEG pages) and `services/invoiceExport.ts` (canvas RTL drawing; Android Filesystem + Share; web download). The print page is `pages/InvoicePrintPage.tsx` with `@media print`.
- `HelpTip` (?) component opens a Sheet.
- e2e: `scripts/e2e-stage3.mjs`.

## v1.3.1: floating banners
- `components/FloatingBanners.tsx` (Home only): fixed overlay with no layout shift, at most 2 visible plus a queue. Sticky when severity >= 1, otherwise auto-hides after 6 s. Dismiss via X or a swipe (horizontal > 70px, or up > 40px). Respects reduced motion.
- Once-only: setting `notifications_shown` is set when a banner is displayed and pruned to live ids. Backup intro and stale-backup are notification kinds (`backup:intro`, `backup:stale:<last>`).
- Out-of-stock notifications only for products with reorderPoint > 0.
- e2e tests that tap Home cards must close the banners first.

## v1.4.0: stage 4 (users, roles, audit)
- Design: docs/stage4-users-roles-audit.md. Migration 009 adds users + audit_log; audit_log is append-only, and the last-owner trigger applies.
- Enforcement: `services/secured.ts` guard() — authorize, then the raw service on the same tx, then audit, all in one transaction. Unlisted methods are rejected (secure by default; a test checks coverage). appContext getters return secured services.
- `services/authz.ts` (single-user mode = implicit owner, audited as «مالک»), `services/session.ts` (actor + usersOn store), `services/userService.ts` (PBKDF2 PINs, lockout 5 tries → 30 s doubling, audit list), `services/pin.ts`.
- settings: appearance keys are free; others need settings.manage. Backup create/restore are audited; restore clears the session.
- UI: `components/LockScreen.tsx` (RootShell gate; auto-lock after 5 min in background), `pages/UsersPage.tsx`, `pages/AuditLogPage.tsx`, `hooks/useSession.ts` (useCan for hiding only).

## v1.5.0: login options, recovery, fiscal periods (stage 5)
- Design: `docs/stage5-fiscal-periods.md`.
- Migration 010 (`010_recovery_fiscal.ts`, all IF NOT EXISTS) creates `user_recovery`, `fiscal_periods` (no-overlap trigger, closed rows can't be deleted) and `fiscal_balances`.
- `validateDump` requires these tables for v>=10.
- **Login off:**
  - Setting `login_required='0'`.
  - `authz.currentActor` falls back to `defaultOwner()` when no session exists.
  - RootShell sets the actor to the owner on start, and the auto-lock is skipped.
  - Session snapshot has `loginOn`. `userService.setLoginRequired(on, ownerPin)`.
- **Recovery:**
  - `userService.setRecovery(userId, currentPin, {q1,a1,q2,a2})`, `recoveryQuestions(id)` (public), `recover(id, {a1,a2}, newPin)`.
  - The shared `checkPin` (with lockout) is used by login, login-off and setRecovery.
  - Answers go through `utils/answer.normalizeAnswer`.
- Last user: `session.rememberLastUser` is called from setActor (localStorage `anbardar.lastUser.v1`, id only).
- **Fiscal lock:**
  - `Rule.dates(args, tx)` in `secured.ts`. guard() calls `assertDatesOpen(tx, [now, ...dates])` before the raw service runs.
  - New write rules MUST declare `dates`.
  - `createFiscalService` authorizes `fiscal.manage` (owner only) itself.
- e2e: `scripts/e2e-stage5.mjs` (wait ~900ms before `page.reload()`, because sql.js persistence is debounced by 200ms). stage4 e2e skips the new recovery sheet.
- Money form: `?lock=1&party=` hides the direction control and locks the party (`money-direction-locked`, `data-kind`). It is used from the PartyLedger buttons (filtered by balance sign) and from InvoicePaymentCard.
- The general form calls `balanceOf` when a party is picked to choose the default direction (`money-direction-hint`), until the user changes the direction manually.

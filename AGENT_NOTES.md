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

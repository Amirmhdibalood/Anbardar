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

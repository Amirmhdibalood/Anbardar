# انباردار

نرم‌افزار ساده، امن و **آفلاین** برای مدیریت خرید، فروش و انبار فروشگاه‌های کوچک.
نسخه اول برای **Android** است، اما منطق برنامه طوری جدا شده که بعداً Web / iOS / Windows هم ساخته شود.

> وضعیت فعلی: **Phase 1–10** تمام — نسخهٔ ۱٫۰٫۰. پیشرفت در `PROGRESS.md`؛ یادداشت انتشار در `RELEASE_NOTES.md`.

## تکنولوژی

React 19 · TypeScript · Vite · React Router (HashRouter) · Capacitor 8 (Android) · SQLite (`@capacitor-community/sqlite` روی اندروید، `sql.js` در وب/تست) · CSS Modules + متغیرهای CSS · فونت Vazirmatn (محلی، داخل برنامه).
Material UI عمداً استفاده نشده؛ کامپوننت‌ها سبک و اختصاصی‌اند.

## ساختار پروژه

```text
src/
├── components/    کامپوننت‌های کوچک و قابل‌استفاده‌مجدد (Icon, Sheet, BottomNav, EmptyState, ErrorBoundary, ...)
├── pages/         صفحه‌ها؛ فقط نمایش و اتصال به hook/service، بدون منطق کسب‌وکار
├── layouts/       چیدمان‌ها (AppLayout با نوار پایین، FullScreenLayout برای فرم‌ها)
├── routes/        تعریف مسیرها (بارگذاری تنبل صفحه‌ها)
├── models/        تایپ‌ها و مدل‌های داده (Money = عدد صحیح، BaseEntity، AppSettings)
├── repositories/  رابط‌ها (types.ts) + پیاده‌سازی SQLite در sqlite/ — قابل تعویض برای Web / Windows
├── database/      درایورهای SQLite، تراکنش، Migration (با Snapshot ایمنی)، Seed، تبدیل خطاها به پیام فارسی
├── validation/    اعتبارسنجی و پاک‌سازی ورودی (ارقام فارسی، «ي/ك» عربی، محدوده اعداد)
├── services/      منطق برنامه (راه‌اندازی، تنظیمات، تم، اطلاعات پایه، موجودی) — UI فقط این‌ها را صدا می‌زند
├── hooks/         hookهای React (useSettings, useMoney, useDashboard)
├── utils/         توابع کمکی خالص (ارقام فارسی، تاریخ شمسی، formatMoney، newId، logger)
├── styles/        فونت، تم‌ها (متغیرهای CSS) و استایل سراسری
└── assets/        فونت و منابع ثابت
tests/                    تست‌های یکپارچه دیتابیس (Node + sql.js)
scripts/screenshots.mjs   تست ظاهری و دیتابیس در Chrome بدون رابط + بررسی خطاهای کنسول
android/                  پروژه Android (Capacitor)
```

### اصول معماری

- **مبلغ همیشه عدد صحیح و به تومان** است (`utils/money.ts`). واحد پول دیگری وجود ندارد و ستون واحد پول هم در دیتابیس نیست.
- **شناسه‌ها UUID (نسخه ۷)** هستند: `utils/id.ts → newId()`.
- **UI منطق ندارد**: صفحه‌ها → hook → service → repository (interface).
- **تم**: `data-theme="dark|light"` روی `<html>` و رنگ‌ها فقط با متغیر CSS (`styles/themes.css`). گزینه‌ها: سیستم / تیره (پیش‌فرض) / روشن. در جدول `settings` دیتابیس ذخیره می‌شود؛ یک کش کوچک در `localStorage` فقط برای جلوگیری از چشمک تم هنگام شروع است. مقدار قدیمی Phase 1 یک‌بار به دیتابیس منتقل می‌شود.
- **خطاها**: `ErrorBoundary` و `RouteErrorPage` فقط پیام فارسی ساده نشان می‌دهند؛ جزئیات فنی فقط در کنسول (`utils/logger.ts`) ثبت می‌شود.
- **امنیت Android**: `allowBackup=false` و `data_extraction_rules` برای جلوگیری از خروج داده از مسیر Backup خودکار گوگل؛ `usesCleartextTraffic=false`؛ مجوز `INTERNET` با `tools:node="remove"` حذف می‌شود (برنامه کاملاً آفلاین است). بیومتریک افزونه SQLite هم حذف شده چون استفاده نمی‌شود.


## تعداد، واحد و تخفیف (Migration 002)

- **تعداد = هزارم واحد (عدد صحیح)**: ۱٫۵ کیلو در دیتابیس `1500` است؛ هیچ ستون REAL/float در Schema نیست. ستون‌ها: `products.reorder_point`، `stock_movements.quantity_delta`، `warehouse_stock.quantity`، `*_items.quantity`. توابع نمایش/تبدیل در `utils/quantity.ts`.
- **واحدها** در جدول `units` (عدد، کیلو، گرم، لیتر، متر، بسته، کارتن، جفت، دست + واحد سفارشی کاربر). هر واحد `allows_fraction` دارد؛ واحد بدون اعشار فقط تعداد صحیح می‌پذیرد (هم در سرویس هم با Trigger دیتابیس). واحد کالا بعد از اولین تراکنش قفل می‌شود.
- **مبلغ ردیف** = `round(تعداد(هزارم) × قیمت ÷ ۱۰۰۰)` (نیم به بالا) − تخفیف ردیف، با عدد صحیح؛ همان فرمول در `CHECK` دیتابیس و در `lineGross` (BigInt) است.
- **تخفیف فاکتور**: ستون‌های `subtotal_amount`، `discount` و `total_amount` با `CHECK (total = subtotal − discount)`؛ تطابق subtotal با جمع ردیف‌ها را مخزن تضمین و `findTotalMismatches()` بررسی می‌کند (در UI هنوز نیست).
- Migration با بازسازی جدول‌ها (جدید بساز ← کپی با ×۱۰۰۰ ← حذف ← تغییر نام) انجام می‌شود، پیش از آن Snapshot گرفته می‌شود و پس از آن `foreign_key_check` اجرا می‌شود. روی sql.js و SQLite 3.46 (CLI) آزمایش شده است.

## دیتابیس (Phase 2)

### اصول
- **SQLite محلی**: روی اندروید با `@capacitor-community/sqlite` (نسخه ۸، سازگار با Capacitor 8)، در مرورگر/تست با `sql.js` (همان SQL و همان Migrationها). درایور فقط در `database/open.ts` انتخاب می‌شود.
- شناسه‌ها UUID v7 متنی؛ مبلغ و تعداد `INTEGER`؛ تاریخ‌ها ISO 8601 (UTC) متنی. همه جدول‌های کسب‌وکار: `created_at`, `updated_at`, `is_active`, `created_by` (خالی در حالت تک‌کاربره).
- **کلیدهای خارجی روشن** و بدون `ON DELETE` (رفتار پیش‌فرض = جلوگیری). حذف واقعی فقط برای ردیف‌های استفاده‌نشده؛ بقیه باید غیرفعال شوند. (عمداً `ON DELETE` نداریم چون افزونه اندروید دستورهای DELETE را بر اساس آن بازنویسی می‌کند.)
- **موجودی منفی ممنوع** است (تنظیم `allow_negative_stock`) — هم در سرویس با پیام فارسی، هم با Trigger در دیتابیس.
- **سند ویرایش‌پذیر نیست**: ردیف‌های فاکتور و دفتر حرکت با Trigger غیرقابل ویرایش/حذف‌اند؛ تنها تغییر مجاز ابطال (`status = 'cancelled'`) است.

### جدول‌ها
| جدول | کاربرد |
|---|---|
| `product_groups`, `warehouses`, `customers`, `suppliers` | اطلاعات پایه (نام یکتا برای گروه و انبار؛ «مشتری نقدی» سیستمی و محافظت‌شده) |
| `products` | کد یکتا، گروه (اجباری)، `unit`، `sub_unit` + `conversion_ratio` (فعلاً بلااستفاده)، `reorder_point`، قیمت فروش پیشنهادی (قیمت خرید فقط روی ردیف فاکتور خرید) |
| `stock_movements` | **دفتر حرکت** (منبع حقیقت): کالا، انبار، تغییر تعداد، نوع، سند مرجع، تاریخ — فقط افزودنی |
| `warehouse_stock` | **کش** سریع موجودی هر (انبار، کالا)؛ همیشه باید با جمع دفتر برابر باشد (`verifyConsistency` / `rebuildCache`) |
| `sales_invoices` + `sales_items`, `purchase_invoices` + `purchase_items` | فاکتورها؛ شماره خودکار یکتا، `status` (active/cancelled)، مبلغ کل، مرجع اختیاری |
| `payments` | دریافت/پرداخت بابت یک فاکتور (کلید خارجی واقعی به فروش یا خرید) |
| `expenses` | هزینه‌های جاری (اجاره، حقوق، …) — جدا از بهای کالای فروش‌رفته |
| `sale_returns` / `purchase_returns` + اقلام | برگشت بخشی از فاکتور فروش/خرید |
| `warehouse_transfers` + اقلام | انتقال کالا بین انبارها با حفظ بها |
| `settings`, `sequences`, `schema_migrations` | تنظیمات، شمارنده‌ها (شماره فاکتور و کد کالا)، تاریخچه Migration |

### Migration
- فهرست در `src/database/migrations/index.ts`؛ **فقط به انتهای فهرست اضافه کنید** و Migration قدیمی را ویرایش نکنید (Checksum بررسی می‌شود).
- پیش از Migration روی دیتابیس دارای داده، یک **Snapshot کامل** (JSON) ذخیره می‌شود (اندروید: پوشه خصوصی برنامه؛ وب: IndexedDB؛ ۵ نسخه آخر نگه‌داری می‌شود). اگر Snapshot ذخیره نشود، Migration شروع نمی‌شود.
- هر Migration در یک تراکنش اجرا می‌شود و با هر خطا کاملاً Rollback می‌شود. دیتابیسِ ساخته‌شده با نسخه جدیدتر برنامه دست‌نخورده می‌ماند.
- ساخت Migration جدید: فایل `00N_name.ts` با `version: N` و آرایه‌ای از **دستورهای SQL تکی** بسازید و به فهرست اضافه کنید.

### خطاها
همه خطاهای دیتابیس به `AppError` با پیام فارسی تبدیل می‌شوند (`database/errorMapper.ts`)؛ UI فقط `toUserMessage(error)` را نشان می‌دهد.

### تست دیتابیس
```bash
npm test    # ۳۸ تست یکپارچه: Seed، Migration، Rollback، کلید خارجی، یکتایی، سازگاری دفتر و کش، اعتبارسنجی
```

## پیش‌نیازها

| ابزار | نسخه |
|---|---|
| Node.js | **۲۲ یا بالاتر** (CLI نسخه ۸ Capacitor این را لازم دارد) |
| JDK | **۲۱** (برای ساخت Android) |
| Android SDK | platform 36 و build-tools 36 (Android Studio یا command-line tools) |

## اجرا

```bash
npm install
npm run dev          # اجرای توسعه روی http://localhost:5173
npm run typecheck    # بررسی TypeScript
npm run lint         # ESLint (بدون هشدار)
npm test             # تست‌های دیتابیس
npm run build        # tsc + ساخت نسخه وب در dist/
npm run preview      # نمایش نسخه build
npm run screenshots  # (با preview روشن روی پورت ۴۱۷۳) اسکرین‌شات + تست دودی
```

## ساخت Android

```bash
export JAVA_HOME=/path/to/jdk-21
export ANDROID_HOME=/path/to/android-sdk

npm run build
npx cap sync android          # کپی dist به پروژه Android
cd android
./gradlew assembleDebug       # خروجی: android/app/build/outputs/apk/debug/app-debug.apk
```

برای باز کردن در Android Studio: `npx cap open android`.

حداقل نسخه اندروید: **۸ (API 26)**.

## پیشنهادهای نسخه‌های بعد

در گزارش Phase 1 فهرست شده‌اند و بدون تأیید وارد MVP نمی‌شوند.


## انتشار Android (Release)

1. نسخه را در `package.json` (و در صورت نیاز `versionCode` / `versionName` در `android/app/build.gradle`) بالا ببرید.
2. `npm run build && npx cap sync android`
3. یک **keystore اختصاصی** بسازید و رمزها را فقط نزد خود نگه دارید (هرگز در git نگذارید):
   ```bash
   keytool -genkeypair -v -keystore anbardar-release.jks -keyalg RSA -keysize 2048 -validity 10000 -alias anbardar
   ```
4. در `android/app` با `assembleRelease` بسازید و با `apksigner` امضا و تأیید کنید (یا از Android Studio → Generate Signed Bundle/APK).
5. قبل از انتشار فروشگاهی: نصب روی دستگاه واقعی، پشتیبان‌گیری و بازیابی آزمایشی، و مرور `RELEASE_NOTES.md`.
6. فروشگاه‌ها (مایکت / بازار / …) ممکن است به‌خاطر امضای ناشناس هشدار «برنامه تأییدنشده» نشان دهند؛ برای کاربر توضیح دهید برنامه آفلاین است و داده را به سرور نمی‌فرستد.

یادداشت انتشار کاربرپسند: [`RELEASE_NOTES.md`](./RELEASE_NOTES.md).


## عملکرد
- مسیرهای غیراصلی با `React.lazy` بارگذاری می‌شوند؛ باندل اصلی سبک می‌ماند.
- موجودی و گزارش‌ها از کش SQLite و ایندکس‌ها می‌خوانند؛ مقدارها عدد صحیح‌اند (بدون float).
- برای فروشگاه‌های کوچک (چند هزار کالا / چند ده هزار حرکت) طراحی شده است؛ صفحه‌بندی فهرست کالا ۱۰۰تایی است.

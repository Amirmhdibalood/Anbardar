# PROGRESS — انباردار

آخرین به‌روزرسانی: فاز ۱۰ تمام شد — نسخه ۱٫۰٫۰.

## QUESTIONS FOR USER
(none open)


## وضعیت فازها
| فاز | وضعیت |
|---|---|
| 1 زیرساخت | ✅ |
| 2 دیتابیس | ✅ |
| 3 کالا و گروه کالا (+ تعداد اعشاری، واحدها، تخفیف فاکتور در DB) | ✅ |
| 4 انبار و موجودی | ✅ |
| 5 خرید (+ Migration 003 لایه‌های بها) | ✅ |
| 6 فروش (+ ماشین‌حساب قیمت، تنظیمات بها) | ✅ |
| 7 Backup/Restore | ✅ |
| 8 گزارش‌ها + هزینه + هشدار | ✅ |
| 9 برگشت خرید/فروش، انتقال | ✅ |
| 10 Polish | ✅ |

## طرح لایه‌های بها (تأییدشده — Oct 5, 2026)
- **Migration 003**:
  - حذف ستون `products.purchase_price` با بازسازی جدول و Triggerها (همان الگوی Migration 002).
  - جدول `cost_lots` (شناسه، کالا، انبار، `source_type`: purchase / opening / adjustment / sale_return / transfer، شناسه ردیف منبع، تاریخ لایه، `quantity`، `remaining`، `total_cost` به‌صورت تومان صحیح؛ بهای واحد مشتق است).
  - جدول `lot_allocations` (لایه، نوع مصرف‌کننده: sale / adjustment / purchase_return / transfer، شناسه ردیف مصرف‌کننده، تعداد، `cost_amount`، و وضعیت برگشت برای ابطال).
  - روی `sales_items` سه ستون بها ذخیره می‌شود: `cost_fifo`، `cost_average`، `cost_last`. با عوض کردن روش در تنظیمات، گزارش‌ها فوراً و بدون محاسبه دوباره درست می‌شوند و داده خام (لایه + تخصیص) هم برای محاسبه هر روش دیگری کافی است.
  - تنظیمات `cost_method` (fifo پیش‌فرض / average / last) و `sale_price_mode` (manual / last_sale پیش‌فرض / markup) و `markup_percent` سراسری + درصد اختیاری روی گروه کالا (ستون جدید `product_groups.markup_percent`).
  - تأمین‌کننده سیستمی «متفرقه» با شناسه ثابت و Trigger حفاظت، مثل «مشتری نقدی».
- **قاعده ثابت (Invariant)** برای هر کالا در هر انبار: مجموع `remaining` لایه‌ها = موجودی کش = جمع دفتر حرکت. یک تست و یک ابزار بررسی سلامت آن را کنترل می‌کنند.
- **بهای لایه خرید** = مبلغ خالص ردیف منهای سهم تخفیف کل فاکتور (تقسیم به نسبت مبلغ ردیف‌ها). یعنی بها همان چیزی است که واقعاً پرداخت شده. روش «آخرین قیمت خرید» هم از همین بهای خالص استفاده می‌کند. پیش‌فرض قیمت در فرم خرید جدید، قیمت واحد ردیف آخرین خرید (قبل از تخفیف) است.
- **FIFO**: مصرف از لایه‌ها به ترتیب تاریخ لایه (تاریخ فاکتور، حتی برای فاکتورهای عقب‌تاریخ‌خورده) و بعد زمان ثبت. سهم بها با گرد کردن محاسبه می‌شود و آخرین برداشت از هر لایه باقی‌مانده را برمی‌دارد تا جمع بها دقیقاً برابر بهای لایه شود.
- **ابطال فروش**: تخصیص‌ها به همان لایه‌ها برمی‌گردد.
- **انتقال بین انبارها (فاز ۹)**: لایه‌ها را با همان بها جابه‌جا می‌کند.
- **داده آزمایشی موجود**: موجودی‌ای که قبل از این تغییر وارد شده، در Migration یک لایه «opening» می‌گیرد با بهای واحد = همان «قیمت خرید» قدیمی کالا (یا صفر)، و بعد ستون حذف می‌شود.
- **ماشین‌حساب قیمت**: در **فاز ۶** ساخته می‌شود (کنار پیشنهاد قیمت فروش؛ از منوی «بیشتر» و از داخل فرم فروش در دسترس است).

## فاز ۸ — انجام‌شده (هزینه عملیاتی + گزارش‌ها + هشدار موجودی)
**هزینه**: جدول `expenses` (Migration 004) با دسته‌های ثابت اجاره / حقوق / قبوض / حمل‌ونقل / سایر. مبلغ تومان صحیح، تاریخ شمسی، یادداشت اختیاری. سند تغییرناپذیر؛ فقط ابطال. صفحه `/more/expenses` + میانبر در برگه «ثبت». داخل Dump پشتیبان هم هست.
**گزارش‌ها** (`/reports`): بازه شمسی (امروز / این ماه / ماه قبل / امسال / دلخواه).
- سود و زیان: درآمد فروش، بهای تمام‌شده کالا (COGS از ستون‌های ذخیره‌شده با روش تنظیمات)، کسری/ضایعات/اضافه شمارش، هزینه عملیاتی جدا، سود ناخالص و خالص + تفکیک دسته هزینه.
- نمودار دایره‌ای درآمد در برابر هزینه نقدی (فروش / خرید کالا / هزینه عملیاتی) با برچسب واضح.
- سود هر کالا: بها (خاکستری)، فروش (سبز)، سود کنارشان.
- گزارش فروش و خرید با فیلتر تاریخ + مشتری/تأمین‌کننده + انبار.
- هشدار موجودی: ناموجود و زیر نقطه سفارش (لینک از خانه به `/stock?f=low` همچنان فعال).
**موتور گزارش**: `reportRepository` + `reportService`؛ بازه با `utils/period.ts` (from شامل، to انحصاری).

## تست‌های فاز ۸ (همه سبز)
- `tsc` ✅ · `eslint --max-warnings 0` ✅ · `npm test`: **95/95** ✅ (جدید: `tests/expenses.test.ts`، `tests/reports.test.ts`)
- `vite build` ✅ · `e2e-reports` **۳۲/۳۲** ✅ — تیره و روشن، بدون خطای کنسول
- `cap sync android` ✅ · `assembleDebug` ✅
- اسکرین‌شات‌ها: `screenshots/phase8-*-{dark,light}.png` (expenses-empty، expenses-list، reports-summary، reports-products، reports-sales، reports-purchases، reports-alerts، more-with-expenses)

## فاز ۱۰ — انجام‌شده (Polish / امنیت / انتشار)
**امنیت**: حذف مجوز `INTERNET` با `tools:node="remove"`؛ `usesCleartextTraffic=false`؛ مرور `allowBackup` / `data_extraction_rules` / حذف بیومتریک. برنامه بدون شبکه، تبلیغات و حساب ابری.
**نسخه**: `package.json` → `1.0.0` (هم‌تراز با `versionName` اندروید).
**اسناد**: `RELEASE_NOTES.md` + بخش انتشار Android و عملکرد در README؛ نکته «آفلاین و امن» در راهنما.
**عملکرد**: مسیرهای تنبل قبلی حفظ شد؛ بدون وابستگی شبکه در زمان اجرا.

## تست‌های فاز ۱۰ (همه سبز)
- `tsc` ✅ · `eslint --max-warnings 0` ✅ · `npm test`: **99/99** ✅
- `vite build` ✅ · `e2e-polish` **۱۲/۱۲** ✅ · `e2e-returns` رگرسیون **۳۰/۳۰** ✅ — بدون خطای کنسول
- `cap sync android` ✅ · `assembleDebug` ✅ · Manifest نهایی بدون `INTERNET`
- اسکرین‌شات‌ها: `screenshots/phase10-*-{dark,light}.png`

## فاز ۹ — انجام‌شده (برگشت فروش/خرید + انتقال بین انبارها)
**Migration 005**: جداول `sale_returns` / `sale_return_items`، `purchase_returns` / `purchase_return_items`، `warehouse_transfers` / `warehouse_transfer_items` + شمارنده‌ها + Trigger تغییرناپذیری. `movement_type` برای برگشت‌ها جداست؛ `document_type` روی دفتر حرکت همان مقادیر قبلی را نگه می‌دارد.
**برگشت فروش**: از جزئیات فاکتور فعال؛ موجودی زیاد می‌شود و لایه جدید با بهای متناسب با همان فروش ساخته می‌شود (`sale_return` در LOT_CREATING).
**برگشت خرید**: ترجیح لایه همان خرید (`preferLotMovementId`)؛ اگر لایه کافی نبود از FIFO عادی.
**انتقال**: خروج از مبدأ + ورود به مقصد با همان بهای FIFO لایه‌ها؛ مسیر `/transfers` و فرم `/transfers/new`؛ میانبر در «ثبت جدید» و «بیشتر».
**UI**: دکمه‌های برگشت روی جزئیات فاکتور فروش/خرید؛ راهنما به‌روز شد.

## تست‌های فاز ۹ (همه سبز)
- `tsc` ✅ · `eslint --max-warnings 0` ✅ · `npm test`: **99/99** ✅ (جدید: `tests/returns.test.ts`)
- `vite build` ✅ · `e2e-returns` **۳۰/۳۰** ✅ — تیره و روشن، بدون خطای کنسول
- `cap sync android` ✅ · `assembleDebug` ✅
- اسکرین‌شات‌ها: `screenshots/phase9-*-{dark,light}.png` (sale/purchase return btn+form، transfers-empty، transfer-form/detail، more-with-transfers)

## فاز ۷ — انجام‌شده (پشتیبان‌گیری و بازیابی)
**Backup**: دکمه «دریافت نسخه پشتیبان» یک فایل JSON کامل (`anbardar-dump`، شامل Schema + همه جدول‌ها + `schemaVersion`) می‌سازد؛ در وب دانلود می‌شود و در اندروید با `@capacitor/share` برگه اشتراک سیستم باز می‌شود. زمان آخرین پشتیبان در تنظیمات ذخیره می‌شود.
**Restore**: انتخاب فایل → هشدار واضح → Snapshot ایمنی داخلی از وضعیت فعلی → جایگزینی کامل → اجرای Migration تا نسخه فعلی در صورت قدیمی‌بودن فایل → بررسی سلامت موجودی و لایه‌های بها. فایل برنامه جدیدتر / قالب ناشناس / جدول ناقص رد می‌شود با پیام فارسی.
**سلامت**: دکمه «بررسی سلامت» روی صفحه پشتیبان (موجودی کش ↔ دفتر حرکت ↔ لایه‌ها).
**یادآوری**: چک‌باکس «اگر بیش از هفت روز…»؛ وقتی روشن باشد و پشتیبان کهنه/ناموجود باشد، بنر روی صفحه اصلی به `/more/backup` می‌رود.

## تست‌های فاز ۷ (همه سبز)
- `tsc` ✅ · `eslint --max-warnings 0` ✅ · `npm test`: **89/89** ✅ (جدید: `tests/backup.test.ts`)
- `vite build` ✅ · همه e2e قبلی + `e2e-backup` **۲۲/۲۲** ✅ — تیره و روشن، بدون خطای کنسول
- `cap sync android` ✅ (با `@capacitor/share`) · `assembleDebug` ✅
- اسکرین‌شات‌ها: `screenshots/phase7-*-{dark,light}.png` (home-backup-reminder، backup-page، backup-health، restore-confirm، after-restore، restore-invalid)

## فاز ۶ — انجام‌شده (فروش + ماشین‌حساب قیمت)
**فروش**: فهرست `/sales`، فرم `/sales/new` (مشتری پیش‌فرض «مشتری نقدی» + مشتری جدید، کنترل موجودی، پیشنهاد قیمت بر اساس تنظیمات)، جزئیات با بهای تمام‌شده و سود این فاکتور، ابطال با برگرداندن کالا به همان لایه‌ها. هر فروش بهای FIFO / میانگین / آخرین خرید را روی ردیف و حرکت ذخیره می‌کند و یک دریافت نقدی به مبلغ کل ثبت می‌کند (نسخه اول بدون بدهی). فروش بیش از موجودی همیشه ممنوع.
**پیشنهاد قیمت** (تنظیمات): دستی / آخرین قیمت فروش (پیش‌فرض) / آخرین قیمت خرید + درصد سود (سراسری یا مخصوص گروه کالا). فروشنده همیشه می‌تواند روی فاکتور عوض کند.
**ماشین‌حساب قیمت** (`/more/price-calculator` و لینک داخل فرم فروش): قیمت خرید + هزینه اضافه + درصد → حداقل قیمت با «سود روی خرید» و «سود از فروش»، گرد به بالا، توضیح فارسی ساده.
**تنظیمات**: روش محاسبه سود (FIFO / میانگین / آخرین خرید) و پیشنهاد قیمت + درصد سود سراسری. گروه کالا فیلد اختیاری درصد سود دارد.
**خرید**: هنگام ثبت، پرداخت نقدی به مبلغ کل هم ثبت می‌شود (هم‌تراز با فروش).
**خانه**: کارت «فروش امروز» از فاکتورهای فروش فعال همان روز خوانده می‌شود.

## تست‌های فاز ۶ (همه سبز)
- `tsc` ✅ · `eslint --max-warnings 0` ✅ · `npm test`: **86/86** ✅ (جدید: `tests/sales.test.ts`)
- `vite build` ✅ · `screenshots` ✅ · `e2e-products` ۹۴/۹۴ · `e2e-stock` ۱۰۸/۱۰۸ · `e2e-purchases` ۷۸/۷۸ · `e2e-sales` (جدید) **۳۲/۳۲** ✅ — تیره و روشن، بدون خطای کنسول
- `cap sync android` ✅ · `assembleDebug` ✅
- اسکرین‌شات‌ها: `screenshots/phase6-*-{dark,light}.png` (price-calculator، settings-pricing، sales-empty، sale-form-empty، sale-form-filled، sale-detail، sale-cancel-sheet، sale-cancelled، sale-oversell-error)

## فاز ۵ — انجام‌شده (خرید + لایه‌های بها)
**Migration 003** (طبق طرح بالا): `cost_lots`، `lot_allocations`، `average_costs` (کش میانگین متحرک در سطح کالا)، ستون‌های بها روی `stock_movements` و `sales_items` (`cost_fifo/average/last`)، `invoice_discount_share` و `line_no` روی ردیف‌های فاکتور، `product_groups.markup_bp`، تأمین‌کننده سیستمی «متفرقه» با Trigger حفاظت، حذف `products.purchase_price` و تنظیم پنهان `allow_negative_stock`، نوع‌های حرکت جدا «کسری» (`shortage`) و «ضایعات / خرابی» (`waste`) با CHECK علامت هر نوع، Triggerهای تغییرناپذیری لایه (فقط `remaining` عوض می‌شود) و برداشت (فقط یک‌بار علامت برگشت). موجودی قبلی به لایه «opening» با قیمت خرید قدیمی تبدیل می‌شود (تست Migration 002→003).
**موتور بها** (`services/costing.ts` + `inventoryService.applyMovement`): هر حرکت ورودی یک لایه می‌سازد؛ هر خروجی FIFO برداشت می‌کند (ترتیب تاریخ فاکتور، سپس زمان ثبت) و بهای هر سه روش را روی حرکت ذخیره می‌کند؛ آخرین برداشت هر لایه باقی‌مانده بهای آن را برمی‌دارد تا جمع دقیق بماند. ابطال فروش برداشت‌ها را به همان لایه‌ها برمی‌گرداند. موجودی منفی همیشه ممنوع.
**خرید**: فهرست `/purchases` (جستجوی شماره/تأمین‌کننده/مرجع، فیلتر همه/فعال/ابطال‌شده)، فرم `/purchases/new` (تأمین‌کننده پیش‌فرض «متفرقه» + دکمه تأمین‌کننده جدید، انبار، تقویم شمسی با هشدار تاریخ آینده، شماره فاکتور فروشنده، ردیف‌ها با + / −، تخفیف ردیف و تخفیف کل فاکتور، پیش‌فرض قیمت = قیمت واحد آخرین خرید فعال)، صفحه جزئیات با «بهای نهایی پس از سهم تخفیف فاکتور» و ابطال با دلیل (اگر چیزی از لایه‌ها مصرف شده باشد مسدود با راهنمای «برگشت از خرید»). تأمین‌کنندگان در «بیشتر».
**موجودی**: «موجودی اولیه» بهای هر واحد را می‌پرسد (پیش‌فرض: آخرین قیمت خرید)؛ «شمارش» اضافه را با میانگین فعلی و کم را به‌عنوان «کسری» ثبت می‌کند؛ «کسری» و «ضایعات / خرابی» دو گزینه جدا هستند.
**اصلاح کوچک**: جداکننده «·» کنار ارقام فارسی شبیه «۰» دیده می‌شد («۰۹:۰۳ · ۱ قلم» ← «۱۰ قلم»)؛ همه با «|» جایگزین شد.

## تست‌های فاز ۵ (همه سبز)
- `tsc` ✅ · `eslint --max-warnings 0` ✅ · `npm test`: **81/81** ✅ (جدید: `tests/costing.test.ts`، `tests/purchases.test.ts`، `tests/invariant.test.ts` = ۲۵۰ عملیات تصادفی و بررسی قاعده ثابت «جمع باقی‌مانده لایه‌ها = موجودی» بعد از هر عملیات)
- `vite build` ✅ · `screenshots.mjs` ✅ · `e2e-products` ✅ · `e2e-stock` ✅ · `e2e-purchases` (جدید) ✅ — همه تیره و روشن، بدون خطای کنسول
- `cap sync android` ✅ · `assembleDebug` ✅
- اسکرین‌شات‌ها: `screenshots/phase5-*-{dark,light}.png` (purchases-empty، purchase-form-empty، purchase-form-error، purchase-new-supplier، purchase-date-picker، purchase-form-filled، purchase-detail، purchases-list، purchase-cancel-sheet، purchase-cancelled، purchase-cancel-blocked، suppliers-list) + `phase4-stock-waste-sheet`، `phase4-stock-detail-shortage-waste`

## فاز ۴ — انجام‌شده (انبار و موجودی)
**صفحه موجودی `/stock`** (تب «موجودی» کنار «کالاها»؛ تب پایین «کالاها» فعال می‌ماند): انتخاب انبار (همه / یک انبار)، جستجوی نام و کد، چیپ «فقط کم‌موجودی (n)»، کارت هر کالا با مقدار و واحد، نوار پیشرفت نسبت به نقطه سفارش، نشان «کافی / زیر نقطه سفارش / ناموجود» و کادر قرمز برای کم‌موجودی/ناموجود. با لمس کارت: موجودی هر انبار + ۸ تغییر آخر (نوع، تاریخ شمسی و ساعت، توضیح، علامت + سبز / − قرمز) و دکمه «اصلاح» برای هر انبار.
**اصلاح موجودی**: کاربر «عدد شمارش‌شده» را وارد می‌کند (موجودی اولیه یا اصلاح)، برنامه اختلاف را به‌صورت یک حرکت در دفتر ثبت می‌کند (هرگز عدد مستقیم عوض نمی‌شود). پیش‌نمایش «n عدد اضافه / کم می‌شود»؛ رد می‌شود: بدون تغییر، منفی، اعشار برای واحد صحیح، کالا/انبار غیرفعال.
**انبارها `/more/warehouses`**: ایجاد، تغییر نام، غیرفعال/فعال (هشدار اگر موجودی دارد؛ تنها انبار فعال غیرفعال نمی‌شود) و حذف فقط انبار بدون هیچ سابقه (و نه تنها انبار).
**سایر**: فهرست کالاها حالا «موجودی: n واحد» و برچسب ناموجود/کم‌موجودی را نشان می‌دهد؛ کارت «کم‌موجودی» صفحه اصلی به `/stock?f=low` می‌رود و عدد واقعی دارد.
**اشکال واقعی که پیدا و رفع شد**: ترتیب الفبایی SQLite بر اساس کد یونیکد است و «کابل» را بعد از «هدفون» می‌گذاشت (ک، گ، پ، چ، ژ، ی جابه‌جا می‌شوند). حالا فهرست کالا، موجودی، گروه، انبار، مشتری و تأمین‌کننده با `Intl.Collator('fa', numeric)` در لایه سرویس مرتب می‌شوند (کالاها: مرتب‌سازی کامل، سپس صفحه‌بندی). همچنین `Sheet` دیگر با هر رندر والد فوکوس را به اولین دکمه برنمی‌گرداند.
**تصمیم‌های جزئی (قابل تغییر)**: وضعیت «کم‌موجودی» با موجودی نمایش‌داده‌شده سنجیده می‌شود (انبار انتخاب‌شده، یا جمع همه انبارها) و «رسیدن به نقطه سفارش» هم کم‌موجودی است. کالای غیرفعال در صفحه موجودی نیست.

## تست‌های فاز ۴ (همه سبز)
- `tsc` ✅ · `eslint --max-warnings 0` ✅ · `npm test`: **62/62** ✅ (جدید: `tests/stock.test.ts`)
- `vite build` ✅ · `scripts/screenshots.mjs` ✅ (بدون خطای کنسول) · `scripts/e2e-products.mjs` **۹۲/۹۲** ✅
- `scripts/e2e-stock.mjs` (جدید، تیره و روشن، ۳۹۰×۸۴۴): **۹۴/۹۴** ✅ بدون خطای کنسول
- `cap sync android` ✅ · `assembleDebug` ✅
- اسکرین‌شات‌ها: `screenshots/phase4-*-{dark,light}.png` (stock-empty، stock-all-zero، stock-detail-empty، stock-adjust-sheet، stock-detail-history، stock-low، stock-attention، products-with-stock، warehouses-list، warehouse-only-active، warehouses-two، stock-detail-two-warehouses، stock-all-warehouses، warehouse-deactivate-confirm، stock-final)

## فاز ۳ — انجام‌شده
**دیتابیس (Migration 002)**: تعدادها به هزارم واحد (عدد صحیح)، جدول `units` (۹ واحد سیستمی + سفارشی، `allows_fraction`)، `products.unit_id`، Triggerهای «واحد بدون اعشار» و «قفل واحد بعد از تراکنش»، تخفیف سطح فاکتور (`subtotal_amount`, `discount`, CHECK ریاضی)، فرمول مبلغ ردیف با گرد کردن نیم‌به‌بالا (عدد صحیح، BigInt در JS).
**UI**: فهرست کالا (جستجوی نام/کد با نرمال‌سازی ارقام فارسی و «ي/ك»، چیپ گروه، نمایش غیرفعال‌ها، صفحه‌بندی ۱۰۰تایی، حالت‌های خالی/بدون نتیجه/خطا/بارگذاری)، فرم کالا (ایجاد/ویرایش، کد خودکار یا دستی، انتخاب واحد + ساخت واحد جدید، قیمت‌ها با جداکننده هزارگان، نقطه سفارش اعشاری برحسب واحد، غیرفعال/فعال، حذف فقط اگر استفاده‌نشده)، مدیریت گروه‌ها (ایجاد، تغییر نام، غیرفعال/فعال، حذف فقط گروه بدون کالا)، Toast، ConfirmSheet (هشدار/خطر).
**تصمیم‌ها**: واحد فرعی/ضریب تبدیل در UI نیست (در Schema مانده). فیلتر/جستجو در URL نگهداری می‌شود. «حذف» برای کالای دارای حرکت انبار/سند ممنوع و فقط غیرفعال‌سازی است.

## تست‌های فاز ۳ (همه سبز)
- `tsc --noEmit` ✅ · `eslint --max-warnings 0` ✅ · `npm test`: **56/56** ✅
- `vite build` ✅ · `scripts/screenshots.mjs` (فاز ۱–۲، بررسی کنسول): همه PASS، بدون خطای کنسول ✅
- `scripts/e2e-products.mjs` (Chrome headless، موبایل ۳۹۰×۸۴۴، تیره و روشن): **۹۲/۹۲** ✅ بدون خطای کنسول
- `cap sync android` ✅ · `assembleDebug` ✅ (`android/app/build/outputs/apk/debug/app-debug.apk`)
- Migration 002 روی SQLite 3.46 واقعی (CLI) هم با داده آزمایش شد: FK/ integrity ok.
- ❗ محدودیت صادقانه: اجرای واقعی روی افزونه SQLite اندروید (دستگاه/شبیه‌ساز) انجام نشده (شبیه‌ساز ناپایدار بود).

## اسکرین‌شات‌ها (`/workspace/anbardar/screenshots/`)
`phase3-<نام>-dark.png` و `phase3-<نام>-light.png` برای: products-empty، product-form-new، product-form-error، product-form-filled، product-form-fraction-error، new-unit-sheet، groups، group-duplicate-error، group-edit-sheet، group-delete-confirm، product-form-edit، products-list، products-filtered، products-search، products-no-results، deactivate-confirm، products-with-inactive، home-with-products، product-not-found.

## یادداشت برای فازهای بعد / سؤال‌های پیش‌رو

## USER DECISIONS (Oct 5, 2026, before Phase 5) — QUESTIONS ANSWERED
- Remove "purchase price" field from product definition. Purchase price lives ONLY on purchase invoice lines; new purchase form prefills last purchase price from previous invoices.
- Every purchase line = a cost lot/batch (qty, remaining, unit cost, date, warehouse). Every sale line records which lots/qty it consumed (lot allocation table) AND stores its computed cost. Raw data must allow computing FIFO, weighted average, and last-purchase-price cost later without schema changes.
- Cost method for profit selectable in Settings: FIFO (default), weighted average, last purchase price.
- Sale price suggestion mode in Settings: manual (empty), last sale price of this product (default; first sale manual), last purchase price + markup % (global or per product group). Seller can always edit price on invoice; final price stored on line.
- Price calculator screen/tool: enter purchase price (+ optional extra cost) and desired profit %, show minimum sale price. Show BOTH interpretations clearly: markup on cost (cost × (1+p)) and margin on sale price (cost ÷ (1−p)), explaining in simple Persian which guarantees "no loss at p% of sale". Integer toman, round up.
- Q1 payments: invoices fully paid in cash for v1 (no debts); keep payments table for later credit feature.
- Q2 supplier: system supplier «متفرقه» like cash customer; supplier optional in UI, inline "new supplier" button.
- Q3 discount: invoice-level discount shown on both sales and purchases (plus line discount).
- Q5 date: default now, user can pick a Jalali date (backdating) via Jalali date picker; warn if date is in the future.
- Q6 expenses: DEFERRED — ask user at start of Phase 8; do not add yet.

## USER DECISIONS Q7–Q10 (Oct 5, 2026, 8:29) — ANSWERED: all recommendations accepted, plus:
- Discount semantics: sales discount reduces the total amount we RECEIVE; purchase discount reduces the amount we must PAY (and the lot cost).
- Stock-loss reasons must be DISTINCT types (not lumped as waste): «کسری» (shortage: lost/stolen/count shortage) vs «ضایعات / خرابی» (damage/spoilage). Separate movement types and separate lines in reports. Both consume oldest lots (FIFO) and keep their cost.

## USER DECISION Q6 (Oct 5, 2026, 10:04) — expense entry
User skipped the widget; proceeding with my recommendation: ADD a simple «ثبت هزینه» feature (rent, salaries, bills, transport — category + date + amount + note). Include these expenses in Phase 8 profit/loss and income-vs-expense pie, alongside product purchases. Purchases stay as cost-of-goods; operating expenses are separate.

## USER CONFIRMATION Q6 (Oct 5, 2026, 10:11)
User explicitly confirmed: ADD «ثبت هزینه» (expense entry). Proceed with Phase 8 including expenses in P&L and pie chart.

## Roadmap stage 1: parties and money documents (v1.1.0, Oct 12, 2026)
- Migration 006 adds unified `parties` (customer/supplier/both). The old customers/suppliers are migrated losslessly and the system defaults are kept. It also adds `money_documents` (receipt/payment/opening), `settlements` (allocations to invoices) and auto documents for invoice payments and return refunds. The old `payments` table is kept for history only.
- Cash stays the default on invoices. «نسیه / بخشی» records a paid amount less than the total (named parties only).
- Balance comes only from documents. New screens: unified parties list, party ledger, money form (manual allocation with an oldest-first suggestion), money list/detail with cancel, debtors/creditors report, and a home card.
- Design note: docs/parties-and-money.md. E2E: scripts/e2e-money.mjs (both themes).

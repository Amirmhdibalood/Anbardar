import { AppError, GENERIC_ERROR_MESSAGE, ValidationError } from '../utils/errors'

/** پیام فارسی برای هر ستون یکتا (UNIQUE) */
const UNIQUE_MESSAGES: Record<string, string> = {
  'products.code': 'این کد برای کالای دیگری ثبت شده است. کد دیگری انتخاب کنید.',
  'product_groups.name': 'گروهی با این نام وجود دارد.',
  'units.name': 'واحدی با این نام وجود دارد.',
  'warehouses.name': 'انباری با این نام وجود دارد.',
  'sales_invoices.invoice_number': 'شماره این فاکتور فروش تکراری است. دوباره تلاش کنید.',
  'money_documents.request_id': 'این سند قبلاً ثبت شده است.',
  'purchase_invoices.invoice_number': 'شماره این فاکتور خرید تکراری است. دوباره تلاش کنید.',
}

/** پیام مربوط به Triggerهای دیتابیس (RAISE(ABORT, '<کد>')) */
const TRIGGER_ERRORS: Record<string, AppError> = {
  sub_unit_locked: new ValidationError({ subUnits: 'ضریب واحدی که در فاکتور استفاده شده قابل تغییر نیست؛ آن را حذف کنید و واحد دیگری بسازید.' }),
  negative_stock: new AppError('insufficient_stock', 'موجودی کالا در انبار کافی نیست.'),
  ledger_immutable: new AppError('immutable', 'حرکت‌های ثبت‌شده انبار و بهای آن‌ها قابل ویرایش یا حذف نیستند.'),
  document_immutable: new AppError(
    'immutable',
    'سند ثبت‌شده قابل ویرایش یا حذف نیست. برای اصلاح، سند را ابطال و دوباره ثبت کنید.',
  ),
  fraction_not_allowed: new AppError('validation', 'برای واحد این کالا فقط تعداد صحیح (بدون اعشار) مجاز است.'),
  unit_locked: new AppError('protected', 'واحد کالا پس از ثبت اولین تراکنش قابل تغییر نیست.'),
  unit_mismatch: new AppError('validation', 'واحد انتخاب‌شده برای این کالا تعریف نشده یا ضریبش درست نیست.'),
  cheque_mismatch: new AppError('validation', 'اطلاعات چک با سند دریافت/پرداخت نمی‌خواند.'),
  amount_mismatch: new AppError('validation', 'مبلغ‌های فاکتور با هم نمی‌خوانند. فاکتور را بررسی و دوباره ثبت کنید.'),
  party_wrong_role: new AppError('validation', 'طرف حساب انتخاب‌شده برای این نوع فاکتور تعریف نشده است (مشتری/تأمین‌کننده).'),
  party_role_in_use: new AppError('in_use', 'این طرف حساب با همین نقش فاکتور دارد، پس این نقش برداشته نمی‌شود.'),
  settlement_invalid: new AppError('validation', 'این سند را نمی‌شود به فاکتور انتخاب‌شده وصل کرد (طرف حساب یا نوع سند یکی نیست، یا یکی از آن‌ها ابطال شده).'),
  settlement_exceeds: new AppError('validation', 'جمع تخصیص‌ها از مبلغ سند بیشتر است.'),
  system_row_protected: new AppError('protected', 'این مورد جزو اطلاعات پایه برنامه است و قابل حذف یا غیرفعال‌کردن نیست.'),
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

/**
 * تبدیل هر خطای SQLite (sql.js یا افزونه Capacitor) به AppError با پیام فارسی.
 * متن فنی اصلی در `cause` نگهداری می‌شود (فقط برای لاگ توسعه‌دهنده).
 */
export function mapDbError(error: unknown, sql?: string): AppError {
  if (error instanceof AppError) return error
  const text = messageOf(error)

  for (const [marker, mapped] of Object.entries(TRIGGER_ERRORS)) {
    if (text.includes(marker)) return mapped instanceof ValidationError ? new ValidationError({ ...mapped.fieldErrors }) : new AppError(mapped.code, mapped.userMessage, { cause: error })
  }

  const unique = /UNIQUE constraint failed:\s*([^\n(]+)/i.exec(text)
  if (unique) {
    const columns = (unique[1] ?? '').trim()
    const known = UNIQUE_MESSAGES[columns]
    return new AppError('duplicate', known ?? 'این مورد قبلاً ثبت شده است.', { cause: error })
  }

  if (/FOREIGN KEY constraint failed/i.test(text)) {
    // در ثبت یا ویرایش یعنی مورد انتخاب‌شده (گروه، انبار، کالا، ...) وجود ندارد؛ در حذف یعنی مورد جای دیگر استفاده شده
    if (sql && !/^\s*DELETE\b/i.test(sql)) {
      return new AppError('constraint', 'مورد انتخاب‌شده (مثلاً گروه، انبار، کالا یا مشتری) وجود ندارد یا حذف شده است. دوباره انتخاب کنید.', {
        cause: error,
      })
    }
    return new AppError(
      'in_use',
      'این مورد در اسناد یا اطلاعات دیگر استفاده شده است، پس حذف نمی‌شود. به‌جای حذف، آن را غیرفعال کنید.',
      { cause: error },
    )
  }

  if (/NOT NULL constraint failed/i.test(text)) {
    return new AppError('constraint', 'یکی از اطلاعات ضروری وارد نشده است.', { cause: error })
  }

  if (/CHECK constraint failed/i.test(text)) {
    return new AppError('constraint', 'مقدار واردشده مجاز نیست. اعداد و مبلغ‌ها را بررسی کنید.', { cause: error })
  }

  if (/database is locked|SQLITE_BUSY/i.test(text)) {
    return new AppError('database', 'پایگاه داده درگیر عملیات دیگری است. چند لحظه بعد دوباره تلاش کنید.', { cause: error })
  }

  if (/disk I\/O error|SQLITE_FULL|database or disk is full|SQLITE_IOERR/i.test(text)) {
    return new AppError('database', 'ذخیره‌سازی انجام نشد؛ احتمالاً حافظه دستگاه پر است.', { cause: error })
  }

  return new AppError('database', GENERIC_ERROR_MESSAGE, { cause: error })
}

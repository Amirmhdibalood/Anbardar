/**
 * خطاهای برنامه. هر AppError یک پیام فارسی و قابل‌فهم برای کاربر (userMessage) دارد؛
 * جزئیات فنی فقط در `cause` می‌ماند و هرگز نمایش داده نمی‌شود.
 */
export type ErrorCode =
  | 'validation' // ورودی نامعتبر
  | 'duplicate' // تکراری (UNIQUE)
  | 'in_use' // مورد در اسناد/اطلاعات دیگر استفاده شده (FOREIGN KEY)
  | 'insufficient_stock' // موجودی کافی نیست
  | 'not_found'
  | 'immutable' // سند یا حرکت ثبت‌شده قابل ویرایش/حذف نیست
  | 'protected' // اطلاعات پایه برنامه
  | 'constraint' // سایر محدودیت‌های دیتابیس
  | 'integrity' // ناسازگاری داخلی اطلاعات (نباید رخ دهد)
  | 'migration'
  | 'database_newer' // دیتابیس با نسخه جدیدتر برنامه ساخته شده
  | 'database' // خطای کلی دیتابیس
  | 'auth_required' // ورود کاربر لازم است
  | 'forbidden' // نقش کاربر اجازه این کار را ندارد
  | 'unknown'

export class AppError extends Error {
  readonly code: ErrorCode
  readonly userMessage: string

  constructor(code: ErrorCode, userMessage: string, options?: { cause?: unknown }) {
    super(`${code}: ${userMessage}`, options)
    this.name = 'AppError'
    this.code = code
    this.userMessage = userMessage
  }
}

/** خطای اعتبارسنجی؛ برای هر فیلد پیام جدا دارد تا UI کنار همان فیلد نشان دهد */
export class ValidationError extends AppError {
  readonly fieldErrors: Readonly<Record<string, string>>

  constructor(fieldErrors: Record<string, string>, code: ErrorCode = 'validation') {
    const first = Object.values(fieldErrors)[0] ?? 'اطلاعات واردشده معتبر نیست.'
    super(code, first)
    this.name = 'ValidationError'
    this.fieldErrors = fieldErrors
  }
}

export const GENERIC_ERROR_MESSAGE = 'مشکلی پیش آمد و عملیات انجام نشد. اطلاعات شما تغییری نکرده است.'

/** تنها راه نمایش خطا به کاربر: برای هر خطا یک پیام فارسی امن برمی‌گرداند */
export function toUserMessage(error: unknown): string {
  return error instanceof AppError ? error.userMessage : GENERIC_ERROR_MESSAGE
}

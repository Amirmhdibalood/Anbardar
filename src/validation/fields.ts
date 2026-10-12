import { MAX_AMOUNT, MAX_NAME_LENGTH, MAX_TEXT_LENGTH } from '../models/limits'
import { ValidationError } from '../utils/errors'
import { toEnglishDigits } from '../utils/persian'

/** جمع‌آوری خطای فیلدها؛ در پایان `done()` اگر خطایی بود ValidationError پرتاب می‌کند */
export class Fields {
  private readonly errors: Record<string, string> = {}

  fail(field: string, message: string): void {
    this.errors[field] ??= message
  }

  done(): void {
    if (Object.keys(this.errors).length > 0) throw new ValidationError(this.errors)
  }
}

/** حذف فاصله‌های اضافه، یکسان‌سازی «ي/ك» عربی با «ی/ک» فارسی و حذف نویسه‌های کنترلی */
export function cleanText(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value
    // eslint-disable-next-line no-control-regex -- حذف نویسه‌های کنترلی عمدی است
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/\s+/g, ' ')
    .trim()
}

export function requiredName(f: Fields, field: string, label: string, value: unknown): string {
  const text = cleanText(value)
  if (!text) f.fail(field, `${label} را وارد کنید.`)
  else if (text.length > MAX_NAME_LENGTH) f.fail(field, `${label} نباید بیشتر از ${MAX_NAME_LENGTH} نویسه باشد.`)
  return text
}

export function optionalText(f: Fields, field: string, label: string, value: unknown, max = MAX_TEXT_LENGTH): string | null {
  const text = cleanText(value)
  if (!text) return null
  if (text.length > max) {
    f.fail(field, `${label} نباید بیشتر از ${max} نویسه باشد.`)
    return null
  }
  return text
}

/** کد کالا: ارقام فارسی به انگلیسی، بدون فاصله، حروف بزرگ */
export function normalizeCode(value: unknown): string {
  return toEnglishDigits(cleanText(value)).replace(/\s+/g, '').toUpperCase()
}

/** شماره تماس: فقط ارقام و + - ( ) و فاصله؛ ارقام فارسی به انگلیسی تبدیل می‌شود */
export function optionalPhone(f: Fields, field: string, value: unknown): string | null {
  const text = toEnglishDigits(cleanText(value))
  if (!text) return null
  if (!/^[0-9+\-() ]{3,20}$/.test(text) || (text.match(/[0-9]/g)?.length ?? 0) < 3) {
    f.fail(field, 'شماره تماس معتبر نیست.')
    return null
  }
  return text
}

export function isSafeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
}

/** عدد صحیح بین min و max */
export function intInRange(f: Fields, field: string, label: string, value: unknown, min: number, max: number): number {
  if (!isSafeInt(value)) {
    f.fail(field, `${label} باید عدد صحیح باشد.`)
    return min
  }
  if (value < min) {
    f.fail(field, min === 0 ? `${label} نمی‌تواند منفی باشد.` : `${label} باید حداقل ${min} باشد.`)
    return min
  }
  if (value > max) {
    f.fail(field, `${label} بیش از حد مجاز است.`)
    return min
  }
  return value
}

export function requiredId(f: Fields, field: string, label: string, value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    f.fail(field, `${label} را انتخاب کنید.`)
    return ''
  }
  return value
}

export function optionalIsoDate(f: Fields, field: string, label: string, value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    f.fail(field, `${label} معتبر نیست.`)
    return undefined
  }
  return new Date(value).toISOString()
}

export function amountInRange(f: Fields, field: string, label: string, value: unknown, min: number, max = MAX_AMOUNT): number {
  return intInRange(f, field, label, value, min, max)
}

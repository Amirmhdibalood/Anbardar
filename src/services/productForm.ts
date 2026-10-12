import type { Product, ProductInput, Unit } from '../models/catalog'
import { MAX_UNIT_PRICE } from '../models/limits'
import { ValidationError } from '../utils/errors'
import { formatInteger, parseIntegerInput, toEnglishDigits, toPersianDigits } from '../utils/persian'
import { parseQuantityInput, quantityParseMessage, quantityToInputText } from '../utils/quantity'
import { validateProduct } from '../validation/entities'

/** مقدارهای فرم کالا همان متنی است که کاربر می‌بیند؛ تبدیل به ورودی سرویس اینجا انجام می‌شود (نه داخل UI) */
export interface ProductFormValues {
  name: string
  /** خالی = کد خودکار */
  code: string
  groupId: string
  unitId: string
  reorderPoint: string
  salePrice: string
  description: string
}

export type ProductFormResult = { ok: true; input: ProductInput } | { ok: false; errors: Record<string, string> }

export function emptyProductForm(defaults: { groupId: string; unitId: string }): ProductFormValues {
  return { name: '', code: '', groupId: defaults.groupId, unitId: defaults.unitId, reorderPoint: '', salePrice: '', description: '' }
}

export function productToForm(p: Product): ProductFormValues {
  return {
    name: p.name,
    code: p.code,
    groupId: p.groupId,
    unitId: p.unitId,
    reorderPoint: p.reorderPoint === 0 ? '' : quantityToInputText(p.reorderPoint),
    salePrice: p.salePrice === 0 ? '' : formatInteger(p.salePrice),
    description: p.description ?? '',
  }
}

/** در حین تایپ مبلغ: فقط رقم نگه داشته می‌شود و با جداکننده هزارگان و ارقام فارسی نمایش داده می‌شود */
export function formatMoneyTyping(text: string): string {
  const digits = toEnglishDigits(text).replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, String(MAX_UNIT_PRICE).length)
  return digits === '' ? '' : formatInteger(Number(digits))
}

/** در حین تایپ تعداد: ارقام فارسی و «٫» به‌عنوان اعشار */
export function formatQuantityTyping(text: string): string {
  const cleaned = toPersianDigits(text.replace(/[.,/]/g, '٫').replace(/[^0-9۰-۹٠-٩٫]/g, ''))
  const [first = '', ...rest] = cleaned.split('٫')
  // فقط اولین جداکننده اعشار نگه داشته می‌شود
  return rest.length === 0 ? first : `${first}٫${rest.join('')}`
}

function parsePrice(text: string, label: string): { value: number } | { error: string } {
  const trimmed = text.trim()
  if (trimmed === '') return { value: 0 }
  if (/[.٫]/.test(trimmed)) return { error: `${label} باید عدد صحیح و بدون اعشار باشد (به تومان).` }
  const value = parseIntegerInput(trimmed)
  if (value === null) return { error: `${label} را به‌صورت عدد وارد کنید.` }
  return { value }
}

/**
 * تبدیل متن فرم به ورودی سرویس + اجرای همان اعتبارسنجی سرویس تا تمام خطاها یک‌جا کنار فیلدها نشان داده شود.
 * `unit` برای قانون اعشار نقطه سفارش لازم است.
 */
export function toProductInput(values: ProductFormValues, unit: Unit | undefined): ProductFormResult {
  const errors: Record<string, string> = {}

  const sale = parsePrice(values.salePrice, 'قیمت فروش')
  if ('error' in sale) errors['salePrice'] = sale.error

  let reorderPoint = 0
  if (!unit) {
    errors['unitId'] = 'واحد کالا را انتخاب کنید.'
  } else {
    const parsed = parseQuantityInput(values.reorderPoint, unit.allowsFraction)
    if (parsed.ok) reorderPoint = parsed.value
    else errors['reorderPoint'] = quantityParseMessage(parsed.reason, 'نقطه سفارش', unit.name)
  }

  const input: ProductInput = {
    code: values.code.trim() === '' ? null : values.code,
    name: values.name,
    groupId: values.groupId,
    unitId: values.unitId || undefined,
    reorderPoint,
    salePrice: 'value' in sale ? sale.value : 0,
    description: values.description,
  }

  try {
    validateProduct(input)
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error
    for (const [field, message] of Object.entries(error.fieldErrors)) errors[field] ??= message
  }

  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, input }
}

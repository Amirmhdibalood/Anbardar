import type { Product } from '../models/catalog'
import type { InvoiceItemInput } from '../models/invoice'
import type { createRepositories } from '../repositories'
import { ValidationError } from '../utils/errors'
import { toBaseQuantity } from '../utils/invoiceMath'
import { isWholeQuantity } from '../utils/quantity'

type Repos = ReturnType<typeof createRepositories>

/** ضریب واحد ردیف برای کالا (هزارم واحد پایه)؛ null = واحد برای این کالا تعریف نشده یا غیرفعال است */
export function factorFor(product: Product, unitId: string | null | undefined): number | null {
  if (!unitId || unitId === product.unitId) return 1000
  const u = product.subUnits?.find((s) => s.unitId === unitId && s.isActive)
  return u ? u.factor : null
}

export function unitLabel(product: Product, unitId: string | null | undefined): string {
  if (!unitId || unitId === product.unitId) return product.unitName
  return product.subUnits?.find((s) => s.unitId === unitId)?.unitName ?? product.unitName
}

/**
 * بررسی کالا و واحد هر ردیف: کالای فعال، واحد تعریف‌شده، تعداد صحیح برای واحدهای بدون اعشار
 * (هم در واحد ردیف و هم پس از تبدیل به واحد پایه). خروجی: نگاشت کالاها و تابع ضریب برای prepareInvoice.
 */
export async function checkLines(r: Repos, items: readonly InvoiceItemInput[]) {
  const products = new Map<string, Product>()
  const errors: Record<string, string> = {}
  for (const [i, item] of items.entries()) {
    const product = await r.products.getById(item.productId)
    if (!product || !product.isActive) {
      errors[`items.${i}.productId`] = `کالای ردیف ${i + 1} پیدا نشد یا غیرفعال است.`
      continue
    }
    products.set(product.id, product)
    const factor = factorFor(product, item.unitId)
    if (factor === null) {
      errors[`items.${i}.unitId`] = `واحد ردیف ${i + 1} برای «${product.name}» تعریف نشده است.`
      continue
    }
    const sub = item.unitId && item.unitId !== product.unitId ? product.subUnits?.find((s) => s.unitId === item.unitId) : undefined
    const allows = sub ? sub.allowsFraction : product.unitAllowsFraction
    const name = sub ? sub.unitName : product.unitName
    if (!allows && !isWholeQuantity(item.quantity)) {
      errors[`items.${i}.quantity`] = `تعداد «${product.name}» باید عدد صحیح باشد (واحد «${name}» اعشار ندارد).`
      continue
    }
    const base = toBaseQuantity(item.quantity, factor)
    if (base === null) errors[`items.${i}.quantity`] = `تعداد ردیف ${i + 1} به واحد «${product.unitName}» بیش از سه رقم اعشار می‌شود.`
    else if (!product.unitAllowsFraction && !isWholeQuantity(base)) {
      errors[`items.${i}.quantity`] = `تعداد «${product.name}» به واحد «${product.unitName}» عدد صحیح نمی‌شود.`
    }
  }
  if (Object.keys(errors).length) throw new ValidationError(errors)
  // واحد ردیف را عادی کن: واحد پایه = null
  const normalized = items.map((it) => {
    const p = products.get(it.productId)
    return p && it.unitId === p.unitId ? { ...it, unitId: null } : it
  })
  return {
    products,
    items: normalized,
    factorOf: (productId: string, unitId: string) => {
      const p = products.get(productId)
      return p ? factorFor(p, unitId) : null
    },
  }
}

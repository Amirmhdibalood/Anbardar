import type { InvoiceInput, InvoiceItemInput } from '../models/invoice'
import type { PartyInput } from '../models/party'
import type { PaymentInput } from '../models/payment'
import type { ProductGroupInput, ProductInput, UnitInput, WarehouseInput } from '../models/catalog'
import { MOVEMENT_TYPES, DOCUMENT_TYPES, type StockMovementInput } from '../models/stock'
import { MAX_AMOUNT, MAX_INVOICE_ITEMS, MAX_QUANTITY, MAX_UNIT_PRICE } from '../models/limits'
import { DEFAULT_UNIT_ID } from '../models/units'
import { MAX_MARKUP_BP } from '../models/settings'
import { lineGross } from '../utils/quantity'
import { Fields, amountInRange, cleanText, intInRange, normalizeCode, optionalIsoDate, optionalPhone, optionalText, requiredId, requiredName } from './fields'

/** همه تابع‌ها ورودی را اعتبارسنجی و پاک‌سازی می‌کنند و مقدار تمیز را برمی‌گردانند یا ValidationError می‌دهند */

export function validateProductGroup(input: ProductGroupInput): ProductGroupInput {
  const f = new Fields()
  const name = requiredName(f, 'name', 'نام گروه', input.name)
  const description = optionalText(f, 'description', 'توضیحات', input.description)
  let markupBp: number | null = null
  if (input.markupBp !== undefined && input.markupBp !== null) markupBp = intInRange(f, 'markupBp', 'درصد سود گروه', input.markupBp, 0, MAX_MARKUP_BP)
  f.done()
  return { name, description, markupBp }
}

export function validateUnit(input: UnitInput): UnitInput {
  const f = new Fields()
  const name = cleanText(input.name)
  if (!name) f.fail('name', 'نام واحد را وارد کنید.')
  else if (name.length > 20) f.fail('name', 'نام واحد نباید بیشتر از ۲۰ نویسه باشد.')
  f.done()
  return { name, allowsFraction: input.allowsFraction === true }
}

export function validateWarehouse(input: WarehouseInput): WarehouseInput {
  const f = new Fields()
  const name = requiredName(f, 'name', 'نام انبار', input.name)
  const description = optionalText(f, 'description', 'توضیحات', input.description)
  f.done()
  return { name, description }
}

export function validateParty(input: PartyInput, label: 'مشتری' | 'تأمین‌کننده'): PartyInput {
  const f = new Fields()
  const name = requiredName(f, 'name', `نام ${label}`, input.name)
  const phone = optionalPhone(f, 'phone', input.phone)
  const address = optionalText(f, 'address', 'آدرس', input.address)
  const description = optionalText(f, 'description', 'توضیحات', input.description)
  f.done()
  return { name, phone, address, description }
}

export function validateProduct(input: ProductInput): ProductInput {
  const f = new Fields()
  const name = requiredName(f, 'name', 'نام کالا', input.name)
  const groupId = requiredId(f, 'groupId', 'گروه کالا', input.groupId)
  const code = normalizeCode(input.code) || null
  if (code && code.length > 40) f.fail('code', 'کد کالا نباید بیشتر از ۴۰ نویسه باشد.')
  const unitId = input.unitId ? requiredId(f, 'unitId', 'واحد کالا', input.unitId) : DEFAULT_UNIT_ID
  const subUnit = optionalText(f, 'subUnit', 'واحد فرعی', input.subUnit, 30)
  let conversionRatio: number | null = null
  if (subUnit !== null || (input.conversionRatio ?? null) !== null) {
    conversionRatio = intInRange(f, 'conversionRatio', 'ضریب تبدیل', input.conversionRatio ?? 0, 1, 1_000_000)
    if (subUnit === null) f.fail('subUnit', 'برای ضریب تبدیل، واحد فرعی را وارد کنید.')
  }
  // تعداد به‌صورت هزارم واحد است؛ قانون «اعشار مجاز است یا نه» (به واحد وابسته است) در سرویس بررسی می‌شود
  const reorderPoint = intInRange(f, 'reorderPoint', 'نقطه سفارش', input.reorderPoint ?? 0, 0, MAX_QUANTITY)
  const salePrice = intInRange(f, 'salePrice', 'قیمت فروش', input.salePrice ?? 0, 0, MAX_UNIT_PRICE)
  const description = optionalText(f, 'description', 'توضیحات', input.description)
  f.done()
  return { code, name, groupId, unitId, subUnit, conversionRatio, reorderPoint, salePrice, description }
}

export function validateInvoiceItem(f: Fields, item: InvoiceItemInput, index: number): InvoiceItemInput {
  const row = `ردیف ${index + 1}`
  const productId = requiredId(f, `items.${index}.productId`, `کالای ${row}`, item.productId)
  const quantity = intInRange(f, `items.${index}.quantity`, `تعداد ${row}`, item.quantity, 1, MAX_QUANTITY)
  const unitPrice = intInRange(f, `items.${index}.unitPrice`, `قیمت ${row}`, item.unitPrice, 0, MAX_UNIT_PRICE)
  const discount = intInRange(f, `items.${index}.discount`, `تخفیف ${row}`, item.discount ?? 0, 0, MAX_AMOUNT)
  const gross = lineGross(quantity, unitPrice)
  if (gross === null) f.fail(`items.${index}.unitPrice`, `مبلغ ${row} بیش از حد مجاز است.`)
  else if (discount > gross) f.fail(`items.${index}.discount`, `تخفیف ${row} نمی‌تواند از مبلغ ردیف بیشتر باشد.`)
  const note = optionalText(f, `items.${index}.note`, 'توضیحات', item.note)
  return { productId, quantity, unitPrice, discount, note }
}

export function validateInvoice(input: InvoiceInput, partyLabel: 'مشتری' | 'تأمین‌کننده'): InvoiceInput {
  const f = new Fields()
  const partyId = requiredId(f, 'partyId', partyLabel, input.partyId)
  const warehouseId = requiredId(f, 'warehouseId', 'انبار', input.warehouseId)
  const invoiceDate = optionalIsoDate(f, 'invoiceDate', 'تاریخ', input.invoiceDate)
  const reference = optionalText(f, 'reference', 'شماره مرجع', input.reference, 60)
  const note = optionalText(f, 'note', 'توضیحات', input.note)
  if (!Array.isArray(input.items) || input.items.length === 0) f.fail('items', 'حداقل یک کالا به فاکتور اضافه کنید.')
  else if (input.items.length > MAX_INVOICE_ITEMS) f.fail('items', `هر فاکتور حداکثر ${MAX_INVOICE_ITEMS} ردیف می‌تواند داشته باشد.`)
  const items = (input.items ?? []).map((item, i) => validateInvoiceItem(f, item, i))

  const seen = new Set<string>()
  for (const item of items) {
    if (seen.has(item.productId)) f.fail('items', 'یک کالا بیش از یک بار در فاکتور آمده است. تعداد را در همان ردیف تغییر دهید.')
    seen.add(item.productId)
  }
  const discount = intInRange(f, 'discount', 'تخفیف فاکتور', input.discount ?? 0, 0, MAX_AMOUNT)
  let subtotal = 0
  for (const it of items) subtotal += (lineGross(it.quantity, it.unitPrice) ?? 0) - (it.discount ?? 0)
  if (subtotal > MAX_AMOUNT) f.fail('items', 'جمع فاکتور بیش از حد مجاز است.')
  else if (discount > subtotal) f.fail('discount', 'تخفیف فاکتور نمی‌تواند از جمع فاکتور بیشتر باشد.')
  f.done()
  return { partyId, warehouseId, invoiceDate, reference, note, discount, items }
}

export function validatePayment(input: PaymentInput): PaymentInput {
  const f = new Fields()
  const hasSales = !!input.salesInvoiceId
  const hasPurchase = !!input.purchaseInvoiceId
  if (hasSales === hasPurchase) f.fail('invoice', 'پرداخت باید به یک فاکتور مربوط باشد.')
  const amount = amountInRange(f, 'amount', 'مبلغ', input.amount, 1)
  const paidAt = optionalIsoDate(f, 'paidAt', 'تاریخ', input.paidAt)
  const note = optionalText(f, 'note', 'توضیحات', input.note)
  f.done()
  return { salesInvoiceId: input.salesInvoiceId ?? null, purchaseInvoiceId: input.purchaseInvoiceId ?? null, amount, paidAt, note }
}

export function validateMovement(input: StockMovementInput): StockMovementInput {
  const f = new Fields()
  const productId = requiredId(f, 'productId', 'کالا', input.productId)
  const warehouseId = requiredId(f, 'warehouseId', 'انبار', input.warehouseId)
  if (!Number.isSafeInteger(input.quantityDelta) || input.quantityDelta === 0 || Math.abs(input.quantityDelta) > MAX_QUANTITY) {
    f.fail('quantityDelta', 'تعداد باید غیرصفر و در محدوده مجاز باشد.')
  }
  if (!MOVEMENT_TYPES.includes(input.movementType)) f.fail('movementType', 'نوع حرکت انبار معتبر نیست.')
  if (input.documentType != null && !DOCUMENT_TYPES.includes(input.documentType)) f.fail('documentType', 'نوع سند معتبر نیست.')
  if ((input.documentType == null) !== (input.documentId == null)) f.fail('documentId', 'نوع و شناسه سند باید با هم مشخص شوند.')
  const occurredAt = optionalIsoDate(f, 'occurredAt', 'تاریخ', input.occurredAt)
  const note = optionalText(f, 'note', 'توضیحات', input.note)
  f.done()
  return { ...input, productId, warehouseId, occurredAt, note }
}

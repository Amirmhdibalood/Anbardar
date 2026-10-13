/* eslint-disable @typescript-eslint/no-explicit-any */
import type { SqlExecutor } from '../database/types'
import { can, type Permission } from '../models/permissions'
import { AppError } from '../utils/errors'
import { formatMoney } from '../utils/money'
import { toPersianDigits } from '../utils/persian'
import { authorize, writeAudit, type AuditEntry, type EffectiveActor } from './authz'
import { createCatalogService } from './catalogService'
import { createChequeService } from './chequeService'
import { createExpenseService } from './expenseService'
import { createStockService } from './inventoryService'
import { createMoneyService } from './moneyService'
import { createPurchaseService } from './purchaseService'
import { createReportService } from './reportService'
import { createReturnService, createTransferService } from './returnService'
import { createSaleService } from './saleService'

/**
 * لایه سرویس امن: هر متد تغییردهنده در یک تراکنش اجرا می‌شود:
 *   مجوز ← اجرای سرویس خام روی همان تراکنش ← ثبت در گزارش فعالیت.
 * سه مرحله با هم Commit یا Rollback می‌شوند. متدهای خواندنی که در READS نیستند مجاز نیستند (تست پوشش).
 */
export interface Rule {
  perm: Permission
  /** قاعده اضافه روی آرگومان‌ها (مثلاً فروشنده فقط «دریافت») */
  extra?: (actor: EffectiveActor, args: any[]) => void
  /** بررسی روی نتیجه، داخل همان تراکنش (خطا = Rollback) */
  after?: (result: any, actor: EffectiveActor) => void
  /** ثبت در گزارش فعالیت (نبودن = متد خواندنی) */
  audit?: (result: any, args: any[]) => AuditEntry
  /** حذف اطلاعات حساس از خروجی برای نقش‌های محدود */
  redact?: (result: any, actor: EffectiveActor) => any
}

const n = (x: number) => toPersianDigits(x)
const money = (x: number) => formatMoney(x)

const getPath = (o: any, path: string[]) => path.reduce((a, k) => a?.[k], o)

export function guard<T extends object>(db: SqlExecutor, factory: (ex: SqlExecutor) => T, rules: Record<string, Rule>, reads: readonly string[]): T {
  const raw = factory(db)
  const build = (node: any, prefix: string[]): any => {
    const out: any = {}
    for (const [k, v] of Object.entries(node)) {
      const path = [...prefix, k]
      const key = path.join('.')
      if (typeof v === 'function') {
        const rule = rules[key]
        if (rule) {
          out[k] = (...args: any[]) =>
            db.transaction(async (tx) => {
              const actor = await authorize(tx, rule.perm)
              rule.extra?.(actor, args)
              const svc = factory(tx)
              const parent = getPath(svc, prefix)
              let result = await parent[k](...args)
              rule.after?.(result, actor)
              if (rule.audit) await writeAudit(tx, actor, rule.audit(result, args))
              if (rule.redact) result = rule.redact(result, actor)
              return result
            })
        } else if (reads.includes(key)) {
          out[k] = (v as (...a: any[]) => any).bind(getPath(raw, prefix))
        } else {
          // متدی که نه قاعده دارد نه در فهرست خواندنی‌هاست: بسته (امن به‌صورت پیش‌فرض)
          out[k] = () => Promise.reject(new AppError('forbidden', 'این عملیات در لایه دسترسی تعریف نشده است.'))
        }
      } else if (v && typeof v === 'object') out[k] = build(v, path)
      else out[k] = v
    }
    return out
  }
  return build(raw, []) as T
}

const redactCosts = (d: any, actor: EffectiveActor) =>
  d && !can(actor.role, 'costs.view') ? { ...d, items: d.items.map((i: any) => ({ ...i, costs: { fifo: 0, average: 0, last: 0 } })), costsHidden: true } : d

export const SALE_RULES: Record<string, Rule> = {
  create: { perm: 'sales.create', audit: (r) => ({ action: 'sale.create', entityType: 'sales_invoice', entityId: r.invoice.id, summary: `فاکتور فروش ${n(r.invoice.invoiceNumber)} به مبلغ ${money(r.invoice.totalAmount)}` }) },
  cancel: { perm: 'sales.cancel', audit: (_r, [id, reason]) => ({ action: 'sale.cancel', entityType: 'sales_invoice', entityId: id, summary: `ابطال فاکتور فروش${reason ? ` — دلیل: ${reason}` : ''}` }) },
  detail: { perm: 'sales.create', redact: redactCosts },
}
export const SALE_READS = ['list', 'lastSalePrice', 'totalActive']

export const PURCHASE_RULES: Record<string, Rule> = {
  create: { perm: 'purchases.create', audit: (r) => ({ action: 'purchase.create', entityType: 'purchase_invoice', entityId: r.invoice.id, summary: `فاکتور خرید ${n(r.invoice.invoiceNumber)} به مبلغ ${money(r.invoice.totalAmount)}` }) },
  cancel: { perm: 'purchases.cancel', audit: (_r, [id, reason]) => ({ action: 'purchase.cancel', entityType: 'purchase_invoice', entityId: id, summary: `ابطال فاکتور خرید${reason ? ` — دلیل: ${reason}` : ''}` }) },
}
export const PURCHASE_READS = ['list', 'detail', 'lastPurchasePrice']

export const RETURN_RULES: Record<string, Rule> = {
  createSaleReturn: { perm: 'returns.sale', audit: (r) => ({ action: 'return.sale', entityType: 'sale_return', entityId: r.id, summary: `برگشت فروش ${n(r.returnNumber)}` }) },
  createPurchaseReturn: { perm: 'returns.purchase', audit: (r) => ({ action: 'return.purchase', entityType: 'purchase_return', entityId: r.id, summary: `برگشت خرید ${n(r.returnNumber)}` }) },
  cancelSaleReturn: { perm: 'sales.cancel', audit: (_r, [id]) => ({ action: 'return.sale.cancel', entityType: 'sale_return', entityId: id, summary: 'ابطال برگشت فروش' }) },
}
export const RETURN_READS = ['listSaleReturns', 'listPurchaseReturns', 'saleReturnDetail', 'purchaseReturnDetail', 'saleReturnable', 'purchaseReturnable']

export const TRANSFER_RULES: Record<string, Rule> = {
  create: { perm: 'transfers.create', audit: (r) => ({ action: 'transfer.create', entityType: 'transfer', entityId: r.id, summary: `انتقال ${n(r.transferNumber)} بین انبارها` }) },
}
export const TRANSFER_READS = ['list', 'detail']

const sellerReceiptsOnly = (actor: EffectiveActor, args: any[]) => {
  if (actor.role === 'seller' && args[0]?.kind !== 'receipt') throw new AppError('forbidden', 'فروشنده فقط «دریافت» ثبت می‌کند؛ پرداخت را مالک یا مدیر ثبت کند.')
}
const moneyAudit = (r: any) => ({ action: `money.${r.kind}`, entityType: 'money_document', entityId: r.id, summary: `${r.kind === 'receipt' ? 'دریافت' : 'پرداخت'} ${n(r.docNumber)} به مبلغ ${money(r.amount)}` })
export const MONEY_RULES: Record<string, Rule> = {
  create: { perm: 'money.create', extra: sellerReceiptsOnly, audit: moneyAudit },
  settleBalance: {
    perm: 'money.create',
    after: (r, actor) => sellerReceiptsOnly(actor, [r]),
    audit: moneyAudit,
  },
  createOpening: { perm: 'parties.manage', audit: (r) => ({ action: 'party.opening', entityType: 'money_document', entityId: r.id, summary: `مانده اول دوره به مبلغ ${money(r.amount)}` }) },
  createPartyWithOpening: { perm: 'parties.manage', audit: (r) => ({ action: 'party.create', entityType: 'party', entityId: r.id, summary: `طرف حساب «${r.name}» اضافه شد` }) },
  cancel: { perm: 'money.cancel', audit: (_r, [id, reason]) => ({ action: 'money.cancel', entityType: 'money_document', entityId: id, summary: `ابطال سند دریافت/پرداخت${reason ? ` — دلیل: ${reason}` : ''}` }) },
}
export const MONEY_READS = ['settlePlan', 'get', 'list', 'settlementsOf', 'openInvoices', 'invoiceSettlement', 'invoiceSettlements', 'documentsForInvoice', 'balanceOf', 'ledger', 'detail', 'balanceMap', 'balancesReport']

export const CHEQUE_RULES: Record<string, Rule> = {
  clear: { perm: 'cheques.manage', audit: (_r, [id]) => ({ action: 'cheque.clear', entityType: 'cheque', entityId: id, summary: 'وصول چک' }) },
  bounce: { perm: 'cheques.manage', audit: (_r, [id]) => ({ action: 'cheque.bounce', entityType: 'cheque', entityId: id, summary: 'برگشت خوردن چک' }) },
  spend: { perm: 'cheques.manage', audit: (_r, [id]) => ({ action: 'cheque.spend', entityType: 'cheque', entityId: id, summary: 'خرج چک به طرف حساب' }) },
}
export const CHEQUE_READS = ['get', 'list', 'dueUntil']

export const EXPENSE_RULES: Record<string, Rule> = {
  create: { perm: 'expenses.manage', audit: (r) => ({ action: 'expense.create', entityType: 'expense', entityId: r.id, summary: `هزینه به مبلغ ${money(r.amount)}` }) },
  cancel: { perm: 'expenses.manage', audit: (_r, [id]) => ({ action: 'expense.cancel', entityType: 'expense', entityId: id, summary: 'ابطال هزینه' }) },
  list: { perm: 'expenses.manage' },
  getById: { perm: 'expenses.manage' },
}
export const EXPENSE_READS: string[] = []

export const REPORT_RULES: Record<string, Rule> = {
  profitLoss: { perm: 'reports.view' },
  incomeSpending: { perm: 'reports.view' },
  productProfit: { perm: 'costs.view' },
}
export const REPORT_READS = ['stockAlerts']

export const STOCK_RULES: Record<string, Rule> = {
  adjust: { perm: 'stock.adjust', audit: (r) => ({ action: 'stock.adjust', entityType: 'stock_movement', entityId: r.id, summary: `اصلاح موجودی (${r.quantityDelta > 0 ? 'افزایش' : 'کاهش'})` }) },
}
export const STOCK_READS = ['overview', 'totals', 'levelsForProduct', 'recentMovements', 'suggestedUnitCost']

const crud = (entity: string, label: string, perm: Permission): Record<string, Rule> => ({
  [`${entity}.create`]: { perm, audit: (r) => ({ action: `${entity}.create`, entityType: entity, entityId: r.id, summary: `${label} «${r.name}» اضافه شد` }) },
  [`${entity}.update`]: { perm, audit: (r, [id]) => ({ action: `${entity}.update`, entityType: entity, entityId: r?.id ?? id, summary: `${label} «${r?.name ?? ''}» ویرایش شد` }) },
  [`${entity}.setActive`]: { perm, audit: (_r, [id, active]) => ({ action: `${entity}.${active ? 'activate' : 'deactivate'}`, entityType: entity, entityId: id, summary: `${label} ${active ? 'فعال' : 'غیرفعال'} شد` }) },
  [`${entity}.remove`]: { perm, audit: (_r, [id]) => ({ action: `${entity}.remove`, entityType: entity, entityId: id, summary: `${label} حذف شد` }) },
})
export const CATALOG_RULES: Record<string, Rule> = {
  ...crud('groups', 'گروه کالا', 'products.manage'),
  ...crud('warehouses', 'انبار', 'products.manage'),
  ...crud('parties', 'طرف حساب', 'parties.manage'),
  ...crud('customers', 'مشتری', 'parties.manage'),
  ...crud('suppliers', 'تأمین‌کننده', 'parties.manage'),
  ...crud('products', 'کالا', 'products.manage'),
  'units.create': { perm: 'products.manage', audit: (r) => ({ action: 'units.create', entityType: 'unit', entityId: r.id, summary: `واحد «${r.name}» اضافه شد` }) },
  'units.remove': { perm: 'products.manage', audit: (_r, [id]) => ({ action: 'units.remove', entityType: 'unit', entityId: id, summary: 'واحد حذف شد' }) },
}
export const CATALOG_READS = [
  'groups.list', 'groups.getById', 'groups.productCounts', 'units.list', 'units.getById', 'warehouses.list', 'warehouses.getById', 'warehouses.isUsed',
  'warehouses.stockedProductCount', 'parties.list', 'parties.getById', 'customers.list', 'customers.getById', 'suppliers.list', 'suppliers.getById',
  'products.list', 'products.getById', 'products.count', 'products.isUsed',
]

export const securedSales = (db: SqlExecutor) => guard(db, createSaleService, SALE_RULES, SALE_READS)
export const securedPurchases = (db: SqlExecutor) => guard(db, createPurchaseService, PURCHASE_RULES, PURCHASE_READS)
export const securedReturns = (db: SqlExecutor) => guard(db, createReturnService, RETURN_RULES, RETURN_READS)
export const securedTransfers = (db: SqlExecutor) => guard(db, createTransferService, TRANSFER_RULES, TRANSFER_READS)
export const securedMoney = (db: SqlExecutor) => guard(db, createMoneyService, MONEY_RULES, MONEY_READS)
export const securedCheques = (db: SqlExecutor) => guard(db, createChequeService, CHEQUE_RULES, CHEQUE_READS)
export const securedExpenses = (db: SqlExecutor) => guard(db, createExpenseService, EXPENSE_RULES, EXPENSE_READS)
export const securedReports = (db: SqlExecutor) => guard(db, createReportService, REPORT_RULES, REPORT_READS)
export const securedStock = (db: SqlExecutor) => guard(db, createStockService, STOCK_RULES, STOCK_READS)
export const securedCatalog = (db: SqlExecutor) => guard(db, createCatalogService, CATALOG_RULES, CATALOG_READS)

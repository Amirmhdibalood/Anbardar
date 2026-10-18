import { searchTokens } from '../utils/search'
import type { ProductUnitInput } from '../models/catalog'
import type { SqlExecutor } from '../database/types'
import type { ProductInput } from '../models/catalog'
import { createRepositories } from '../repositories'
import type { CrudRepository, ProductFilter } from '../repositories'
import type { Unit, UnitInput } from '../models/catalog'
import { DEFAULT_UNIT_ID } from '../models/units'
import { sortByName, compareFa } from '../utils/collate'
import { AppError, ValidationError } from '../utils/errors'
import { formatInteger } from '../utils/persian'
import { isWholeQuantity } from '../utils/quantity'
import { validateParty, validateProduct, validateProductGroup, validateUnit, validateWarehouse } from '../validation/entities'

/** CRUD ساده با اعتبارسنجی پیش از ذخیره */
function crudService<T extends { name: string }, I>(repo: CrudRepository<T, I>, validate: (input: I) => I) {
  return {
    /** مرتب‌شده بر اساس نام با ترتیب حروف فارسی */
    list: async (options?: { includeInactive?: boolean }) => sortByName(await repo.list(options)),
    getById: (id: string) => repo.getById(id),
    create: async (input: I) => repo.create(validate(input)),
    update: async (id: string, input: I) => repo.update(id, validate(input)),
    /** غیرفعال/فعال‌سازی (راه امن به‌جای حذف) */
    setActive: (id: string, active: boolean) => repo.setActive(id, active),
    /** حذف فقط برای مواردی که هیچ‌جا استفاده نشده‌اند؛ وگرنه خطای فارسی «غیرفعال کنید» */
    remove: (id: string) => repo.remove(id),
  }
}

const MAX_CODE_ATTEMPTS = 100

/**
 * خدمات اطلاعات پایه: گروه کالا، انبار، مشتری، تأمین‌کننده و کالا.
 * `db` می‌تواند اتصال اصلی یا یک تراکنش باشد.
 */
export function createCatalogService(db: SqlExecutor) {
  const repos = createRepositories(db)

  return {
    groups: {
      ...crudService(repos.productGroups, validateProductGroup),
      /** تعداد کالاهای هر گروه (شناسه ← تعداد) */
      productCounts: () => repos.productGroups.productCounts(),
      /** حذف فقط برای گروه بدون کالا؛ گروهِ دارای کالا فقط غیرفعال می‌شود */
      remove: async (id: string) => {
        const count = (await repos.productGroups.productCounts())[id] ?? 0
        if (count > 0) {
          throw new AppError(
            'in_use',
            `در این گروه ${formatInteger(count)} کالا وجود دارد، پس حذف نمی‌شود. اگر دیگر لازمش ندارید، آن را غیرفعال کنید.`,
          )
        }
        await repos.productGroups.remove(id)
      },
    },
    units: {
      list: async (options?: { includeInactive?: boolean }) =>
        (await repos.units.list(options)).sort((a, b) => a.sortOrder - b.sortOrder || compareFa(a.name, b.name)),
      getById: (id: string) => repos.units.getById(id),
      /** ساخت واحد سفارشی؛ نام تکراری (حتی با واحدهای پیش‌فرض) پذیرفته نمی‌شود */
      create: async (input: UnitInput): Promise<Unit> => {
        const clean = validateUnit(input)
        if (await repos.units.getByName(clean.name)) throw new ValidationError({ name: 'واحدی با این نام وجود دارد.' }, 'duplicate')
        return repos.units.create(clean)
      },
      /** حذف واحد سفارشیِ استفاده‌نشده */
      remove: async (id: string) => {
        if (await repos.units.isUsed(id)) throw new AppError('in_use', 'این واحد برای کالاها استفاده شده است، پس حذف نمی‌شود.')
        await repos.units.remove(id)
      },
    },
    warehouses: {
      ...crudService(repos.warehouses, validateWarehouse),
      isUsed: (id: string) => repos.warehouses.isUsed(id),
      /** تعداد کالاهایی که در این انبار موجودی دارند */
      stockedProductCount: (id: string) => repos.warehouses.stockedProductCount(id),
      /** حداقل یک انبار فعال باید بماند (بدون انبار فعال نمی‌شود خرید و فروش ثبت کرد) */
      setActive: async (id: string, active: boolean) => {
        if (!active) {
          const others = (await repos.warehouses.list()).filter((w) => w.id !== id)
          if (others.length === 0) throw new AppError('protected', 'این تنها انبار فعال است و غیرفعال نمی‌شود. اول انبار دیگری بسازید.')
        }
        await repos.warehouses.setActive(id, active)
      },
      remove: async (id: string) => {
        if (await repos.warehouses.isUsed(id)) {
          throw new AppError('in_use', 'در این انبار موجودی یا سند ثبت شده است، پس حذف نمی‌شود. به‌جای حذف، آن را غیرفعال کنید.')
        }
        const others = (await repos.warehouses.list()).filter((w) => w.id !== id)
        if (others.length === 0) throw new AppError('protected', 'این تنها انبار شماست و حذف نمی‌شود. می‌توانید نامش را تغییر دهید.')
        await repos.warehouses.remove(id)
      },
    },
    /** طرف حساب واحد (مشتری، تأمین‌کننده یا هر دو) */
    parties: crudService(repos.parties, (i) => validateParty(i, 'طرف حساب', true)),
    customers: crudService(repos.customers, (i) => validateParty(i, 'مشتری')),
    suppliers: crudService(repos.suppliers, (i) => validateParty(i, 'تأمین‌کننده')),

    products: {
      /** فهرست کالاها؛ search زیررشته نام، کد یا گروه را می‌گردد (utils/search.normalizeSearch) */
      list: async (filter: ProductSearch = {}) => {
        const { search, limit, offset, ...rest } = filter
        // جستجوی یکسان‌شده در نام، کد و گروه (داخل SQL)؛ ترتیب فارسی در SQLite ممکن نیست، پس مرتب‌سازی بعد از فیلتر
        const all = sortByName(await repos.products.list({ ...rest, tokens: searchTokens(search) }))
        return limit === undefined ? all : all.slice(offset ?? 0, (offset ?? 0) + limit)
      },
      getById: (id: string) => repos.products.getById(id),
      count: (options?: { includeInactive?: boolean }) => repos.products.count(options),
      /** آیا کالا در موجودی یا اسناد استفاده شده؟ (استفاده‌شده فقط غیرفعال می‌شود) */
      isUsed: (id: string) => repos.products.isUsed(id),
      setActive: (id: string, active: boolean) => repos.products.setActive(id, active),
      remove: async (id: string) => {
        if (await repos.products.isUsed(id)) {
          throw new AppError('in_use', 'این کالا در موجودی یا اسناد استفاده شده است، پس حذف نمی‌شود. به‌جای حذف، آن را غیرفعال کنید.')
        }
        await repos.products.remove(id)
      },

      /** ثبت کالا؛ اگر کد داده نشود کد خودکار یکتا ساخته می‌شود */
      create: (input: ProductInput) =>
        db.transaction(async (tx) => {
          const r = createRepositories(tx)
          const clean = validateProduct(input)
          await assertGroupUsable(r, clean.groupId)
          await assertUnitRules(r, clean)
          let code = clean.code
          if (code) {
            if (await r.products.getByCode(code)) throw duplicateCode()
          } else {
            code = await generateFreeCode(r)
          }
          const created = await r.products.create({ ...clean, code })
          if (input.subUnits) {
            await r.products.syncSubUnits(created.id, await validateSubUnits(r, created.unitId, created.unitAllowsFraction, input.subUnits))
            return (await r.products.getById(created.id)) ?? created
          }
          return created
        }),

      update: (id: string, input: ProductInput) =>
        db.transaction(async (tx) => {
          const r = createRepositories(tx)
          const existing = await r.products.getById(id)
          if (!existing) throw new AppError('not_found', 'کالا پیدا نشد. ممکن است قبلاً تغییر کرده باشد.')
          const clean = validateProduct(input)
          if (clean.groupId !== existing.groupId) await assertGroupUsable(r, clean.groupId)
          if (clean.unitId !== existing.unitId && (await r.products.isUsed(id))) {
            throw new ValidationError({ unitId: 'واحد این کالا بعد از ثبت اولین تراکنش قابل تغییر نیست.' })
          }
          await assertUnitRules(r, clean, clean.unitId !== existing.unitId)
          const code = clean.code ?? existing.code
          if (code !== existing.code && (await r.products.getByCode(code))) throw duplicateCode()
          const updated = await r.products.update(id, { ...clean, code })
          if (input.subUnits) {
            await r.products.syncSubUnits(id, await validateSubUnits(r, updated.unitId, updated.unitAllowsFraction, input.subUnits))
            return (await r.products.getById(id)) ?? updated
          }
          return updated
        }),
    },
  }
}

export interface ProductSearch extends Omit<ProductFilter, 'nameContains' | 'codeContains'> {
  /** متن جستجو در نام و کد */
  search?: string
}

type Repos = ReturnType<typeof createRepositories>

export const MAX_SUB_UNITS = 5

/** اعتبارسنجی واحدهای فرعی: واحد معتبر و غیر از واحد پایه، بدون تکرار، ضریب مثبت؛ برای پایه بدون اعشار ضریب صحیح */
async function validateSubUnits(r: Repos, baseUnitId: string, baseAllowsFraction: boolean, list: readonly ProductUnitInput[]): Promise<ProductUnitInput[]> {
  if (list.length > MAX_SUB_UNITS) throw new ValidationError({ subUnits: `حداکثر ${MAX_SUB_UNITS} واحد فرعی برای هر کالا.` })
  const seen = new Set<string>()
  for (const [i, u] of list.entries()) {
    const key = `subUnits.${i}`
    if (u.unitId === baseUnitId) throw new ValidationError({ [key]: 'واحد فرعی نباید همان واحد اصلی کالا باشد.' })
    if (seen.has(u.unitId)) throw new ValidationError({ [key]: 'این واحد دو بار آمده است.' })
    seen.add(u.unitId)
    const unit = await r.units.getById(u.unitId)
    if (!unit) throw new ValidationError({ [key]: 'واحد انتخاب‌شده پیدا نشد.' })
    if (!Number.isSafeInteger(u.factor) || u.factor <= 0 || u.factor > 1_000_000_000) throw new ValidationError({ [key]: 'ضریب تبدیل را بیشتر از صفر وارد کنید.' })
    if (u.factor === 1000) throw new ValidationError({ [key]: 'ضریب ۱ یعنی همان واحد اصلی؛ عدد دیگری وارد کنید.' })
    if (!baseAllowsFraction && u.factor % 1000 !== 0) throw new ValidationError({ [key]: 'واحد اصلی اعشار ندارد؛ ضریب باید عدد صحیح باشد.' })
  }
  return [...list]
}

function duplicateCode(): AppError {
  return new ValidationError({ code: 'این کد برای کالای دیگری ثبت شده است. کد دیگری انتخاب کنید.' }, 'duplicate')
}

/** واحد باید وجود داشته باشد (و برای انتخاب جدید فعال باشد) و نقطه سفارش با قانون اعشار واحد هماهنگ باشد */
async function assertUnitRules(r: Repos, product: ProductInput, unitChanged = true): Promise<void> {
  const unit = await r.units.getById(product.unitId ?? DEFAULT_UNIT_ID)
  if (!unit || (unitChanged && !unit.isActive)) throw new ValidationError({ unitId: 'واحد انتخاب‌شده معتبر یا فعال نیست.' })
  if (!unit.allowsFraction && !isWholeQuantity(product.reorderPoint ?? 0)) {
    throw new ValidationError({ reorderPoint: `نقطه سفارش باید عدد صحیح باشد (واحد «${unit.name}» اعشار ندارد).` })
  }
}

async function assertGroupUsable(r: ReturnType<typeof createRepositories>, groupId: string): Promise<void> {
  const group = await r.productGroups.getById(groupId)
  if (!group || !group.isActive) throw new AppError('validation', 'گروه کالای انتخاب‌شده معتبر یا فعال نیست.')
}

async function generateFreeCode(r: ReturnType<typeof createRepositories>): Promise<string> {
  for (let i = 0; i < MAX_CODE_ATTEMPTS; i++) {
    const code = String(await r.sequences.next('product_code'))
    if (!(await r.products.getByCode(code))) return code
  }
  throw new AppError('database', 'ساخت کد خودکار کالا ممکن نشد. کد را دستی وارد کنید.')
}

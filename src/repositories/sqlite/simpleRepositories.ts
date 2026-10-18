import { sqlNormalized } from '../../utils/search'
import type { Product, ProductUnit, ProductUnitInput, ProductGroup, ProductGroupInput, ProductInput, Unit, UnitInput, Warehouse, WarehouseInput } from '../../models/catalog'
import type { Party, PartyInput, PartyRole } from '../../models/party'
import type { SqlExecutor, SqlRow, SqlValue } from '../../database/types'
import type { ListOptions, PartyRepository, ProductFilter, ProductGroupRepository, ProductRepository, ProductWithStock, UnitRepository, WarehouseRepository } from '../types'
import { EntityRepository } from './entityRepository'
import { DEFAULT_UNIT_ID } from '../../models/units'
import { nowIso } from '../../utils/time'
import { newId } from '../../utils/id'
import { baseFromRow, escapeLike, notFound, num, numOrNull, str, strOrNull } from './helpers'

export class SqliteProductGroupRepository extends EntityRepository<ProductGroup, ProductGroupInput> implements ProductGroupRepository {
  protected readonly table = 'product_groups'
  protected readonly label = 'گروه کالا'
  protected fromRow(r: SqlRow): ProductGroup {
    return { ...this.base(r), name: str(r, 'name'), description: strOrNull(r, 'description'), markupBp: numOrNull(r, 'markup_bp') }
  }
  protected columns(i: ProductGroupInput) {
    return { name: i.name, description: i.description ?? null, markup_bp: i.markupBp ?? null }
  }
  async productCounts(): Promise<Record<string, number>> {
    const rows = await this.db.all<{ group_id: string; n: number }>('SELECT group_id, COUNT(*) AS n FROM products GROUP BY group_id')
    return Object.fromEntries(rows.map((r) => [String(r.group_id), Number(r.n)]))
  }
}

export class SqliteUnitRepository extends EntityRepository<Unit, UnitInput> implements UnitRepository {
  protected readonly table = 'units'
  protected readonly label = 'واحد'
  protected readonly orderBy = 'sort_order, name'
  protected fromRow(r: SqlRow): Unit {
    return {
      ...this.base(r),
      name: str(r, 'name'),
      allowsFraction: num(r, 'allows_fraction') === 1,
      isSystem: num(r, 'is_system') === 1,
      sortOrder: num(r, 'sort_order'),
    }
  }
  protected columns(i: UnitInput) {
    return { name: i.name, allows_fraction: i.allowsFraction ? 1 : 0, is_system: 0, sort_order: 1000 }
  }
  override async update(id: string, input: UnitInput): Promise<Unit> {
    // sort_order و is_system هنگام ویرایش دست نمی‌خورند
    const result = await this.db.run('UPDATE units SET name = ?, allows_fraction = ?, updated_at = ? WHERE id = ?', [
      input.name,
      input.allowsFraction ? 1 : 0,
      nowIso(),
      id,
    ])
    if (result.changes === 0) throw notFound(this.label)
    return this.mustGet(id)
  }
  async getByName(name: string): Promise<Unit | null> {
    const row = await this.db.get('SELECT * FROM units WHERE name = ?', [name])
    return row ? this.fromRow(row) : null
  }
  async isUsed(id: string): Promise<boolean> {
    return (await this.db.get('SELECT 1 AS x FROM products WHERE unit_id = ? LIMIT 1', [id])) !== undefined
  }
}

export class SqliteWarehouseRepository extends EntityRepository<Warehouse, WarehouseInput> implements WarehouseRepository {
  protected readonly table = 'warehouses'
  protected readonly label = 'انبار'
  protected fromRow(r: SqlRow): Warehouse {
    return { ...this.base(r), name: str(r, 'name'), description: strOrNull(r, 'description') }
  }
  protected columns(i: WarehouseInput) {
    return { name: i.name, description: i.description ?? null }
  }
  async isUsed(id: string): Promise<boolean> {
    const row = await this.db.get(
      `SELECT 1 AS x WHERE EXISTS (SELECT 1 FROM stock_movements WHERE warehouse_id = ?)
         OR EXISTS (SELECT 1 FROM sales_invoices WHERE warehouse_id = ?)
         OR EXISTS (SELECT 1 FROM purchase_invoices WHERE warehouse_id = ?)`,
      [id, id, id],
    )
    return row !== undefined
  }
  async stockedProductCount(id: string): Promise<number> {
    const row = await this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM warehouse_stock WHERE warehouse_id = ? AND quantity <> 0', [id])
    return Number(row?.n ?? 0)
  }
}

function partyFromRow(r: SqlRow, base: ReturnType<typeof baseFromRow>): Party {
  return {
    ...base,
    name: str(r, 'name'),
    phone: strOrNull(r, 'phone'),
    address: strOrNull(r, 'address'),
    description: strOrNull(r, 'description'),
    isCustomer: num(r, 'is_customer') === 1,
    isSupplier: num(r, 'is_supplier') === 1,
    isSystem: num(r, 'is_system') === 1,
  }
}

/**
 * طرف حساب (جدول parties). با `role` همان رفتار قبلی «مشتریان» یا «تأمین‌کنندگان» را دارد:
 * فقط طرف‌های همان نقش را می‌بیند و هنگام ساخت همان نقش را می‌گذارد (نقش دیگر دست نمی‌خورد).
 */
export class SqlitePartyRepository extends EntityRepository<Party, PartyInput> implements PartyRepository {
  protected readonly table = 'parties'
  protected readonly label: string
  constructor(
    db: SqlExecutor,
    private readonly role: PartyRole | null = null,
  ) {
    super(db)
    this.label = role === 'customer' ? 'مشتری' : role === 'supplier' ? 'تأمین‌کننده' : 'طرف حساب'
  }
  private get roleWhere(): string {
    return this.role === 'customer' ? 'is_customer = 1' : this.role === 'supplier' ? 'is_supplier = 1' : '1 = 1'
  }
  protected fromRow(r: SqlRow): Party {
    return partyFromRow(r, this.base(r))
  }
  protected columns(i: PartyInput): Record<string, SqlValue> {
    const cols: Record<string, SqlValue> = { name: i.name, phone: i.phone ?? null, address: i.address ?? null, description: i.description ?? null }
    if (this.role === 'customer') cols['is_customer'] = 1
    else if (this.role === 'supplier') cols['is_supplier'] = 1
    else {
      cols['is_customer'] = i.isCustomer ? 1 : 0
      cols['is_supplier'] = i.isSupplier ? 1 : 0
    }
    return cols
  }
  override async getById(id: string): Promise<Party | null> {
    const row = await this.db.get(`SELECT * FROM parties WHERE id = ? AND ${this.roleWhere}`, [id])
    return row ? this.fromRow(row) : null
  }
  override async list(options: ListOptions = {}): Promise<Party[]> {
    const rows = await this.db.all(`SELECT * FROM parties WHERE ${this.roleWhere}${options.includeInactive ? '' : ' AND is_active = 1'} ORDER BY name`)
    return rows.map((r) => this.fromRow(r))
  }
  async isUsed(id: string): Promise<boolean> {
    const row = await this.db.get(
      `SELECT 1 AS x WHERE EXISTS (SELECT 1 FROM sales_invoices WHERE customer_id = ?)
         OR EXISTS (SELECT 1 FROM purchase_invoices WHERE supplier_id = ?)
         OR EXISTS (SELECT 1 FROM money_documents WHERE party_id = ?)`,
      [id, id, id],
    )
    return row !== undefined
  }
}

type ProductWriteInput = ProductInput & { code: string }

export class SqliteProductRepository extends EntityRepository<Product, ProductWriteInput> implements ProductRepository {
  protected readonly table = 'products'
  protected readonly label = 'کالا'

  protected fromRow(r: SqlRow): Product {
    return {
      ...this.base(r),
      code: str(r, 'code'),
      name: str(r, 'name'),
      groupId: str(r, 'group_id'),
      unitId: str(r, 'unit_id'),
      unitName: str(r, 'unit_name'),
      unitAllowsFraction: num(r, 'unit_allows_fraction') === 1,
      subUnit: strOrNull(r, 'sub_unit'),
      conversionRatio: numOrNull(r, 'conversion_ratio'),
      reorderPoint: num(r, 'reorder_point'),
      salePrice: num(r, 'sale_price'),
      description: strOrNull(r, 'description'),
      subUnits: parseSubUnits(r['sub_units']),
    }
  }

  /** همگام‌سازی واحدهای فرعی: جدید ← درج؛ حذف‌شده ← غیرفعال؛ ضریب تغییرکرده ← به‌روزرسانی (Trigger اگر استفاده شده باشد جلوگیری می‌کند) */
  async syncSubUnits(productId: string, list: readonly ProductUnitInput[]): Promise<void> {
    const rows = await this.db.all<{ id: string; unit_id: string; factor: number; is_active: number }>('SELECT id, unit_id, factor, is_active FROM product_units WHERE product_id = ?', [productId])
    const now = nowIso()
    const wanted = new Map(list.map((u) => [u.unitId, u.factor]))
    for (const row of rows) {
      const factor = wanted.get(row.unit_id)
      if (factor === undefined) {
        if (row.is_active) await this.db.run('UPDATE product_units SET is_active = 0, updated_at = ? WHERE id = ?', [now, row.id])
      } else if (factor !== row.factor || !row.is_active) {
        await this.db.run('UPDATE product_units SET factor = ?, is_active = 1, updated_at = ? WHERE id = ?', [factor, now, row.id])
      }
      wanted.delete(row.unit_id)
    }
    for (const [unitId, factor] of wanted) {
      await this.db.run('INSERT INTO product_units (id, product_id, unit_id, factor, created_at, updated_at, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)', [newId(), productId, unitId, factor, now, now])
    }
  }

  protected columns(i: ProductWriteInput) {
    return {
      code: i.code,
      name: i.name,
      group_id: i.groupId,
      unit_id: i.unitId ?? DEFAULT_UNIT_ID,
      sub_unit: i.subUnit ?? null,
      conversion_ratio: i.conversionRatio ?? null,
      reorder_point: i.reorderPoint ?? 0,
      sale_price: i.salePrice ?? 0,
      description: i.description ?? null,
    }
  }

  override async getById(id: string): Promise<Product | null> {
    const row = await this.db.get(`${SELECT_PRODUCT} WHERE p.id = ?`, [id])
    return row ? this.fromRow(row) : null
  }

  async getByCode(code: string): Promise<Product | null> {
    const row = await this.db.get(`${SELECT_PRODUCT} WHERE p.code = ?`, [code])
    return row ? this.fromRow(row) : null
  }

  async count(options: ListOptions = {}): Promise<number> {
    const row = await this.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM products ${options.includeInactive ? '' : 'WHERE is_active = 1'}`)
    return row?.n ?? 0
  }

  async isUsed(id: string): Promise<boolean> {
    const row = await this.db.get(
      `SELECT 1 AS x WHERE EXISTS (SELECT 1 FROM stock_movements WHERE product_id = ?)
         OR EXISTS (SELECT 1 FROM sales_items WHERE product_id = ?)
         OR EXISTS (SELECT 1 FROM purchase_items WHERE product_id = ?)`,
      [id, id, id],
    )
    return row !== undefined
  }

  private where(filter: ProductFilter): { where: string; params: (string | number)[] } {
    const where: string[] = []
    const params: (string | number)[] = []
    if (!filter.includeInactive) where.push('p.is_active = 1')
    if (filter.groupId) {
      where.push('p.group_id = ?')
      params.push(filter.groupId)
    }
    const likes: string[] = []
    if (filter.nameContains?.trim()) {
      likes.push("p.name LIKE ? ESCAPE '\\'")
      params.push(`%${escapeLike(filter.nameContains.trim())}%`)
    }
    if (filter.codeContains?.trim()) {
      likes.push("p.code LIKE ? ESCAPE '\\'")
      params.push(`%${escapeLike(filter.codeContains.trim())}%`)
    }
    if (likes.length) where.push(`(${likes.join(' OR ')})`)
    for (const t of filter.tokens ?? []) {
      where.push(`instr(${PRODUCT_HAYSTACK}, ?) > 0`)
      params.push(t)
    }
    return { where: where.length ? 'WHERE ' + where.join(' AND ') : '', params }
  }

  // list با فیلتر (امضای گسترده‌تر از CrudRepository.list)
  override async list(filter: ProductFilter = {}): Promise<Product[]> {
    const { where, params } = this.where(filter)
    let sql = `${SELECT_PRODUCT} ${where} ORDER BY p.name, p.code`
    if (filter.limit !== undefined) {
      sql += ' LIMIT ? OFFSET ?'
      params.push(filter.limit, filter.offset ?? 0)
    }
    const rows = await this.db.all(sql, params)
    return rows.map((r) => this.fromRow(r))
  }

  async listWithStock(filter: ProductFilter & { warehouseId?: string } = {}): Promise<ProductWithStock[]> {
    const { where, params } = this.where(filter)
    const warehouse = filter.warehouseId ? ' AND s.warehouse_id = ?' : ''
    const sql = `SELECT p.*, u.name AS unit_name, u.allows_fraction AS unit_allows_fraction,
  COALESCE((SELECT SUM(s.quantity) FROM warehouse_stock s WHERE s.product_id = p.id${warehouse}), 0) AS stock_qty, ${SUB_UNITS}
FROM products p JOIN units u ON u.id = p.unit_id ${where} ORDER BY p.name, p.code${filter.limit !== undefined ? ' LIMIT ? OFFSET ?' : ''}`
    if (filter.limit !== undefined) params.push(filter.limit, filter.offset ?? 0)
    const rows = await this.db.all(sql, filter.warehouseId ? [filter.warehouseId, ...params] : params)
    return rows.map((r) => ({ product: this.fromRow(r), quantity: num(r, 'stock_qty') }))
  }
}

/** متن قابل جستجوی کالا: نام + کد + نام گروه، یکسان‌شده (بدون فاصله، ی/ک فارسی، ارقام لاتین) */
const PRODUCT_HAYSTACK = sqlNormalized("p.name || char(31) || p.code || char(31) || COALESCE((SELECT g.name FROM product_groups g WHERE g.id = p.group_id), '')")

const SUB_UNITS = `(SELECT group_concat(pu.id || char(31) || pu.unit_id || char(31) || uu.name || char(31) || uu.allows_fraction || char(31) || pu.factor || char(31) || pu.is_active, char(30))
   FROM product_units pu JOIN units uu ON uu.id = pu.unit_id WHERE pu.product_id = p.id) AS sub_units`
const SELECT_PRODUCT = `SELECT p.*, u.name AS unit_name, u.allows_fraction AS unit_allows_fraction, ${SUB_UNITS}
FROM products p JOIN units u ON u.id = p.unit_id`

/** ردیف‌های product_units که با group_concat فشرده شده‌اند (جداکننده‌ها نویسه‌های کنترلی‌اند) */
function parseSubUnits(raw: unknown): ProductUnit[] {
  if (typeof raw !== 'string' || raw === '') return []
  return raw
    .split(String.fromCharCode(30))
    .map((part) => part.split(String.fromCharCode(31)))
    .map(([id = '', unitId = '', unitName = '', frac = '0', factor = '0', active = '1']) => ({ id, unitId, unitName, allowsFraction: frac === '1', factor: Number(factor), isActive: active === '1' }))
    .sort((a, b) => a.factor - b.factor)
}

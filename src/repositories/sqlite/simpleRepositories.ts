import type { Product, ProductGroup, ProductGroupInput, ProductInput, Unit, UnitInput, Warehouse, WarehouseInput } from '../../models/catalog'
import type { Customer, PartyInput, Supplier } from '../../models/party'
import type { SqlRow } from '../../database/types'
import type { CustomerRepository, ListOptions, ProductFilter, ProductGroupRepository, ProductRepository, ProductWithStock, SupplierRepository, UnitRepository, WarehouseRepository } from '../types'
import { EntityRepository } from './entityRepository'
import { DEFAULT_UNIT_ID } from '../../models/units'
import { nowIso } from '../../utils/time'
import { escapeLike, notFound, num, numOrNull, str, strOrNull } from './helpers'

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

function partyColumns(i: PartyInput) {
  return { name: i.name, phone: i.phone ?? null, address: i.address ?? null, description: i.description ?? null }
}

export class SqliteCustomerRepository extends EntityRepository<Customer, PartyInput> implements CustomerRepository {
  protected readonly table = 'customers'
  protected readonly label = 'مشتری'
  protected fromRow(r: SqlRow): Customer {
    return {
      ...this.base(r),
      name: str(r, 'name'),
      phone: strOrNull(r, 'phone'),
      address: strOrNull(r, 'address'),
      description: strOrNull(r, 'description'),
      isSystem: num(r, 'is_system') === 1,
    }
  }
  protected columns = partyColumns
}

export class SqliteSupplierRepository extends EntityRepository<Supplier, PartyInput> implements SupplierRepository {
  protected readonly table = 'suppliers'
  protected readonly label = 'تأمین‌کننده'
  protected fromRow(r: SqlRow): Supplier {
    return {
      ...this.base(r),
      name: str(r, 'name'),
      phone: strOrNull(r, 'phone'),
      address: strOrNull(r, 'address'),
      description: strOrNull(r, 'description'),
      isSystem: num(r, 'is_system') === 1,
    }
  }
  protected columns = partyColumns
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
  COALESCE((SELECT SUM(s.quantity) FROM warehouse_stock s WHERE s.product_id = p.id${warehouse}), 0) AS stock_qty
FROM products p JOIN units u ON u.id = p.unit_id ${where} ORDER BY p.name, p.code`
    const rows = await this.db.all(sql, filter.warehouseId ? [filter.warehouseId, ...params] : params)
    return rows.map((r) => ({ product: this.fromRow(r), quantity: num(r, 'stock_qty') }))
  }
}

const SELECT_PRODUCT = `SELECT p.*, u.name AS unit_name, u.allows_fraction AS unit_allows_fraction
FROM products p JOIN units u ON u.id = p.unit_id`

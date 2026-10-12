import type { BaseEntity } from '../../models/common'
import type { SqlExecutor, SqlRow, SqlValue } from '../../database/types'
import { newId } from '../../utils/id'
import { nowIso } from '../../utils/time'
import type { CrudRepository, ListOptions } from '../types'
import { baseFromRow, insertSql, notFound } from './helpers'

/** پیاده‌سازی مشترک CRUD برای جدول‌هایی که ستون‌های استاندارد دارند */
export abstract class EntityRepository<T extends BaseEntity, Input> implements CrudRepository<T, Input> {
  protected abstract readonly table: string
  protected abstract readonly label: string
  protected readonly orderBy: string = 'name'

  constructor(protected readonly db: SqlExecutor) {}

  protected abstract fromRow(row: SqlRow): T
  /** ستون‌های مخصوص این جدول (بدون ستون‌های استاندارد) */
  protected abstract columns(input: Input): Record<string, SqlValue>

  async getById(id: string): Promise<T | null> {
    const row = await this.db.get(`SELECT * FROM ${this.table} WHERE id = ?`, [id])
    return row ? this.fromRow(row) : null
  }

  async list(options: ListOptions = {}): Promise<T[]> {
    const where = options.includeInactive ? '' : 'WHERE is_active = 1'
    const rows = await this.db.all(`SELECT * FROM ${this.table} ${where} ORDER BY ${this.orderBy}`)
    return rows.map((r) => this.fromRow(r))
  }

  async create(input: Input): Promise<T> {
    const id = newId()
    const now = nowIso()
    const { sql, params } = insertSql(this.table, {
      id,
      ...this.columns(input),
      created_at: now,
      updated_at: now,
      is_active: 1,
      created_by: null,
    })
    await this.db.run(sql, params)
    return this.mustGet(id)
  }

  async update(id: string, input: Input): Promise<T> {
    const columns = this.columns(input)
    const names = Object.keys(columns)
    const result = await this.db.run(
      `UPDATE ${this.table} SET ${names.map((n) => `${n} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
      [...names.map((n) => columns[n] as SqlValue), nowIso(), id],
    )
    if (result.changes === 0) throw notFound(this.label)
    return this.mustGet(id)
  }

  async setActive(id: string, active: boolean): Promise<void> {
    const result = await this.db.run(`UPDATE ${this.table} SET is_active = ?, updated_at = ? WHERE id = ?`, [active ? 1 : 0, nowIso(), id])
    if (result.changes === 0) throw notFound(this.label)
  }

  async remove(id: string): Promise<void> {
    const result = await this.db.run(`DELETE FROM ${this.table} WHERE id = ?`, [id])
    if (result.changes === 0) throw notFound(this.label)
  }

  protected async mustGet(id: string): Promise<T> {
    const entity = await this.getById(id)
    if (!entity) throw notFound(this.label)
    return entity
  }

  protected base(row: SqlRow): BaseEntity {
    return baseFromRow(row)
  }
}

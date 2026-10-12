import type { SqlExecutor, SqlRow, SqlValue } from '../../database/types'
import type { StockInconsistency, StockLevel, StockMovement, StockMovementInput, MovementType, DocumentType, MovementCosts } from '../../models/stock'
import { newId } from '../../utils/id'
import { nowIso } from '../../utils/time'
import type { IsoDateTime } from '../../models/common'
import type { MovementFilter, StockFilter, StockRepository } from '../types'
import { baseFromRow, insertSql, num, str, strOrNull } from './helpers'

function movementFromRow(r: SqlRow): StockMovement {
  return {
    ...baseFromRow(r),
    productId: str(r, 'product_id'),
    warehouseId: str(r, 'warehouse_id'),
    quantityDelta: num(r, 'quantity_delta'),
    movementType: str(r, 'movement_type') as MovementType,
    documentType: strOrNull(r, 'document_type') as DocumentType | null,
    documentId: strOrNull(r, 'document_id'),
    occurredAt: str(r, 'occurred_at'),
    note: strOrNull(r, 'note'),
    documentLineId: strOrNull(r, 'document_line_id'),
    costs: r['cost_fifo'] === null || r['cost_fifo'] === undefined ? null : { fifo: num(r, 'cost_fifo'), average: num(r, 'cost_average'), last: num(r, 'cost_last') },
  }
}

export class SqliteStockRepository implements StockRepository {
  constructor(private readonly db: SqlExecutor) {}

  async getQuantity(warehouseId: string, productId: string): Promise<number> {
    const row = await this.db.get<{ quantity: number }>('SELECT quantity FROM warehouse_stock WHERE warehouse_id = ? AND product_id = ?', [
      warehouseId,
      productId,
    ])
    return row ? Number(row.quantity) : 0
  }

  async listLevels(filter: StockFilter = {}): Promise<StockLevel[]> {
    const where: string[] = []
    const params: SqlValue[] = []
    if (filter.warehouseId) {
      where.push('warehouse_id = ?')
      params.push(filter.warehouseId)
    }
    if (filter.productId) {
      where.push('product_id = ?')
      params.push(filter.productId)
    }
    const rows = await this.db.all(`SELECT warehouse_id, product_id, quantity FROM warehouse_stock ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`, params)
    return rows.map((r) => ({ warehouseId: str(r, 'warehouse_id'), productId: str(r, 'product_id'), quantity: num(r, 'quantity') }))
  }

  async addToCache(warehouseId: string, productId: string, delta: number): Promise<void> {
    const now = nowIso()
    await this.db.transaction(async (tx) => {
      const result = await tx.run('UPDATE warehouse_stock SET quantity = quantity + ?, updated_at = ? WHERE warehouse_id = ? AND product_id = ?', [
        delta,
        now,
        warehouseId,
        productId,
      ])
      if (result.changes === 0) {
        const { sql, params } = insertSql('warehouse_stock', {
          id: newId(),
          warehouse_id: warehouseId,
          product_id: productId,
          quantity: delta,
          created_at: now,
          updated_at: now,
          is_active: 1,
          created_by: null,
        })
        await tx.run(sql, params)
      }
    })
  }

  async insertMovement(input: StockMovementInput & { occurredAt: IsoDateTime; costs?: MovementCosts | null }): Promise<StockMovement> {
    const id = newId()
    const now = nowIso()
    const { sql, params } = insertSql('stock_movements', {
      id,
      product_id: input.productId,
      warehouse_id: input.warehouseId,
      quantity_delta: input.quantityDelta,
      movement_type: input.movementType,
      document_type: input.documentType ?? null,
      document_id: input.documentId ?? null,
      document_line_id: input.documentLineId ?? null,
      occurred_at: input.occurredAt,
      note: input.note ?? null,
      cost_fifo: input.costs?.fifo ?? null,
      cost_average: input.costs?.average ?? null,
      cost_last: input.costs?.last ?? null,
      created_at: now,
      updated_at: now,
      is_active: 1,
      created_by: null,
    })
    await this.db.run(sql, params)
    const row = await this.db.get('SELECT * FROM stock_movements WHERE id = ?', [id])
    return movementFromRow(row as SqlRow)
  }

  async getMovement(id: string): Promise<StockMovement | null> {
    const row = await this.db.get('SELECT * FROM stock_movements WHERE id = ?', [id])
    return row ? movementFromRow(row) : null
  }

  async listMovements(filter: MovementFilter = {}): Promise<StockMovement[]> {
    const where: string[] = []
    const params: SqlValue[] = []
    const add = (clause: string, value: string | undefined) => {
      if (value) {
        where.push(clause)
        params.push(value)
      }
    }
    add('warehouse_id = ?', filter.warehouseId)
    add('product_id = ?', filter.productId)
    add('document_id = ?', filter.documentId)
    add('document_line_id = ?', filter.documentLineId)
    add('occurred_at >= ?', filter.from)
    add('occurred_at <= ?', filter.to)
    const rows = await this.db.all(
      `SELECT * FROM stock_movements ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY occurred_at, created_at, id`,
      params,
    )
    return rows.map(movementFromRow)
  }

  async findInconsistencies(): Promise<StockInconsistency[]> {
    const rows = await this.db.all(`
      SELECT m.warehouse_id AS warehouse_id, m.product_id AS product_id, COALESCE(s.quantity, 0) AS cached, m.total AS ledger
      FROM (SELECT warehouse_id, product_id, SUM(quantity_delta) AS total FROM stock_movements GROUP BY warehouse_id, product_id) m
      LEFT JOIN warehouse_stock s ON s.warehouse_id = m.warehouse_id AND s.product_id = m.product_id
      WHERE COALESCE(s.quantity, 0) <> m.total
      UNION ALL
      SELECT s.warehouse_id, s.product_id, s.quantity, 0
      FROM warehouse_stock s
      WHERE s.quantity <> 0
        AND NOT EXISTS (SELECT 1 FROM stock_movements m WHERE m.warehouse_id = s.warehouse_id AND m.product_id = s.product_id)`)
    return rows.map((r) => ({ warehouseId: str(r, 'warehouse_id'), productId: str(r, 'product_id'), cached: num(r, 'cached'), ledger: num(r, 'ledger') }))
  }

  async rebuildCache(): Promise<void> {
    const now = nowIso()
    await this.db.transaction(async (tx) => {
      const totals = await tx.all('SELECT warehouse_id, product_id, SUM(quantity_delta) AS total FROM stock_movements GROUP BY warehouse_id, product_id')
      await tx.run('UPDATE warehouse_stock SET quantity = 0, updated_at = ?', [now])
      for (const t of totals) {
        const warehouseId = str(t, 'warehouse_id')
        const productId = str(t, 'product_id')
        const total = num(t, 'total')
        const result = await tx.run('UPDATE warehouse_stock SET quantity = ?, updated_at = ? WHERE warehouse_id = ? AND product_id = ?', [total, now, warehouseId, productId])
        if (result.changes === 0) {
          const { sql, params } = insertSql('warehouse_stock', {
            id: newId(),
            warehouse_id: warehouseId,
            product_id: productId,
            quantity: total,
            created_at: now,
            updated_at: now,
            is_active: 1,
            created_by: null,
          })
          await tx.run(sql, params)
        }
      }
    })
  }
}

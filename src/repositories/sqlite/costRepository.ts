import type { SqlExecutor, SqlRow } from '../../database/types'
import type { CostInconsistency, CostLot, LotAllocation } from '../../models/costing'
import { newId } from '../../utils/id'
import { nowIso } from '../../utils/time'
import type { AverageState, CostRepository, NewAllocation, NewLot } from '../types'
import { baseFromRow, insertSql, notFound, num, str, strOrNull } from './helpers'

function lotFromRow(r: SqlRow): CostLot {
  return {
    ...baseFromRow(r),
    productId: str(r, 'product_id'),
    warehouseId: str(r, 'warehouse_id'),
    movementId: str(r, 'movement_id'),
    lotDate: str(r, 'lot_date'),
    quantity: num(r, 'quantity'),
    remaining: num(r, 'remaining'),
    totalCost: num(r, 'total_cost'),
  }
}

function allocationFromRow(r: SqlRow): LotAllocation {
  return {
    ...baseFromRow(r),
    lotId: str(r, 'lot_id'),
    movementId: str(r, 'movement_id'),
    quantity: num(r, 'quantity'),
    costAmount: num(r, 'cost_amount'),
    reversalMovementId: strOrNull(r, 'reversal_movement_id'),
  }
}

/** لایه‌ای که با ابطال خرید کاملاً برداشته شده دیگر «آخرین خرید» حساب نمی‌شود */
const NOT_CANCELLED = `NOT EXISTS (SELECT 1 FROM lot_allocations a JOIN stock_movements c ON c.id = a.movement_id
  WHERE a.lot_id = l.id AND c.movement_type = 'purchase_cancel')`

export class SqliteCostRepository implements CostRepository {
  constructor(private readonly db: SqlExecutor) {}

  async insertLot(input: NewLot): Promise<CostLot> {
    const id = newId()
    const now = nowIso()
    const { sql, params } = insertSql('cost_lots', {
      id,
      product_id: input.productId,
      warehouse_id: input.warehouseId,
      movement_id: input.movementId,
      lot_date: input.lotDate,
      quantity: input.quantity,
      remaining: input.quantity,
      total_cost: input.totalCost,
      created_at: now,
      updated_at: now,
      is_active: 1,
      created_by: null,
    })
    await this.db.run(sql, params)
    const lot = await this.getLot(id)
    if (!lot) throw notFound('لایه بها')
    return lot
  }

  async getLot(id: string): Promise<CostLot | null> {
    const row = await this.db.get('SELECT * FROM cost_lots WHERE id = ?', [id])
    return row ? lotFromRow(row) : null
  }

  async getLotByMovement(movementId: string): Promise<CostLot | null> {
    const row = await this.db.get('SELECT * FROM cost_lots WHERE movement_id = ?', [movementId])
    return row ? lotFromRow(row) : null
  }

  async openLots(productId: string, warehouseId: string): Promise<CostLot[]> {
    const rows = await this.db.all(
      'SELECT * FROM cost_lots WHERE product_id = ? AND warehouse_id = ? AND remaining > 0 ORDER BY lot_date, created_at, id',
      [productId, warehouseId],
    )
    return rows.map(lotFromRow)
  }

  async listLots(filter: { productId?: string; warehouseId?: string } = {}): Promise<CostLot[]> {
    const where: string[] = []
    const params: string[] = []
    if (filter.productId) {
      where.push('product_id = ?')
      params.push(filter.productId)
    }
    if (filter.warehouseId) {
      where.push('warehouse_id = ?')
      params.push(filter.warehouseId)
    }
    const rows = await this.db.all(`SELECT * FROM cost_lots ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY lot_date, created_at, id`, params)
    return rows.map(lotFromRow)
  }

  async setRemaining(lotId: string, remaining: number): Promise<void> {
    const result = await this.db.run('UPDATE cost_lots SET remaining = ?, updated_at = ? WHERE id = ?', [remaining, nowIso(), lotId])
    if (result.changes === 0) throw notFound('لایه بها')
  }

  async insertAllocation(input: NewAllocation): Promise<LotAllocation> {
    const id = newId()
    const now = nowIso()
    const { sql, params } = insertSql('lot_allocations', {
      id,
      lot_id: input.lotId,
      movement_id: input.movementId,
      quantity: input.quantity,
      cost_amount: input.costAmount,
      reversal_movement_id: null,
      created_at: now,
      updated_at: now,
      is_active: 1,
      created_by: null,
    })
    await this.db.run(sql, params)
    return allocationFromRow((await this.db.get('SELECT * FROM lot_allocations WHERE id = ?', [id])) as SqlRow)
  }

  async allocationsForMovement(movementId: string): Promise<LotAllocation[]> {
    const rows = await this.db.all('SELECT * FROM lot_allocations WHERE movement_id = ? ORDER BY created_at, id', [movementId])
    return rows.map(allocationFromRow)
  }

  async allocationsForLot(lotId: string): Promise<LotAllocation[]> {
    const rows = await this.db.all('SELECT * FROM lot_allocations WHERE lot_id = ? ORDER BY created_at, id', [lotId])
    return rows.map(allocationFromRow)
  }

  async activeAllocatedCost(lotId: string): Promise<number> {
    const row = await this.db.get<{ c: number }>('SELECT COALESCE(SUM(cost_amount), 0) AS c FROM lot_allocations WHERE lot_id = ? AND reversal_movement_id IS NULL', [lotId])
    return Number(row?.c ?? 0)
  }

  async markReversed(allocationId: string, reversalMovementId: string): Promise<void> {
    const result = await this.db.run('UPDATE lot_allocations SET reversal_movement_id = ?, updated_at = ? WHERE id = ?', [reversalMovementId, nowIso(), allocationId])
    if (result.changes === 0) throw notFound('برداشت از لایه')
  }

  async getAverage(productId: string): Promise<AverageState> {
    const row = await this.db.get('SELECT quantity, value FROM average_costs WHERE product_id = ?', [productId])
    return row ? { quantity: num(row, 'quantity'), value: num(row, 'value') } : { quantity: 0, value: 0 }
  }

  async setAverage(productId: string, state: AverageState): Promise<void> {
    await this.db.run(
      `INSERT INTO average_costs (product_id, quantity, value, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(product_id) DO UPDATE SET quantity = excluded.quantity, value = excluded.value, updated_at = excluded.updated_at`,
      [productId, state.quantity, state.value, nowIso()],
    )
  }

  async clearAverages(): Promise<void> {
    await this.db.run('DELETE FROM average_costs')
  }

  async latestLot(productId: string, options: { purchaseOnly: boolean }): Promise<CostLot | null> {
    const row = await this.db.get(
      `SELECT l.* FROM cost_lots l JOIN stock_movements m ON m.id = l.movement_id
       WHERE l.product_id = ? ${options.purchaseOnly ? "AND m.movement_type = 'purchase'" : ''} AND ${NOT_CANCELLED}
       ORDER BY l.lot_date DESC, l.created_at DESC, l.id DESC LIMIT 1`,
      [productId],
    )
    return row ? lotFromRow(row) : null
  }

  async findInconsistencies(): Promise<CostInconsistency[]> {
    const out: CostInconsistency[] = []
    const lotsVsStock = await this.db.all(`
      SELECT k.product_id AS product_id, k.warehouse_id AS warehouse_id,
        COALESCE((SELECT quantity FROM warehouse_stock s WHERE s.product_id = k.product_id AND s.warehouse_id = k.warehouse_id), 0) AS stock,
        COALESCE((SELECT SUM(remaining) FROM cost_lots l WHERE l.product_id = k.product_id AND l.warehouse_id = k.warehouse_id), 0) AS lots
      FROM (SELECT product_id, warehouse_id FROM warehouse_stock UNION SELECT product_id, warehouse_id FROM cost_lots) k`)
    for (const r of lotsVsStock) {
      if (num(r, 'stock') !== num(r, 'lots')) {
        out.push({ kind: 'lots_vs_stock', productId: str(r, 'product_id'), warehouseId: str(r, 'warehouse_id'), expected: num(r, 'stock'), actual: num(r, 'lots') })
      }
    }
    const remaining = await this.db.all(`
      SELECT l.product_id AS product_id, l.warehouse_id AS warehouse_id, l.remaining AS remaining,
        l.quantity - COALESCE((SELECT SUM(a.quantity) FROM lot_allocations a WHERE a.lot_id = l.id AND a.reversal_movement_id IS NULL), 0) AS expected
      FROM cost_lots l`)
    for (const r of remaining) {
      if (num(r, 'remaining') !== num(r, 'expected')) {
        out.push({ kind: 'lot_remaining', productId: str(r, 'product_id'), warehouseId: str(r, 'warehouse_id'), expected: num(r, 'expected'), actual: num(r, 'remaining') })
      }
    }
    const averages = await this.db.all(`
      SELECT k.product_id AS product_id,
        COALESCE((SELECT SUM(quantity) FROM warehouse_stock s WHERE s.product_id = k.product_id), 0) AS stock,
        COALESCE((SELECT quantity FROM average_costs a WHERE a.product_id = k.product_id), 0) AS avg_qty
      FROM (SELECT product_id FROM warehouse_stock UNION SELECT product_id FROM average_costs) k`)
    for (const r of averages) {
      if (num(r, 'stock') !== num(r, 'avg_qty')) {
        out.push({ kind: 'average_quantity', productId: str(r, 'product_id'), warehouseId: null, expected: num(r, 'stock'), actual: num(r, 'avg_qty') })
      }
    }
    return out
  }
}

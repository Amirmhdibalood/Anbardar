import type { Product } from '../models/catalog'
import type { InvoiceItem } from '../models/invoice'

/** واحد ورود تعداد برگشت برای یک ردیف فاکتور */
export function returnUnit(row: { item: InvoiceItem; product: Product | null }, mode: 'line' | 'base' | undefined) {
  const p = row.product
  const useLine = !!row.item.unitId && mode !== 'base'
  if (useLine) {
    const sub = p?.subUnits?.find((u) => u.unitId === row.item.unitId)
    return { unitId: row.item.unitId, factor: row.item.unitFactor, name: sub?.unitName ?? '', allowsFraction: sub?.allowsFraction ?? false }
  }
  return { unitId: null, factor: 1000, name: p?.unitName ?? '', allowsFraction: p?.unitAllowsFraction ?? true }
}

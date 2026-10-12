import { migration001 } from './001_initial'
import { migration002 } from './002_quantities_units'
import { migration003 } from './003_cost_lots'
import { migration004 } from './004_expenses'
import { migration005 } from './005_returns_transfers'
import type { Migration } from './types'

export type { Migration } from './types'

/** فهرست رسمی Migrationها؛ فقط به انتهای آن اضافه کنید و هیچ‌وقت Migration قدیمی را ویرایش نکنید */
export const MIGRATIONS: readonly Migration[] = [migration001, migration002, migration003, migration004, migration005]

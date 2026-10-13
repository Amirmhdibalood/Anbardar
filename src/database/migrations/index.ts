import { migration001 } from './001_initial'
import { migration002 } from './002_quantities_units'
import { migration003 } from './003_cost_lots'
import { migration004 } from './004_expenses'
import { migration005 } from './005_returns_transfers'
import { migration006 } from './006_parties_money'
import { migration007 } from './007_units_landed_cheques'
import { migration008 } from './008_request_keys'
import { migration009 } from './009_users_audit'
import type { Migration } from './types'

export type { Migration } from './types'

/** فهرست رسمی Migrationها؛ فقط به انتهای آن اضافه کنید و هیچ‌وقت Migration قدیمی را ویرایش نکنید */
export const MIGRATIONS: readonly Migration[] = [migration001, migration002, migration003, migration004, migration005, migration006, migration007, migration008, migration009]

import { newId } from '../utils/id'
import { nowIso } from '../utils/time'
import { createRepositories } from '../repositories'
import type { Database } from './types'

export const SEED_NAMES = {
  warehouse: 'انبار مرکزی',
  customer: 'مشتری نقدی',
  productGroup: 'عمومی',
} as const

export const SETTING_KEYS = {
  seedCompleted: 'seed_completed',
  defaultWarehouseId: 'default_warehouse_id',
  defaultCustomerId: 'default_customer_id',
  defaultProductGroupId: 'default_product_group_id',
} as const

/**
 * ساخت اطلاعات اولیه در اولین اجرا (فقط یک بار، در یک تراکنش):
 * انبار مرکزی، مشتری نقدی (سیستمی) و گروه کالای «عمومی».
 * اگر در میانه کار خطا شود هیچ‌چیز ساخته نمی‌شود و اجرای بعدی دوباره تلاش می‌کند.
 * @returns true اگر Seed در همین فراخوانی انجام شد
 */
export async function seedIfNeeded(db: Database): Promise<boolean> {
  const done = await createRepositories(db).settings.getValue(SETTING_KEYS.seedCompleted)
  if (done === '1') return false

  await db.transaction(async (tx) => {
    const repos = createRepositories(tx)
    const now = nowIso()

    // اگر قبلاً (مثلاً در اجرای نیمه‌کاره قدیمی) ساخته شده باشند دوباره ساخته نمی‌شوند
    const warehouse = (await repos.warehouses.list({ includeInactive: true })).find((w) => w.name === SEED_NAMES.warehouse)
    const group = (await repos.productGroups.list({ includeInactive: true })).find((g) => g.name === SEED_NAMES.productGroup)
    const existingCustomer = await tx.get<{ id: string }>('SELECT id FROM customers WHERE is_system = 1')

    const warehouseId = warehouse?.id ?? (await repos.warehouses.create({ name: SEED_NAMES.warehouse })).id
    // درج مستقیم با ستون‌های پایه تا Seed به ستون‌های اختیاری نسخه‌های بعدی وابسته نباشد
    let groupId = group?.id
    if (!groupId) {
      groupId = newId()
      await tx.run('INSERT INTO product_groups (id, name, created_at, updated_at, is_active, created_by) VALUES (?, ?, ?, ?, 1, NULL)', [groupId, SEED_NAMES.productGroup, now, now])
    }
    let customerId = existingCustomer?.id
    if (!customerId) {
      customerId = newId()
      await tx.run(
        'INSERT INTO customers (id, name, is_system, created_at, updated_at, is_active, created_by) VALUES (?, ?, 1, ?, ?, 1, NULL)',
        [customerId, SEED_NAMES.customer, now, now],
      )
    }

    await repos.settings.setValue(SETTING_KEYS.defaultWarehouseId, warehouseId)
    await repos.settings.setValue(SETTING_KEYS.defaultCustomerId, customerId)
    await repos.settings.setValue(SETTING_KEYS.defaultProductGroupId, groupId)
    // مقادیر پیش‌فرض تنظیمات (در صورت نبودن)
    await tx.run("INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES ('theme', 'dark', ?)", [now])
    await repos.settings.setValue(SETTING_KEYS.seedCompleted, '1')
  })
  return true
}

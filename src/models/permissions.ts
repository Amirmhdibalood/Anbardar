/** نقش‌ها و مجوزها — جدول خالص؛ اعمال واقعی در services/authz.ts (لایه سرویس) */
export type Role = 'owner' | 'manager' | 'seller' | 'storekeeper'

export const ROLES: readonly Role[] = ['owner', 'manager', 'seller', 'storekeeper']

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'مالک',
  manager: 'مدیر',
  seller: 'فروشنده',
  storekeeper: 'انباردار',
}

export const ROLE_HINTS: Record<Role, string> = {
  owner: 'همه کارها، کاربران، تنظیمات و بازیابی پشتیبان',
  manager: 'همه کارهای روزانه، ابطال، گزارش و سود؛ بدون کاربران و بازیابی',
  seller: 'فروش، برگشت فروش، مشتری و دریافت؛ بدون بها، سود و ابطال',
  storekeeper: 'کالا، خرید، موجودی و انتقال؛ بدون فروش و امور مالی',
}

export type Permission =
  | 'sales.create'
  | 'sales.cancel'
  | 'returns.sale'
  | 'purchases.create'
  | 'purchases.cancel'
  | 'returns.purchase'
  | 'stock.adjust'
  | 'transfers.create'
  | 'products.manage'
  | 'parties.manage'
  | 'money.create'
  | 'money.cancel'
  | 'cheques.manage'
  | 'expenses.manage'
  | 'reports.view'
  | 'costs.view'
  | 'backup.create'
  | 'backup.restore'
  | 'settings.manage'
  | 'users.manage'
  | 'audit.view'

const ALL: readonly Permission[] = [
  'sales.create', 'sales.cancel', 'returns.sale', 'purchases.create', 'purchases.cancel', 'returns.purchase',
  'stock.adjust', 'transfers.create', 'products.manage', 'parties.manage', 'money.create', 'money.cancel',
  'cheques.manage', 'expenses.manage', 'reports.view', 'costs.view', 'backup.create', 'backup.restore',
  'settings.manage', 'users.manage', 'audit.view',
]

export const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  owner: new Set(ALL),
  manager: new Set(ALL.filter((p) => !['backup.restore', 'settings.manage', 'users.manage'].includes(p))),
  seller: new Set<Permission>(['sales.create', 'returns.sale', 'parties.manage', 'money.create', 'backup.create']),
  storekeeper: new Set<Permission>(['purchases.create', 'returns.purchase', 'stock.adjust', 'transfers.create', 'products.manage', 'backup.create']),
}

export const PERMISSION_LABELS: Record<Permission, string> = {
  'sales.create': 'ثبت فروش',
  'sales.cancel': 'ابطال فاکتور فروش',
  'returns.sale': 'برگشت فروش',
  'purchases.create': 'ثبت خرید',
  'purchases.cancel': 'ابطال فاکتور خرید',
  'returns.purchase': 'برگشت خرید',
  'stock.adjust': 'اصلاح موجودی',
  'transfers.create': 'انتقال بین انبارها',
  'products.manage': 'تعریف و ویرایش کالا، گروه، واحد و انبار',
  'parties.manage': 'تعریف و ویرایش طرف حساب',
  'money.create': 'ثبت دریافت/پرداخت',
  'money.cancel': 'ابطال سند دریافت/پرداخت',
  'cheques.manage': 'وصول، برگشت و خرج چک',
  'expenses.manage': 'ثبت و ابطال هزینه',
  'reports.view': 'دیدن گزارش‌ها',
  'costs.view': 'دیدن بها و سود',
  'backup.create': 'گرفتن نسخه پشتیبان',
  'backup.restore': 'بازیابی نسخه پشتیبان',
  'settings.manage': 'تغییر تنظیمات',
  'users.manage': 'مدیریت کاربران',
  'audit.view': 'دیدن گزارش فعالیت‌ها',
}

export function can(role: Role | null | undefined, p: Permission): boolean {
  return !!role && ROLE_PERMISSIONS[role].has(p)
}

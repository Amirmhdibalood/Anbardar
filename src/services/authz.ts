import type { SqlExecutor } from '../database/types'
import { can, PERMISSION_LABELS, type Permission, type Role } from '../models/permissions'
import { AppError } from '../utils/errors'
import { newId } from '../utils/id'
import { getActor } from './session'

/** کاربر مؤثر برای ثبت در گزارش فعالیت؛ userId=null یعنی حالت تک‌کاربره (بدون ورود) */
export interface EffectiveActor {
  userId: string | null
  name: string
  role: Role
}

export const SINGLE_USER: EffectiveActor = { userId: null, name: 'مالک', role: 'owner' }

export async function usersEnabled(tx: SqlExecutor): Promise<boolean> {
  return !!(await tx.get('SELECT 1 AS x FROM users WHERE is_active = 1 LIMIT 1'))
}

/** «ورود لازم است» (پیش‌فرض روشن)؛ با login_required='0' برنامه بدون صفحه ورود و به‌نام مالک باز می‌شود */
export async function loginRequired(tx: SqlExecutor): Promise<boolean> {
  const row = await tx.get<{ value: string }>("SELECT value FROM settings WHERE key = 'login_required'")
  return row?.value !== '0'
}

/** نخستین مالک فعال (برای حالت «بدون ورود»؛ نام واقعی در گزارش فعالیت ثبت می‌شود) */
export async function defaultOwner(tx: SqlExecutor): Promise<EffectiveActor | null> {
  const row = await tx.get<{ id: string; name: string }>("SELECT id, name FROM users WHERE role = 'owner' AND is_active = 1 ORDER BY created_at, id LIMIT 1")
  return row ? { userId: row.id, name: row.name, role: 'owner' } : null
}

/** کاربر فعلی را از دیتابیس دوباره می‌خواند (کاربر غیرفعال‌شده فوراً مسدود می‌شود) */
export async function currentActor(tx: SqlExecutor): Promise<EffectiveActor | null> {
  if (!(await usersEnabled(tx))) return SINGLE_USER
  const a = getActor()
  if (!a) return (await loginRequired(tx)) ? null : defaultOwner(tx)
  const row = await tx.get<{ name: string; role: Role; is_active: number }>('SELECT name, role, is_active FROM users WHERE id = ?', [a.userId])
  if (!row || row.is_active !== 1) return null
  return { userId: a.userId, name: row.name, role: row.role }
}

/** اعمال مجوز در لایه سرویس؛ خطای فارسی برای نبود ورود یا نبود اجازه */
export async function authorize(tx: SqlExecutor, permission: Permission): Promise<EffectiveActor> {
  const actor = await currentActor(tx)
  if (!actor) throw new AppError('auth_required', 'برای این کار اول وارد حساب کاربری شوید.')
  if (!can(actor.role, permission)) {
    throw new AppError('forbidden', `شما اجازه «${PERMISSION_LABELS[permission]}» را ندارید. از ${can('manager', permission) ? 'مالک یا مدیر' : 'مالک'} بخواهید.`)
  }
  return actor
}

export interface AuditEntry {
  action: string
  entityType?: string | null
  entityId?: string | null
  summary: string
}

export async function writeAudit(tx: SqlExecutor, actor: EffectiveActor, e: AuditEntry): Promise<void> {
  await tx.run('INSERT INTO audit_log (id, at, user_id, user_name, action, entity_type, entity_id, summary) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
    newId(),
    new Date().toISOString(),
    actor.userId,
    actor.name,
    e.action,
    e.entityType ?? null,
    e.entityId ?? null,
    e.summary.slice(0, 300),
  ])
}

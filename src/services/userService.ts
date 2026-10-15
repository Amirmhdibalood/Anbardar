import type { SqlExecutor, SqlRow } from '../database/types'
import { ROLE_LABELS, ROLES, type Role } from '../models/permissions'
import { AppError, ValidationError } from '../utils/errors'
import { newId } from '../utils/id'
import { cleanText } from '../validation/fields'
import { normalizeAnswer } from '../utils/answer'
import { authorize, currentActor, defaultOwner, loginRequired, SINGLE_USER, usersEnabled, writeAudit } from './authz'
import { hashPin, PIN_ITERATIONS, PIN_PATTERN, verifyPin } from './pin'
import { getActor, setActor, setLoginOn, setUsersOn, type Actor } from './session'

export interface UserRow {
  id: string
  name: string
  role: Role
  isActive: boolean
  lastLoginAt: string | null
  lockedUntil: string | null
}

export interface AuditRow {
  id: string
  at: string
  userId: string | null
  userName: string
  action: string
  entityType: string | null
  entityId: string | null
  summary: string
}

const MAX_FAILS = 5
const BASE_LOCK_MS = 30_000
const MAX_LOCK_MS = 15 * 60_000

function checkName(name: string): string {
  const n = cleanText(name)
  if (!n) throw new ValidationError({ name: 'نام کاربر را وارد کنید.' })
  if (n.length > 60) throw new ValidationError({ name: 'نام کاربر نباید بیشتر از ۶۰ نویسه باشد.' })
  return n
}
function checkPinFormat(pin: string): void {
  if (!PIN_PATTERN.test(pin)) throw new ValidationError({ pin: 'رمز باید ۴ تا ۸ رقم باشد.' })
}
function checkRole(role: string): Role {
  if (!ROLES.includes(role as Role)) throw new ValidationError({ role: 'نقش انتخاب‌شده معتبر نیست.' })
  return role as Role
}

const map = (r: SqlRow): UserRow => ({
  id: r.id as string,
  name: r.name as string,
  role: r.role as Role,
  isActive: r.is_active === 1,
  lastLoginAt: (r.last_login_at as string | null) ?? null,
  lockedUntil: (r.locked_until as string | null) ?? null,
})

export function createUserService(db: SqlExecutor, opts: { pinIterations?: number; now?: () => number } = {}) {
  const iterations = opts.pinIterations ?? PIN_ITERATIONS
  const now = opts.now ?? (() => Date.now())

  const lockFor = (fails: number) => (fails >= MAX_FAILS ? Math.min(MAX_LOCK_MS, BASE_LOCK_MS * 2 ** (fails - MAX_FAILS)) : 0)
  const assertNotLocked = (lockedUntil: string | null, what: string) => {
    const locked = lockedUntil ? Date.parse(lockedUntil) : 0
    if (locked > now()) {
      const sec = Math.ceil((locked - now()) / 1000)
      throw new AppError('forbidden', `به‌خاطر چند تلاش اشتباه، ${what} تا ${sec.toLocaleString('fa-IR')} ثانیه دیگر بسته است.`)
    }
  }
  /** بررسی رمز کاربر با شمارش اشتباه و قفل موقت (مشترک بین ورود، خاموش کردن ورود و سؤال‌های بازیابی) */
  const checkPin = async (id: string, pin: string): Promise<Actor> => {
    const u = await db.get<SqlRow>('SELECT * FROM users WHERE id = ? AND is_active = 1', [id])
    if (!u) throw new AppError('not_found', 'کاربر پیدا نشد یا غیرفعال است.')
    assertNotLocked(u.locked_until as string | null, 'ورود')
    const ok = PIN_PATTERN.test(pin) && (await verifyPin(pin, { hash: u.pin_hash as string, salt: u.pin_salt as string, iterations: u.pin_iter as number }))
    const name = u.name as string
    const actorOf: Actor = { userId: id, name, role: u.role as Role }
    if (!ok) {
      const fails = (u.failed_attempts as number) + 1
      const lockMs = lockFor(fails)
      await db.transaction(async (tx) => {
        await tx.run('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?', [fails, lockMs ? new Date(now() + lockMs).toISOString() : null, id])
        await writeAudit(tx, { ...actorOf }, { action: 'auth.fail', entityType: 'user', entityId: id, summary: `رمز اشتباه برای «${name}»${lockMs ? ' — ورود موقتاً قفل شد' : ''}` })
      })
      throw new AppError('validation', lockMs ? `رمز اشتباه است. ورود ${Math.round(lockMs / 1000).toLocaleString('fa-IR')} ثانیه قفل شد.` : 'رمز اشتباه است.')
    }
    if ((u.failed_attempts as number) > 0) await db.run('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?', [id])
    return actorOf
  }

  return {
    enabled: () => usersEnabled(db),

    /** فهرست کاربران فعال برای صفحه ورود (بدون هیچ اطلاعات حساس) */
    async loginList(): Promise<UserRow[]> {
      const rows = await db.all("SELECT * FROM users WHERE is_active = 1 ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END, name")
      return rows.map(map)
    },

    async list(): Promise<UserRow[]> {
      return db.transaction(async (tx) => {
        await authorize(tx, 'users.manage')
        return (await tx.all('SELECT * FROM users ORDER BY is_active DESC, name')).map(map)
      })
    },

    /** افزودن کاربر؛ اولین کاربر باید «مالک» باشد و با ساختنش حالت چندکاربره روشن می‌شود */
    async create(input: { name: string; role: Role; pin: string }): Promise<UserRow> {
      const name = checkName(input.name)
      const role = checkRole(input.role)
      checkPinFormat(input.pin)
      const pin = await hashPin(input.pin, iterations)
      return db.transaction(async (tx) => {
        const first = !(await usersEnabled(tx))
        const actor = await authorize(tx, 'users.manage')
        if (first && role !== 'owner') throw new ValidationError({ role: 'اولین کاربر باید «مالک» باشد.' })
        const id = newId()
        await tx.run('INSERT INTO users (id, name, role, pin_hash, pin_salt, pin_iter, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)', [id, name, role, pin.hash, pin.salt, pin.iterations, actor.userId])
        await writeAudit(tx, first ? SINGLE_USER : actor, {
          action: first ? 'users.enable' : 'user.create',
          entityType: 'user',
          entityId: id,
          summary: first ? `حالت چندکاربره روشن شد؛ مالک: ${name}` : `کاربر «${name}» با نقش ${ROLE_LABELS[role]} اضافه شد`,
        })
        if (first) {
          setActor({ userId: id, name, role })
          setUsersOn(true)
        }
        return map((await tx.get('SELECT * FROM users WHERE id = ?', [id]))!)
      })
    },

    async update(id: string, input: { name?: string; role?: Role }): Promise<void> {
      await db.transaction(async (tx) => {
        const actor = await authorize(tx, 'users.manage')
        const u = await tx.get<{ name: string; role: Role }>('SELECT name, role FROM users WHERE id = ?', [id])
        if (!u) throw new AppError('not_found', 'کاربر پیدا نشد.')
        const name = input.name !== undefined ? checkName(input.name) : u.name
        const role = input.role !== undefined ? checkRole(input.role) : u.role
        if (role !== 'owner' && u.role === 'owner' && !(await tx.get("SELECT 1 AS x FROM users WHERE role = 'owner' AND is_active = 1 AND id <> ?", [id]))) {
          throw new AppError('protected', 'دست‌کم یک «مالک» فعال باید بماند؛ اول مالک دیگری تعریف کنید.')
        }
        await tx.run('UPDATE users SET name = ?, role = ?, updated_at = ? WHERE id = ?', [name, role, new Date().toISOString(), id])
        const parts = [name !== u.name ? `نام: ${u.name} ← ${name}` : '', role !== u.role ? `نقش: ${ROLE_LABELS[u.role]} ← ${ROLE_LABELS[role]}` : ''].filter(Boolean)
        await writeAudit(tx, actor, { action: 'user.update', entityType: 'user', entityId: id, summary: `ویرایش کاربر «${name}»${parts.length ? ` (${parts.join('، ')})` : ''}` })
        const cur = getActor()
        if (cur?.userId === id) setActor({ userId: id, name, role })
      })
    },

    async resetPin(id: string, pin: string): Promise<void> {
      checkPinFormat(pin)
      const h = await hashPin(pin, iterations)
      await db.transaction(async (tx) => {
        const actor = await authorize(tx, 'users.manage')
        const u = await tx.get<{ name: string }>('SELECT name FROM users WHERE id = ?', [id])
        if (!u) throw new AppError('not_found', 'کاربر پیدا نشد.')
        await tx.run('UPDATE users SET pin_hash = ?, pin_salt = ?, pin_iter = ?, failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?', [h.hash, h.salt, h.iterations, new Date().toISOString(), id])
        await writeAudit(tx, actor, { action: 'user.pin', entityType: 'user', entityId: id, summary: `رمز کاربر «${u.name}» تغییر کرد` })
      })
    },

    async setActive(id: string, active: boolean): Promise<void> {
      await db.transaction(async (tx) => {
        const actor = await authorize(tx, 'users.manage')
        const u = await tx.get<{ name: string; role: Role }>('SELECT name, role FROM users WHERE id = ?', [id])
        if (!u) throw new AppError('not_found', 'کاربر پیدا نشد.')
        if (!active && actor.userId === id) throw new AppError('protected', 'نمی‌توانید حساب خودتان را غیرفعال کنید.')
        if (!active && u.role === 'owner' && !(await tx.get("SELECT 1 AS x FROM users WHERE role = 'owner' AND is_active = 1 AND id <> ?", [id]))) {
          throw new AppError('protected', 'دست‌کم یک «مالک» فعال باید بماند؛ اول مالک دیگری تعریف کنید.')
        }
        await tx.run('UPDATE users SET is_active = ?, updated_at = ? WHERE id = ?', [active ? 1 : 0, new Date().toISOString(), id])
        await writeAudit(tx, actor, { action: active ? 'user.activate' : 'user.deactivate', entityType: 'user', entityId: id, summary: `کاربر «${u.name}» ${active ? 'فعال' : 'غیرفعال'} شد` })
      })
    },

    /** خاموش کردن حالت چندکاربره (فقط مالک): همه کاربران غیرفعال می‌شوند و برنامه بدون ورود کار می‌کند */
    async disableUsers(): Promise<void> {
      await db.transaction(async (tx) => {
        const actor = await authorize(tx, 'users.manage')
        await writeAudit(tx, actor, { action: 'users.disable', summary: 'حالت چندکاربره خاموش شد' })
        await tx.run('UPDATE users SET is_active = 0, updated_at = ? WHERE is_active = 1 AND id <> ?', [new Date().toISOString(), actor.userId ?? ''])
        if (actor.userId) await tx.run('UPDATE users SET is_active = 0, updated_at = ? WHERE id = ?', [new Date().toISOString(), actor.userId])
        await tx.run("DELETE FROM settings WHERE key = 'login_required'")
      })
      setActor(null)
      setLoginOn(true)
      setUsersOn(false)
    },

    /** ورود با PIN؛ پس از ۵ اشتباه، قفل موقت (۳۰ ثانیه، دوبرابر با هر اشتباه بعدی، حداکثر ۱۵ دقیقه) */
    async login(id: string, pin: string): Promise<Actor> {
      const actorOf = await checkPin(id, pin)
      await db.transaction(async (tx) => {
        const at = new Date(now()).toISOString()
        await tx.run('UPDATE users SET last_login_at = ? WHERE id = ?', [at, id])
        await writeAudit(tx, actorOf, { action: 'auth.login', entityType: 'user', entityId: id, summary: `ورود «${actorOf.name}»` })
      })
      setActor(actorOf)
      return actorOf
    },

    loginRequired: () => loginRequired(db),

    /**
     * روشن/خاموش کردن صفحه ورود (فقط مالک). خاموش کردن رمز مالک فعلی را می‌خواهد.
     * در حالت خاموش برنامه مستقیم و به‌نام نخستین مالک باز می‌شود.
     */
    async setLoginRequired(on: boolean, ownerPin?: string): Promise<void> {
      const actor = await db.transaction((tx) => authorize(tx, 'users.manage'))
      if (actor.role !== 'owner' || !actor.userId) throw new AppError('forbidden', 'فقط مالک می‌تواند ورود را خاموش یا روشن کند.')
      if (!on) await checkPin(actor.userId, ownerPin ?? '')
      await db.transaction(async (tx) => {
        await tx.run("INSERT INTO settings (key, value, updated_at) VALUES ('login_required', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at", [on ? '1' : '0', new Date(now()).toISOString()])
        await writeAudit(tx, actor, on ? { action: 'auth.login_on', summary: 'صفحه ورود روشن شد' } : { action: 'auth.login_off', summary: 'صفحه ورود خاموش شد؛ برنامه به‌نام مالک باز می‌شود' })
      })
      setLoginOn(on)
      if (!on) setActor({ userId: actor.userId, name: actor.name, role: 'owner' })
    },

    /** کاربر پیش‌فرض حالت «بدون ورود» */
    defaultOwner: () => defaultOwner(db),

    /** سؤال‌های بازیابی یک کاربر (فقط متن سؤال؛ برای صفحه «رمز را فراموش کردم») */
    async recoveryQuestions(userId: string): Promise<{ q1: string; q2: string } | null> {
      const r = await db.get<{ q1: string; q2: string }>('SELECT r.q1, r.q2 FROM user_recovery r JOIN users u ON u.id = r.user_id WHERE r.user_id = ? AND u.is_active = 1', [userId])
      return r ? { q1: r.q1, q2: r.q2 } : null
    },

    /** ثبت/ویرایش سؤال‌های بازیابی؛ همیشه با رمز فعلی همان کاربر */
    async setRecovery(userId: string, currentPin: string, input: { q1: string; a1: string; q2: string; a2: string }): Promise<void> {
      const q1 = cleanText(input.q1)
      const q2 = cleanText(input.q2)
      const a1 = normalizeAnswer(input.a1)
      const a2 = normalizeAnswer(input.a2)
      const errors: Record<string, string> = {}
      if (q1.length < 3 || q1.length > 120) errors.q1 = 'سؤال اول را بنویسید (۳ تا ۱۲۰ نویسه).'
      if (q2.length < 3 || q2.length > 120) errors.q2 = 'سؤال دوم را بنویسید (۳ تا ۱۲۰ نویسه).'
      if (q1 && q2 && normalizeAnswer(q1) === normalizeAnswer(q2)) errors.q2 = 'دو سؤال باید با هم فرق داشته باشند.'
      if (a1.length < 2) errors.a1 = 'پاسخ سؤال اول را بنویسید.'
      if (a2.length < 2) errors.a2 = 'پاسخ سؤال دوم را بنویسید.'
      if (Object.keys(errors).length) throw new ValidationError(errors)
      const who = await checkPin(userId, currentPin)
      const h1 = await hashPin(a1, iterations)
      const h2 = await hashPin(a2, iterations)
      await db.transaction(async (tx) => {
        await tx.run(
          `INSERT INTO user_recovery (user_id, q1, a1_hash, a1_salt, q2, a2_hash, a2_salt, iter, failed_attempts, locked_until, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?)
ON CONFLICT(user_id) DO UPDATE SET q1 = excluded.q1, a1_hash = excluded.a1_hash, a1_salt = excluded.a1_salt, q2 = excluded.q2,
  a2_hash = excluded.a2_hash, a2_salt = excluded.a2_salt, iter = excluded.iter, failed_attempts = 0, locked_until = NULL, updated_at = excluded.updated_at`,
          [userId, q1, h1.hash, h1.salt, q2, h2.hash, h2.salt, iterations, new Date(now()).toISOString()],
        )
        await writeAudit(tx, (await currentActor(tx)) ?? who, { action: 'user.recovery', entityType: 'user', entityId: userId, summary: `سؤال‌های بازیابی «${who.name}» ثبت شد` })
      })
    },

    /**
     * «رمز را فراموش کردم»: هر دو پاسخ درست ← رمز تازه و ورود.
     * پاسخ اشتباه مثل رمز اشتباه محدود می‌شود (شمارنده جدا).
     */
    async recover(userId: string, answers: { a1: string; a2: string }, newPin: string): Promise<Actor> {
      if (!PIN_PATTERN.test(newPin)) throw new ValidationError({ pin: 'رمز باید ۴ تا ۸ رقم باشد.' })
      const row = await db.get<SqlRow>('SELECT r.*, u.name, u.role FROM user_recovery r JOIN users u ON u.id = r.user_id WHERE r.user_id = ? AND u.is_active = 1', [userId])
      if (!row) throw new AppError('not_found', 'برای این کاربر سؤال بازیابی ثبت نشده است. از مالک بخواهید رمز را عوض کند.')
      const name = row.name as string
      const actorOf: Actor = { userId, name, role: row.role as Role }
      assertNotLocked(row.locked_until as string | null, 'بازیابی')
      const iter = row.iter as number
      const ok1 = await verifyPin(normalizeAnswer(answers.a1), { hash: row.a1_hash as string, salt: row.a1_salt as string, iterations: iter })
      const ok2 = await verifyPin(normalizeAnswer(answers.a2), { hash: row.a2_hash as string, salt: row.a2_salt as string, iterations: iter })
      if (!(ok1 && ok2)) {
        const fails = (row.failed_attempts as number) + 1
        const lockMs = lockFor(fails)
        await db.transaction(async (tx) => {
          await tx.run('UPDATE user_recovery SET failed_attempts = ?, locked_until = ? WHERE user_id = ?', [fails, lockMs ? new Date(now() + lockMs).toISOString() : null, userId])
          await writeAudit(tx, actorOf, { action: 'auth.recover_fail', entityType: 'user', entityId: userId, summary: `پاسخ اشتباه بازیابی رمز برای «${name}»${lockMs ? ' — بازیابی موقتاً قفل شد' : ''}` })
        })
        throw new AppError('validation', lockMs ? `پاسخ‌ها درست نیست. بازیابی ${Math.round(lockMs / 1000).toLocaleString('fa-IR')} ثانیه قفل شد.` : 'پاسخ‌ها درست نیست.')
      }
      const h = await hashPin(newPin, iterations)
      await db.transaction(async (tx) => {
        const at = new Date(now()).toISOString()
        await tx.run('UPDATE users SET pin_hash = ?, pin_salt = ?, pin_iter = ?, failed_attempts = 0, locked_until = NULL, last_login_at = ?, updated_at = ? WHERE id = ?', [h.hash, h.salt, h.iterations, at, at, userId])
        await tx.run('UPDATE user_recovery SET failed_attempts = 0, locked_until = NULL WHERE user_id = ?', [userId])
        await writeAudit(tx, actorOf, { action: 'auth.recover', entityType: 'user', entityId: userId, summary: `رمز «${name}» با سؤال‌های بازیابی عوض شد و وارد شد` })
      })
      setActor(actorOf)
      return actorOf
    },

    /** گزارش فعالیت‌ها (جدیدترین اول) */
    async audit(filter: { userId?: string | null; limit?: number; offset?: number } = {}): Promise<AuditRow[]> {
      return db.transaction(async (tx) => {
        await authorize(tx, 'audit.view')
        const where = filter.userId === undefined ? '' : filter.userId === null ? 'WHERE user_id IS NULL' : 'WHERE user_id = ?'
        const params = filter.userId ? [filter.userId] : []
        const rows = await tx.all(`SELECT * FROM audit_log ${where} ORDER BY at DESC, rowid DESC LIMIT ? OFFSET ?`, [...params, filter.limit ?? 50, filter.offset ?? 0])
        return rows.map((r) => ({ id: r.id as string, at: r.at as string, userId: (r.user_id as string | null) ?? null, userName: r.user_name as string, action: r.action as string, entityType: (r.entity_type as string | null) ?? null, entityId: (r.entity_id as string | null) ?? null, summary: r.summary as string }))
      })
    },

    async logout(): Promise<void> {
      const a = await currentActor(db)
      if (a?.userId) await db.transaction((tx) => writeAudit(tx, a, { action: 'auth.logout', entityType: 'user', entityId: a.userId, summary: `خروج «${a.name}»` }))
      setActor(null)
    },
  }
}

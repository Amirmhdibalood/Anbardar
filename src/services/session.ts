import type { Role } from '../models/permissions'

/** کاربر واردشده در همین اجرای برنامه (در حافظه؛ با بستن برنامه پاک می‌شود) */
export interface Actor {
  userId: string
  name: string
  role: Role
}

let current: Actor | null = null
/** null = هنوز معلوم نیست (در حال بارگذاری) */
let usersOn: boolean | null = null
/** صفحه ورود روشن است؟ (خاموش = برنامه به‌نام مالک باز می‌شود) */
let loginOn = true
const listeners = new Set<() => void>()
let snapshot: { actor: Actor | null; usersOn: boolean | null; loginOn: boolean } = { actor: current, usersOn, loginOn }
const emit = () => {
  snapshot = { actor: current, usersOn, loginOn }
  listeners.forEach((l) => l())
}

export const getActor = (): Actor | null => current
export function setActor(a: Actor | null): void {
  current = a
  if (a) rememberLastUser(a.userId)
  emit()
}
export function setUsersOn(on: boolean): void {
  usersOn = on
  emit()
}
export function setLoginOn(on: boolean): void {
  loginOn = on
  emit()
}
export const getSessionSnapshot = () => snapshot
export function subscribeActor(l: () => void): () => void {
  listeners.add(l)
  return () => void listeners.delete(l)
}

/** فقط شناسه آخرین کاربر واردشده (هرگز رمز) برای انتخاب خودکار در صفحه ورود */
const LAST_USER_KEY = 'anbardar.lastUser.v1'
export function rememberLastUser(id: string): void {
  try {
    localStorage.setItem(LAST_USER_KEY, id)
  } catch {
    /* حافظه در دسترس نیست */
  }
}
export function lastUserId(): string | null {
  try {
    return localStorage.getItem(LAST_USER_KEY)
  } catch {
    return null
  }
}

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
const listeners = new Set<() => void>()
let snapshot: { actor: Actor | null; usersOn: boolean | null } = { actor: current, usersOn }
const emit = () => {
  snapshot = { actor: current, usersOn }
  listeners.forEach((l) => l())
}

export const getActor = (): Actor | null => current
export function setActor(a: Actor | null): void {
  current = a
  emit()
}
export function setUsersOn(on: boolean): void {
  usersOn = on
  emit()
}
export const getSessionSnapshot = () => snapshot
export function subscribeActor(l: () => void): () => void {
  listeners.add(l)
  return () => void listeners.delete(l)
}

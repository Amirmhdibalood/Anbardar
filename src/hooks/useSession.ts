import { useSyncExternalStore } from 'react'
import { can, type Permission } from '../models/permissions'
import { getSessionSnapshot, subscribeActor } from '../services/session'

export function useSession() {
  return useSyncExternalStore(subscribeActor, getSessionSnapshot)
}

/** فقط برای پنهان/غیرفعال کردن دکمه‌ها؛ اعمال واقعی مجوز در لایه سرویس است */
export function useCan(p: Permission): boolean {
  const { actor, usersOn } = useSession()
  if (!usersOn) return true
  return can(actor?.role, p)
}

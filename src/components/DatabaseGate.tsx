import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { initApp } from '../services/appContext'
import { toUserMessage } from '../utils/errors'
import { logger } from '../utils/logger'
import { Icon } from './Icon'
import styles from './DatabaseGate.module.css'

type State = { status: 'loading' } | { status: 'ready' } | { status: 'failed'; message: string }

/** تا آماده شدن دیتابیس (Migration و Seed) برنامه را نگه می‌دارد و در صورت خطا پیام فارسی ساده نشان می‌دهد */
export function DatabaseGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    initApp()
      .then(() => !cancelled && setState({ status: 'ready' }))
      .catch((error) => {
        logger.error('DatabaseGate', error)
        if (!cancelled) setState({ status: 'failed', message: toUserMessage(error) })
      })
    return () => {
      cancelled = true
    }
  }, [attempt])

  const retry = useCallback(() => {
    setState({ status: 'loading' })
    setAttempt((n) => n + 1)
  }, [])

  if (state.status === 'ready') return <>{children}</>
  if (state.status === 'loading') return <div className={styles.root} aria-busy="true" />
  return (
    <div className={styles.root} role="alert">
      <div className={styles.icon}>
        <Icon name="alert" size={30} />
      </div>
      <h1 className={styles.title}>اطلاعات برنامه باز نشد</h1>
      <p className={styles.text}>{state.message}</p>
      <button type="button" className={styles.button} onClick={retry}>
        تلاش دوباره
      </button>
    </div>
  )
}

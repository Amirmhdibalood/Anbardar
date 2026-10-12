import { useCallback, useEffect, useState } from 'react'
import { logger } from '../utils/logger'
import { toUserMessage } from '../utils/errors'

export interface AsyncState<T> {
  /** آخرین نتیجه موفق (هنگام بارگذاری دوباره همان قبلی می‌ماند تا صفحه نپرد) */
  data: T | undefined
  /** پیام فارسی خطا، اگر آخرین بارگذاری ناموفق بود */
  error: string | null
  /** تا اولین نتیجه نیامده true است */
  loading: boolean
  reload: () => void
}

interface Result<T> {
  loader: () => Promise<T>
  version: number
  data?: T
  error?: string
}

/** اجرای یک تابع async هنگام ساخت صفحه و هر بار که `loader` (با useCallback) یا reload عوض شود */
export function useAsync<T>(loader: () => Promise<T>): AsyncState<T> {
  const [version, setVersion] = useState(0)
  const [result, setResult] = useState<Result<T> | null>(null)

  useEffect(() => {
    let cancelled = false
    loader().then(
      (data) => !cancelled && setResult({ loader, version, data }),
      (error: unknown) => {
        logger.error('بارگذاری ناموفق بود', error)
        if (!cancelled) setResult((prev) => ({ loader, version, data: prev?.data, error: toUserMessage(error) }))
      },
    )
    return () => {
      cancelled = true
    }
  }, [loader, version])

  const reload = useCallback(() => setVersion((v) => v + 1), [])
  const fresh = result !== null && result.loader === loader && result.version === version
  return { data: result?.data, error: fresh ? (result.error ?? null) : null, loading: result === null || (!fresh && result.data === undefined), reload }
}

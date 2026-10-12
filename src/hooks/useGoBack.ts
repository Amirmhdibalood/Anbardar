import { useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

/** بازگشت به صفحه قبلی (با حفظ جستجو و فیلتر)؛ اگر صفحه مستقیم باز شده باشد به مسیر جایگزین می‌رود */
export function useGoBack(fallback: string): () => void {
  const navigate = useNavigate()
  const location = useLocation()
  return useCallback(() => {
    if (location.key === 'default') navigate(fallback, { replace: true })
    else navigate(-1)
  }, [fallback, location.key, navigate])
}

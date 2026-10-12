import { useEffect } from 'react'
import { isRouteErrorResponse, useNavigate, useRouteError } from 'react-router-dom'
import { logger } from '../utils/logger'
import { ErrorFallback } from './ErrorFallback'
import { NotFoundView } from './NotFoundView'

/** جایگزین صفحه خطای پیش‌فرض React Router که متن فنی انگلیسی نشان می‌دهد */
export function RouteErrorPage() {
  const error = useRouteError()
  const navigate = useNavigate()
  const notFound = isRouteErrorResponse(error) && error.status === 404

  useEffect(() => {
    if (!notFound) logger.error('خطای مسیر', error)
  }, [error, notFound])

  if (notFound) return <NotFoundView />
  return <ErrorFallback onRetry={() => navigate(0)} />
}

import { useEffect, useState } from 'react'
import { getDashboardSummary, type DashboardSummary } from '../services/dashboardService'
import { logger } from '../utils/logger'

const EMPTY: DashboardSummary = { productCount: 0, todaySales: 0, lowStockCount: 0 }

export function useDashboard(): DashboardSummary {
  const [summary, setSummary] = useState<DashboardSummary>(EMPTY)

  useEffect(() => {
    let cancelled = false
    getDashboardSummary()
      .then((s) => !cancelled && setSummary(s))
      .catch((error) => logger.error('بارگذاری خلاصه داشبورد ناموفق بود', error))
    return () => {
      cancelled = true
    }
  }, [])

  return summary
}

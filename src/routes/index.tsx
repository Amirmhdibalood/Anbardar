import type { ComponentType } from 'react'
import { createHashRouter, type RouteObject } from 'react-router-dom'
import { RouteErrorPage } from '../components/RouteErrorPage'
import { AppLayout } from '../layouts/AppLayout'
import { FullScreenLayout } from '../layouts/FullScreenLayout'
import HomePage from '../pages/HomePage'

// صفحه‌های غیراصلی با `lazy` روتر بارگذاری می‌شوند تا شروع برنامه سریع بماند
const page = (load: () => Promise<{ default: ComponentType }>): Pick<RouteObject, 'lazy'> => ({
  lazy: async () => ({ Component: (await load()).default }),
})

/**
 * HashRouter عمداً انتخاب شده: در Capacitor، میزبانی وب ایستا و Electron/Tauri آینده
 * بدون نیاز به تنظیم سرور (fallback مسیرها) کار می‌کند و رفرش روی هر صفحه امن است.
 */
const routes: RouteObject[] = [
  {
    errorElement: <RouteErrorPage />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { index: true, element: <HomePage /> },
          { path: 'products', ...page(() => import('../pages/ProductsPage')) },
          { path: 'stock', ...page(() => import('../pages/StockPage')) },
          { path: 'products/groups', ...page(() => import('../pages/ProductGroupsPage')) },
          { path: 'reports', ...page(() => import('../pages/ReportsPage')) },
          { path: 'more', ...page(() => import('../pages/MorePage')) },
          { path: 'purchases', ...page(() => import('../pages/PurchasesPage')) },
          { path: 'purchases/:id', ...page(() => import('../pages/PurchaseDetailPage')) },
          { path: 'sales', ...page(() => import('../pages/SalesPage')) },
          { path: 'sales/:id', ...page(() => import('../pages/SaleDetailPage')) },
          { path: 'more/price-calculator', ...page(() => import('../pages/PriceCalculatorPage')) },
          { path: 'more/expenses', ...page(() => import('../pages/ExpensesPage')) },
          { path: 'more/customers', ...page(() => import('../pages/CustomersPage')) },
          { path: 'more/suppliers', ...page(() => import('../pages/SuppliersPage')) },
          { path: 'more/warehouses', ...page(() => import('../pages/WarehousesPage')) },
          { path: 'more/settings', ...page(() => import('../pages/SettingsPage')) },
          { path: 'more/backup', ...page(() => import('../pages/BackupPage')) },
          { path: 'more/help', ...page(() => import('../pages/HelpPage')) },
          { path: 'transfers', ...page(() => import('../pages/TransfersPage')) },
          { path: 'transfers/:id', ...page(() => import('../pages/TransferDetailPage')) },
          { path: '*', ...page(() => import('../pages/NotFoundPage')) },
        ],
      },
      {
        element: <FullScreenLayout />,
        children: [
          { path: 'products/new', ...page(() => import('../pages/ProductFormPage')) },
          { path: 'products/:id', ...page(() => import('../pages/ProductFormPage')) },
          { path: 'sales/new', ...page(() => import('../pages/NewSalePage')) },
          { path: 'purchases/new', ...page(() => import('../pages/NewPurchasePage')) },
          { path: 'sales/:id/return', ...page(() => import('../pages/NewSaleReturnPage')) },
          { path: 'purchases/:id/return', ...page(() => import('../pages/NewPurchaseReturnPage')) },
          { path: 'transfers/new', ...page(() => import('../pages/NewTransferPage')) },
        ],
      },
    ],
  },
]

export const router = createHashRouter(routes)

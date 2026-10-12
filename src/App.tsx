import { RouterProvider } from 'react-router-dom'
import { DatabaseGate } from './components/DatabaseGate'
import { ErrorBoundary } from './components/ErrorBoundary'
import { SettingsProvider } from './components/SettingsProvider'
import { ToastProvider } from './components/Toast'
import { router } from './routes'

export default function App() {
  return (
    <ErrorBoundary>
      <DatabaseGate>
        <SettingsProvider>
          <ToastProvider>
            <RouterProvider router={router} />
          </ToastProvider>
        </SettingsProvider>
      </DatabaseGate>
    </ErrorBoundary>
  )
}

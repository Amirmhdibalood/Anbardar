import { Component, type ErrorInfo, type ReactNode } from 'react'
import { logger } from '../utils/logger'
import { ErrorFallback } from './ErrorFallback'

interface Props {
  children: ReactNode
}
interface State {
  failed: boolean
}

/** آخرین خط دفاعی: هر خطای پیش‌بینی‌نشده در رندر به یک پیام فارسی ساده تبدیل می‌شود */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    logger.error('خطای رندر', { error, componentStack: info.componentStack })
  }

  render(): ReactNode {
    if (this.state.failed) {
      return <ErrorFallback onRetry={() => this.setState({ failed: false })} />
    }
    return this.props.children
  }
}

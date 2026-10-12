import { PageHeader } from './PageHeader'
import { EmptyState } from './EmptyState'
import type { IconName } from './Icon'

interface Props {
  title: string
  backTo?: string
  icon: IconName
  emptyTitle: string
  emptyDescription: string
  badge?: string
}

/** صفحه موقت Phase 1 با Empty State؛ هر صفحه در فاز مربوط به خودش کامل می‌شود */
export function PlaceholderPage({ title, backTo, icon, emptyTitle, emptyDescription, badge = 'به‌زودی' }: Props) {
  return (
    <>
      <PageHeader title={title} backTo={backTo} />
      <EmptyState icon={icon} title={emptyTitle} description={emptyDescription} badge={badge} />
    </>
  )
}

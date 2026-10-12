import { PartiesPage } from './parties/PartiesPage'
import { SUPPLIERS_CONFIG } from './parties/partyConfigs'

export default function SuppliersPage() {
  return <PartiesPage config={SUPPLIERS_CONFIG} />
}

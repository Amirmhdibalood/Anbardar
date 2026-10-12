import { PartiesPage } from './parties/PartiesPage'
import { CUSTOMERS_CONFIG } from './parties/partyConfigs'

export default function CustomersPage() {
  return <PartiesPage config={CUSTOMERS_CONFIG} />
}

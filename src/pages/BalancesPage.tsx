import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { EmptyState } from '../components/EmptyState'
import { PageHeader } from '../components/PageHeader'
import { SegmentedControl } from '../components/SegmentedControl'
import { useAsync } from '../hooks/useAsync'
import { useGoBack } from '../hooks/useGoBack'
import { getMoney } from '../services/appContext'
import { formatMoney } from '../utils/money'
import { formatInteger, toPersianDigits } from '../utils/persian'
import styles from './money/Money.module.css'

/** گزارش بدهکاران (طلب ما) و بستانکاران (بدهی ما) */
export default function BalancesPage() {
  const goBack = useGoBack('/reports')
  const navigate = useNavigate()
  const load = useCallback(() => getMoney().balancesReport(), [])
  const { data, error, loading, reload } = useAsync(load)
  const [tab, setTab] = useState<'debtors' | 'creditors'>('debtors')

  return (
    <>
      <PageHeader title="بدهکاران و بستانکاران" onBack={goBack} />
      {error && !data ? (
        <EmptyState icon="alert" title="گزارش باز نشد" description={error} action={<Button onClick={reload}>تلاش دوباره</Button>} />
      ) : loading || !data ? null : (
        <>
          <div className={styles.totals}>
            <Card>
              <div data-testid="total-receivable">
                <span className={styles.meta}>طلب از دیگران ({formatInteger(data.debtors.length)} نفر)</span>
                <strong className={styles.plus}>{formatMoney(data.totalReceivable)}</strong>
              </div>
            </Card>
            <Card>
              <div data-testid="total-payable">
                <span className={styles.meta}>بدهی به دیگران ({formatInteger(data.creditors.length)} نفر)</span>
                <strong className={styles.minus}>{formatMoney(data.totalPayable)}</strong>
              </div>
            </Card>
          </div>
          <SegmentedControl
            label="نوع"
            options={[
              { value: 'debtors', label: 'بدهکاران' },
              { value: 'creditors', label: 'بستانکاران' },
            ]}
            value={tab}
            onChange={setTab}
          />
          <div style={{ height: 12 }} />
          {(tab === 'debtors' ? data.debtors : data.creditors).length === 0 ? (
            <EmptyState compact icon="check" title={tab === 'debtors' ? 'کسی به شما بدهکار نیست' : 'به کسی بدهکار نیستید'} description="مانده‌ها فقط از فاکتورها، برگشت‌ها و اسناد دریافت/پرداخت محاسبه می‌شوند." />
          ) : (
            <Card>
              <ul className={styles.list} data-testid="balances-list">
                {(tab === 'debtors' ? data.debtors : data.creditors).map(({ party, balance }, i) => (
                  <li key={party.id}>
                    <button type="button" className={styles.row} onClick={() => navigate(`/parties/${party.id}`)}>
                      <span className={styles.meta}>{toPersianDigits(i + 1)}</span>
                      <span className={styles.rowMain}>
                        <strong>{party.name}</strong>
                        {party.phone && <span className={styles.meta}>{toPersianDigits(party.phone)}</span>}
                      </span>
                      <span className={balance > 0 ? styles.plus : styles.minus}>{formatMoney(Math.abs(balance))}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </>
  )
}

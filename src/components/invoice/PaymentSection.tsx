import { useEffect } from 'react'
import type { Party } from '../../models/party'
import { parseIntegerInput } from '../../utils/persian'
import { formatMoney } from '../../utils/money'
import { Field, MoneyInput } from '../Field'
import { Icon } from '../Icon'
import { SegmentedControl } from '../SegmentedControl'
import styles from './Invoice.module.css'

interface Props {
  kind: 'purchase' | 'sale'
  party: Party | null
  payMode: 'full' | 'credit'
  paid: string
  total: number
  error?: string
  onChange: (patch: { payMode?: 'full' | 'credit'; paid?: string }) => void
}

/**
 * پرداخت هنگام ثبت فاکتور. پیش‌فرض «کامل» است تا فروش/خرید نقدی همان جریان سریع بماند.
 * برای «مشتری نقدی» و «متفرقه» نسیه ممکن نیست و این بخش فقط یک توضیح کوتاه است.
 */
export function PaymentSection({ kind, party, payMode, paid, total, error, onChange }: Props) {
  const system = !!party?.isSystem
  useEffect(() => {
    if (system && payMode !== 'full') onChange({ payMode: 'full', paid: '' })
  }, [system, payMode, onChange])

  const fullLabel = kind === 'sale' ? 'کامل دریافت شد' : 'کامل پرداخت شد'
  if (system) {
    return (
      <p className={styles.discountHint} data-testid="pay-system-note">
        <Icon name="info" size={14} /> {kind === 'sale' ? 'فروش به «مشتری نقدی» همیشه نقدی است. برای فروش نسیه، مشتری با نام انتخاب کنید.' : 'خرید از «متفرقه» همیشه نقدی است. برای خرید نسیه، تأمین‌کننده با نام انتخاب کنید.'}
      </p>
    )
  }
  const paidValue = parseIntegerInput(paid || '0') ?? 0
  const remaining = Math.max(0, total - paidValue)
  return (
    <div className={styles.paymentCard}>
      <SegmentedControl
        label="نحوه تسویه"
        options={[
          { value: 'full', label: fullLabel },
          { value: 'credit', label: 'نسیه / بخشی' },
        ]}
        value={payMode}
        onChange={(v) => onChange({ payMode: v })}
      />
      {payMode === 'credit' && (
        <>
          <Field label={kind === 'sale' ? 'مبلغ دریافتی الان (تومان)' : 'مبلغ پرداختی الان (تومان)'} htmlFor="inv-paid" error={error} hint="خالی یعنی هیچ مبلغی الان جابه‌جا نشد.">
            <MoneyInput id="inv-paid" value={paid} onChange={(v) => onChange({ paid: v })} invalid={!!error} placeholder="۰" suffix="تومان" />
          </Field>
          <p className={styles.discountHint} data-testid="pay-remaining">
            {kind === 'sale' ? `باقیمانده به بدهی «${party?.name ?? ''}» اضافه می‌شود: ` : `باقیمانده بدهی شما به «${party?.name ?? ''}» می‌شود: `}
            <strong>{formatMoney(remaining, { withUnit: true })}</strong>
          </p>
        </>
      )}
    </div>
  )
}

import { useMemo, useState } from 'react'
import { Card } from '../components/Card'
import { Field, MoneyInput, TextInput } from '../components/Field'
import { PageHeader } from '../components/PageHeader'
import { useGoBack } from '../hooks/useGoBack'
import { MAX_MARKUP_BP } from '../models/settings'
import { calcMinSalePrice } from '../services/pricing'
import { formatMoney } from '../utils/money'
import { formatInteger, parseIntegerInput, toPersianDigits } from '../utils/persian'
import styles from './SettingsPage.module.css'

function parseBp(text: string): { ok: true; bp: number } | { ok: false; error: string } {
  const raw = text.trim().replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d).toString()).replace(',', '.')
  if (raw === '' || !/^\d+(\.\d{1,2})?$/.test(raw)) return { ok: false, error: 'درصد سود را درست وارد کنید (مثلاً ۱۳ یا ۱۲٫۵).' }
  const bp = Math.round(Number(raw) * 100)
  if (bp < 0 || bp > MAX_MARKUP_BP) return { ok: false, error: 'درصد سود باید بین ۰ تا ۱۰۰۰ باشد.' }
  return { ok: true, bp }
}

/** ماشین‌حساب حداقل قیمت فروش: هر دو تفسیر «سود روی خرید» و «سود از فروش» */
export default function PriceCalculatorPage() {
  const goBack = useGoBack('/more')
  const [purchase, setPurchase] = useState('')
  const [extra, setExtra] = useState('')
  const [percent, setPercent] = useState('۱۳')

  const computed = useMemo(() => {
    const p = purchase.trim() === '' ? 0 : parseIntegerInput(purchase)
    const e = extra.trim() === '' ? 0 : parseIntegerInput(extra)
    if (p === null || e === null) return { error: 'مبالغ باید عدد صحیح تومان باشند.' as string }
    const bpResult = parseBp(percent)
    if (!bpResult.ok) return { error: bpResult.error }
    try {
      return { result: { ...calcMinSalePrice(p, e, bpResult.bp), bp: bpResult.bp } }
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'محاسبه ممکن نشد.' }
    }
  }, [purchase, extra, percent])

  const result = 'result' in computed ? computed.result : null
  const error = 'error' in computed ? computed.error : null

  return (
    <>
      <PageHeader title="ماشین‌حساب قیمت" onBack={goBack} />
      <Card className={styles.group}>
        <h2 className={styles.heading}>حداقل قیمت فروش</h2>
        <p className={styles.hint}>قیمت خرید و درصد سود دلخواه را بزنید. برنامه هر دو معنی رایج «درصد سود» را حساب می‌کند.</p>
        <Field label="قیمت خرید (تومان)" htmlFor="pc-buy">
          <MoneyInput id="pc-buy" value={purchase} onChange={setPurchase} placeholder="مثلاً ۱۰۰٬۰۰۰" suffix="تومان" />
        </Field>
        <Field label="هزینه اضافه (اختیاری)" htmlFor="pc-extra" hint="مثل کرایه یا کارمزد روی این کالا">
          <MoneyInput id="pc-extra" value={extra} onChange={setExtra} placeholder="۰" suffix="تومان" />
        </Field>
        <Field label="درصد سود" htmlFor="pc-pct">
          <TextInput id="pc-pct" value={percent} onChange={(e) => setPercent(e.target.value)} inputMode="decimal" placeholder="۱۳" autoComplete="off" />
        </Field>
        {error && <p className={styles.note} role="alert">{error}</p>}
      </Card>
      {result && (
        <Card className={styles.group} data-testid="price-calc-result">
          <h2 className={styles.heading}>نتیجه</h2>
          <p className={styles.hint}>جمع هزینه: {formatMoney(result.cost)}</p>
          <div className={styles.resultRow}>
            <strong>سود {toPersianDigits((result.bp / 100).toFixed(result.bp % 100 === 0 ? 0 : 1))}٪ روی قیمت خرید</strong>
            <p className={styles.hint}>یعنی هزینه را به همان درصد زیاد کنید: {formatInteger(result.cost)} × (۱ + درصد)</p>
            <p className={styles.big}>{formatMoney(result.markupPrice)}</p>
          </div>
          <div className={styles.resultRow}>
            <strong>سود {toPersianDigits((result.bp / 100).toFixed(result.bp % 100 === 0 ? 0 : 1))}٪ از قیمت فروش</strong>
            <p className={styles.hint}>یعنی همان درصد از مبلغی که از مشتری می‌گیرید سود باشد (مناسب وقتی اجاره و کارمزد درصدی از فروش‌اند). این عدد «ضرر نکردن» را تضمین می‌کند.</p>
            <p className={styles.big} data-testid="margin-price">
              {formatMoney(result.marginPrice)}
            </p>
          </div>
          <p className={styles.note}>هر دو عدد به بالا گرد شده‌اند تا از درصد کمتر نشود.</p>
        </Card>
      )}
    </>
  )
}

import { Card } from '../components/Card'
import { Field, TextInput } from '../components/Field'
import { Picker } from '../components/Picker'
import { PageHeader } from '../components/PageHeader'
import { useSettings } from '../hooks/useSettings'
import { COST_METHODS, MAX_MARKUP_BP, SALE_PRICE_MODES, type CostMethod, type SalePriceMode } from '../models/settings'
import { costMethodLabel, salePriceModeLabel } from '../services/pricing'
import { toPersianDigits } from '../utils/persian'
import styles from './SettingsPage.module.css'
import { AppearanceSettings } from './settings/AppearanceSettings'
import { LoginSettings } from './settings/LoginSettings'
import { useState } from 'react'

export default function SettingsPage() {
  const { settings, setCostMethod, setSalePriceMode, setMarkupBp } = useSettings()
  const [markupText, setMarkupText] = useState(() => toPersianDigits(String(settings.markupBp / 100)))
  const [markupError, setMarkupError] = useState<string | null>(null)

  const saveMarkup = (text: string) => {
    setMarkupText(text)
    const raw = text.trim().replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d).toString()).replace(',', '.')
    if (raw === '') {
      setMarkupBp(0)
      setMarkupError(null)
      return
    }
    if (!/^\d+(\.\d{1,2})?$/.test(raw)) {
      setMarkupError('درصد را درست وارد کنید (مثلاً ۲۰ یا ۱۲٫۵).')
      return
    }
    const bp = Math.round(Number(raw) * 100)
    if (bp < 0 || bp > MAX_MARKUP_BP) {
      setMarkupError('درصد باید بین ۰ تا ۱۰۰۰ باشد.')
      return
    }
    setMarkupError(null)
    setMarkupBp(bp)
  }

  return (
    <>
      <PageHeader title="تنظیمات" backTo="/more" />

      <AppearanceSettings />

      <LoginSettings />

      <Card className={styles.group}>
        <h2 className={styles.heading}>روش محاسبه سود</h2>
        <p className={styles.hint}>بهای هر سه روش هنگام فروش ذخیره شده؛ عوض کردن این گزینه گزارش‌ها را فوراً عوض می‌کند.</p>
        <div className={styles.fieldGap}>
          <Picker id="cost-method" title="روش محاسبه سود" value={settings.costMethod} onChange={(m) => setCostMethod(m as CostMethod)} options={COST_METHODS.map((m) => ({ value: m, label: costMethodLabel(m) }))} />
        </div>
      </Card>

      <Card className={styles.group}>
        <h2 className={styles.heading}>پیشنهاد قیمت فروش</h2>
        <p className={styles.hint}>وقتی کالا را به فاکتور فروش اضافه می‌کنید، قیمت واحد چطور پر شود؟ همیشه می‌توانید دستی عوضش کنید.</p>
        <div className={styles.fieldGap}>
          <Picker id="sale-price-mode" title="پیشنهاد قیمت فروش" value={settings.salePriceMode} onChange={(m) => setSalePriceMode(m as SalePriceMode)} options={SALE_PRICE_MODES.map((m) => ({ value: m, label: salePriceModeLabel(m) }))} />
        </div>
        {settings.salePriceMode === 'markup' && (
          <Field label="درصد سود سراسری" htmlFor="markup-bp" error={markupError ?? undefined} hint="اگر برای گروهی درصد جدا بگذارید، همان اولویت دارد.">
            <TextInput id="markup-bp" value={markupText} onChange={(e) => saveMarkup(e.target.value)} inputMode="decimal" placeholder="۲۰" autoComplete="off" />
          </Field>
        )}
      </Card>
    </>
  )
}

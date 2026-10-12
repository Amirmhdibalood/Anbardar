import { Card } from '../components/Card'
import { Field, TextInput } from '../components/Field'
import { PageHeader } from '../components/PageHeader'
import { SegmentedControl, type SegmentOption } from '../components/SegmentedControl'
import { useSettings } from '../hooks/useSettings'
import { COST_METHODS, MAX_MARKUP_BP, SALE_PRICE_MODES, type CostMethod, type SalePriceMode, type ThemePreference } from '../models/settings'
import { costMethodLabel, salePriceModeLabel } from '../services/pricing'
import { toPersianDigits } from '../utils/persian'
import styles from './SettingsPage.module.css'
import { useState } from 'react'

const THEME_OPTIONS: SegmentOption<ThemePreference>[] = [
  { value: 'system', label: 'سیستم', icon: 'monitor' },
  { value: 'dark', label: 'تیره', icon: 'moon' },
  { value: 'light', label: 'روشن', icon: 'sun' },
]

export default function SettingsPage() {
  const { settings, setTheme, setCostMethod, setSalePriceMode, setMarkupBp } = useSettings()
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

      <Card className={styles.group}>
        <h2 className={styles.heading}>ظاهر برنامه</h2>
        <p className={styles.hint}>با گزینه «سیستم»، تم برنامه با تم گوشی شما هماهنگ می‌شود.</p>
        <SegmentedControl label="تم برنامه" options={THEME_OPTIONS} value={settings.theme} onChange={setTheme} />
      </Card>

      <Card className={styles.group}>
        <h2 className={styles.heading}>روش محاسبه سود</h2>
        <p className={styles.hint}>بهای هر سه روش هنگام فروش ذخیره شده؛ عوض کردن این گزینه گزارش‌ها را فوراً عوض می‌کند.</p>
        <div className={styles.fieldGap} role="radiogroup" aria-label="روش بها">
          {COST_METHODS.map((m) => (
            <label key={m} className={styles.radioRow}>
              <input type="radio" name="cost-method" checked={settings.costMethod === m} onChange={() => setCostMethod(m as CostMethod)} />
              <span>{costMethodLabel(m)}</span>
            </label>
          ))}
        </div>
      </Card>

      <Card className={styles.group}>
        <h2 className={styles.heading}>پیشنهاد قیمت فروش</h2>
        <p className={styles.hint}>وقتی کالا را به فاکتور فروش اضافه می‌کنید، قیمت واحد چطور پر شود؟ همیشه می‌توانید دستی عوضش کنید.</p>
        <div className={styles.fieldGap} role="radiogroup" aria-label="پیشنهاد قیمت">
          {SALE_PRICE_MODES.map((m) => (
            <label key={m} className={styles.radioRow}>
              <input type="radio" name="sale-price-mode" checked={settings.salePriceMode === m} onChange={() => setSalePriceMode(m as SalePriceMode)} />
              <span>{salePriceModeLabel(m)}</span>
            </label>
          ))}
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

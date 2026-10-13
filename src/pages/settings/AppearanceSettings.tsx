import { Card } from '../../components/Card'
import { SegmentedControl, type SegmentOption } from '../../components/SegmentedControl'
import { ACCENT_META, isAccentLocked, isPremiumAccent } from '../../config/themes'
import { useSettings } from '../../hooks/useSettings'
import { ACCENTS, FONTS, type AppFont, type ThemePreference } from '../../models/settings'
import { resolveTheme } from '../../services/themeService'
import styles from './AppearanceSettings.module.css'

const FONT_META: Record<AppFont, { label: string; family: string }> = {
  vazirmatn: { label: 'وزیرمتن (پیش‌فرض)', family: "'Vazirmatn', system-ui, sans-serif" },
  sahel: { label: 'ساحل', family: "'Sahel', 'Vazirmatn', sans-serif" },
  samim: { label: 'صمیم', family: "'Samim', 'Vazirmatn', sans-serif" },
}
const FONT_SAMPLE = 'فاکتور ۱۴۰۵/۰۷/۲۱ — جمع ۱۲٬۳۴۵٬۶۷۸ تومان'

const MODE_OPTIONS: SegmentOption<ThemePreference>[] = [
  { value: 'light', label: 'روشن', icon: 'sun' },
  { value: 'dark', label: 'تیره', icon: 'moon' },
  { value: 'system', label: 'مطابق سیستم', icon: 'monitor' },
]

/** «تنظیمات ظاهری»: حالت تم + رنگ تأکیدی همان حالت، با پیش‌نمایش زنده */
export function AppearanceSettings() {
  const { settings, setTheme, setAccent, setFont } = useSettings()
  const mode = resolveTheme(settings.theme)
  const current = mode === 'dark' ? settings.accentDark : settings.accentLight
  return (
    <Card className={styles.group}>
      <h2 className={styles.heading}>تنظیمات ظاهری</h2>
      <h3 className={styles.sub}>تم</h3>
      <SegmentedControl label="حالت تم" options={MODE_OPTIONS} value={settings.theme} onChange={setTheme} />
      <p className={styles.hint}>{settings.theme === 'system' ? 'با تم گوشی هماهنگ می‌شود؛ ' : ''}رنگ برای حالت {mode === 'dark' ? 'تیره' : 'روشن'}:</p>
      <div className={styles.swatches} role="radiogroup" aria-label={`رنگ تم ${mode === 'dark' ? 'تیره' : 'روشن'}`} id="accent-swatches">
        {ACCENTS.map((a) => {
          const locked = isAccentLocked(a)
          return (
            <button
              key={a}
              type="button"
              role="radio"
              aria-checked={current === a}
              aria-disabled={locked || undefined}
              data-accent-option={a}
              className={styles.swatch}
              onClick={() => !locked && setAccent(mode, a)}
            >
              <span className={styles.dot} style={{ background: ACCENT_META[a][mode] }}>
                {current === a && (
                  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                    <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </span>
              <span className={styles.name}>{ACCENT_META[a].label}</span>
              {isPremiumAccent(a) && (
                <span className={styles.badge}>
                  <svg viewBox="0 0 24 24" width="10" height="10" aria-hidden="true">
                    <rect x="5" y="11" width="14" height="10" rx="2" fill="currentColor" />
                    <path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" strokeWidth="2.4" />
                  </svg>
                  ویژه
                </span>
              )}
            </button>
          )
        })}
      </div>
      {/* پیش‌نمایش زنده با توکن‌های همین تم */}
      <div className={styles.preview} aria-hidden="true" data-testid="theme-preview">
        <div className={styles.pvHead}>
          <span className={styles.pvTitle}>پیش‌نمایش</span>
          <span className={styles.pvChip}>۱۲ کالا</span>
        </div>
        <div className={styles.pvRow}>
          <span>فروش امروز</span>
          <strong>۲٬۴۵۰٬۰۰۰ تومان</strong>
        </div>
        <span className={styles.pvButton}>ثبت فروش</span>
      </div>
      <h3 className={styles.sub} style={{ marginTop: 18 }}>فونت</h3>
      <div className={styles.fonts} role="radiogroup" aria-label="فونت برنامه" id="font-options">
        {FONTS.map((f) => (
          <button key={f} type="button" role="radio" aria-checked={settings.font === f} data-font-option={f} className={styles.fontOption} onClick={() => setFont(f)} style={{ fontFamily: FONT_META[f].family }}>
            <span className={styles.fontName}>{FONT_META[f].label}</span>
            <span className={styles.fontSample}>{FONT_SAMPLE}</span>
          </button>
        ))}
      </div>
      <p className={styles.fontPreview} data-testid="font-preview">
        پیش‌نمایش: انبار مرکزی — ۲۴ عدد هدفون، ۱۲٫۵ کیلو برنج، مانده ۳٬۹۸۰٬۰۰۰ تومان
      </p>
    </Card>
  )
}

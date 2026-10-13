import { useSettings } from '../hooks/useSettings'
import { resolveTheme } from '../services/themeService'
import styles from './ThemeLamp.module.css'

/**
 * چراغ تم (بالا چپ خانه و تب‌های اصلی): چراغ روشن = تم روشن (روز)، خاموش = تم تیره (شب).
 * زدن آن تم را برعکس می‌کند و در تنظیمات ذخیره می‌شود («مطابق سیستم» هم به حالت مخالف ثابت می‌شود).
 */
export function ThemeLamp() {
  const { settings, setTheme } = useSettings()
  const lit = resolveTheme(settings.theme) === 'light'
  return (
    <button
      type="button"
      className={styles.lamp}
      data-lit={lit}
      data-theme-lamp
      aria-pressed={lit}
      aria-label={lit ? 'تم روشن است؛ زدن برای تم تیره' : 'تم تیره است؛ زدن برای تم روشن'}
      onClick={() => setTheme(lit ? 'dark' : 'light')}
    >
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <g className={styles.rays} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="M12 1.5v1.6M4.2 4.6l1.1 1.1M19.8 4.6l-1.1 1.1M1.8 11.5h1.6M20.6 11.5h1.6" />
        </g>
        <path className={styles.bulb} d="M12 5.2a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1 2V18.6h5.2V18c0-.8.4-1.5 1-2A6 6 0 0 0 12 5.2z" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M9.6 21h4.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" />
      </svg>
    </button>
  )
}

import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'ir.anbardar.app',
  appName: 'انباردار',
  webDir: 'dist',
  // پس‌زمینه WebView پیش از اولین رنگ‌آمیزی صفحه (هم‌رنگ اسپلش/معرفی؛ بدون چشمک سفید)
  backgroundColor: '#0D122F',
  plugins: {
    // Capacitor 8: WebView لبه‌به‌لبه است (MainActivity) و فاصله نوارهای سیستم فقط یک بار اعمال می‌شود:
    // WebView ≥140 ← env()/--safe-area-inset-* در CSS؛ WebView قدیمی ← padding بومی + متغیرهای صفر
    // initialViewportFitValueHint: index.html از اول viewport-fit=cover دارد؛ از جابه‌جایی اولیه جلوگیری می‌کند
    SystemBars: { insetsHandling: 'css', initialViewportFitValueHint: 'cover' },
  },
  android: {
    // محتوای وب فقط از منابع امن بارگذاری شود
    allowMixedContent: false,
  },
}

export default config

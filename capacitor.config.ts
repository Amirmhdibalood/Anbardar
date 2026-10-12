import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'ir.anbardar.app',
  appName: 'انباردار',
  webDir: 'dist',
  plugins: {
    // Capacitor 8: مقادیر درست safe-area را به‌صورت متغیر CSS تزریق می‌کند (WebView قدیمی)
    SystemBars: { insetsHandling: 'css' },
  },
  android: {
    // محتوای وب فقط از منابع امن بارگذاری شود
    allowMixedContent: false,
  },
}

export default config

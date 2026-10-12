import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'ir.anbardar.app',
  appName: 'انباردار',
  webDir: 'dist',
  android: {
    // محتوای وب فقط از منابع امن بارگذاری شود
    allowMixedContent: false,
  },
}

export default config

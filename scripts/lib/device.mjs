// پیکربندی دستگاه شبیه‌سازی‌شده برای همه تست‌ها از متغیرهای محیطی (اجرای «walkthrough»):
//   DEVICE=360x780  INSETS=3btn|gesture|none  KB=open|closed  (پیش‌فرض: 390x844، بدون فاصله، صفحه‌کلید بسته)
// صفحه‌کلید باز = صفحه‌کلیدی که روی WebView افتاده: visualViewport کوتاه‌تر از innerHeight (مثل Chrome اندروید).
const [w, h] = (process.env.DEVICE ?? '390x844').split('x').map(Number)
const INSET = { '3btn': { top: 24, bottom: 48 }, gesture: { top: 24, bottom: 16 }, none: { top: 0, bottom: 0 } }[process.env.INSETS ?? 'none']
export const device = { w, h, ...INSET, kb: process.env.KB === 'open' ? Math.round(h * 0.4) : 0 }
export const label = `${w}x${h} ${process.env.INSETS ?? 'none'} kb-${process.env.KB ?? 'closed'}`

/** شبیه‌ساز visualViewport (برای باز/بسته کردن صفحه‌کلید با window.__setKb(px)) */
export function installFakeKeyboard(initialKb) {
  const et = new EventTarget()
  window.__kb = initialKb
  // مثل visualViewport واقعی، مقدارها زنده‌اند (getter)
  Object.defineProperties(et, {
    height: { get: () => innerHeight - window.__kb },
    width: { get: () => innerWidth },
    offsetTop: { get: () => 0 },
    offsetLeft: { get: () => 0 },
    pageTop: { get: () => scrollY },
    scale: { get: () => 1 },
  })
  Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => et })
  // تغییر اندازه پنجره هم visualViewport را عوض می‌کند
  window.addEventListener('resize', () => et.dispatchEvent(new Event('resize')))
  window.__setKb = (px) => {
    window.__kb = px
    et.dispatchEvent(new Event('resize'))
  }
}

export async function setupDevice(page) {
  await page.setViewport({ width: device.w, height: device.h, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  await page.evaluateOnNewDocument(installFakeKeyboard, device.kb)
  if (device.top || device.bottom)
    await page.evaluateOnNewDocument((d) => {
      const set = () => {
        document.documentElement.style.setProperty('--safe-area-inset-top', d.top + 'px')
        document.documentElement.style.setProperty('--safe-area-inset-bottom', d.bottom + 'px')
      }
      document.addEventListener('DOMContentLoaded', set)
    }, device)
}

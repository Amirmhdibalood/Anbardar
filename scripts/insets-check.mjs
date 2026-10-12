// شبیه‌سازی دو حالت SystemBars کپسیتور: (۱) WebView جدید لبه‌به‌لبه با متغیرهای تزریق‌شده
// (۲) WebView قدیمی: padding بومی (viewport کوچک‌تر) و متغیرهای صفر. فاصله باید دقیقاً یک بار اعمال شود.
import puppeteer from 'puppeteer-core'
const BASE = process.env.BASE_URL ?? 'http://localhost:4173/'
const OUT = new URL('../screenshots/', import.meta.url).pathname
const results = []
const check = (n, ok, x = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : ' ' + x}`)
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] })
const modes = [
  { name: 'edge-3btn', w: 412, h: 915, top: 24, bottom: 48 },
  { name: 'edge-gesture', w: 412, h: 915, top: 24, bottom: 16 },
  { name: 'padded-old-webview', w: 412, h: 915 - 24 - 48, top: 0, bottom: 0 },
]
for (const m of modes) {
  const ctx = await browser.createBrowserContext()
  const page = await ctx.newPage()
  await page.setViewport({ width: m.w, height: m.h, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  await page.evaluateOnNewDocument((m) => {
    const set = () => {
      document.documentElement.style.setProperty('--safe-area-inset-top', m.top + 'px')
      document.documentElement.style.setProperty('--safe-area-inset-bottom', m.bottom + 'px')
    }
    document.addEventListener('DOMContentLoaded', set)
  }, m)
  for (const [hash, sel] of [['#/', 'nav'], ['#/sales/new', '[class*="footer"]'], ['#/products/new', '[class*="footer"]']]) {
    await page.goto(BASE + hash, { waitUntil: 'networkidle0' })
    await new Promise((r) => setTimeout(r, 600))
    const r = await page.evaluate((sel) => {
      const els = [...document.querySelectorAll(sel)].filter((e) => getComputedStyle(e).position !== 'static' || e.tagName === 'NAV')
      const el = els.sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom)[0]
      const b = el?.getBoundingClientRect()
      const pb = el ? parseFloat(getComputedStyle(el).paddingBottom) : -1
      const header = document.querySelector('header, h1')?.getBoundingClientRect().top ?? -1
      return { bottom: b?.bottom, height: b?.height, pb, vh: innerHeight, header, scroll: document.documentElement.scrollHeight }
    }, sel)
    check(`${m.name} ${hash}: bottom bar flush with screen bottom`, Math.abs(r.bottom - r.vh) < 1, JSON.stringify(r))
    if (hash === '#/') check(`${m.name}: nav = 68 + inset exactly once`, Math.abs(r.height - (68 + m.bottom)) < 1, JSON.stringify(r))
    check(`${m.name} ${hash}: page does not overflow window`, r.scroll <= r.vh + 1, JSON.stringify(r))
    await page.screenshot({ path: `${OUT}insets-${m.name}-${hash.replace(/[#/]+/g, '-').replace(/^-|-$/g, '') || 'home'}.png` })
  }
  await ctx.close()
}
await browser.close()
console.log(results.join('\n'))
const f = results.filter((r) => r.startsWith('FAIL'))
console.log(`\n${results.length - f.length}/${results.length} passed`)
if (f.length) process.exit(1)

// پیش‌نمایش تم‌ها (412x915): خانه و فرم فروش برای هر رنگ تأکیدی تیره + تم روشن
import puppeteer from 'puppeteer-core'
const BASE = process.env.BASE_URL ?? 'http://localhost:4173/'
const OUT = '/workspace/anbardar-out/screens/'
const themes = [['purple', 'dark', ''], ['teal', 'dark', 'teal'], ['emerald', 'dark', 'emerald'], ['gold', 'dark', 'gold'], ['crimson', 'dark', 'crimson'], ['light', 'light', ''], ['light-purple', 'light', ''], ['light-teal', 'light', 'teal'], ['light-emerald', 'light', 'emerald'], ['light-gold', 'light', 'gold'], ['light-crimson', 'light', 'crimson']]
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
for (const [name, mode, accent] of themes) {
  const ctx = await browser.createBrowserContext()
  const page = await ctx.newPage()
  await page.setViewport({ width: 412, height: 915, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  const go = async (h) => { await page.goto(BASE + h, { waitUntil: 'networkidle0' }); await page.waitForSelector('header h1, nav'); await page.evaluate(() => document.fonts.ready); await wait(500) }
  if (mode === 'light') { await go('#/more/settings'); await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'روشن')?.click()); await wait(300) }
  const apply = () => page.evaluate((a) => { if (a) document.documentElement.dataset.accent = a }, accent)
  await go('#/'); await apply(); await wait(250); await page.screenshot({ path: `${OUT}theme-${name}-home.png` })
  await go('#/sales/new'); await apply(); await wait(250); await page.screenshot({ path: `${OUT}theme-${name}-sale.png` })
  await ctx.close()
}
await browser.close(); console.log('ok')

// پیش‌نمایش طراحی در 412x915 (تیره/روشن): خانه، فرم کالا (بالا و اسکرول‌شده)، فرم فروش، برگه انتخاب‌گر
import puppeteer from 'puppeteer-core'
const BASE = process.env.BASE_URL ?? 'http://localhost:4173/'
const OUT = process.env.OUT ?? '/workspace/anbardar-out/screens/'
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const errors = []
for (const theme of ['dark', 'light']) {
  const ctx = await browser.createBrowserContext()
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(e.message))
  await page.setViewport({ width: 412, height: 915, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  await page.evaluateOnNewDocument(() => document.addEventListener('DOMContentLoaded', () => {
    document.documentElement.style.setProperty('--safe-area-inset-top', '24px')
    document.documentElement.style.setProperty('--safe-area-inset-bottom', '48px')
  }))
  const go = async (h) => { await page.goto(BASE + h, { waitUntil: 'networkidle0' }); await page.waitForSelector('header h1, nav'); await page.evaluate(() => document.fonts.ready); await wait(600) }
  if (theme === 'light') {
    await go('#/more/settings')
    await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'روشن')?.click())
    await wait(400)
  }
  const shot = (n) => page.screenshot({ path: `${OUT}preview-${theme}-${n}.png` })
  await go('#/'); await shot('home')
  await go('#/products/new'); await shot('product-form')
  await page.evaluate(() => document.querySelector('[class*="content"]')?.scrollBy(0, 260)); await wait(400); await shot('product-form-scrolled')
  await page.evaluate(() => document.querySelector('[class*="content"]')?.scrollTo(0, 0)); await wait(200)
  await page.click('#f-unitId'); await wait(500); await shot('picker-open')
  await go('#/sales/new'); await shot('sale-form')
  await ctx.close()
}
await browser.close()
console.log(errors.length ? 'ERRORS ' + errors.join(' | ') : 'ok')

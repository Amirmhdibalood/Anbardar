// تست معرفی متحرک هنگام باز شدن برنامه (نماد از چپ، نام از راست) + prefers-reduced-motion
import puppeteer from 'puppeteer-core'

const BASE = process.env.BASE_URL ?? 'http://localhost:4173/'
const OUT = new URL('../screenshots/', import.meta.url).pathname
const results = []
const problems = []
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ' ' + extra}`)
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-gpu'] })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function open(query, reduced = false) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
  page.on('console', (m) => m.type() === 'error' && problems.push(`console.error: ${m.text()}`))
  if (reduced) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
  const t0 = Date.now()
  await page.goto(BASE + query + '#/', { waitUntil: 'domcontentloaded' })
  return { page, context, t0 }
}

// ۱) معرفی کامل
{
  const { page, context, t0 } = await open('?intro=1')
  check('intro overlay present on open', !!(await page.$('#intro')))
  check('intro background is dark navy', (await page.$eval('#intro', (e) => getComputedStyle(e).backgroundColor)) === 'rgb(13, 18, 47)')
  await sleep(250)
  await page.screenshot({ path: `${OUT}intro-frame-early.png` })
  await page.waitForFunction(() => document.getElementById('intro')?.classList.contains('run'), { timeout: 2000 })
  const anim = await page.$eval('#intro img', (e) => getComputedStyle(e).animationName)
  check('icon slides in (animation)', anim === 'intro-left', anim)
  check('text slides in from right', (await page.$eval('#intro .text', (e) => getComputedStyle(e).animationName)) === 'intro-right')
  await page.waitForFunction(() => !document.getElementById('intro'), { timeout: 3000 })
  const ms = Date.now() - t0
  check('intro finishes ≈1.2s and is removed', ms < 2200, `${ms}ms`)
  await sleep(300)
  check('app visible after intro', (await page.evaluate(() => document.body.innerText)).includes('سلام'))
  await context.close()
}
// ۲) قاب نهایی (نگه‌داشته)
{
  const { page, context } = await open('?intro=hold')
  await sleep(1400)
  const box = await page.$eval('#intro .lockup', (e) => { const r = e.getBoundingClientRect(); return { cx: r.x + r.width / 2, w: r.width } })
  check('lockup settles centered', Math.abs(box.cx - 195) < 4, JSON.stringify(box))
  const order = await page.evaluate(() => document.querySelector('#intro img').getBoundingClientRect().x < document.querySelector('#intro .text').getBoundingClientRect().x)
  check('icon left of text in final lockup', order)
  await page.screenshot({ path: `${OUT}intro-final.png` })
  await context.close()
}
// ۳) کاهش حرکت
{
  const { page, context, t0 } = await open('?intro=1', true)
  await page.waitForFunction(() => document.getElementById('intro')?.classList.contains('run'), { timeout: 2000 })
  check('reduced motion: no slide animation', (await page.$eval('#intro img', (e) => getComputedStyle(e).animationName)) === 'none')
  await page.waitForFunction(() => !document.getElementById('intro'), { timeout: 3000 })
  check('reduced motion: short static intro', Date.now() - t0 < 1500, `${Date.now() - t0}ms`)
  await context.close()
}
// ۴) تست خودکار بدون پارامتر معرفی را رد می‌کند (تست‌های دیگر کند نشوند)
{
  const { page, context } = await open('')
  await sleep(100)
  check('automation without ?intro skips overlay', !(await page.$('#intro')))
  await context.close()
}
await browser.close()
console.log(results.join('\n'))
if (problems.length) console.log('\nProblems:\n' + [...new Set(problems)].join('\n'))
const fails = results.filter((r) => r.startsWith('FAIL'))
console.log(`\n${results.length - fails.length}/${results.length} passed`)
if (fails.length || problems.length) process.exit(1)

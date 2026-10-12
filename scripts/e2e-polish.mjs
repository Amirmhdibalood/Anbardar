// تست دودی فاز ۱۰ (نسخه، راهنما، بیشتر، بدون خطای کنسول) — تیره و روشن
import puppeteer from 'puppeteer-core'
import { setupDevice } from './lib/device.mjs'

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:4173/'
const OUT = new URL('../screenshots/', import.meta.url).pathname
const problems = []
const results = []
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ' ' + extra}`)

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
})

async function run(theme) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await setupDevice(page)
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && problems.push(`[${theme}] console.${m.type()}: ${m.text()}`))
  page.on('pageerror', (e) => problems.push(`[${theme}] pageerror: ${e.message}`))
  page.on('requestfailed', (r) => problems.push(`[${theme}] requestfailed: ${r.url()}`))
  page.on('response', (r) => r.status() >= 400 && problems.push(`[${theme}] http ${r.status()}: ${r.url()}`))
  await page.evaluateOnNewDocument((t) => {
    if (!localStorage.getItem('anbardar.theme.v1')) localStorage.setItem('anbardar.theme.v1', t)
  }, theme)

  const t = (name) => `[${theme}] ${name}`
  const shot = (name) => page.screenshot({ path: `${OUT}phase10-${name}-${theme}.png` })
  const settle = (ms = 350) => page.evaluate((m) => document.fonts.ready.then(() => new Promise((r) => setTimeout(r, m))), ms)
  const body = () => page.evaluate(() => document.body.innerText)
  const go = async (hash) => {
    await page.goto(BASE + hash, { waitUntil: 'networkidle0' })
    await settle()
  }
  const clickText = async (text) => {
    const [el] = await page.$$(`xpath/.//button[contains(normalize-space(.), "${text}")] | .//a[contains(normalize-space(.), "${text}")]`)
    if (!el) throw new Error('not found: ' + text)
    await el.evaluate((e) => e.scrollIntoView({ block: 'center' }))
    await el.click()
    await settle()
  }

  if (theme === 'light') {
    await go('#/more/settings')
    await clickText('روشن')
    await settle()
  }

  await go('#/')
  check(t('home loads'), (await body()).length > 20)
  await shot('home')

  await go('#/more')
  const more = await body()
  check(t('version 1.0.0'), more.includes('۱.۰.۰') || more.includes('1.0.0') || /نسخه\s*[۰-۹1]/.test(more))
  check(t('more has transfers'), more.includes('انتقال بین انبارها'))
  check(t('more has expenses'), more.includes('هزینه‌ها'))
  await shot('more')

  await go('#/more/help')
  const help = await body()
  check(t('help offline tip'), help.includes('آفلاین') || help.includes('اینترنت'))
  await shot('help')

  await go('#/reports')
  check(t('reports loads'), (await body()).includes('گزارش') || (await body()).includes('سود'))
  await shot('reports')

  await context.close()
}

await run('dark')
await run('light')
await browser.close()

const fails = results.filter((r) => r.startsWith('FAIL'))
console.log(results.join('\n'))
if (problems.length) {
  console.log('\nProblems:')
  console.log([...new Set(problems)].join('\n'))
}
console.log(`\n${results.length - fails.length}/${results.length} passed`)
if (fails.length || problems.length) process.exit(1)

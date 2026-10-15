// تست End-to-End مرحله ۵ (ورود، بازیابی رمز، دوره‌های مالی) در هر دو تم
import puppeteer from 'puppeteer-core'
import { setupDevice } from './lib/device.mjs'
import { pick, pickAdd, pickedText, pickerOptions } from './lib/picker.mjs'

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
  const shot = (name) => page.screenshot({ path: `${OUT}stage5-${name}-${theme}.png` })
  const settle = (ms = 350) => page.evaluate((m) => document.fonts.ready.then(() => new Promise((r) => setTimeout(r, m))), ms)
  const body = () => page.evaluate(() => document.body.innerText)
  const go = async (hash) => {
    await page.goto(BASE + hash, { waitUntil: 'networkidle0' })
    await settle()
  }
  const clickText = async (text, tag = 'button') => {
    const [el] = await page.$$(`xpath/.//${tag}[contains(normalize-space(.), "${text}")] | .//a[contains(normalize-space(.), "${text}")]`)
    if (!el) throw new Error('not found: ' + text)
    await el.evaluate((e) => e.scrollIntoView({ block: 'center' }))
    await el.click()
    await settle()
  }
  const waitText = async (text, ms = 5000) => {
    const end = Date.now() + ms
    while (Date.now() < end) {
      if ((await body()).includes(text)) return true
      await new Promise((r) => setTimeout(r, 100))
    }
    return false
  }
  const fill = async (sel, text) => {
    await page.$eval(sel, (e) => {
      e.focus()
      e.select()
    })
    for (let i = 0; i < 40 && (await page.$eval(sel, (e) => e.value)) !== ''; i++) await page.keyboard.press('Backspace')
    if (text) await page.type(sel, text)
  }
  const selectByText = (sel, text) => (text.startsWith('＋') ? pickAdd(page, sel) : pick(page, sel, text))
  const dialogClick = async (text) => {
    const [el] = await page.$$(`xpath/.//*[@role="dialog"]//button[contains(normalize-space(.), "${text}")]`)
    if (!el) throw new Error('dialog button not found: ' + text)
    await el.evaluate((e) => e.scrollIntoView({ block: 'center' }))
    await el.click()
    await settle()
  }
  const lineSel = (name, prefix) => `[data-line="${name}"] input[id^="${prefix}-"]`
  const addLine = async (name) => {
    await clickText('افزودن کالا')
    await settle(400)
    await dialogClick(name)
    await settle(400)
  }

  if (theme === 'light') {
    await go('#/more/settings')
    await clickText('روشن')
    await settle()
  }
  // دکمه‌های پایین فرم ممکن است زیر نوار ثابت «ثبت» باشند؛ کلیک مستقیم DOM
  const domClick = async (text) => {
    const [el] = await page.$$(`xpath/.//button[contains(normalize-space(.), "${text}")]`)
    if (!el) throw new Error('not found: ' + text)
    await el.evaluate((e) => (e.scrollIntoView({ block: 'center' }), e.click()))
    await settle()
  }
  const sheetText = () => page.evaluate(() => [...document.querySelectorAll('[role="dialog"]')].map((d) => d.innerText).join('\n'))
  const sfx = theme === 'dark' ? '' : ' روشن'


  const badge = () => page.$eval('[data-testid="notification-badge"]', (e) => e.textContent).catch(() => null)
  const back = async () => (await page.evaluate(() => window.dispatchEvent(new Event('anbardar:back'))), settle(450))



  const exists = (sel) => page.$(sel).then((e) => !!e)
  const typeInto = async (sel, v) => {
    await page.$eval(sel, (e) => e.focus())
    await page.type(sel, v)
  }
  const login = async (name, pin) => {
    if (await exists('[data-testid="lock-user"]')) {
      const [u] = await page.$$(`xpath/.//button[@data-testid="lock-user"][contains(., "${name}")]`)
      await u.click()
      await settle(300)
    }
    await fill('#lock-pin', pin)
    await page.click('[data-testid="lock-submit"]')
    await settle(600)
  }
  const toastHas = (text) => waitText(text, 4000)
  const owner = 'امیر' + sfx

  // ---- ۱) ساخت مالک ← برگه سؤال‌های بازیابی
  await go('#/more/users')
  await page.click('[data-testid="users-enable"]')
  await settle(300)
  await typeInto('#user-name', owner)
  await typeInto('#user-pin', '1234')
  await typeInto('#user-pin2', '1234')
  await page.click('[data-testid="user-save"]')
  await settle(700)
  const rs = await sheetText()
  check(t('recovery setup opens right after creating the PIN'), (await exists('[data-testid="recovery-form"]')) && rs.includes('اگر روزی رمز را فراموش کنید'), rs)
  await shot('recovery-setup')
  await page.click('[data-testid="recovery-skip"]')
  await settle(300)
  check(t('skip shows a clear warning'), (await sheetText()).includes('قابل بازیابی نیست'))
  await shot('recovery-skip-warning')
  await page.click('[data-testid="recovery-back"]')
  await settle(300)
  await page.click('[data-testid="recovery-save"]')
  await settle(300)
  check(t('empty questions rejected'), (await sheetText()).includes('سؤال اول را بنویسید'))
  await typeInto('#rec-q1', 'نام اولین معلم؟')
  await typeInto('#rec-a1', 'خانم رضايي')
  await typeInto('#rec-q2', 'شهر تولد؟')
  await typeInto('#rec-a2', 'كرج ۱')
  await page.click('[data-testid="recovery-save"]')
  check(t('recovery questions saved'), await toastHas('سؤال‌های بازیابی ذخیره شد'))
  await settle(300)
  check(t('sheet closed after save'), !(await exists('[role="dialog"]')))
  // فروشنده (رد کردن سؤال‌ها)
  await page.click('[data-testid="user-add"]')
  await settle(300)
  await typeInto('#user-name', 'سارا' + sfx)
  await typeInto('#user-pin', '5678')
  await typeInto('#user-pin2', '5678')
  await page.click('[data-testid="user-save"]')
  await settle(700)
  await page.click('[data-testid="recovery-skip"]')
  await settle(250)
  await page.click('[data-testid="recovery-skip-confirm"]')
  check(t('skip leaves a reminder'), await toastHas('بعداً از «بیشتر» تنظیم کنید'))

  // ---- ۲) قفل ← آخرین کاربر از قبل انتخاب شده
  await go('#/more')
  await page.click('[data-testid="lock-now"]')
  await settle(500)
  check(t('lock screen remembers the last user'), (await exists('#lock-pin')) && (await body()).includes(`ورود ${owner}`))
  const ls = await page.evaluate(() => JSON.stringify(localStorage))
  check(t('PIN never stored in localStorage'), !ls.includes('1234') && !ls.includes('4321'))
  await shot('lock-remembered')

  // ---- ۳) رمز را فراموش کردم
  await page.click('[data-testid="lock-forgot"]')
  await settle(400)
  check(t('forgot shows my questions'), (await body()).includes('نام اولین معلم؟') && (await body()).includes('شهر تولد؟'))
  await typeInto('#forgot-a1', 'غلط')
  await typeInto('#forgot-a2', 'غلط')
  await typeInto('#forgot-pin', '4321')
  await typeInto('#forgot-pin2', '4321')
  await page.click('[data-testid="forgot-submit"]')
  await settle(600)
  check(t('wrong answers rejected'), (await page.$eval('[data-testid="forgot-error"]', (e) => e.innerText).catch(() => '')).includes('پاسخ‌ها درست نیست'))
  await shot('forgot-wrong')
  await fill('#forgot-a1', '  خانم   رضایی ')
  await fill('#forgot-a2', 'کرج 1')
  await shot('forgot-pin')
  await page.click('[data-testid="forgot-submit"]')
  await settle(800)
  check(t('normalized answers accepted → signed in'), !(await exists('[data-testid="lock-screen"]')))
  // فروشنده بدون سؤال
  await go('#/more')
  await page.click('[data-testid="lock-now"]')
  await settle(400)
  await clickText('کاربر دیگر')
  const [sara] = await page.$$(`xpath/.//button[@data-testid="lock-user"][contains(., "سارا")]`)
  await sara.click()
  await settle(300)
  await page.click('[data-testid="lock-forgot"]')
  await settle(400)
  check(t('no questions → clear guidance'), (await page.$eval('[data-testid="forgot-none"]', (e) => e.innerText).catch(() => '')).includes('سؤال بازیابی ثبت نشده'))
  await page.click('[data-testid="forgot-back"]')
  await settle(300)
  await clickText('کاربر دیگر')
  await login(owner, '4321')
  check(t('new PIN works'), !(await exists('[data-testid="lock-screen"]')))

  // ---- ۴) ویرایش سؤال‌ها با رمز فعلی (از «بیشتر»)
  await go('#/more')
  await page.click('[data-testid="my-recovery"]')
  await settle(500)
  check(t('edit prefills my questions'), (await page.$eval('#rec-q1', (e) => e.value)) === 'نام اولین معلم؟')
  check(t('edit asks for the current PIN'), await exists('#rec-pin'))
  await back()
  check(t('back closes the recovery sheet'), !(await exists('[role="dialog"]')))

  // ---- ۵) خاموش کردن ورود
  await go('#/more/settings')
  await settle(300)
  check(t('login setting visible to the owner'), await exists('[data-testid="login-setting"] [role="switch"][aria-checked="true"]'))
  await page.$eval('[data-testid="login-setting"]', (e) => e.scrollIntoView({ block: 'center' }))
  await settle(200)
  await shot('login-setting')
  await page.click('[data-testid="login-setting"] [role="switch"]')
  await settle(400)
  await typeInto('#login-off-pin', '1234')
  await page.click('[data-testid="login-off-confirm"]')
  await settle(600)
  check(t('turning off needs the owner PIN'), (await sheetText()).includes('رمز اشتباه'))
  await fill('#login-off-pin', '4321')
  await shot('login-off-sheet')
  await page.click('[data-testid="login-off-confirm"]')
  check(t('login turned off'), await toastHas('ورود خاموش شد'))
  await settle(900) // ذخیره دیتابیس وب با تأخیر ۲۰۰ms
  await page.reload({ waitUntil: 'networkidle0' })
  await settle(600)
  check(t('opens straight in, no lock screen'), !(await exists('[data-testid="lock-screen"]')))
  await go('#/more')
  check(t('acts as the owner, no lock button'), (await page.$eval('[data-testid="current-user"]', (e) => e.innerText).catch(() => '')).includes(owner) && !(await exists('[data-testid="lock-now"]')))
  await go('#/more/settings')
  await page.$eval('[data-testid="login-setting"]', (e) => e.scrollIntoView({ block: 'center' }))
  await settle(200)
  await shot('login-off')
  await page.click('[data-testid="login-setting"] [role="switch"]')
  check(t('login turned back on'), await toastHas('ورود روشن شد'))
  await settle(900) // ذخیره دیتابیس وب با تأخیر ۲۰۰ms
  await page.reload({ waitUntil: 'networkidle0' })
  await settle(600)
  check(t('lock screen back after turning on'), await exists('[data-testid="lock-screen"]'))
  await login(owner, '4321')

  // ---- ۶) دوره‌های مالی
  await go('#/more')
  check(t('fiscal entry in More for the owner'), (await body()).includes('دوره‌های مالی'))
  await go('#/more/fiscal')
  check(t('fiscal empty state'), (await body()).includes('هنوز دوره مالی تعریف نشده'))
  await page.click('[data-testid="fiscal-add"]')
  await settle(300)
  check(t('default = current Jalali year'), (await page.$eval('#fiscal-name', (e) => e.value)) === 'سال مالی ۱۴۰۵')
  await back()
  check(t('back closes new-period sheet'), !(await exists('[role="dialog"]')))
  await page.click('[data-testid="fiscal-add"]')
  await settle(300)
  await pick(page, '#fiscal-year', 'سال ۱۴۰۴')
  await settle(300)
  const st = await sheetText()
  check(t('year picker fills 1 Farvardin – 29 Esfand'), (await page.$eval('#fiscal-name', (e) => e.value)) === 'سال مالی ۱۴۰۴' && st.includes('۱ فروردین ۱۴۰۴') && st.includes('۲۹ اسفند ۱۴۰۴'), st)
  await shot('fiscal-new')
  await page.click('[data-testid="fiscal-save"]')
  check(t('period defined'), await toastHas('دوره مالی تعریف شد'))
  await settle(300)
  await page.click('[data-testid="fiscal-add"]')
  await settle(300)
  await pick(page, '#fiscal-year', 'سال ۱۴۰۴')
  await settle(200)
  await page.click('[data-testid="fiscal-save"]')
  await settle(500)
  check(t('overlap rejected'), (await sheetText()).includes('هم‌پوشانی'))
  await back()
  await page.click('[data-testid="fiscal-add"]')
  await settle(300)
  await page.click('[data-testid="fiscal-save"]')
  await toastHas('دوره مالی تعریف شد')
  await settle(400)
  check(t('two periods listed'), (await page.$$('[data-testid="fiscal-row"]')).length === 2)
  await shot('fiscal-list')
  await page.click('[data-testid="fiscal-close"]')
  await settle(300)
  check(t('close explains the lock and carry-forward'), (await sheetText()).includes('منتقل می‌شود'))
  await shot('fiscal-close-confirm')
  await dialogClick('بستن و انتقال مانده‌ها')
  check(t('period closed'), await toastHas('بسته شد و مانده‌ها منتقل شد'))
  await settle(300)
  await page.click('[data-testid="fiscal-balances"]')
  await settle(400)
  check(t('carry-forward balances shown'), (await body()).includes('صندوق (نقد)') && (await body()).includes('ارزش موجودی'))
  await shot('fiscal-closed')
  await page.click('[data-testid="fiscal-reopen"]')
  await settle(300)
  check(t('reopen asks for confirmation'), (await sheetText()).includes('قفل اسناد این دوره برداشته می‌شود'))
  await shot('fiscal-reopen-confirm')
  await dialogClick('بله، باز کن')
  check(t('reopened'), await toastHas('دوباره باز شد'))
  await settle(300)
  await page.click('[data-testid="fiscal-close"]')
  await settle(300)
  await dialogClick('بستن و انتقال مانده‌ها')
  await toastHas('بسته شد')

  // ---- ۷) گزارش‌ها: دوره مالی به‌عنوان بازه
  await go('#/reports')
  await settle(500)
  const pres = await page.$eval('[data-testid="fiscal-presets"]', (e) => e.innerText).catch(() => '')
  check(t('reports show fiscal period chips'), pres.includes('سال مالی ۱۴۰۴ (بسته)') && pres.includes('سال مالی ۱۴۰۵'), pres)
  await clickText('سال مالی ۱۴۰۴')
  await settle(500)
  check(t('fiscal chip applies its range'), (await body()).includes('۱ فروردین ۱۴۰۴ تا ۲۹ اسفند ۱۴۰۴'))
  await shot('reports-fiscal')

  // ---- ۸) گزارش فعالیت
  await go('#/more/audit')
  await settle(500)
  const log = await page.$eval('[data-testid="audit-list"]', (e) => e.innerText).catch(() => '')
  check(t('audit: recovery fail + success'), log.includes('پاسخ اشتباه بازیابی') && log.includes('با سؤال‌های بازیابی عوض شد'), log.slice(0, 400))
  check(t('audit: login off/on'), log.includes('صفحه ورود خاموش شد') && log.includes('صفحه ورود روشن شد'))
  check(t('audit: fiscal close/reopen'), log.includes('بسته شد؛') && log.includes('دوباره باز شد'))
  await shot('audit')

  await context.close()
}

await run('dark').catch((e) => (console.log(results.join('\n')), Promise.reject(e)))
await run('light').catch((e) => (console.log(results.join('\n')), Promise.reject(e)))
await browser.close()

const fails = results.filter((r) => r.startsWith('FAIL'))
console.log(results.join('\n'))
if (problems.length) {
  console.log('\nProblems:')
  console.log([...new Set(problems)].join('\n'))
}
console.log(`\n${results.length - fails.length}/${results.length} passed`)
if (fails.length || problems.length) process.exit(1)

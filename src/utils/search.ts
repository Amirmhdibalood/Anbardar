/**
 * جستجوی «حین تایپ» یکسان در همه انتخاب‌گرها:
 * ي/ی و ك/ک، ارقام فارسی/عربی/لاتین، نیم‌فاصله و فاصله‌ها، و بزرگی/کوچکی حروف لاتین اثری ندارند.
 * متن به چند «تکه» شکسته می‌شود و همه تکه‌ها باید جایی در نام/کد/گروه باشند (زیررشته).
 */
const CHAR_MAP: Record<string, string> = { 'ي': 'ی', 'ى': 'ی', 'ك': 'ک', 'ة': 'ه', 'ۀ': 'ه' }

/** یکسان‌سازی یک متن برای مقایسه (فاصله و نیم‌فاصله حذف می‌شوند) */
export function normalizeSearch(text: string): string {
  return text
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[يىكةۀ]/g, (c) => CHAR_MAP[c] ?? c)
    .toLowerCase()
    // eslint-disable-next-line no-misleading-character-class -- نویسه‌های اتصال (ZWNJ/ZWJ) عمداً تکی حذف می‌شوند
    .replace(/[\s\u200C\u200D\u200E\u200F]+/g, '')
}

/** تکه‌های جستجو (بر اساس فاصله)، هر کدام یکسان‌شده؛ تکه خالی حذف می‌شود */
export function searchTokens(query: string | null | undefined): string[] {
  if (!query) return []
  return query
    .replace(/[\u200C\u200D]/g, '')
    .split(/\s+/)
    .map(normalizeSearch)
    .filter(Boolean)
    .slice(0, 6)
}

/** آیا همه تکه‌ها در متن هستند؟ (برای فهرست‌های کوچک داخل حافظه) */
export function matchesTokens(haystack: string, tokens: readonly string[]): boolean {
  if (!tokens.length) return true
  const h = normalizeSearch(haystack)
  return tokens.every((t) => h.includes(t))
}

/** همان یکسان‌سازی به‌صورت عبارت SQL (SQLite) روی یک ستون/عبارت */
export function sqlNormalized(expr: string): string {
  const pairs: [string, string][] = [
    ['ي', 'ی'], ['ى', 'ی'], ['ك', 'ک'], ['ة', 'ه'], ['ۀ', 'ه'],
    [' ', ''], ['char(8204)', ''], ['char(8205)', ''],
  ]
  for (let i = 0; i < 10; i++) {
    pairs.push([String.fromCharCode(0x06f0 + i), String(i)])
    pairs.push([String.fromCharCode(0x0660 + i), String(i)])
  }
  let out = `lower(${expr})`
  for (const [a, b] of pairs) {
    const from = a.startsWith('char(') ? a : `'${a}'`
    out = `replace(${out}, ${from}, '${b}')`
  }
  return out
}

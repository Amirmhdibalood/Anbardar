/**
 * یکسان‌سازی پاسخ سؤال بازیابی پیش از هش: فاصله‌های اضافه، نیم‌فاصله، حروف عربی/فارسی،
 * اعراب، ارقام فارسی/عربی و بزرگی/کوچکی حروف لاتین اثری ندارند.
 */
const MAP: Record<string, string> = { 'ي': 'ی', 'ى': 'ی', 'ئ': 'ی', 'ك': 'ک', 'ة': 'ه', 'ۀ': 'ه', 'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ٱ': 'ا', 'ؤ': 'و' }

export function normalizeAnswer(text: string): string {
  return text
    .normalize('NFC')
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '') // اعراب و کشیده
    // eslint-disable-next-line no-misleading-character-class -- نویسه‌های اتصال (ZWNJ/ZWJ) عمداً تکی جایگزین می‌شوند
    .replace(/[\u200C\u200D\u200E\u200F]/g, ' ') // نیم‌فاصله و نشانه‌های جهت
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[يىئكةۀأإآٱؤ]/g, (c) => MAP[c] ?? c)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

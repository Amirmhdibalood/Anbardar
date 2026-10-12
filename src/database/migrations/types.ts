export interface Migration {
  /** شماره نسخه Schema؛ باید از ۱ شروع شود و بدون جا افتادگی باشد */
  version: number
  name: string
  /** هر عنصر دقیقاً یک دستور SQL است (برای سازگاری با افزونه اندروید، Triggerها تکه‌تکه نمی‌شوند) */
  statements: readonly string[]
}

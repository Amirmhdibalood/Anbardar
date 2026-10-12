import { useState } from 'react'
import { ConfirmSheet } from '../components/ConfirmSheet'

/**
 * تأیید خروج از فرمی که چیزی در آن وارد شده؛ هم دکمه بازگشت سربرگ و هم دکمه بازگشت سخت‌افزاری
 * (که همان دکمه سربرگ را می‌زند) از آن رد می‌شوند.
 */
export function useLeaveConfirm(dirty: boolean, leave: () => void, message = 'اطلاعاتی که وارد کرده‌اید ذخیره نمی‌شود.') {
  const [asking, setAsking] = useState(false)
  const back = () => (dirty ? setAsking(true) : leave())
  const confirm = (
    <ConfirmSheet
      open={asking}
      title="خروج بدون ثبت؟"
      message={message}
      confirmLabel="بله، خارج شو"
      onConfirm={async () => {
        setAsking(false)
        leave()
      }}
      onCancel={() => setAsking(false)}
    />
  )
  return { back, confirm }
}

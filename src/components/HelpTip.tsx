import { useState } from 'react'
import { Icon } from './Icon'
import { Sheet } from './Sheet'
import styles from './HelpTip.module.css'

interface Props {
  title: string
  text: string
}

/** دکمه کوچک «؟» که توضیح کوتاه را در برگه پایینی نشان می‌دهد */
export function HelpTip({ title, text }: Props) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className={styles.tip} aria-label={`راهنما: ${title}`} onClick={() => setOpen(true)} data-testid="help-tip">
        ؟
      </button>
      <Sheet open={open} title={title} onClose={() => setOpen(false)}>
        <div className={styles.body}>
          <Icon name="info" size={18} />
          <p>{text}</p>
        </div>
      </Sheet>
    </>
  )
}

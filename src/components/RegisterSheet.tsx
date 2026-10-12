import { Link } from 'react-router-dom'
import { Icon } from './Icon'
import { Sheet } from './Sheet'
import styles from './RegisterSheet.module.css'

interface Props {
  open: boolean
  onClose: () => void
}

export function RegisterSheet({ open, onClose }: Props) {
  return (
    <Sheet open={open} title="ثبت جدید" onClose={onClose}>
      <div className={styles.options}>
        <Link to="/sales/new" className={`${styles.option} ${styles.primary}`} onClick={onClose}>
          <Icon name="cart" size={26} />
          <strong>ثبت فروش</strong>
          <span>کاهش موجودی انبار</span>
        </Link>
        <Link to="/purchases/new" className={styles.option} onClick={onClose}>
          <Icon name="truck" size={26} />
          <strong>ثبت خرید</strong>
          <span>افزایش موجودی انبار</span>
        </Link>
        <Link to="/more/expenses" className={styles.option} onClick={onClose}>
          <Icon name="wallet" size={26} />
          <strong>ثبت هزینه</strong>
          <span>اجاره، حقوق، قبض و …</span>
        </Link>
        <Link to="/transfers/new" className={styles.option} onClick={onClose}>
          <Icon name="grid" size={26} />
          <strong>انتقال انبار</strong>
          <span>جابه‌جایی بین انبارها</span>
        </Link>
      </div>
    </Sheet>
  )
}

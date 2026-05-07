import { X } from "lucide-react";
import styles from "./Modal.module.css";

export default function Modal({ open, title, children, footer, onClose }) {
  if (!open) return null;
  return (
    <div className={styles.overlay} role="presentation" onMouseDown={onClose}>
      <section
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className={styles.header}>
          <h2>{title}</h2>
          <button type="button" onClick={onClose} aria-label="Cerrar modal">
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <div className={styles.body}>{children}</div>
        {footer ? <footer className={styles.footer}>{footer}</footer> : null}
      </section>
    </div>
  );
}

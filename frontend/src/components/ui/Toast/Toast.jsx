import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import styles from "./Toast.module.css";

const icons = {
  success: CheckCircle2,
  error: AlertCircle,
  warning: AlertCircle,
  info: Info,
};

export default function Toast({ toasts, onDismiss }) {
  if (!toasts.length) return null;
  return (
    <div className={styles.wrap} aria-live="polite" aria-atomic="true">
      {toasts.map((toast) => {
        const Icon = icons[toast.type] || Info;
        return (
          <div key={toast.id} className={[styles.toast, styles[toast.type]].filter(Boolean).join(" ")}>
            <Icon size={17} aria-hidden="true" />
            <span>{toast.message}</span>
            <button type="button" onClick={() => onDismiss(toast.id)} aria-label="Cerrar notificacion">
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

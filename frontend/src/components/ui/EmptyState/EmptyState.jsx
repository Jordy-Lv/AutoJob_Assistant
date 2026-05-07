import { Sparkles } from "lucide-react";
import styles from "./EmptyState.module.css";

export default function EmptyState({ icon: Icon = Sparkles, title, text, action }) {
  return (
    <div className={styles.empty}>
      <div className={styles.icon}>
        <Icon size={24} aria-hidden="true" />
      </div>
      <h2>{title}</h2>
      {text ? <p>{text}</p> : null}
      {action ? <div className={styles.action}>{action}</div> : null}
    </div>
  );
}

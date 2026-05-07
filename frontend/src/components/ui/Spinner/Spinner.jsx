import styles from "./Spinner.module.css";

export default function Spinner({ label = "Cargando...", size = "md", full = false }) {
  const spinner = <span className={[styles.spinner, styles[size]].filter(Boolean).join(" ")} aria-hidden="true" />;
  if (!full) {
    return (
      <span className={styles.inline}>
        {spinner}
        <span>{label}</span>
      </span>
    );
  }
  return (
    <div className={styles.full} role="status">
      {spinner}
      <span>{label}</span>
    </div>
  );
}

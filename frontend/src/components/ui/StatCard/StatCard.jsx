import styles from "./StatCard.module.css";

export default function StatCard({ icon: Icon, label, value, detail, tone = "primary" }) {
  return (
    <article className={styles.card}>
      {Icon ? (
        <span className={[styles.icon, styles[tone]].filter(Boolean).join(" ")}>
          <Icon size={18} aria-hidden="true" />
        </span>
      ) : null}
      <div className={styles.value}>{value}</div>
      <div className={styles.label}>{label}</div>
      {detail ? <div className={styles.detail}>{detail}</div> : null}
    </article>
  );
}

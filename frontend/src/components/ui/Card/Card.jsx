import styles from "./Card.module.css";

export default function Card({ children, title, meta, icon: Icon, actions, className = "", hover = true }) {
  const classes = [styles.card, hover ? styles.hover : "", className].filter(Boolean).join(" ");
  return (
    <section className={classes}>
      {(title || meta || Icon || actions) && (
        <header className={styles.header}>
          {Icon ? (
            <span className={styles.icon}>
              <Icon size={16} aria-hidden="true" />
            </span>
          ) : null}
          <div className={styles.heading}>
            {title ? <h2>{title}</h2> : null}
            {meta ? <p>{meta}</p> : null}
          </div>
          {actions ? <div className={styles.actions}>{actions}</div> : null}
        </header>
      )}
      <div className={styles.body}>{children}</div>
    </section>
  );
}

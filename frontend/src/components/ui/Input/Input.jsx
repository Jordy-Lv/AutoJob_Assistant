import styles from "./Input.module.css";

export default function Input({
  label,
  hint,
  error,
  textarea = false,
  select = false,
  options = [],
  className = "",
  ...props
}) {
  const Control = textarea ? "textarea" : select ? "select" : "input";
  return (
    <label className={[styles.field, className].filter(Boolean).join(" ")}>
      {label ? <span className={styles.label}>{label}</span> : null}
      {select ? (
        <Control className={styles.control} {...props}>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Control>
      ) : (
        <Control className={styles.control} {...props} />
      )}
      {error ? <span className={styles.error}>{error}</span> : hint ? <span className={styles.hint}>{hint}</span> : null}
    </label>
  );
}

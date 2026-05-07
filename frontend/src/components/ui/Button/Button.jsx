import styles from "./Button.module.css";

export default function Button({
  children,
  variant = "primary",
  size = "md",
  icon: Icon,
  iconPosition = "left",
  className = "",
  type = "button",
  ...props
}) {
  const classes = [styles.button, styles[variant], styles[size], className].filter(Boolean).join(" ");
  return (
    <button className={classes} type={type} {...props}>
      {Icon && iconPosition === "left" ? <Icon size={16} aria-hidden="true" /> : null}
      {children}
      {Icon && iconPosition === "right" ? <Icon size={16} aria-hidden="true" /> : null}
    </button>
  );
}

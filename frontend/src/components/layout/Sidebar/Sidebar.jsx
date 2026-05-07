import { NavLink } from "react-router-dom";
import { Database, Moon, RefreshCw, Sun } from "lucide-react";
import { NAV_ITEMS } from "@/constants";
import { useTheme } from "@/hooks/useTheme";
import styles from "./Sidebar.module.css";

const groups = [
  { key: "primary", label: "PRINCIPAL" },
  { key: "secondary", label: "HERRAMIENTAS" },
  { key: "technical", label: "SISTEMA" },
];

export default function Sidebar({ counters, health, open, onClose, onRefresh, onCheckHealth, refreshing }) {
  const { theme, toggleTheme } = useTheme();
  const healthOk = Boolean(health?.ok ?? health?.status === "ok");

  return (
    <>
      {open ? <button className={styles.overlay} type="button" aria-label="Cerrar menu" onClick={onClose} /> : null}
      <aside className={[styles.sidebar, open ? styles.open : ""].filter(Boolean).join(" ")}>
        <div className={styles.brand}>
          <div className={styles.logo}>AJ</div>
          <div className={styles.brandText}>
            <strong>AutoJob</strong>
            <span>Assistant</span>
          </div>
        </div>

        <nav className={styles.nav} aria-label="Navegacion principal">
          {groups.map((group) => (
            <div className={styles.group} key={group.key}>
              <div className={styles.groupLabel}>{group.label}</div>
              {NAV_ITEMS.filter((item) => item.group === group.key).map((item) => {
                const Icon = item.icon;
                const count = item.counterKey ? counters[item.counterKey] : null;
                return (
                  <NavLink key={item.key} onClick={onClose} title={item.label} to={item.path}>
                    {({ isActive }) => (
                      <span className={[styles.item, isActive ? styles.active : ""].filter(Boolean).join(" ")}>
                        <Icon size={18} aria-hidden="true" />
                        <span className={styles.itemText}>{item.label}</span>
                        {Number(count) > 0 ? <span className={styles.counter}>{count}</span> : null}
                      </span>
                    )}
                  </NavLink>
                );
              })}
            </div>
          ))}
        </nav>

        <footer className={styles.footer}>
          <button className={styles.health} onClick={onCheckHealth} type="button" title="Revisar DB">
            <span className={[styles.dot, healthOk ? styles.ok : styles.bad].join(" ")} />
            <Database size={15} aria-hidden="true" />
            <span>Revisar DB</span>
          </button>
          <button className={styles.iconButton} onClick={toggleTheme} type="button" title="Cambiar tema">
            {theme === "dark" ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
          </button>
          <button className={styles.iconButton} disabled={refreshing} onClick={onRefresh} type="button" title="Actualizar datos">
            <RefreshCw size={16} aria-hidden="true" />
          </button>
        </footer>
      </aside>
    </>
  );
}

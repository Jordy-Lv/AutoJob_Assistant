import { Menu, RefreshCw } from "lucide-react";
import { useLocation } from "react-router-dom";
import { NAV_ITEMS } from "@/constants";
import styles from "./TopBar.module.css";

export default function TopBar({ onMenu, onRefresh, refreshing }) {
  const location = useLocation();
  const item = NAV_ITEMS.find((nav) => nav.path === location.pathname) || NAV_ITEMS[0];

  return (
    <header className={styles.topbar}>
      <button className={styles.menu} type="button" onClick={onMenu} aria-label="Abrir navegacion">
        <Menu size={20} aria-hidden="true" />
      </button>
      <div className={styles.title}>
        <span>{item.label}</span>
        <small>{item.hint}</small>
      </div>
      <button className={styles.refresh} disabled={refreshing} onClick={onRefresh} type="button" title="Actualizar contadores">
        <RefreshCw size={16} aria-hidden="true" />
        <span>Actualizar</span>
      </button>
    </header>
  );
}

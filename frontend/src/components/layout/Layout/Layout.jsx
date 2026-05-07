import { useContext, useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import { Database } from "lucide-react";
import { AppContext } from "@/context/AppContext";
import { useToast } from "@/hooks/useToast";
import { getLastApiError, subscribeToApiErrors } from "@/api/client";
import Modal from "@/components/ui/Modal/Modal";
import Sidebar from "@/components/layout/Sidebar/Sidebar";
import TopBar from "@/components/layout/TopBar/TopBar";
import styles from "./Layout.module.css";

export default function Layout() {
  const { counters, health, refreshing, refreshCounters, checkHealth } = useContext(AppContext);
  const { success, error } = useToast();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [lastError, setLastError] = useState(getLastApiError());
  const [errorModalOpen, setErrorModalOpen] = useState(false);

  useEffect(() => subscribeToApiErrors(setLastError), []);

  async function handleHealthCheck() {
    try {
      const status = await checkHealth();
      const ok = status.database?.ok ?? false;
      success(ok ? "Base de datos conectada." : "La base de datos respondio con error.");
    } catch (err) {
      error(err.message || "No se pudo revisar la base de datos.");
    }
  }

  async function handleRefresh() {
    try {
      await refreshCounters();
      success("Datos actualizados.");
    } catch (err) {
      error(err.message || "No se pudieron actualizar los datos.");
    }
  }

  return (
    <div className={styles.shell}>
      <Sidebar
        counters={counters}
        health={health}
        onCheckHealth={handleHealthCheck}
        onClose={() => setDrawerOpen(false)}
        onRefresh={handleRefresh}
        open={drawerOpen}
        refreshing={refreshing}
      />
      <div className={styles.main}>
        <TopBar onMenu={() => setDrawerOpen(true)} onRefresh={handleRefresh} refreshing={refreshing} />
        <main className={styles.content}>
          <Outlet />
        </main>
      </div>

      <button className={styles.dbCheck} type="button" onClick={handleHealthCheck}>
        <Database size={15} aria-hidden="true" />
        Revisar DB
      </button>

      {lastError ? (
        <button className={styles.errorBadge} type="button" onClick={() => setErrorModalOpen(true)}>
          HTTP {lastError.status || 0}
        </button>
      ) : null}

      <Modal open={errorModalOpen} onClose={() => setErrorModalOpen(false)} title="Ultimo error HTTP">
        {lastError ? (
          <dl className={styles.errorDetails}>
            <dt>Endpoint</dt>
            <dd><code>{lastError.endpoint}</code></dd>
            <dt>Status</dt>
            <dd>HTTP {lastError.status || 0}</dd>
            <dt>Mensaje</dt>
            <dd>{lastError.message}</dd>
            <dt>Timestamp</dt>
            <dd>{lastError.timestamp}</dd>
          </dl>
        ) : null}
      </Modal>
    </div>
  );
}

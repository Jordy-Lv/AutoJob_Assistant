import { useCallback } from "react";
import { Bell, Brain, Database, Globe2, RefreshCw } from "lucide-react";
import { endpoints } from "@/api/endpoints";
import { request } from "@/api/client";
import { useFetch } from "@/hooks/useFetch";
import Badge from "@/components/ui/Badge/Badge";
import Button from "@/components/ui/Button/Button";
import Card from "@/components/ui/Card/Card";
import EmptyState from "@/components/ui/EmptyState/EmptyState";
import Spinner from "@/components/ui/Spinner/Spinner";
import { normalizeListPayload } from "@/utils/formatters";
import styles from "./Configuracion.module.css";

export default function Configuracion() {
  const fetchSettings = useCallback(async () => {
    const [health, sourcesPayload, overview] = await Promise.all([
      request(endpoints.health()),
      request(endpoints.sources.list()),
      request(endpoints.overview()),
    ]);
    return {
      health,
      sources: normalizeListPayload(sourcesPayload, "sources"),
      overview,
    };
  }, []);

  const { data, loading, error, refetch } = useFetch(fetchSettings);

  if (loading) return <Spinner full label="Cargando configuracion..." />;
  if (error) return <PageError message={error.message} onRetry={refetch} />;
  if (!data) return <EmptyState title="Sin estado de sistema" text="El backend no devolvio configuracion." />;

  const dbOk = Boolean(data.health.database?.ok ?? data.overview.health?.ok);
  const activeSources = data.sources.filter((source) => source.enabled && source.configured);
  const missingSources = data.sources.filter((source) => source.requires_api_key && !source.configured);
  const aiConfigured = Boolean(data.health.ai?.openai_configured);

  const cards = [
    {
      title: "Base de datos",
      icon: Database,
      badge: dbOk ? "Conectada" : "Con error",
      tone: dbOk ? "success" : "danger",
      detail: data.health.database?.database_url || data.overview.health?.database_url || "DATABASE_URL no disponible",
      extra: data.health.database?.error || data.overview.health?.error,
    },
    {
      title: "Analisis",
      icon: Brain,
      badge: aiConfigured ? "IA opcional" : "Local activo",
      tone: aiConfigured ? "success" : "info",
      detail: data.health.ai?.mode || "Heuristica local disponible",
      extra: aiConfigured ? "OPENAI_API_KEY configurada." : "Sin clave externa; el analisis local sigue disponible.",
    },
    {
      title: "Alertas Telegram",
      icon: Bell,
      badge: "Configurable",
      tone: "warning",
      detail: "TELEGRAM_BOT_TOKEN y TELEGRAM_CHAT_ID",
      extra: "No hay endpoint de envio en este backend; se muestra estado de configuracion esperada.",
    },
    {
      title: "Fuentes de empleo",
      icon: Globe2,
      badge: `${activeSources.length} activas`,
      tone: activeSources.length ? "success" : "warning",
      detail: `${data.sources.length} fuentes registradas`,
      extra: missingSources.length ? `${missingSources.length} fuentes requieren clave.` : "Fuentes listas para busqueda.",
    },
  ];

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>Configuracion</span>
          <h1>Estado del sistema</h1>
          <p>Base de datos, analisis, alertas y proveedores en una vista tecnica.</p>
        </div>
        <Button icon={RefreshCw} onClick={refetch} variant="secondary">Revisar sistema</Button>
      </header>

      <div className={styles.grid}>
        {cards.map((item) => {
          const Icon = item.icon;
          return (
            <Card key={item.title} title={item.title} icon={Icon} actions={<Badge tone={item.tone}>{item.badge}</Badge>}>
              <div className={styles.systemCard}>
                <code>{item.detail}</code>
                <p>{item.extra}</p>
              </div>
            </Card>
          );
        })}
      </div>

      <Card title="Resumen operativo" icon={Database} meta="Datos actuales del backend">
        <div className={styles.summary}>
          <div><span>Ofertas</span><strong>{data.overview.total_jobs || 0}</strong></div>
          <div><span>Pendientes</span><strong>{data.overview.unanalyzed_count || 0}</strong></div>
          <div><span>Documentos</span><strong>{data.overview.documents_count || 0}</strong></div>
          <div><span>Promedio score</span><strong>{data.overview.avg_score || 0}%</strong></div>
        </div>
      </Card>
    </section>
  );
}

function PageError({ message, onRetry }) {
  return (
    <div className={styles.error}>
      <strong>No se pudo cargar Configuracion</strong>
      <p>{message}</p>
      <Button onClick={onRetry} variant="secondary">Reintentar</Button>
    </div>
  );
}

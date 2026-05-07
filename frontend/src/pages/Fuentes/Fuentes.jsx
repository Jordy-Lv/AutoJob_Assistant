import { useCallback } from "react";
import { CheckCircle2, Globe2, KeyRound, RadioTower, RefreshCw } from "lucide-react";
import { endpoints } from "@/api/endpoints";
import { request } from "@/api/client";
import { useFetch } from "@/hooks/useFetch";
import Badge from "@/components/ui/Badge/Badge";
import Button from "@/components/ui/Button/Button";
import Card from "@/components/ui/Card/Card";
import EmptyState from "@/components/ui/EmptyState/EmptyState";
import Spinner from "@/components/ui/Spinner/Spinner";
import StatCard from "@/components/ui/StatCard/StatCard";
import { normalizeListPayload } from "@/utils/formatters";
import styles from "./Fuentes.module.css";

export default function Fuentes() {
  const fetchSources = useCallback(async () => {
    const [sourcesPayload, healthPayload] = await Promise.all([
      request(endpoints.sources.list()),
      request(endpoints.sources.health()),
    ]);
    return {
      sources: normalizeListPayload(sourcesPayload, "sources"),
      health: healthPayload.sources || [],
    };
  }, []);

  const { data, loading, error, refetch } = useFetch(fetchSources);

  if (loading) return <Spinner full label="Cargando fuentes..." />;
  if (error) return <PageError message={error.message} onRetry={refetch} />;
  if (!data?.sources?.length) return <EmptyState title="Sin fuentes registradas" text="El backend no devolvio proveedores de busqueda." />;

  const healthById = new Map(data.health.map((source) => [source.id, source]));
  const active = data.sources.filter((source) => source.enabled && source.configured);
  const missingKey = data.sources.filter((source) => source.requires_api_key && !source.configured);
  const okHealth = data.health.filter((source) => ["available", "ok"].includes(source.status)).length;

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>Fuentes</span>
          <h1>Estado por proveedor de empleo</h1>
          <p>Revisa claves, disponibilidad y fuentes activas antes de ejecutar busquedas grandes.</p>
        </div>
        <Button icon={RefreshCw} onClick={refetch} variant="secondary">Actualizar health</Button>
      </header>

      <div className={styles.stats}>
        <StatCard icon={RadioTower} label="Activas" value={active.length} detail="Habilitadas y configuradas" tone="success" />
        <StatCard icon={KeyRound} label="Sin clave" value={missingKey.length} detail="Requieren variables de entorno" tone="warning" />
        <StatCard icon={Globe2} label="Total" value={data.sources.length} detail="Proveedores registrados" />
        <StatCard icon={CheckCircle2} label="Health OK" value={okHealth} detail="Respondieron correctamente" tone="info" />
      </div>

      <Card title="Estado por fuente" icon={Globe2} meta={`${data.sources.length} fuentes`}>
        <div className={styles.table}>
          <div className={styles.head}>
            <span>Fuente</span>
            <span>Configuracion</span>
            <span>Health</span>
            <span>Detalle</span>
          </div>
          {data.sources.map((source) => {
            const health = healthById.get(source.id) || {};
            const configured = source.enabled && source.configured;
            const tone = configured ? "success" : source.requires_api_key ? "warning" : "neutral";
            const healthTone = ["available", "ok"].includes(health.status) ? "success" : health.status ? "danger" : "neutral";
            return (
              <div className={styles.row} key={source.id}>
                <div>
                  <strong>{source.name}</strong>
                  <small>{source.id}</small>
                </div>
                <Badge tone={tone}>{configured ? "Activa" : source.requires_api_key ? "Sin clave" : "Inactiva"}</Badge>
                <Badge tone={healthTone}>{health.status || "Sin health"}</Badge>
                <p>{health.error || source.description || "Sin detalle adicional."}</p>
              </div>
            );
          })}
        </div>
      </Card>
    </section>
  );
}

function PageError({ message, onRetry }) {
  return (
    <div className={styles.error}>
      <strong>No se pudo cargar Fuentes</strong>
      <p>{message}</p>
      <Button onClick={onRetry} variant="secondary">Reintentar</Button>
    </div>
  );
}

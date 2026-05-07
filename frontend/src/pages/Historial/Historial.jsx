import { useCallback, useMemo } from "react";
import { AlertCircle, CheckCircle2, History, Search, Trash2 } from "lucide-react";
import { endpoints } from "@/api/endpoints";
import { request } from "@/api/client";
import { useFetch } from "@/hooks/useFetch";
import Badge from "@/components/ui/Badge/Badge";
import Button from "@/components/ui/Button/Button";
import Card from "@/components/ui/Card/Card";
import EmptyState from "@/components/ui/EmptyState/EmptyState";
import Spinner from "@/components/ui/Spinner/Spinner";
import StatCard from "@/components/ui/StatCard/StatCard";
import { formatDateTime, scoreText, scoreTone, statusTone } from "@/utils/formatters";
import styles from "./Historial.module.css";

export default function Historial() {
  const fetchHistory = useCallback(async () => {
    const [runsPayload, jobsPayload, applicationsPayload] = await Promise.all([
      request(endpoints.search.runs({ limit: 50 })),
      request(endpoints.jobs.list({ status: "Todos", search: "", min_score: 0, include_discarded: true })),
      request(endpoints.jobs.applications({ limit: 100 })),
    ]);
    return {
      runs: runsPayload.runs || [],
      jobs: jobsPayload.jobs || [],
      applications: applicationsPayload.applications || [],
    };
  }, []);

  const { data, loading, error, refetch } = useFetch(fetchHistory);
  const jobsById = useMemo(() => new Map((data?.jobs || []).map((job) => [job.id, job])), [data]);

  if (loading) return <Spinner full label="Cargando historial..." />;
  if (error) return <PageError message={error.message} onRetry={refetch} />;
  if (!data?.runs?.length && !data?.applications?.length) {
    return <EmptyState title="Historial vacio" text="Las busquedas ejecutadas y aplicaciones manuales apareceran aqui." />;
  }

  const failedRuns = data.runs.filter((run) => run.status && !["success", "completed"].includes(run.status));
  const discarded = data.jobs.filter((job) => job.status === "Descartada");

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <span className={styles.eyebrow}>Historial</span>
        <h1>Busquedas y aplicaciones manuales</h1>
        <p>Audita ejecuciones recientes, resultados guardados y ofertas que avanzaron o fueron descartadas.</p>
      </header>

      <div className={styles.stats}>
        <StatCard icon={Search} label="Busquedas" value={data.runs.length} detail="Runs registrados" />
        <StatCard icon={CheckCircle2} label="Aplicadas" value={data.applications.length} detail="Aplicaciones manuales" tone="success" />
        <StatCard icon={Trash2} label="Descartadas" value={discarded.length} detail="Ofertas descartadas" tone="warning" />
        <StatCard icon={AlertCircle} label="Con errores" value={failedRuns.length} detail="Runs para revisar" tone="danger" />
      </div>

      <div className={styles.grid}>
        <Card title="Historial de busquedas" icon={History} meta={`${data.runs.length} runs`}>
          {data.runs.length ? (
            <div className={styles.rows}>
              {data.runs.map((run) => (
                <article className={styles.row} key={run.id || `${run.query}-${run.started_at}`}>
                  <div className={styles.rowHead}>
                    <div>
                      <strong>{run.query || "Busqueda sin query"}</strong>
                      <span>{formatDateTime(run.started_at)} · {(run.selected_sources || []).length} fuentes</span>
                    </div>
                    <Badge tone={["success", "completed"].includes(run.status) ? "success" : "warning"}>{run.status || "sin estado"}</Badge>
                  </div>
                  <div className={styles.badges}>
                    <Badge>{run.total_found || 0} encontradas</Badge>
                    <Badge tone="success">{run.total_saved || 0} guardadas</Badge>
                    <Badge tone="warning">{run.duplicates || 0} duplicadas</Badge>
                  </div>
                  {run.errors?.length ? <p className={styles.inlineError}>{run.errors.map((item) => item.error || item.message || String(item)).join(" · ")}</p> : null}
                </article>
              ))}
            </div>
          ) : (
            <EmptyState title="Sin busquedas" text="Ejecuta una busqueda multi-fuente para poblar esta columna." />
          )}
        </Card>

        <Card title="Aplicaciones manuales" icon={CheckCircle2} meta={`${data.applications.length} registros`}>
          {data.applications.length ? (
            <div className={styles.rows}>
              {data.applications.map((application) => {
                const job = jobsById.get(application.job_id);
                return (
                  <article className={styles.row} key={application.id}>
                    <div className={styles.rowHead}>
                      <div>
                        <strong>{job?.title || "Oferta eliminada"}</strong>
                        <span>{job?.company || application.portal || "Portal no indicado"}</span>
                      </div>
                      {job?.score != null ? <Badge tone={scoreTone(job.score)}>{scoreText(job.score)}</Badge> : <Badge tone={statusTone(application.status || "Aplicada")}>{application.status || "Aplicada"}</Badge>}
                    </div>
                    <div className={styles.badges}>
                      <Badge>{formatDateTime(application.created_at)}</Badge>
                      <Badge tone="info">{application.documents_used?.length || 0} docs</Badge>
                      <Badge tone="success">{application.portal || job?.source || "Manual"}</Badge>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <EmptyState title="Sin aplicaciones" text="Marca ofertas como aplicadas para conservar el rastro." />
          )}
        </Card>
      </div>
    </section>
  );
}

function PageError({ message, onRetry }) {
  return (
    <div className={styles.error}>
      <strong>No se pudo cargar Historial</strong>
      <p>{message}</p>
      <Button onClick={onRetry} variant="secondary">Reintentar</Button>
    </div>
  );
}

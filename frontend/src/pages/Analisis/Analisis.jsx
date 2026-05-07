import { useCallback, useContext, useMemo, useState } from "react";
import { FileText, Gauge, Sparkles, Target, TrendingUp } from "lucide-react";
import { endpoints } from "@/api/endpoints";
import { request } from "@/api/client";
import { AppContext } from "@/context/AppContext";
import { useFetch } from "@/hooks/useFetch";
import { useToast } from "@/hooks/useToast";
import Badge from "@/components/ui/Badge/Badge";
import Button from "@/components/ui/Button/Button";
import Card from "@/components/ui/Card/Card";
import EmptyState from "@/components/ui/EmptyState/EmptyState";
import Spinner from "@/components/ui/Spinner/Spinner";
import StatCard from "@/components/ui/StatCard/StatCard";
import { scoreText, scoreTone } from "@/utils/formatters";
import styles from "./Analisis.module.css";

export default function Analisis() {
  const fetchAnalysis = useCallback(async () => {
    const [jobsPayload, documentsPayload] = await Promise.all([
      request(endpoints.jobs.list({ status: "Todos", search: "", min_score: 0 })),
      request(endpoints.documents.list()),
    ]);
    return {
      jobs: jobsPayload.jobs || [],
      documents: documentsPayload.documents || [],
    };
  }, []);

  const { data, loading, error, refetch } = useFetch(fetchAnalysis);
  const { success, error: toastError } = useToast();
  const { refreshCounters } = useContext(AppContext);
  const [busyKey, setBusyKey] = useState("");

  const documentJobIds = useMemo(() => new Set((data?.documents || []).map((doc) => doc.job_id).filter(Boolean)), [data]);
  const activeJobs = (data?.jobs || []).filter((job) => !["Aplicada", "Descartada"].includes(job.status));
  const queue = activeJobs.filter((job) => job.score == null);
  const best = [...activeJobs].filter((job) => job.score != null).sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 6);
  const withoutDocs = activeJobs.filter((job) => (job.score || 0) >= 60 && !documentJobIds.has(job.id));
  const scored = activeJobs.filter((job) => job.score != null);
  const average = scored.length ? Math.round(scored.reduce((sum, job) => sum + (job.score || 0), 0) / scored.length) : 0;

  if (loading) return <Spinner full label="Cargando analisis..." />;
  if (error) return <PageError message={error.message} onRetry={refetch} />;
  if (!data?.jobs?.length) return <EmptyState title="Sin ofertas para analizar" text="Captura ofertas primero para llenar la cola de analisis." />;

  async function runAction(key, action, okMessage) {
    setBusyKey(key);
    try {
      await action();
      await refetch();
      await refreshCounters();
      success(okMessage);
    } catch (err) {
      toastError(err.message || "No se pudo completar la accion.");
    } finally {
      setBusyKey("");
    }
  }

  async function analyze(job) {
    await runAction(`analyze:${job.id}`, async () => {
      const response = await request(endpoints.jobs.analyze(job.id), { method: "POST", body: { use_ai: false } });
      if (!response?.id || response.score == null) throw new Error("El analisis no devolvio score.");
    }, "Oferta analizada.");
  }

  async function generate(job) {
    await runAction(`docs:${job.id}`, async () => {
      const response = await request(endpoints.jobs.documents(job.id), { method: "POST" });
      if (!Array.isArray(response?.documents)) throw new Error("No se generaron documentos.");
    }, "Documentos generados.");
  }

  async function analyzeQueue() {
    const candidates = queue.slice(0, 8);
    await runAction("bulk", async () => {
      let ok = 0;
      for (const job of candidates) {
        const response = await request(endpoints.jobs.analyze(job.id), { method: "POST", body: { use_ai: false } });
        if (response?.id && response.score != null) ok += 1;
      }
      if (!ok) throw new Error("Ninguna oferta fue analizada.");
    }, `${candidates.length} ofertas procesadas.`);
  }

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <span className={styles.eyebrow}>Analisis</span>
        <h1>Score, cola y mejores oportunidades</h1>
        <p>Separa lo que falta analizar de lo que ya puede avanzar a documentos.</p>
      </header>

      <div className={styles.stats}>
        <StatCard icon={Gauge} label="Sin score" value={queue.length} detail="Pendientes de compatibilidad" tone="warning" />
        <StatCard icon={Target} label="Matches fuertes" value={best.filter((job) => (job.score || 0) >= 80).length} detail="Score igual o mayor a 80" tone="success" />
        <StatCard icon={FileText} label="Sin documentos" value={withoutDocs.length} detail="Buenos matches por preparar" tone="info" />
        <StatCard icon={TrendingUp} label="Promedio activo" value={`${average}%`} detail={`${scored.length} ofertas con score`} />
      </div>

      <div className={styles.grid}>
        <Card
          title="Cola de analisis"
          icon={Sparkles}
          meta={`${queue.length} pendientes`}
          actions={<Button disabled={!queue.length || busyKey === "bulk"} onClick={analyzeQueue} variant="secondary">Analizar cola</Button>}
        >
          {queue.length ? (
            <div className={styles.rows}>
              {queue.map((job) => (
                <article className={styles.row} key={job.id}>
                  <div>
                    <strong>{job.title}</strong>
                    <span>{job.company || "Empresa no indicada"} · {job.source || "Manual"}</span>
                  </div>
                  <Button disabled={busyKey === `analyze:${job.id}`} onClick={() => analyze(job)} size="sm" variant="secondary">Analizar</Button>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState title="Cola limpia" text="Todas las ofertas activas tienen score." />
          )}
        </Card>

        <Card title="Mejores oportunidades" icon={Target} meta={`${best.length} destacadas`}>
          {best.length ? (
            <div className={styles.rows}>
              {best.map((job) => (
                <article className={styles.row} key={job.id}>
                  <div>
                    <strong>{job.title}</strong>
                    <span>{job.company || "Empresa no indicada"}</span>
                    <div className={styles.badges}>
                      <Badge tone={scoreTone(job.score)}>{scoreText(job.score)}</Badge>
                      {documentJobIds.has(job.id) ? <Badge tone="success">Con documentos</Badge> : <Badge tone="warning">Sin documentos</Badge>}
                    </div>
                  </div>
                  {!documentJobIds.has(job.id) ? (
                    <Button disabled={busyKey === `docs:${job.id}`} onClick={() => generate(job)} size="sm" variant="secondary">Preparar</Button>
                  ) : null}
                </article>
              ))}
            </div>
          ) : (
            <EmptyState title="Sin oportunidades rankeadas" text="Analiza ofertas para construir esta lista." />
          )}
        </Card>
      </div>
    </section>
  );
}

function PageError({ message, onRetry }) {
  return (
    <div className={styles.error}>
      <strong>No se pudo cargar Analisis</strong>
      <p>{message}</p>
      <Button onClick={onRetry} variant="secondary">Reintentar</Button>
    </div>
  );
}

import { useCallback, useContext, useMemo, useState } from "react";
import { ExternalLink, FileText, Filter, MapPin, Send, Sparkles, Trash2 } from "lucide-react";
import { endpoints } from "@/api/endpoints";
import { request } from "@/api/client";
import { AppContext } from "@/context/AppContext";
import { JOB_FILTERS, STATUSES } from "@/constants";
import { useFetch } from "@/hooks/useFetch";
import { useToast } from "@/hooks/useToast";
import Badge from "@/components/ui/Badge/Badge";
import Button from "@/components/ui/Button/Button";
import Card from "@/components/ui/Card/Card";
import EmptyState from "@/components/ui/EmptyState/EmptyState";
import Input from "@/components/ui/Input/Input";
import Spinner from "@/components/ui/Spinner/Spinner";
import {
  displayStatus,
  documentDownloadUrl,
  documentViewUrl,
  formatDate,
  scoreSummary,
  scoreText,
  scoreTone,
  statusTone,
} from "@/utils/formatters";
import styles from "./Ofertas.module.css";

export default function Ofertas() {
  const fetchJobs = useCallback(async () => {
    const [jobsPayload, documentsPayload] = await Promise.all([
      request(endpoints.jobs.list({ status: "Todos", search: "", min_score: 0, include_discarded: true })),
      request(endpoints.documents.list()),
    ]);
    return {
      jobs: jobsPayload.jobs || [],
      documents: documentsPayload.documents || [],
    };
  }, []);

  const { data, loading, error, refetch } = useFetch(fetchJobs);
  const { success, error: toastError } = useToast();
  const { refreshCounters } = useContext(AppContext);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [busyKey, setBusyKey] = useState("");

  const documentJobIds = useMemo(() => new Set((data?.documents || []).map((doc) => doc.job_id).filter(Boolean)), [data]);
  const filterCounts = useMemo(() => buildFilterCounts(data?.jobs || [], documentJobIds), [data, documentJobIds]);
  const visibleJobs = useMemo(() => filterJobs(data?.jobs || [], filter, query, documentJobIds), [data, filter, query, documentJobIds]);
  const selectedJob = visibleJobs.find((job) => job.id === selectedId) || visibleJobs[0] || null;
  const selectedDocuments = (data?.documents || []).filter((doc) => doc.job_id === selectedJob?.id);

  if (loading) return <Spinner full label="Cargando ofertas..." />;
  if (error) return <PageError message={error.message} onRetry={refetch} />;
  if (!data?.jobs?.length) {
    return (
      <section className={styles.page}>
        <EmptyState title="No hay ofertas guardadas" text="Busca, importa o carga manualmente oportunidades para revisar esta bandeja." />
      </section>
    );
  }

  async function runJobAction(key, action, okMessage) {
    setBusyKey(key);
    try {
      const response = await action();
      if (response === null || response === undefined) {
        throw new Error("El backend no devolvio confirmacion.");
      }
      await refetch();
      await refreshCounters();
      success(okMessage);
    } catch (err) {
      toastError(err.message || "No se pudo actualizar la oferta.");
    } finally {
      setBusyKey("");
    }
  }

  async function handleSelect(job) {
    if (!job.viewed) {
      await runJobAction(`viewed:${job.id}`, async () => {
        const response = await request(endpoints.jobs.viewed(job.id), { method: "PATCH" });
        if (!response?.id) throw new Error("No se pudo marcar como vista.");
        setSelectedId(job.id);
        return response;
      }, "Oferta marcada como vista.");
      return;
    }
    setSelectedId(job.id);
  }

  async function updateStatus(job, status) {
    await runJobAction(`status:${job.id}`, async () => {
      const response = await request(endpoints.jobs.status(job.id), { method: "PATCH", body: { status } });
      if (!response?.id || response.status !== status) throw new Error("El estado no fue confirmado por el backend.");
      return response;
    }, `Estado actualizado a ${displayStatus(status)}.`);
  }

  async function analyze(job) {
    await runJobAction(`analyze:${job.id}`, async () => {
      const response = await request(endpoints.jobs.analyze(job.id), { method: "POST", body: { use_ai: false } });
      if (!response?.id || response.score == null) throw new Error("El analisis no devolvio score.");
      return response;
    }, "Compatibilidad calculada.");
  }

  async function generateDocuments(job) {
    await runJobAction(`documents:${job.id}`, async () => {
      const response = await request(endpoints.jobs.documents(job.id), { method: "POST" });
      if (!Array.isArray(response?.documents)) throw new Error("No se confirmaron documentos generados.");
      return response;
    }, "Documentos generados.");
  }

  async function apply(job) {
    await runJobAction(`apply:${job.id}`, async () => {
      const response = await request(endpoints.jobs.apply(job.id), { method: "POST" });
      if (response?.status !== "Aplicada") throw new Error("La aplicacion no fue confirmada.");
      return response;
    }, "Oferta marcada como aplicada.");
  }

  async function discard(job) {
    await runJobAction(`discard:${job.id}`, async () => {
      const response = await request(endpoints.jobs.discard(job.id), { method: "POST" });
      if (!response?.job?.id) throw new Error("El descarte no fue confirmado.");
      setSelectedId(null);
      return response;
    }, "Oferta descartada.");
  }

  return (
    <section className={styles.page}>
      <aside className={styles.filters}>
        <Card title="Filtros" icon={Filter} hover={false}>
          <Input label="Buscar" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Titulo, empresa, tag..." />
          <div className={styles.filterList}>
            {JOB_FILTERS.map((item) => (
              <label className={[styles.filterItem, filter === item.key ? styles.activeFilter : ""].join(" ")} key={item.key}>
                <input checked={filter === item.key} name="job-filter" onChange={() => setFilter(item.key)} type="radio" />
                <span>{item.label}</span>
                <Badge>{filterCounts[item.key] || 0}</Badge>
              </label>
            ))}
          </div>
        </Card>
      </aside>

      <div className={styles.list}>
        {visibleJobs.length ? visibleJobs.map((job) => (
          <button
            className={[styles.jobCard, selectedJob?.id === job.id ? styles.selected : ""].join(" ")}
            key={job.id}
            onClick={() => handleSelect(job)}
            type="button"
          >
            <div className={styles.jobTop}>
              <strong>{job.title}</strong>
              <Badge tone={scoreTone(job.score)}>{scoreText(job.score)}</Badge>
            </div>
            <span>{job.company || "Empresa no indicada"}</span>
            <small>{job.source || "Manual"} · {formatDate(job.first_seen_at || job.created_at)}</small>
            <div className={styles.cardBadges}>
              {!job.viewed ? <Badge tone={statusTone("Nueva")}>Nueva</Badge> : <Badge tone={statusTone("Vista")}>Vista</Badge>}
              {documentJobIds.has(job.id) ? <Badge tone="success">Con documentos</Badge> : null}
              <Badge tone={statusTone(job.status)}>{displayStatus(job.status)}</Badge>
            </div>
          </button>
        )) : (
          <EmptyState title="Sin resultados para este filtro" text="Cambia estado, busqueda o score para recuperar ofertas." />
        )}
      </div>

      <aside className={styles.detail}>
        {selectedJob ? (
          <Card title="Detalle" icon={Sparkles} meta={scoreSummary(selectedJob.score)} hover={false}>
            <div className={styles.detailHead}>
              <h2>{selectedJob.title}</h2>
              <p>{selectedJob.company || "Empresa no indicada"}</p>
              <div className={styles.metaRow}>
                <MapPin size={14} aria-hidden="true" />
                {selectedJob.location || "Ubicacion no indicada"}
              </div>
            </div>

            <div className={styles.actions}>
              <Button disabled={busyKey === `analyze:${selectedJob.id}`} icon={Sparkles} onClick={() => analyze(selectedJob)} variant="secondary">Analizar</Button>
              <Button disabled={busyKey === `documents:${selectedJob.id}`} icon={FileText} onClick={() => generateDocuments(selectedJob)} variant="secondary">Documentos</Button>
              <Button disabled={busyKey === `apply:${selectedJob.id}`} icon={Send} onClick={() => apply(selectedJob)} variant="success">Aplicada</Button>
              <Button disabled={busyKey === `discard:${selectedJob.id}`} icon={Trash2} onClick={() => discard(selectedJob)} variant="danger">Descartar</Button>
              {selectedJob.url ? (
                <a className={styles.external} href={selectedJob.url} rel="noreferrer" target="_blank">
                  <ExternalLink size={15} aria-hidden="true" />
                  Abrir portal
                </a>
              ) : null}
            </div>

            <Input
              label="Estado"
              onChange={(event) => updateStatus(selectedJob, event.target.value)}
              options={STATUSES.map((status) => ({ value: status, label: displayStatus(status) }))}
              select
              value={selectedJob.status || "Nueva"}
            />

            <section className={styles.section}>
              <h3>Razones</h3>
              {selectedJob.reasons?.length ? (
                <ul>{selectedJob.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
              ) : (
                <p>No hay razones todavia. Ejecuta el analisis para generarlas.</p>
              )}
            </section>

            <section className={styles.section}>
              <h3>Brechas</h3>
              {selectedJob.gaps?.length ? (
                <div className={styles.gaps}>{selectedJob.gaps.map((gap) => <Badge tone="warning" key={gap}>{gap}</Badge>)}</div>
              ) : (
                <p>Sin brechas registradas.</p>
              )}
            </section>

            <section className={styles.section}>
              <h3>Documentos</h3>
              {selectedDocuments.length ? (
                <div className={styles.docs}>
                  {selectedDocuments.map((document) => (
                    <a href={documentViewUrl(document)} key={document.id} rel="noreferrer" target="_blank">
                      {document.doc_type}
                    </a>
                  ))}
                  {selectedDocuments.map((document) => (
                    <a href={documentDownloadUrl(document)} key={`download-${document.id}`} rel="noreferrer" target="_blank">
                      Descargar {document.doc_type}
                    </a>
                  ))}
                </div>
              ) : (
                <p>Esta oferta aun no tiene documentos.</p>
              )}
            </section>

            <section className={styles.section}>
              <h3>Descripcion</h3>
              <p className={styles.description}>{selectedJob.description || "Sin descripcion guardada."}</p>
            </section>
          </Card>
        ) : (
          <EmptyState title="Selecciona una oferta" text="El detalle aparecera en este panel." />
        )}
      </aside>
    </section>
  );
}

function buildFilterCounts(jobs, documentJobIds) {
  return {
    all: jobs.length,
    new: jobs.filter((job) => !job.viewed).length,
    viewed: jobs.filter((job) => job.viewed).length,
    good: jobs.filter((job) => (job.score || 0) >= 60 && !["Aplicada", "Descartada"].includes(job.status)).length,
    docs: jobs.filter((job) => documentJobIds.has(job.id)).length,
    applied: jobs.filter((job) => job.status === "Aplicada").length,
  };
}

function filterJobs(jobs, filter, query, documentJobIds) {
  const needle = query.trim().toLowerCase();
  return jobs.filter((job) => {
    const haystack = [job.title, job.company, job.location, job.description, ...(Array.isArray(job.tags) ? job.tags : [])]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    const matchesQuery = !needle || haystack.includes(needle);
    const matchesFilter =
      filter === "all" ||
      (filter === "new" && !job.viewed) ||
      (filter === "viewed" && job.viewed) ||
      (filter === "good" && (job.score || 0) >= 60 && !["Aplicada", "Descartada"].includes(job.status)) ||
      (filter === "docs" && documentJobIds.has(job.id)) ||
      (filter === "applied" && job.status === "Aplicada");
    return matchesQuery && matchesFilter;
  });
}

function PageError({ message, onRetry }) {
  return (
    <div className={styles.error}>
      <strong>No se pudieron cargar las ofertas</strong>
      <p>{message}</p>
      <Button onClick={onRetry} variant="secondary">Reintentar</Button>
    </div>
  );
}

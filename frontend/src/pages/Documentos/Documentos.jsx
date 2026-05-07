import { useCallback, useContext, useMemo, useState } from "react";
import { Download, FileArchive, FileText, Sparkles } from "lucide-react";
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
import { documentDownloadUrl, documentViewUrl, groupDocumentsByJob, scoreText, scoreTone } from "@/utils/formatters";
import styles from "./Documentos.module.css";

export default function Documentos() {
  const fetchDocuments = useCallback(async () => {
    const [documentsPayload, jobsPayload] = await Promise.all([
      request(endpoints.documents.list()),
      request(endpoints.jobs.list({ status: "Todos", search: "", min_score: 0 })),
    ]);
    return {
      documents: documentsPayload.documents || [],
      jobs: jobsPayload.jobs || [],
    };
  }, []);

  const { data, loading, error, refetch } = useFetch(fetchDocuments);
  const { success, error: toastError } = useToast();
  const { refreshCounters } = useContext(AppContext);
  const [busyId, setBusyId] = useState(null);

  const groups = useMemo(() => groupDocumentsByJob(data?.documents || [], data?.jobs || []), [data]);
  const documentJobIds = useMemo(() => new Set((data?.documents || []).map((doc) => doc.job_id).filter(Boolean)), [data]);
  const suggestions = (data?.jobs || [])
    .filter((job) => (job.score || 0) >= 60 && !documentJobIds.has(job.id) && !["Aplicada", "Descartada"].includes(job.status))
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, 8);

  if (loading) return <Spinner full label="Cargando documentos..." />;
  if (error) return <PageError message={error.message} onRetry={refetch} />;
  if (!groups.length && !suggestions.length) {
    return <EmptyState title="No hay documentos ni sugerencias" text="Analiza ofertas con buen score para preparar CV y carta personalizados." />;
  }

  async function generate(job) {
    setBusyId(job.id);
    try {
      const response = await request(endpoints.jobs.documents(job.id), { method: "POST" });
      if (!Array.isArray(response?.documents)) throw new Error("El backend no confirmo documentos generados.");
      await refetch();
      await refreshCounters();
      success("Documentos generados.");
    } catch (err) {
      toastError(err.message || "No se pudieron generar documentos.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <span className={styles.eyebrow}>Documentos</span>
        <h1>CV y cartas por oportunidad</h1>
        <p>Revisa lo generado y prepara documentos para los matches que aun no tienen paquete.</p>
      </header>

      <div className={styles.grid}>
        <Card title="Documentos generados" icon={FileArchive} meta={`${groups.length} ofertas`}>
          {groups.length ? (
            <div className={styles.groups}>
              {groups.map((group) => (
                <article className={styles.group} key={group.key}>
                  <div className={styles.groupHead}>
                    <div>
                      <strong>{group.title}</strong>
                      <span>{group.company}</span>
                    </div>
                    {group.job?.score != null ? <Badge tone={scoreTone(group.job.score)}>{scoreText(group.job.score)}</Badge> : null}
                  </div>
                  <div className={styles.files}>
                    {group.documents.map((document) => (
                      <a href={documentViewUrl(document)} key={document.id} rel="noreferrer" target="_blank">
                        <FileText size={15} aria-hidden="true" />
                        {document.doc_type}
                      </a>
                    ))}
                    {group.documents.map((document) => (
                      <a href={documentDownloadUrl(document)} key={`download-${document.id}`} rel="noreferrer" target="_blank">
                        <Download size={15} aria-hidden="true" />
                        Descargar {document.doc_type}
                      </a>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState title="Sin documentos generados" text="Los paquetes apareceran aqui despues de prepararlos." />
          )}
        </Card>

        <Card title="Sugeridas para preparar" icon={Sparkles} meta={`${suggestions.length} pendientes`}>
          {suggestions.length ? (
            <div className={styles.groups}>
              {suggestions.map((job) => (
                <article className={styles.group} key={job.id}>
                  <div className={styles.groupHead}>
                    <div>
                      <strong>{job.title}</strong>
                      <span>{job.company || "Empresa no indicada"}</span>
                    </div>
                    <Badge tone={scoreTone(job.score)}>{scoreText(job.score)}</Badge>
                  </div>
                  <p>{job.location || "Ubicacion no indicada"}</p>
                  <Button disabled={busyId === job.id} onClick={() => generate(job)} size="sm" variant="secondary">
                    Generar documentos
                  </Button>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState title="Nada pendiente" text="Todos los buenos matches tienen documentos o aun falta analizar mas ofertas." />
          )}
        </Card>
      </div>
    </section>
  );
}

function PageError({ message, onRetry }) {
  return (
    <div className={styles.error}>
      <strong>No se pudieron cargar documentos</strong>
      <p>{message}</p>
      <Button onClick={onRetry} variant="secondary">Reintentar</Button>
    </div>
  );
}

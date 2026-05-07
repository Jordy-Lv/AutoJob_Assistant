import { useCallback } from "react";
import { Link } from "react-router-dom";
import { Briefcase, FileArchive, ListChecks, Target, UserRound } from "lucide-react";
import { endpoints } from "@/api/endpoints";
import { request } from "@/api/client";
import { useFetch } from "@/hooks/useFetch";
import Badge from "@/components/ui/Badge/Badge";
import Button from "@/components/ui/Button/Button";
import Card from "@/components/ui/Card/Card";
import EmptyState from "@/components/ui/EmptyState/EmptyState";
import Spinner from "@/components/ui/Spinner/Spinner";
import StatCard from "@/components/ui/StatCard/StatCard";
import { displayStatus, formatDate, profileCompletion, scoreText, scoreTone } from "@/utils/formatters";
import styles from "./Inicio.module.css";

export default function Inicio() {
  const fetchHome = useCallback(async () => {
    const [overview, profile, jobsPayload, documentsPayload] = await Promise.all([
      request(endpoints.overview()),
      request(endpoints.profile()),
      request(endpoints.jobs.list({ status: "Todos", search: "", min_score: 0 })),
      request(endpoints.documents.list()),
    ]);
    return {
      overview,
      profile,
      jobs: jobsPayload.jobs || [],
      documents: documentsPayload.documents || [],
    };
  }, []);

  const { data, loading, error, refetch } = useFetch(fetchHome);

  if (loading) return <Spinner full label="Cargando inicio..." />;
  if (error) return <PageError message={error.message} onRetry={refetch} />;
  if (!data) return <EmptyState title="Sin datos del dashboard" text="El backend no devolvio informacion inicial." />;

  const { overview, profile, jobs, documents } = data;
  const progress = profileCompletion(profile);
  const activeJobs = jobs.filter((job) => !["Aplicada", "Descartada"].includes(job.status));
  const pending = activeJobs.filter((job) => !job.viewed || job.score == null).length;
  const bestScore = jobs.reduce((best, job) => (job.score == null ? best : Math.max(best, Number(job.score))), -1);
  const recent = (overview.recent_jobs?.length ? overview.recent_jobs : jobs).slice(0, 5);
  const statusEntries = Object.entries(overview.counts || {});
  const nextAction = buildNextAction({ progress, totalJobs: overview.total_jobs, pending, documentsCount: documents.length });

  if (!jobs.length && progress === 0) {
    return (
      <section className={styles.page}>
        <EmptyState
          icon={Briefcase}
          title="AutoJob esta listo para empezar"
          text="Completa tu perfil o ejecuta tu primera busqueda para alimentar el dashboard."
          action={<Link className={styles.primaryLink} to="/perfil">Crear base inicial</Link>}
        />
      </section>
    );
  }

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>Inicio</span>
          <h1>Panel operativo de busqueda laboral</h1>
          <p>Prioriza oportunidades, revisa pendientes y prepara el siguiente movimiento.</p>
        </div>
        <Link className={styles.primaryLink} to={nextAction.path}>
          {nextAction.cta}
        </Link>
      </header>

      <div className={styles.stats}>
        <StatCard icon={Briefcase} label="Ofertas guardadas" value={overview.total_jobs || 0} detail="En la bandeja" />
        <StatCard icon={ListChecks} label="Pendientes" value={pending} detail="Sin revisar o analizar" tone="warning" />
        <StatCard icon={FileArchive} label="Documentos" value={documents.length || overview.documents_count || 0} detail="CV y cartas generados" tone="info" />
        <StatCard icon={Target} label="Mejor match" value={bestScore >= 0 ? `${Math.round(bestScore)}%` : "N/D"} detail="Score mas alto activo" tone="success" />
      </div>

      <div className={styles.grid}>
        <div className={styles.mainStack}>
          <Card title="Siguiente accion" icon={nextAction.icon} meta={nextAction.detail}>
            <div className={styles.nextAction}>
              <div>
                <h2>{nextAction.title}</h2>
                <p>{nextAction.text}</p>
              </div>
              <Link className={styles.inlineLink} to={nextAction.path}>
                {nextAction.cta}
              </Link>
            </div>
          </Card>

          <Card title="Ultimas ofertas" icon={Briefcase} meta={`${recent.length} recientes`}>
            {recent.length ? (
              <div className={styles.jobList}>
                {recent.map((job) => (
                  <Link className={styles.jobRow} to="/ofertas" key={job.id}>
                    <div>
                      <strong>{job.title}</strong>
                      <span>{job.company || "Empresa no indicada"} · {formatDate(job.first_seen_at || job.created_at)}</span>
                    </div>
                    <Badge tone={scoreTone(job.score)}>{scoreText(job.score)}</Badge>
                  </Link>
                ))}
              </div>
            ) : (
              <EmptyState title="Aun no hay ofertas" text="Ejecuta una busqueda o importa una URL para crear la primera tarjeta." />
            )}
          </Card>
        </div>

        <aside className={styles.sideStack}>
          <Card title="Perfil" icon={UserRound} meta={`${progress}% completo`}>
            <div className={styles.profileBox}>
              <div className={styles.progressTrack}>
                <span style={{ width: `${progress}%` }} />
              </div>
              <strong>{profile.full_name || "Perfil sin nombre"}</strong>
              <p>{profile.target_role || "Define tu rol objetivo para mejorar el scoring."}</p>
              <Link className={styles.secondaryLink} to="/perfil">Editar perfil</Link>
            </div>
          </Card>

          <Card title="Por estado" icon={ListChecks} meta={`${statusEntries.length} grupos`}>
            {statusEntries.length ? (
              <div className={styles.statusList}>
                {statusEntries.map(([status, count]) => (
                  <div className={styles.statusRow} key={status}>
                    <span>{displayStatus(status)}</span>
                    <Badge>{count}</Badge>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="Sin estados" text="Cuando existan ofertas, apareceran por etapa." />
            )}
          </Card>
        </aside>
      </div>
    </section>
  );
}

function buildNextAction({ progress, totalJobs, pending, documentsCount }) {
  if (progress < 70) {
    return {
      icon: UserRound,
      title: "Completa tu perfil",
      text: "La calidad del score y los documentos depende de tu perfil profesional.",
      detail: `${progress}% completado`,
      cta: "Ir al perfil",
      path: "/perfil",
    };
  }
  if (!totalJobs) {
    return {
      icon: Briefcase,
      title: "Busca tus primeras ofertas",
      text: "Ejecuta una busqueda multi-fuente para poblar la bandeja.",
      detail: "Sin ofertas todavia",
      cta: "Buscar ofertas",
      path: "/buscar",
    };
  }
  if (pending) {
    return {
      icon: ListChecks,
      title: "Revisa la cola pendiente",
      text: `${pending} ofertas necesitan lectura, score o decision.`,
      detail: `${pending} pendientes`,
      cta: "Abrir ofertas",
      path: "/ofertas",
    };
  }
  return {
    icon: FileArchive,
    title: "Prepara documentos",
    text: documentsCount ? "Ya tienes documentos listos para revisar." : "Genera CV y carta para tus mejores oportunidades.",
    detail: `${documentsCount} documentos`,
    cta: "Ver documentos",
    path: "/documentos",
  };
}

function PageError({ message, onRetry }) {
  return (
    <div className={styles.error}>
      <strong>No se pudo cargar Inicio</strong>
      <p>{message}</p>
      <Button onClick={onRetry} variant="secondary">Reintentar</Button>
    </div>
  );
}

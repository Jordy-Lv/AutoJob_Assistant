import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AlertCircle,
  ArrowRight,
  Bell,
  Briefcase,
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Database,
  Download,
  ExternalLink,
  Eye,
  FileArchive,
  FileText,
  Filter,
  Gauge,
  Globe2,
  Layers3,
  Link as LinkIcon,
  ListChecks,
  MapPin,
  Menu,
  Moon,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles,
  Sun,
  Target,
  Trash2,
  UserRound,
  WandSparkles,
  X,
} from "lucide-react";
import { documentDownloadUrl, documentViewUrl, request } from "./api";
import "./styles.css";

const THEME_KEY = "autojob-theme";

// ----------------------------------------------------------------------------
// Estados aceptados por el backend (post simplificación). NO incluyen estados
// del bot eliminado (En aplicacion, Captcha requerido, Necesita revision, Error).
// ----------------------------------------------------------------------------
const STATUSES = ["Nueva", "Interesante", "Lista para aplicar", "Aplicada", "Descartada"];

// Mapeo solo para mostrar (legacy gracefully degradation).
const STATUS_LABELS = {
  Nueva: "Nueva",
  Interesante: "Interesante",
  "Lista para aplicar": "Lista para aplicar",
  Aplicada: "Aplicada manualmente",
  Descartada: "Descartada",
  // Legacy — solo mostrar, no permitir asignar.
  Aprobada: "Lista para aplicar",
  "En aplicacion": "Aplicada manualmente",
  "Captcha requerido": "Aplicada manualmente",
  "Necesita revision": "Lista para aplicar",
  Error: "Descartada",
};

const NAV_ITEMS = [
  { key: "dashboard", label: "Inicio", icon: Gauge, hint: "Resumen y siguiente accion", group: "primary" },
  { key: "search", label: "Buscar ofertas", icon: Search, hint: "Buscar o capturar oportunidades", group: "primary" },
  { key: "jobs", label: "Ofertas", icon: Briefcase, hint: "Revisar oportunidades", group: "primary" },
  { key: "saved", label: "Automatizacion", icon: Bell, hint: "Busquedas automaticas", group: "secondary" },
  { key: "documents", label: "Documentos", icon: FileArchive, hint: "CV y carta por oferta", group: "secondary" },
  { key: "profile", label: "Perfil", icon: UserRound, hint: "Tu base profesional", group: "secondary" },
  { key: "settings", label: "Configuracion", icon: Database, hint: "Estado tecnico", group: "technical" },
];

// Pasos del flujo, visibles en el dashboard como guía clara.
const FLOW_STEPS = [
  { key: "profile", label: "Configurar perfil", icon: UserRound, target: "profile" },
  { key: "search", label: "Buscar ofertas", icon: Search, target: "search" },
  { key: "review", label: "Revisar bandeja", icon: ListChecks, target: "jobs" },
  { key: "analyze", label: "Analizar compatibilidad", icon: WandSparkles, target: "jobs" },
  { key: "top", label: "Mejores oportunidades", icon: Target, target: "jobs" },
  { key: "documents", label: "Generar CV / carta", icon: FileText, target: "documents" },
  { key: "apply", label: "Aplicar manualmente", icon: ExternalLink, target: "jobs" },
];

const JOB_FILTERS = [
  { key: "all", label: "Todas" },
  { key: "new", label: "Nuevas" },
  { key: "good", label: "Buen match" },
  { key: "docs", label: "Con documentos" },
  { key: "applied", label: "Aplicadas" },
];

function getInitialTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === "light" || saved === "dark") return saved;
  return "dark";
}

// ----------------------------------------------------------------------------
// Top-level App
// ----------------------------------------------------------------------------
function App() {
  const [view, setView] = useState("dashboard");
  const [overview, setOverview] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [profile, setProfile] = useState(null);
  const [selectedJobId, setSelectedJobId] = useState(null);
  const [filters, setFilters] = useState({ category: "all", search: "", minScore: 0 });
  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(true);
  const [theme, setTheme] = useState(getInitialTheme);

  const documentJobIds = useMemo(
    () => new Set(documents.map((doc) => doc.job_id).filter(Boolean)),
    [documents],
  );

  const visibleJobs = useMemo(
    () => filterJobs(jobs, filters, documentJobIds),
    [jobs, filters, documentJobIds],
  );

  const selectedJob = useMemo(() => {
    if (!visibleJobs.length) return null;
    if (!selectedJobId) return visibleJobs[0];
    return visibleJobs.find((job) => job.id === selectedJobId) || visibleJobs[0];
  }, [selectedJobId, visibleJobs]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    loadAll();
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const t = window.setTimeout(() => setToast(null), 4500);
    return () => window.clearTimeout(t);
  }, [toast]);

  function showToast(message, type = "success") {
    setToast({ message, type });
  }

  async function loadAll(options = {}) {
    const { silent = false } = options;
    if (!silent) setLoading(true);
    try {
      const [overviewData, jobsData, profileData, documentsData] = await Promise.all([
        request("/api/overview"),
        request("/api/jobs?status=Todos&search=&min_score=0"),
        request("/api/profile"),
        request("/api/documents"),
      ]);
      setOverview(overviewData);
      setJobs(jobsData.jobs || []);
      setDocuments(documentsData.documents || overviewData.documents || []);
      setProfile(profileData);
      if (!selectedJobId && jobsData.jobs?.length) {
        setSelectedJobId(jobsData.jobs[0].id);
      }
    } catch (error) {
      showToast(error.message, "error");
    } finally {
      setLoading(false);
    }
  }

  async function updateStatus(job, status) {
    try {
      const updated = await request(`/api/jobs/${job.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      setSelectedJobId(updated.id);
      showToast(`Estado actualizado: ${displayStatus(status)}`);
      await loadAll({ silent: true });
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  async function analyze(job) {
    try {
      await request(`/api/jobs/${job.id}/analyze`, {
        method: "POST",
        body: JSON.stringify({ use_ai: false }),
      });
      showToast("Compatibilidad calculada");
      await loadAll({ silent: true });
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  async function generateDocuments(job) {
    try {
      await request(`/api/jobs/${job.id}/documents`, { method: "POST" });
      showToast("CV y carta generados para esta oferta");
      await loadAll({ silent: true });
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  async function markAsApplied(job) {
    try {
      await request(`/api/jobs/${job.id}/apply`, { method: "POST" });
      showToast("Marcada como aplicada manualmente");
      await loadAll({ silent: true });
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  return (
    <div className="product-shell">
      <TopNav
        view={view}
        setView={setView}
        overview={overview}
        onRefresh={() => loadAll({ silent: true })}
        theme={theme}
        toggleTheme={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
      />

      <main className="workspace" id="main-content">
        {toast && (
          <button className={`toast ${toast.type}`} onClick={() => setToast(null)} type="button">
            {toast.message}
          </button>
        )}

        {loading && !overview ? (
          <div className="loading-panel">
            <RefreshCw size={18} />
            Cargando AutoJob Assistant...
          </div>
        ) : (
          <>
            {view === "dashboard" && (
              <Dashboard
                overview={overview}
                jobs={jobs}
                documents={documents}
                profile={profile}
                setView={setView}
              />
            )}
            {view === "jobs" && (
              <JobsView
                jobs={jobs}
                visibleJobs={visibleJobs}
                documents={documents}
                documentJobIds={documentJobIds}
                filters={filters}
                setFilters={setFilters}
                selectedJob={selectedJob}
                setSelectedJobId={setSelectedJobId}
                setView={setView}
                profile={profile}
                onAnalyze={analyze}
                onGenerate={generateDocuments}
                onStatus={updateStatus}
                onMarkApplied={markAsApplied}
              />
            )}
            {view === "saved" && <SavedSearchesView showToast={showToast} reload={() => loadAll({ silent: true })} />}
            {view === "search" && <SearchView reload={() => loadAll({ silent: true })} showToast={showToast} setView={setView} />}
            {view === "documents" && (
              <DocumentsView
                documents={documents}
                jobs={jobs}
                onGenerate={generateDocuments}
                setView={setView}
                setSelectedJobId={setSelectedJobId}
              />
            )}
            {view === "profile" && (
              <ProfileView
                profile={profile}
                setProfile={setProfile}
                reload={() => loadAll({ silent: true })}
                showToast={showToast}
              />
            )}
            {view === "settings" && <SettingsView overview={overview} />}
          </>
        )}
      </main>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Top nav
// ----------------------------------------------------------------------------
function TopNav({ view, setView, overview, onRefresh, theme, toggleTheme }) {
  const [navOpen, setNavOpen] = useState(false);
  const healthOk = overview?.health?.ok;
  const navGroups = [
    { key: "primary", label: "Flujo principal" },
    { key: "secondary", label: "Trabajo" },
    { key: "technical", label: "Admin" },
  ];

  function go(target) {
    setView(target);
    setNavOpen(false);
  }

  return (
    <header className="product-nav">
      <a className="skip-link" href="#main-content">Saltar al contenido</a>

      <div className="brand-lockup">
        <div className="brand-mark" aria-hidden="true">AJ</div>
        <div>
          <strong>AutoJob Assistant</strong>
          <span>Busca ofertas, prepara documentos y aplica manualmente.</span>
        </div>
      </div>

      <button
        className="icon-button nav-toggle"
        onClick={() => setNavOpen((c) => !c)}
        type="button"
        aria-label={navOpen ? "Cerrar navegación" : "Abrir navegación"}
        aria-expanded={navOpen}
      >
        {navOpen ? <X size={18} /> : <Menu size={18} />}
      </button>

      <nav className={`nav-pills ${navOpen ? "open" : ""}`} aria-label="Navegacion principal">
        {navGroups.map((group) => (
          <div key={group.key} className={`nav-group ${group.key}`}>
            <span className="nav-group-label">{group.label}</span>
            {NAV_ITEMS.filter((item) => item.group === group.key).map(({ key, label, icon: Icon, hint }) => (
              <button
                key={key}
                className={view === key ? "active" : ""}
                onClick={() => go(key)}
                type="button"
                title={hint}
              >
                <Icon size={16} />
                <span>{label}</span>
              </button>
            ))}
          </div>
        ))}
      </nav>

      <div className="nav-actions">
        <div className={`system-chip ${healthOk ? "ok" : "bad"}`} title={overview?.health?.database_url || ""}>
          <Database size={15} />
          <span>{healthOk ? "DB conectada" : "Revisar DB"}</span>
        </div>
        <button className="icon-button" onClick={toggleTheme} type="button" aria-label="Cambiar tema">
          {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
        </button>
        <button className="icon-button" onClick={onRefresh} type="button" aria-label="Actualizar">
          <RefreshCw size={17} />
        </button>
        <button className="button primary nav-capture" onClick={() => go("search")} type="button">
          <Search size={16} />
          Buscar ofertas
        </button>
      </div>
    </header>
  );
}

// ----------------------------------------------------------------------------
// Dashboard — el flujo de 7 pasos es la columna principal
// ----------------------------------------------------------------------------
function Dashboard({ overview, jobs, documents, profile, setView }) {
  const profileProgress = profileCompletion(profile);
  const counts = overview?.counts || {};

  const totalJobs = overview?.total_jobs || 0;
  const newCount = overview?.new_count || 0;
  const unanalyzedCount = overview?.unanalyzed_count || 0;
  const highPriorityCount = overview?.high_priority_count || 0;
  const documentsCount = overview?.documents_count || documents.length || 0;
  const readyCount = overview?.ready_to_apply_count || 0;
  const appliedCount = overview?.applied_count || counts.Aplicada || 0;

  const stepStatus = computeStepStatus({
    profileProgress,
    totalJobs,
    unanalyzedCount,
    highPriorityCount,
    documentsCount,
    appliedCount,
  });

  const nextStep = stepStatus.find((s) => s.state === "current") || stepStatus[stepStatus.length - 1];
  const recommendation = buildPrimaryRecommendation({ nextStep, totalJobs, unanalyzedCount, highPriorityCount, documentsCount, profileProgress });
  const activeJobs = jobs.filter((job) => !["Aplicada", "Descartada"].includes(job.status));
  const pendingReviewCount = activeJobs.filter((job) => job.status === "Nueva" || job.is_new || job.score == null).length;
  const bestScore = jobs.reduce((best, job) => (job.score == null ? best : Math.max(best, Number(job.score))), -1);
  const bestScoreLabel = bestScore >= 0 ? `${Math.round(bestScore)}%` : "Sin score";
  const bestScoreDetail = bestScore >= 60
    ? "Mayor score detectado"
    : profileProgress < 70
      ? "Mejora al completar el perfil"
      : "Aun hay margen para afinar";
  const homeAction = profileProgress < 70
    ? { title: "Completa tu perfil", description: "El perfil mejora el score y la calidad del CV/carta.", target: "profile", icon: UserRound, cta: "Completar perfil" }
    : recommendation;
  const summaryCards = [
    { icon: Briefcase, title: "Ofertas encontradas", value: totalJobs, detail: "Guardadas en tu bandeja", tone: "blue" },
    { icon: ListChecks, title: "Pendientes de revisar", value: pendingReviewCount, detail: "Nuevas o sin decision", tone: "amber" },
    { icon: FileArchive, title: "Documentos generados", value: documentsCount, detail: "CV y cartas por oferta", tone: "violet" },
    { icon: Target, title: "Mejor match actual", value: bestScoreLabel, detail: bestScoreDetail, tone: "green" },
  ];
  const recentJobs = (overview?.new_jobs?.length ? overview.new_jobs : overview?.recent_jobs || jobs).slice(0, 3);

  return (
    <div className="page-stack home-page">
      <section className="home-hero">
        <div className="home-hero-copy">
          <span className="eyebrow">Inicio</span>
          <h1>{homeAction.title}</h1>
          <p>{homeAction.description} Despues busca ofertas, revisa matches y aplica manualmente desde la fuente original.</p>
          <div className="intro-actions">
            <button className="button primary" onClick={() => setView(homeAction.target)} type="button">
              <homeAction.icon size={16} />
              {homeAction.cta}
            </button>
            <button className="button secondary" onClick={() => setView("search")} type="button">
              <Search size={16} />
              Buscar ofertas
            </button>
          </div>
        </div>

        <aside className="home-profile-card">
          <div className="home-profile-header">
            <UserRound size={18} />
            <div>
              <strong>Perfil</strong>
              <span>{profileProgress < 70 ? "Necesita datos clave" : "Listo para analizar"}</span>
            </div>
          </div>
          <ProgressBar value={profileProgress} label="Completado" />
          <button className="button ghost compact" onClick={() => setView("profile")} type="button">
            Editar perfil
            <ArrowRight size={14} />
          </button>
        </aside>
      </section>

      <section className="metrics-grid home-summary-grid" aria-label="Resumen simple">
        {summaryCards.map((item) => (
          <MetricCard key={item.title} {...item} />
        ))}
      </section>

      <section className="content-grid home-bottom-grid">
        <Panel icon={Sparkles} title="Siguiente accion recomendada" action="Ahora">
          <div className="next-action-card">
            <homeAction.icon size={20} />
            <div>
              <strong>{homeAction.title}</strong>
              <p>{homeAction.description}</p>
            </div>
            <button className="button primary compact" onClick={() => setView(homeAction.target)} type="button">
              Continuar
              <ArrowRight size={14} />
            </button>
          </div>
        </Panel>

        <Panel icon={Briefcase} title="Ultimas ofertas" action={`${recentJobs.length} recientes`}>
          {recentJobs.length ? (
            <div className="compact-list recent-jobs-list">
              {recentJobs.map((job) => (
                <CompactJob key={job.id} job={job} actionLabel="Ver detalle" onClick={() => setView("jobs")} />
              ))}
              <button className="button ghost compact recent-jobs-more" onClick={() => setView("jobs")} type="button">
                Ver todas
                <ArrowRight size={14} />
              </button>
            </div>
          ) : (
            <EmptyState
              icon={Search}
              title="Todavia no hay ofertas"
              text="Empieza con una busqueda multi-fuente y guarda oportunidades reales en tu bandeja."
              action="Buscar ofertas"
              onClick={() => setView("search")}
            />
          )}
        </Panel>
      </section>

      {profileProgress < 70 && (
        <section className="profile-banner compact-banner">
          <div>
            <UserRound size={20} />
            <div>
              <strong>Completa tu perfil para mejores resultados</strong>
              <span>Con habilidades, experiencia y rol objetivo, el analisis y los documentos salen mas precisos.</span>
            </div>
          </div>
          <button className="button primary" onClick={() => setView("profile")} type="button">
            Completar perfil
            <ArrowRight size={16} />
          </button>
        </section>
      )}
    </div>
  );
}


// ----------------------------------------------------------------------------
// Jobs view — bandeja con filtros claros
// ----------------------------------------------------------------------------
function JobsView({
  jobs,
  visibleJobs,
  documents,
  documentJobIds,
  filters,
  setFilters,
  selectedJob,
  setSelectedJobId,
  setView,
  onAnalyze,
  onGenerate,
  onStatus,
  onMarkApplied,
  profile,
}) {
  const counts = useMemo(() => buildFilterCounts(jobs, documentJobIds), [jobs, documentJobIds]);
  const selectedDocuments = selectedJob ? documents.filter((doc) => doc.job_id === selectedJob.id) : [];
  const profileProgress = profileCompletion(profile);

  function clearFilters() {
    setFilters({ category: "all", search: "", minScore: 0 });
  }

  return (
    <div className="jobs-page">
      <section className="jobs-list-panel">
        <div className="page-heading inline-heading">
          <div>
            <span className="eyebrow">Ofertas</span>
            <h1>Revisa oportunidades y decide el siguiente paso.</h1>
            <p>Filtra, abre el detalle, analiza compatibilidad y aplica manualmente desde la oferta original.</p>
          </div>
          <button className="button primary" onClick={() => setView("search")} type="button">
            <Plus size={16} />
            Buscar mas
          </button>
        </div>

        <div className="filters-panel">
          <div className="filter-segments" role="tablist" aria-label="Filtros">
            {JOB_FILTERS.map(({ key, label }) => (
              <button
                key={key}
                className={filters.category === key ? "active" : ""}
                onClick={() => setFilters({ ...filters, category: key })}
                type="button"
              >
                <span>{label}</span>
                <strong>{counts[key] || 0}</strong>
              </button>
            ))}
          </div>

          <div className="filter-controls">
            <label className="search-field">
              <Search size={16} />
              <input
                value={filters.search}
                placeholder="Buscar cargo, empresa o palabra"
                onChange={(e) => setFilters({ ...filters, search: e.target.value })}
              />
            </label>
            <button className="button secondary compact" onClick={clearFilters} type="button">
              <Filter size={15} />
              Limpiar
            </button>
          </div>
        </div>

        <div className="mobile-detail-panel">
          {selectedJob ? (
            <JobDetail
              job={selectedJob}
              documents={selectedDocuments}
              hasDocuments={documentJobIds.has(selectedJob.id)}
              profileProgress={profileProgress}
              onCompleteProfile={() => setView("profile")}
              onAnalyze={() => onAnalyze(selectedJob)}
              onGenerate={() => onGenerate(selectedJob)}
              onStatus={(status) => onStatus(selectedJob, status)}
              onMarkApplied={() => onMarkApplied(selectedJob)}
            />
          ) : (
            <EmptyState
              icon={Briefcase}
              title="Selecciona una oferta"
              text="Aqui veras compatibilidad, documentos y acciones."
            />
          )}
        </div>

        <div className="job-card-grid">
          {visibleJobs.map((job) => (
            <JobCard
              key={job.id}
              job={job}
              active={selectedJob?.id === job.id}
              hasDocuments={documentJobIds.has(job.id)}
              onSelect={() => setSelectedJobId(job.id)}
              onAnalyze={() => onAnalyze(job)}
              onGenerate={() => onGenerate(job)}
            />
          ))}

          {!visibleJobs.length && (
            <EmptyState
              icon={Search}
              title="Sin ofertas con esos filtros"
              text="Limpia los filtros o captura nuevas ofertas para ver más oportunidades."
              action="Limpiar filtros"
              onClick={clearFilters}
            />
          )}
        </div>
      </section>

      <aside className="job-detail-panel">
        {selectedJob ? (
          <JobDetail
            job={selectedJob}
            documents={selectedDocuments}
            hasDocuments={documentJobIds.has(selectedJob.id)}
            profileProgress={profileProgress}
            onCompleteProfile={() => setView("profile")}
            onAnalyze={() => onAnalyze(selectedJob)}
            onGenerate={() => onGenerate(selectedJob)}
            onStatus={(status) => onStatus(selectedJob, status)}
            onMarkApplied={() => onMarkApplied(selectedJob)}
          />
        ) : (
          <EmptyState
            icon={Briefcase}
            title="Selecciona una oferta"
            text="Aquí verás compatibilidad, brechas, documentos y el botón para marcar como aplicada."
          />
        )}
      </aside>
    </div>
  );
}

function JobCard({ job, active, hasDocuments, onSelect }) {
  return (
    <article className={`job-card ${active ? "active" : ""}`}>
      <button className="job-card-select" onClick={onSelect} type="button">
        <div className="job-card-top">
          <div>
            <h2>{job.title || "Cargo sin titulo"}</h2>
            <span>{job.company || "Empresa no indicada"}</span>
          </div>
          <ScorePill value={job.score} />
        </div>
        <div className="job-card-meta">
          <span><Globe2 size={14} />{job.source || "Fuente"}</span>
          <span><MapPin size={14} />{job.location || "Ubicación no indicada"}</span>
          <span><CalendarDays size={14} />{formatDate(job.first_seen_at || job.created_at)}</span>
        </div>
        <div className="job-card-footer">
          <div className="job-card-badges">
            {job.is_new && <span className="new-badge"><Sparkles size={12} /> Nueva</span>}
            <StatusBadge status={job.status} />
            {hasDocuments && <span className="status-badge active">Docs listos</span>}
          </div>
          <span className="detail-link">Ver detalle <ChevronRight size={14} /></span>
        </div>
      </button>
    </article>
  );
}

function JobMiniFlow({ stepIndex }) {
  // 5 dots: capturada | analizada | high-score? | docs | aplicada
  return (
    <div className="mini-workflow" aria-label="Progreso resumido">
      {[0, 1, 2, 3, 4].map((i) => (
        <span key={i} className={i <= stepIndex ? "done" : ""} />
      ))}
    </div>
  );
}

function JobDetail({
  job,
  documents,
  hasDocuments,
  profileProgress = 0,
  onCompleteProfile,
  onAnalyze,
  onGenerate,
  onStatus,
  onMarkApplied,
}) {
  const isAlreadyApplied = job.status === "Aplicada";
  const scoreText = scoreSummary(job.score);
  const profileIncomplete = profileProgress < 70;
  const lowScore = job.score != null && Number(job.score) < 60;
  const generateIsPrimary = !profileIncomplete && !lowScore && job.score != null;
  const openOriginalIsPrimary = !profileIncomplete && lowScore && Boolean(job.url);
  return (
    <div className="job-detail">
      <div className="detail-header">
        <div>
          <div className="job-card-badges">
            {job.is_new && <span className="new-badge"><Sparkles size={12} /> Nueva</span>}
            <StatusBadge status={job.status} />
          </div>
          <h2>{job.title || "Oferta sin titulo"}</h2>
          <p>{job.company || "Empresa no indicada"} · {job.source || "Fuente"} · {formatDate(job.first_seen_at || job.created_at)}</p>
        </div>
        <div className="detail-score-card">
          <ScorePill value={job.score} large />
          <span>{scoreText}</span>
        </div>
      </div>

      <div className="detail-actions">
        {profileIncomplete && onCompleteProfile && (
          <button className="button primary" onClick={onCompleteProfile} type="button">
            <UserRound size={16} />
            Completar perfil
          </button>
        )}
        {profileIncomplete && job.score == null && (
          <button className="button secondary" onClick={onAnalyze} type="button">
            <WandSparkles size={16} />
            Analizar ahora
          </button>
        )}
        {!profileIncomplete && job.score == null && (
          <button className="button primary" onClick={onAnalyze} type="button">
            <WandSparkles size={16} />
            Analizar compatibilidad
          </button>
        )}
        <button className={generateIsPrimary ? "button primary" : "button secondary"} onClick={onGenerate} type="button">
          <FileText size={16} />
          {hasDocuments ? "Regenerar CV/carta" : "Generar CV/carta"}
        </button>
        {job.url ? (
          <a className={openOriginalIsPrimary ? "button primary" : "button secondary"} href={job.url} target="_blank" rel="noreferrer">
            <ExternalLink size={16} />
            Abrir oferta original
          </a>
        ) : (
          <button className="button secondary" disabled type="button">
            <ExternalLink size={16} />
            Sin URL original
          </button>
        )}
        {!isAlreadyApplied && (
          <button className="button secondary" onClick={onMarkApplied} type="button">
            <CheckCircle2 size={16} />
            Marcar como aplicada
          </button>
        )}
        {job.score != null && (
          <button className="button ghost" onClick={onAnalyze} type="button">
            <RotateCcw size={16} />
            Recalcular
          </button>
        )}
      </div>

      {profileIncomplete && (
        <div className="profile-nudge">
          <UserRound size={16} />
          <div>
            <strong>Completa tu perfil para obtener un analisis mas preciso.</strong>
            <span>Los scores bajos pueden reflejar datos faltantes, no necesariamente una mala oportunidad.</span>
          </div>
        </div>
      )}

      <label className="field">
        <span>Estado</span>
        <select value={STATUSES.includes(job.status) ? job.status : "Nueva"} onChange={(e) => onStatus(e.target.value)}>
          {STATUSES.map((status) => (
            <option key={status} value={status}>{displayStatus(status)}</option>
          ))}
        </select>
      </label>

      <div className="detail-section-grid">
        <section>
          <h3>Por qué encaja</h3>
          {job.reasons?.length ? (
            <ul className="clean-list">
              {job.reasons.slice(0, 4).map((r) => <li key={r}>{r}</li>)}
            </ul>
          ) : (
            <p className="muted-line">Ejecuta el analisis para ver razones concretas.</p>
          )}
        </section>

        <section>
          <h3>Brechas a reforzar</h3>
          {job.gaps?.length ? (
            <div className="tag-row">
              {job.gaps.slice(0, 5).map((g) => <span key={g}>{g}</span>)}
            </div>
          ) : (
            <p className="muted-line">Sin brechas detectadas todavia.</p>
          )}
        </section>
      </div>

      <section className="detail-documents">
        <div className="section-title-row">
          <h3>CV y carta de esta oferta</h3>
          <span>{documents.length} archivos</span>
        </div>
        {documents.length ? (
          <div className="document-chip-list">
            {documents.map((doc) => (
              <a key={`${doc.id || doc.path}-${doc.created_at}`} href={documentViewUrl(doc)} target="_blank" rel="noreferrer">
                <FileText size={15} />
                {humanDocType(doc.doc_type)}
              </a>
            ))}
          </div>
        ) : (
          <p className="muted-line">Aun no hay CV ni carta. Genera los documentos cuando estes listo para aplicar.</p>
        )}
      </section>

      <details className="description-box">
        <summary>Ver descripcion guardada</summary>
        <p>{job.description || "Sin descripcion guardada."}</p>
      </details>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Saved Searches — Búsqueda automática
// ----------------------------------------------------------------------------
function SavedSearchesView({ showToast, reload }) {
  const [items, setItems] = useState([]);
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // null | "new" | id
  const [form, setForm] = useState(emptySavedSearchForm());

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const [savedData, sourcesData] = await Promise.all([
        request("/api/saved-searches"),
        request("/api/sources"),
      ]);
      setItems(savedData.saved_searches || []);
      setSources(Array.isArray(sourcesData) ? sourcesData : sourcesData.sources || []);
    } catch (error) {
      showToast(error.message, "error");
    } finally {
      setLoading(false);
    }
  }

  function startNew() {
    setForm({
      ...emptySavedSearchForm(),
      selected_sources: sources.filter((s) => s.enabled && s.configured).map((s) => s.id),
    });
    setEditing("new");
  }

  function startEdit(saved) {
    setForm({
      name: saved.name,
      query: saved.query,
      location: saved.location,
      remote_only: saved.remote_only,
      junior_only: saved.junior_only,
      internship_allowed: saved.internship_allowed,
      selected_sources: saved.selected_sources || [],
      date_filter: saved.date_filter,
      score_threshold: saved.score_threshold,
      interval_minutes: saved.interval_minutes,
      enabled: saved.enabled,
    });
    setEditing(saved.id);
  }

  function cancel() {
    setEditing(null);
  }

  async function save() {
    if (form.query.trim().length < 2) {
      showToast("La búsqueda necesita al menos 2 caracteres.", "error");
      return;
    }
    try {
      if (editing === "new") {
        await request("/api/saved-searches", { method: "POST", body: JSON.stringify(form) });
        showToast("Búsqueda guardada");
      } else {
        await request(`/api/saved-searches/${editing}`, { method: "PUT", body: JSON.stringify(form) });
        showToast("Búsqueda actualizada");
      }
      setEditing(null);
      await load();
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  async function remove(id) {
    if (!confirm("¿Eliminar esta búsqueda guardada?")) return;
    try {
      await request(`/api/saved-searches/${id}`, { method: "DELETE" });
      showToast("Búsqueda eliminada");
      await load();
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  async function runNow(id) {
    try {
      const result = await request(`/api/saved-searches/${id}/run`, { method: "POST" });
      const sr = result.search_result || {};
      showToast(`Ejecutada: ${sr.total_new || 0} nuevas, ${sr.total_updated || 0} actualizadas, ${sr.duplicates || 0} duplicadas`);
      await load();
      await reload();
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  async function toggleEnabled(saved) {
    try {
      await request(`/api/saved-searches/${saved.id}`, {
        method: "PUT",
        body: JSON.stringify({ ...saved, enabled: !saved.enabled }),
      });
      await load();
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  return (
    <div className="page-stack">
      <section className="page-heading inline-heading">
        <div>
          <span className="eyebrow">Busqueda automatica</span>
          <h1>Deja una busqueda corriendo para encontrar ofertas nuevas.</h1>
          <p>Crea reglas simples por rol, ubicacion y frecuencia. Cuando se ejecutan, guardan oportunidades nuevas en tu bandeja.</p>
        </div>
        <button className="button primary" onClick={startNew} type="button">
          <Plus size={16} />
          Crear busqueda automatica
        </button>
      </section>

      {editing !== null && (
        <Panel icon={editing === "new" ? Plus : Filter} title={editing === "new" ? "Crear busqueda automatica" : "Editar busqueda"} action="">
          <SavedSearchForm form={form} setForm={setForm} sources={sources} />
          <div className="form-footer">
            <button className="button ghost" onClick={cancel} type="button">Cancelar</button>
            <button className="button primary" onClick={save} type="button">
              <CheckCircle2 size={16} />
              {editing === "new" ? "Crear" : "Guardar cambios"}
            </button>
          </div>
        </Panel>
      )}

      <Panel icon={Bell} title="Busquedas automaticas" action={`${items.length} configuradas`}>
        {loading && <p className="muted-line">Cargando...</p>}
        {!loading && !items.length && (
          <EmptyState
            icon={Bell}
            title="No hay busquedas automaticas"
            text="Crea una busqueda para revisar fuentes de empleo de forma recurrente."
            action="Crear busqueda automatica"
            onClick={startNew}
          />
        )}
        {!loading && items.length > 0 && (
          <div className="saved-search-list">
            {items.map((saved) => (
              <article key={saved.id} className={`saved-search-item ${saved.enabled ? "" : "disabled"}`}>
                <header>
                  <div>
                    <strong>{saved.name}</strong>
                    <span>{saved.query} · {saved.location || "cualquier ubicacion"}</span>
                  </div>
                  <div className="saved-search-status">
                    {saved.enabled ? (
                      <span className="status-badge active">Activa</span>
                    ) : (
                      <span className="status-badge neutral">Pausada</span>
                    )}
                  </div>
                </header>
                <div className="saved-search-meta">
                  <span>Frecuencia: <strong>cada {saved.interval_minutes} min</strong></span>
                  <span>Ultima ejecucion: <strong>{saved.last_run_at ? formatDate(saved.last_run_at) : "Sin ejecutar"}</strong></span>
                  <span>Nuevas ofertas: <strong>{saved.last_run_status || "Sin datos"}</strong></span>
                  <span>Fuentes activas: <strong>{saved.selected_sources?.length || 0}</strong></span>
                </div>
                <div className="saved-search-actions">
                  <button className="button primary compact" onClick={() => runNow(saved.id)} type="button">
                    <Play size={14} /> Ejecutar ahora
                  </button>
                  <button className="button ghost compact" onClick={() => toggleEnabled(saved)} type="button">
                    {saved.enabled ? <><Pause size={14} /> Pausar</> : <><Play size={14} /> Reanudar</>}
                  </button>
                  <button className="button ghost compact" onClick={() => startEdit(saved)} type="button">
                    <Filter size={14} /> Editar
                  </button>
                  <button className="button ghost compact danger" onClick={() => remove(saved.id)} type="button">
                    <Trash2 size={14} /> Eliminar
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

function SavedSearchForm({ form, setForm, sources }) {
  function update(key, value) { setForm({ ...form, [key]: value }); }
  function toggleSource(id) {
    const has = form.selected_sources.includes(id);
    update("selected_sources", has ? form.selected_sources.filter((s) => s !== id) : [...form.selected_sources, id]);
  }

  return (
    <div className="form-grid">
      <Field label="Nombre" value={form.name} onChange={(v) => update("name", v)} placeholder="Java junior remoto" />
      <Field label="Búsqueda (query)" value={form.query} onChange={(v) => update("query", v)} placeholder="java junior" />
      <Field label="Ubicación" value={form.location} onChange={(v) => update("location", v)} placeholder="Remote, Bogotá..." />
      <Field
        label="Intervalo (minutos)"
        value={String(form.interval_minutes)}
        onChange={(v) => update("interval_minutes", Math.max(15, Math.min(1440, Number(v) || 360)))}
        placeholder="360"
      />
      <Field
        label="Score mínimo para alertar (0-100)"
        value={String(form.score_threshold)}
        onChange={(v) => update("score_threshold", Math.max(0, Math.min(100, Number(v) || 0)))}
        placeholder="70"
      />
      <Field label="Filtro de fecha" value={form.date_filter} onChange={(v) => update("date_filter", v)} placeholder="7d, 30d o vacío" />

      <div className="field-wide field-checkboxes">
        <label className="toggle-field">
          <input type="checkbox" checked={form.remote_only} onChange={(e) => update("remote_only", e.target.checked)} />
          <span>Solo remoto</span>
        </label>
        <label className="toggle-field">
          <input type="checkbox" checked={form.junior_only} onChange={(e) => update("junior_only", e.target.checked)} />
          <span>Solo junior</span>
        </label>
        <label className="toggle-field">
          <input type="checkbox" checked={form.internship_allowed} onChange={(e) => update("internship_allowed", e.target.checked)} />
          <span>Aceptar prácticas / internships</span>
        </label>
        <label className="toggle-field">
          <input type="checkbox" checked={form.enabled} onChange={(e) => update("enabled", e.target.checked)} />
          <span>Activa (se ejecuta automáticamente)</span>
        </label>
      </div>

      <div className="field-wide">
        <span className="field-label-block">Fuentes</span>
        <div className="source-picker">
          {sources.map((source) => (
            <label key={source.id} className={`source-option ${!source.configured ? "disabled" : ""}`} title={source.error || source.status}>
              <input
                type="checkbox"
                checked={form.selected_sources.includes(source.id)}
                disabled={!source.enabled || !source.configured}
                onChange={() => toggleSource(source.id)}
              />
              <span>
                <strong>{source.name}</strong>
                <small>{source.configured ? source.status : "No configurada"}</small>
              </span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Search view — 4 modos de captura en pestañas
// ----------------------------------------------------------------------------
function SearchView({ reload, showToast, setView }) {
  const [tab, setTab] = useState("auto");
  const [sources, setSources] = useState([]);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const data = await request("/api/sources");
        if (!active) return;
        setSources(Array.isArray(data) ? data : data.sources || []);
      } catch (error) {
        showToast(`No se pudieron cargar fuentes. ${error.message}`, "error");
      }
    }
    load();
    return () => { active = false; };
  }, []);

  const tabs = [
    { key: "auto", label: "Buscar por palabra clave", icon: Globe2 },
    { key: "url", label: "Pegar URL", icon: LinkIcon },
    { key: "linkedin", label: "Pegar texto", icon: FileText },
    { key: "manual", label: "Registrar manualmente", icon: Plus },
  ];

  return (
    <div className="page-stack">
      <section className="page-heading">
        <span className="eyebrow">Buscar ofertas</span>
        <h1>Encuentra ofertas reales y guardalas en tu bandeja.</h1>
        <p>La busqueda multi-fuente es el metodo principal. Tambien puedes pegar una URL, texto de una oferta o registrar una oportunidad manualmente.</p>
      </section>

      <div className="filter-segments capture-tabs" role="tablist" aria-label="Modo de captura">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            className={tab === key ? "active" : ""}
            onClick={() => setTab(key)}
            type="button"
          >
            <Icon size={14} />
            <span>{label}</span>
          </button>
        ))}
      </div>

      {tab === "auto" && <AutoSearchPanel sources={sources} reload={reload} showToast={showToast} setView={setView} />}
      {tab === "url" && <UrlImportPanel reload={reload} showToast={showToast} />}
      {tab === "linkedin" && <LinkedInTextPanel reload={reload} showToast={showToast} />}
      {tab === "manual" && <ManualPanel reload={reload} showToast={showToast} />}
    </div>
  );
}

function AutoSearchPanel({ sources, reload, showToast, setView }) {
  const [keywords, setKeywords] = useState("");
  const [location, setLocation] = useState("Remote");
  const [remoteOnly, setRemoteOnly] = useState(true);
  const [autoAnalyze, setAutoAnalyze] = useState(true);
  const [selectedSourceIds, setSelectedSourceIds] = useState([]);
  const [summary, setSummary] = useState(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    setSelectedSourceIds(sources.filter((s) => s.enabled && s.configured).map((s) => s.id));
  }, [sources]);

  const activeSourceNames = sources
    .filter((source) => selectedSourceIds.includes(source.id))
    .map((source) => source.name);

  function toggleSource(id) {
    setSelectedSourceIds((cur) => cur.includes(id) ? cur.filter((s) => s !== id) : [...cur, id]);
  }

  async function run() {
    if (keywords.trim().length < 2) {
      showToast("Escribe al menos 2 caracteres en la búsqueda.", "error");
      return;
    }
    if (!selectedSourceIds.length) {
      showToast("Activa al menos una fuente para buscar.", "error");
      return;
    }
    setRunning(true);
    try {
      const result = await request("/api/search/jobs", {
        method: "POST",
        body: JSON.stringify({
          query: keywords,
          location,
          remote_only: remoteOnly,
          internship_allowed: true,
          limit: 50,
          selected_sources: selectedSourceIds,
          auto_analyze: autoAnalyze,
          save_results: true,
        }),
      });
      setSummary(result);
      const newCount = result.total_new ?? 0;
      const updatedCount = result.total_updated ?? 0;
      showToast(
        newCount > 0
          ? `${newCount} ofertas nuevas guardadas, ${updatedCount} actualizadas`
          : `Sin nuevas. ${updatedCount} actualizadas, ${result.duplicates || 0} duplicadas.`,
      );
      await reload();
    } catch (error) {
      showToast(error.message, "error");
    } finally {
      setRunning(false);
    }
  }

  return (
    <Panel icon={Globe2} title="Buscar por palabra clave" action="Metodo principal">
      <div className="form-grid">
        <Field label="Rol o palabra clave" value={keywords} onChange={setKeywords} placeholder="java junior, react developer..." />
        <Field label="Ubicación" value={location} onChange={setLocation} placeholder="Remote, Colombia, Berlin..." />
        <div className="field-wide field-checkboxes">
          <label className="toggle-field">
            <input type="checkbox" checked={remoteOnly} onChange={(e) => setRemoteOnly(e.target.checked)} />
            <span>Solo remoto</span>
          </label>
          <label className="toggle-field">
            <input type="checkbox" checked={autoAnalyze} onChange={(e) => setAutoAnalyze(e.target.checked)} />
            <span>Analizar compatibilidad al guardar</span>
          </label>
        </div>
        <div className="field-wide source-inline">
          <span className="field-label-block">Fuentes activas</span>
          <strong>{activeSourceNames.length ? activeSourceNames.join(", ") : "Sin fuentes activas"}</strong>
          <details className="source-settings">
            <summary>Ajustar fuentes</summary>
            <div className="source-picker">
            {sources.map((source) => (
              <label key={source.id} className={`source-option ${!source.configured ? "disabled" : ""}`} title={source.error || source.status}>
                <input
                  type="checkbox"
                  checked={selectedSourceIds.includes(source.id)}
                  disabled={!source.enabled || !source.configured}
                  onChange={() => toggleSource(source.id)}
                />
                <span>
                  <strong>{source.name}</strong>
                  <small>{source.configured ? source.status : "No configurada"}</small>
                </span>
              </label>
            ))}
            {!sources.length && (
              <div className="empty-state compact">
                <Search size={18} />
                <strong>Fuentes no cargadas</strong>
                <p>Revisa la conexión del backend y vuelve a intentar.</p>
              </div>
            )}
            </div>
          </details>
        </div>
      </div>
      <div className="form-footer">
        <button className="button ghost" onClick={() => setView("saved")} type="button">
          <Bell size={16} />
          Convertir en búsqueda automática
        </button>
        <button className="button primary" onClick={run} disabled={running || !selectedSourceIds.length} type="button">
          <Search size={16} />
          {running ? "Buscando..." : "Buscar y guardar ahora"}
        </button>
      </div>

      {summary && (
        <div className="source-summary">
          <strong>
            {summary.total_found} encontradas · {summary.total_new ?? 0} nuevas · {summary.total_updated ?? 0} actualizadas · {summary.duplicates} duplicadas
          </strong>
          {summary.sources?.map((s) => (
            <span key={s.id} className={s.status === "ok" ? "ok" : "warn"}>
              {s.name}: {s.found} encontradas, {s.saved} guardadas
              {s.error ? ` · ${s.error}` : ""}
            </span>
          ))}
        </div>
      )}
    </Panel>
  );
}

function UrlImportPanel({ reload, showToast }) {
  const [url, setUrl] = useState("");
  const [useBrowser, setUseBrowser] = useState(false);

  const ready = isValidUrl(url);

  async function run() {
    if (!ready) {
      showToast("Pega una URL completa que empiece con http o https.", "error");
      return;
    }
    try {
      await request("/api/jobs/import-url", {
        method: "POST",
        body: JSON.stringify({ url, use_browser: useBrowser }),
      });
      setUrl("");
      showToast("Oferta importada desde URL");
      await reload();
    } catch (error) {
      showToast(`No se pudo importar. ${error.message}`, "error");
    }
  }

  return (
    <Panel icon={LinkIcon} title="Importar desde una URL" action="cuando ya tienes la oferta abierta">
      <div className="form-grid">
        <Field
          label="URL de la oferta"
          className="field-wide"
          value={url}
          onChange={setUrl}
          placeholder="https://empresa.com/jobs/..."
          error={url && !ready ? "URL inválida (debe empezar con http o https)." : ""}
        />
        <label className="toggle-field field-wide">
          <input type="checkbox" checked={useBrowser} onChange={(e) => setUseBrowser(e.target.checked)} />
          <span>Intentar lectura avanzada si la página es dinámica</span>
        </label>
      </div>
      <div className="form-footer">
        <button className="button primary" onClick={run} disabled={!ready} type="button">
          <Plus size={16} />
          Importar URL
        </button>
      </div>
    </Panel>
  );
}

function LinkedInTextPanel({ reload, showToast }) {
  const [rawText, setRawText] = useState("");
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");
  const [location, setLocation] = useState("");

  const ready = rawText.trim().length >= 80;

  async function run() {
    if (!ready) {
      showToast("Pega al menos 80 caracteres del contenido de la oferta.", "error");
      return;
    }
    try {
      await request("/api/jobs/import-text", {
        method: "POST",
        body: JSON.stringify({ raw_text: rawText, url, title, company, location }),
      });
      setRawText("");
      setUrl("");
      setTitle("");
      setCompany("");
      setLocation("");
      showToast("Oferta capturada desde texto pegado");
      await reload();
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  return (
    <Panel icon={FileText} title="Captura asistida (LinkedIn / Indeed)" action="sin login ni scraping">
      <p className="muted-line">
        Si la oferta está en LinkedIn u otro portal con login, ábrela en tu navegador, copia el contenido visible y pégalo aquí. El sistema extraerá título, empresa y descripción para que puedas analizarla y generar CV/carta.
      </p>
      <div className="form-grid">
        <Field
          label="Texto pegado de la oferta"
          textarea
          className="field-wide field-tall"
          value={rawText}
          onChange={setRawText}
          placeholder={"Pega aquí: título, empresa, ubicación, descripción, requisitos, beneficios..."}
          error={rawText && !ready ? "Pega al menos 80 caracteres." : ""}
        />
        <Field label="URL de la oferta (opcional)" value={url} onChange={setUrl} placeholder="https://www.linkedin.com/jobs/view/..." />
        <Field label="Título (opcional, override)" value={title} onChange={setTitle} placeholder="Senior Backend Engineer" />
        <Field label="Empresa (opcional)" value={company} onChange={setCompany} placeholder="Acme Corp" />
        <Field label="Ubicación (opcional)" value={location} onChange={setLocation} placeholder="Remote · Worldwide" />
      </div>
      <div className="form-footer">
        <button className="button primary" onClick={run} disabled={!ready} type="button">
          <CheckCircle2 size={16} />
          Capturar oferta
        </button>
      </div>
    </Panel>
  );
}

function ManualPanel({ reload, showToast }) {
  const [form, setForm] = useState({
    title: "",
    company: "",
    location: "",
    url: "",
    salary: "",
    tags: "",
    description: "",
  });

  const ready = form.title.trim().length > 2;

  async function save() {
    if (!ready) {
      showToast("Escribe al menos un cargo válido.", "error");
      return;
    }
    try {
      await request("/api/jobs/manual", { method: "POST", body: JSON.stringify(form) });
      setForm({ title: "", company: "", location: "", url: "", salary: "", tags: "", description: "" });
      showToast("Oferta manual guardada");
      await reload();
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  return (
    <Panel icon={Plus} title="Registrar oferta manualmente" action="cuando no se puede importar">
      <div className="form-grid">
        <Field label="Cargo" value={form.title} onChange={(v) => setForm({ ...form, title: v })} placeholder="Frontend Engineer" />
        <Field label="Empresa" value={form.company} onChange={(v) => setForm({ ...form, company: v })} />
        <Field label="Ubicación" value={form.location} onChange={(v) => setForm({ ...form, location: v })} placeholder="Remoto, Bogotá..." />
        <Field label="URL" value={form.url} onChange={(v) => setForm({ ...form, url: v })} />
        <Field label="Salario" value={form.salary} onChange={(v) => setForm({ ...form, salary: v })} placeholder="Opcional" />
        <Field label="Etiquetas" value={form.tags} onChange={(v) => setForm({ ...form, tags: v })} placeholder="React, remoto, senior" />
        <Field
          label="Descripción"
          textarea
          className="field-wide"
          value={form.description}
          onChange={(v) => setForm({ ...form, description: v })}
          placeholder="Pega responsabilidades, requisitos y beneficios."
        />
      </div>
      <div className="form-footer">
        <button className="button primary" onClick={save} disabled={!ready} type="button">
          <CheckCircle2 size={16} />
          Guardar oferta
        </button>
      </div>
    </Panel>
  );
}

// ----------------------------------------------------------------------------
// Documents view
// ----------------------------------------------------------------------------
function DocumentsView({ documents, jobs, onGenerate, setView, setSelectedJobId }) {
  const groups = useMemo(() => groupDocumentsByJob(documents, jobs), [documents, jobs]);
  const jobsWithDocs = new Set(documents.map((doc) => doc.job_id));
  const jobsWithoutDocs = jobs
    .filter((job) => !jobsWithDocs.has(job.id))
    .filter((job) => !["Aplicada", "Descartada"].includes(job.status))
    .filter((job) => (job.score || 0) >= 60)
    .slice(0, 8);

  return (
    <div className="page-stack">
      <section className="page-heading inline-heading">
        <div>
          <span className="eyebrow">Documentos</span>
          <h1>CV y cartas organizados por oferta.</h1>
          <p>Abre, descarga o regenera documentos sin revisar bloques repetidos por cada archivo.</p>
        </div>
        <button className="button primary" onClick={() => setView("jobs")} type="button">
          <ArrowRight size={16} />
          Ir a la bandeja
        </button>
      </section>

      <section className="content-grid documents-layout">
        <Panel icon={FileArchive} title="Documentos por oferta" action={`${groups.length} ofertas`}>
          <div className="document-group-list">
            {groups.map((group) => (
              <article className="document-group" key={group.key}>
                <header>
                  <div>
                    <strong>{group.title}</strong>
                    <span>{group.company} · {group.documents.length} documentos</span>
                  </div>
                  {group.job && <ScorePill value={group.job.score} />}
                </header>
                <DocumentGroupActions documents={group.documents} job={group.job} onRegenerate={onGenerate} />
                <div className="document-group-footer">
                  {group.job && <StatusBadge status={group.job.status} />}
                  {group.job && (
                    <button className="button ghost compact" onClick={() => { setSelectedJobId(group.job.id); setView("jobs"); }} type="button">
                      Ver oferta <ChevronRight size={14} />
                    </button>
                  )}
                </div>
              </article>
            ))}

            {!groups.length && (
              <EmptyState
                icon={FileArchive}
                title="Aún no hay documentos"
                text="Genera CV y carta desde la ficha de una oferta para que aparezcan aquí."
                action="Ir a la bandeja"
                onClick={() => setView("jobs")}
              />
            )}
          </div>
        </Panel>

        <Panel icon={WandSparkles} title="Sugeridas para preparar" action="buen match sin documentos">
          <div className="compact-list">
            {jobsWithoutDocs.map((job) => (
              <div className="automation-row" key={job.id}>
                <CompactJob job={job} />
                <button className="button secondary compact" onClick={() => onGenerate(job)} type="button">
                  <FileText size={15} /> Generar
                </button>
              </div>
            ))}
            {!jobsWithoutDocs.length && (
              <EmptyState
                icon={CheckCircle2}
                title="Todo esta cubierto"
                text="Todas las ofertas con buen match ya tienen documentos preparados o no hay pendientes."
              />
            )}
          </div>
        </Panel>
      </section>
    </div>
  );
}

function DocumentGroupActions({ documents, job, onRegenerate }) {
  const cvDoc = documents.find((doc) => doc.doc_type?.toLowerCase().includes("cv"));
  const letterDoc = documents.find((doc) => doc.doc_type?.toLowerCase().includes("carta"));

  return (
    <div className="document-action-grid">
      <DocumentAction doc={cvDoc} label="CV" />
      <DocumentAction doc={letterDoc} label="Carta" />
      <button
        className="button secondary compact"
        onClick={() => job && onRegenerate(job)}
        disabled={!job}
        type="button"
      >
        <RotateCcw size={15} />
        Regenerar documentos
      </button>
    </div>
  );
}

function DocumentAction({ doc, label }) {
  if (!doc) {
    return <span className="document-missing">{label} pendiente</span>;
  }
  return (
    <span className="document-action-pair">
      <a className="button ghost compact" href={documentViewUrl(doc)} target="_blank" rel="noreferrer">
        <Eye size={15} />
        Ver {label}
      </a>
      <a className="button ghost compact" href={documentDownloadUrl(doc)} download>
        <Download size={15} />
        Descargar {label}
      </a>
    </span>
  );
}

function DocumentRow({ doc, job, onRegenerate }) {
  return (
    <div className="document-row">
      <div className="document-row-main">
        <FileText size={17} />
        <span>
          <strong>{humanDocType(doc.doc_type)}</strong>
          <small>{formatDate(doc.created_at)} · {doc.filename || "archivo"}</small>
        </span>
      </div>
      <div className="document-actions">
        <a className="button ghost compact" href={documentViewUrl(doc)} target="_blank" rel="noreferrer">
          <Eye size={15} /> Ver
        </a>
        <a className="button ghost compact" href={documentDownloadUrl(doc)} download>
          <Download size={15} /> Descargar
        </a>
        <button
          className="button ghost compact"
          onClick={() => job && onRegenerate(job)}
          disabled={!job}
          type="button"
        >
          <RotateCcw size={15} /> Regenerar
        </button>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Profile view
// ----------------------------------------------------------------------------
function ProfileView({ profile, setProfile, reload, showToast }) {
  const [form, setForm] = useState(profile || {});
  useEffect(() => setForm(profile || {}), [profile]);

  const completion = profileCompletion(form);

  async function save() {
    try {
      const saved = await request("/api/profile", { method: "POST", body: JSON.stringify(form) });
      setProfile(saved);
      showToast("Perfil guardado");
      await reload();
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  function update(key, value) { setForm({ ...form, [key]: value }); }

  return (
    <div className="profile-page">
      <aside className="profile-aside">
        <UserRound size={30} />
        <span className="eyebrow">Perfil</span>
        <h2>{form.full_name || "Tu perfil profesional"}</h2>
        <p>La app usa estos datos para calcular compatibilidad y generar CV/carta por oferta.</p>
        <ProgressBar value={completion} label="Perfil completado" />
        <button className="button primary full-width" onClick={save} type="button">
          <CheckCircle2 size={16} />
          Guardar perfil
        </button>
      </aside>

      <section className="profile-form">
        <ProfileSection icon={UserRound} title="Informacion basica" description="Datos visibles en los documentos.">
          <Field label="Nombre completo" value={form.full_name} onChange={(v) => update("full_name", v)} />
        </ProfileSection>

        <ProfileSection icon={Target} title="Rol objetivo" description="Ayuda a priorizar ofertas y ajustar el mensaje.">
          <Field label="Rol objetivo" value={form.target_role} onChange={(v) => update("target_role", v)} placeholder="React Frontend Engineer" />
          <Field
            label="Resumen profesional"
            textarea
            className="field-wide"
            value={form.summary}
            onChange={(v) => update("summary", v)}
            placeholder="Describe tu experiencia, enfoque y logros principales."
          />
        </ProfileSection>

        <ProfileSection icon={Layers3} title="Habilidades" description="Tecnologias y herramientas separadas por coma o salto de linea.">
          <Field
            label="Habilidades y herramientas"
            textarea
            className="field-wide"
            value={form.skills}
            onChange={(v) => update("skills", v)}
            placeholder="React, TypeScript, Python, FastAPI, PostgreSQL..."
          />
        </ProfileSection>

        <ProfileSection icon={Briefcase} title="Experiencia" description="Responsabilidades y logros relevantes.">
          <Field
            label="Experiencia laboral"
            textarea
            className="field-wide"
            value={form.experience}
            onChange={(v) => update("experience", v)}
          />
        </ProfileSection>

        <ProfileSection icon={FileText} title="Educacion" description="Formacion, cursos o certificaciones.">
          <Field
            label="Educación"
            textarea
            className="field-wide"
            value={form.education}
            onChange={(v) => update("education", v)}
          />
        </ProfileSection>

        <ProfileSection icon={Sparkles} title="Proyectos" description="Productos, casos de uso o demos.">
          <Field
            label="Proyectos destacados"
            textarea
            className="field-wide"
            value={form.projects}
            onChange={(v) => update("projects", v)}
          />
        </ProfileSection>

        <ProfileSection icon={Globe2} title="Links" description="LinkedIn, GitHub, portafolio o sitio personal.">
          <Field
            label="Links profesionales"
            textarea
            className="field-wide"
            value={form.links}
            onChange={(v) => update("links", v)}
            placeholder="LinkedIn, GitHub, portafolio"
          />
        </ProfileSection>

        <ProfileSection icon={Filter} title="Preferencias" description="Palabras clave para priorizar al buscar y analizar.">
          <Field
            label="Palabras clave preferidas"
            textarea
            className="field-wide"
            value={form.keywords}
            onChange={(v) => update("keywords", v)}
            placeholder="Remote, SaaS, React, backend, startups..."
          />
        </ProfileSection>
      </section>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Settings view (sin bot, sin auto-apply)
// ----------------------------------------------------------------------------
function SettingsView({ overview }) {
  return (
    <div className="page-stack">
      <section className="page-heading">
        <span className="eyebrow">Configuracion</span>
        <h1>Estado tecnico de la app.</h1>
        <p>Informacion de soporte para revisar conexion, fuentes y servicios opcionales.</p>
      </section>

      <section className="settings-grid">
        <Panel icon={Database} title="Base de datos" action={overview?.health?.ok ? "conectada" : "revisar"}>
          <div className="settings-card">
            <StatusBadge status={overview?.health?.ok ? "Aplicada" : "Descartada"} label={overview?.health?.ok ? "Conectada" : "Con error"} />
            <strong>{overview?.health?.database_url || "URL no disponible"}</strong>
            {overview?.health?.error && <span>{overview.health.error}</span>}
          </div>
        </Panel>

        <Panel icon={Search} title="Fuentes de empleo" action="multi-fuente">
          <div className="settings-card">
            <StatusBadge status="Lista para aplicar" label="Activas" />
            <strong>Remotive · Arbeitnow · RemoteOK · Adzuna · SerpAPI</strong>
            <span>Las fuentes con API key requerida solo se activan si configuras sus variables de entorno.</span>
          </div>
        </Panel>

        <Panel icon={WandSparkles} title="Análisis de compatibilidad" action="local + IA opcional">
          <div className="settings-card">
            <StatusBadge status="Interesante" label="Disponible" />
            <strong>Heurística local activa</strong>
            <span>Si configuras OPENAI_API_KEY, podrás usar análisis con IA opcional desde la ficha de la oferta.</span>
          </div>
        </Panel>

        <Panel icon={Bell} title="Alertas por Telegram" action="próxima fase">
          <div className="settings-card">
            <StatusBadge status="Nueva" label="Configurable" />
            <strong>Configura TELEGRAM_BOT_TOKEN y TELEGRAM_CHAT_ID</strong>
            <span>El scheduler enviará alertas con las ofertas nuevas que superen el score mínimo de cada búsqueda guardada.</span>
          </div>
        </Panel>
      </section>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Reusable UI
// ----------------------------------------------------------------------------
function Panel({ icon: Icon, title, action, children }) {
  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          {Icon && <Icon size={18} />}
          <h2>{title}</h2>
        </div>
        {action && <span>{action}</span>}
      </div>
      {children}
    </section>
  );
}

function MetricCard({ icon: Icon, title, value, detail, tone = "blue" }) {
  return (
    <article className={`metric-card ${tone}`}>
      <div className="metric-icon">
        <Icon size={19} />
      </div>
      <strong>{value}</strong>
      <span>{title}</span>
      <p>{detail}</p>
    </article>
  );
}

function CompactJob({ job, actionLabel, onClick }) {
  const content = (
    <>
      <div className="compact-job-main">
        <strong>{job.title}</strong>
        <span>{job.company || "Empresa no indicada"} · {displayStatus(job.status)}</span>
      </div>
      <div className="compact-job-right">
        {job.is_new && <span className="new-badge tiny"><Sparkles size={10} /></span>}
        <ScorePill value={job.score} />
      </div>
    </>
  );

  if (onClick) {
    return (
      <button className="compact-job interactive" onClick={onClick} type="button">
        {content}
        {actionLabel && <small>{actionLabel}</small>}
      </button>
    );
  }
  return <div className="compact-job">{content}</div>;
}

function EmptyState({ icon: Icon = Sparkles, title, text, action, onClick }) {
  return (
    <div className="empty-state">
      <Icon size={22} />
      <strong>{title}</strong>
      <p>{text}</p>
      {action && (
        <button className="button secondary" onClick={onClick} type="button">{action}</button>
      )}
    </div>
  );
}

function StatusBadge({ status, label }) {
  return <span className={`status-badge ${statusClass(status)}`}>{label || displayStatus(status)}</span>;
}

function ScorePill({ value, large = false }) {
  const label = value == null ? "Sin analizar" : `${Math.round(value)}%`;
  return <span className={`score-pill ${scoreClass(value)} ${large ? "large" : ""}`}>{label}</span>;
}

function Field({ label, value = "", onChange, textarea = false, placeholder = "", error = "", className = "" }) {
  return (
    <label className={`field ${className} ${error ? "invalid" : ""}`}>
      <span>{label}</span>
      {textarea ? (
        <textarea value={value || ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      ) : (
        <input value={value || ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      )}
      {error && <small>{error}</small>}
    </label>
  );
}

function ProgressBar({ value, label }) {
  return (
    <div className="progress-block">
      <div>
        <span>{label}</span>
        <strong>{value}%</strong>
      </div>
      <div className="progress-track" aria-hidden="true">
        <span style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

function ProfileSection({ icon: Icon, title, description, children }) {
  return (
    <section className="profile-section">
      <div className="profile-section-heading">
        <Icon size={18} />
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </div>
      <div className="form-grid">{children}</div>
    </section>
  );
}

function DocumentTypeCard({ icon: Icon, title, text, count }) {
  return (
    <article className="document-type-card">
      <Icon size={20} />
      <strong>{title}</strong>
      <span>{count} generados</span>
      <p>{text}</p>
    </article>
  );
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------
function emptySavedSearchForm() {
  return {
    name: "",
    query: "",
    location: "",
    remote_only: false,
    junior_only: false,
    internship_allowed: false,
    selected_sources: [],
    date_filter: "",
    score_threshold: 70,
    interval_minutes: 360,
    enabled: true,
  };
}

function computeStepStatus({
  profileProgress,
  totalJobs,
  unanalyzedCount,
  highPriorityCount,
  documentsCount,
  appliedCount,
}) {
  const hasProfile = profileProgress >= 70;
  const hasJobs = totalJobs > 0;
  const allAnalyzed = hasJobs && unanalyzedCount === 0;
  const hasTop = highPriorityCount > 0;
  const hasDocs = documentsCount > 0;
  const hasApplied = appliedCount > 0;

  const states = [
    {
      key: "profile",
      done: hasProfile,
      detail: hasProfile ? "Perfil listo" : `${profileProgress}% completado`,
    },
    {
      key: "search",
      done: hasJobs,
      detail: hasJobs ? `${totalJobs} ofertas guardadas` : "Sin búsquedas aún",
    },
    {
      key: "review",
      done: hasJobs,
      detail: hasJobs ? "Bandeja activa" : "Captura primero",
    },
    {
      key: "analyze",
      done: hasJobs && allAnalyzed,
      detail: hasJobs ? (allAnalyzed ? "Todas analizadas" : `${unanalyzedCount} pendientes`) : "—",
    },
    {
      key: "top",
      done: hasTop,
      detail: hasTop ? `${highPriorityCount} con ≥80%` : "Aún no aparecen",
    },
    {
      key: "documents",
      done: hasDocs,
      detail: hasDocs ? `${documentsCount} documentos` : "Genera cuando estés listo",
    },
    {
      key: "apply",
      done: hasApplied,
      detail: hasApplied ? `${appliedCount} aplicadas` : "Tú aplicas afuera",
    },
  ];

  // Mark current step (first not done).
  const firstPendingIdx = states.findIndex((s) => !s.done);
  return FLOW_STEPS.map((flow, idx) => {
    const s = states[idx];
    let state = s.done ? "done" : "pending";
    if (!s.done && firstPendingIdx === idx) state = "current";
    return {
      ...flow,
      state,
      detail: s.detail,
      tooltip: `${flow.label}${s.detail ? " — " + s.detail : ""}`,
    };
  });
}

function buildPrimaryRecommendation({ nextStep, totalJobs, unanalyzedCount, highPriorityCount, documentsCount, profileProgress }) {
  switch (nextStep?.key) {
    case "profile":
      return { title: "completar tu perfil", description: `Tu perfil está al ${profileProgress}%.`, target: "profile", icon: UserRound, cta: "Completar perfil" };
    case "search":
      return { title: "buscar tus primeras ofertas", description: "Configura una búsqueda multi-fuente para llenar tu bandeja.", target: "search", icon: Search, cta: "Buscar ofertas" };
    case "review":
      return { title: "revisar la bandeja", description: `Tienes ${totalJobs} ofertas esperando.`, target: "jobs", icon: ListChecks, cta: "Abrir bandeja" };
    case "analyze":
      return { title: "analizar compatibilidad", description: `${unanalyzedCount} ofertas todavía no tienen score.`, target: "jobs", icon: WandSparkles, cta: "Ir a analizar" };
    case "top":
      return { title: "encontrar mejores oportunidades", description: "Captura más ofertas o ajusta tu perfil para subir los scores.", target: "search", icon: Target, cta: "Capturar más" };
    case "documents":
      return { title: "generar CV y carta", description: `${highPriorityCount} ofertas con alta compatibilidad listas para preparar.`, target: "jobs", icon: FileText, cta: "Ir a generar" };
    case "apply":
    default:
      return { title: "aplicar manualmente", description: `Tienes ${documentsCount} documentos listos. Abre la oferta original y postúlate.`, target: "jobs", icon: ExternalLink, cta: "Ver ofertas listas" };
  }
}

function buildFilterCounts(jobs, documentJobIds) {
  return {
    all: jobs.length,
    new: jobs.filter((j) => j.is_new).length,
    good: jobs.filter((j) => (j.score || 0) >= 60 && !["Aplicada", "Descartada"].includes(j.status)).length,
    docs: jobs.filter((j) => documentJobIds.has(j.id)).length,
    applied: jobs.filter((j) => j.status === "Aplicada").length,
  };
}

function filterJobs(jobs, filters, documentJobIds) {
  const query = filters.search.trim().toLowerCase();
  return jobs.filter((job) => {
    const haystack = [
      job.title,
      job.company,
      job.location,
      job.description,
      ...(Array.isArray(job.tags) ? job.tags : []),
    ].filter(Boolean).join(" ").toLowerCase();

    const matchesQuery = !query || haystack.includes(query);
    const matchesScore = !filters.minScore || (job.score || 0) >= Number(filters.minScore);

    const cat = filters.category;
    const matchesCategory =
      cat === "all" ||
      (cat === "new" && job.is_new) ||
      (cat === "good" && (job.score || 0) >= 60 && !["Aplicada", "Descartada"].includes(job.status)) ||
      (cat === "docs" && documentJobIds.has(job.id)) ||
      (cat === "applied" && job.status === "Aplicada");

    return matchesQuery && matchesScore && matchesCategory;
  });
}

function profileCompletion(profile = {}) {
  const fields = ["full_name", "target_role", "summary", "skills", "experience", "education", "projects", "links", "keywords"];
  const completed = fields.filter((f) => String(profile?.[f] || "").trim().length > 0).length;
  return Math.round((completed / fields.length) * 100);
}

function computeJobStepIndex(job, hasDocs) {
  // 0 capturada, 1 analizada, 2 high, 3 docs, 4 aplicada
  if (job.status === "Aplicada") return 4;
  if (hasDocs || job.status === "Lista para aplicar") return 3;
  if ((job.score || 0) >= 80) return 2;
  if (job.score != null) return 1;
  return 0;
}

function groupDocumentsByJob(documents, jobs) {
  const jobsById = new Map(jobs.map((j) => [j.id, j]));
  const groups = new Map();
  documents.forEach((doc) => {
    const job = jobsById.get(doc.job_id);
    const key = doc.job_id || `${doc.job_title}-${doc.company}`;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        job,
        title: job?.title || doc.job_title || "Oferta sin título",
        company: job?.company || doc.company || "Empresa no indicada",
        documents: [],
      });
    }
    groups.get(key).documents.push(doc);
  });
  return Array.from(groups.values());
}

function displayStatus(status = "") {
  return STATUS_LABELS[status] || status || "Sin estado";
}

function humanDocType(type = "") {
  const n = type.toLowerCase();
  if (n.includes("cv")) return type.includes("PDF") ? "CV PDF" : "CV editable";
  if (n.includes("carta")) return type.includes("PDF") ? "Carta PDF" : "Carta editable";
  return type || "Documento";
}

function statusClass(status = "") {
  if (["Aplicada"].includes(status)) return "success";
  if (["Lista para aplicar", "Aprobada"].includes(status)) return "active";
  if (["Interesante"].includes(status)) return "active";
  if (["Descartada", "Error"].includes(status)) return "danger";
  if (["Captcha requerido", "Necesita revision"].includes(status)) return "warning";
  return "neutral";
}

function scoreClass(value) {
  if (value == null) return "neutral";
  if (value >= 80) return "high";
  if (value >= 60) return "medium";
  return "low";
}

function scoreSummary(value) {
  if (value == null) return "Analisis pendiente";
  if (value >= 80) return "Match fuerte";
  if (value >= 60) return "Buen match";
  if (value >= 40) return "Match parcial";
  return "Bajo encaje";
}

function formatDate(value) {
  if (!value) return "sin fecha";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("es-CO", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

function isValidUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol);
  } catch {
    return false;
  }
}

createRoot(document.getElementById("root")).render(<App />);

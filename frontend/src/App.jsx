import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity, AlertCircle, ArrowRight, Bell, Briefcase,
  CalendarDays, CheckCircle2, ChevronRight, Database, Download,
  ExternalLink, Eye, FileArchive, FileText, Filter, Gauge, Globe2, Layers3,
  History, Link as LinkIcon, ListChecks, MapPin, Menu, Moon, Pause, Play, Plus,
  RadioTower, RefreshCw, RotateCcw, Search, Sparkles, Sun, Target, Trash2, UserRound,
  WandSparkles, X, AlertTriangle,
} from "lucide-react";
import { documentDownloadUrl, documentViewUrl, request } from "./api";
import ErrorBoundary from "./components/ErrorBoundary";
import { FLOW_STEPS, JOB_FILTERS, NAV_ITEMS, STATUSES, STATUS_LABELS, THEME_KEY } from "./constants";
import "./styles.css";

function getInitialTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  return saved === "light" || saved === "dark" ? saved : "light";
}

// ============================================================
// App root
// ============================================================
export default function App() {
  const [view, setView]                   = useState("dashboard");
  const [overview, setOverview]           = useState(null);
  const [jobs, setJobs]                   = useState([]);
  const [documents, setDocuments]         = useState([]);
  const [profile, setProfile]             = useState(null);
  const [selectedJobId, setSelectedJobId] = useState(null);
  const [filters, setFilters]             = useState({ category: "new", search: "", minScore: 0 });
  const [toast, setToast]                 = useState(null);
  const [loading, setLoading]             = useState(true);
  const [theme, setTheme]                 = useState(getInitialTheme);
  const [navOpen, setNavOpen]             = useState(false);
  const [actionBusy, setActionBusy]       = useState({});

  const documentJobIds = useMemo(
    () => new Set(documents.map((d) => d.job_id).filter(Boolean)),
    [documents],
  );

  const visibleJobs = useMemo(
    () => filterJobs(jobs, filters, documentJobIds),
    [jobs, filters, documentJobIds],
  );

  const selectedJob = useMemo(() => {
    if (!visibleJobs.length) return null;
    if (!selectedJobId) return visibleJobs[0];
    return visibleJobs.find((j) => j.id === selectedJobId) || visibleJobs[0];
  }, [selectedJobId, visibleJobs]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    if (!toast) return undefined;
    const t = window.setTimeout(() => setToast(null), 4500);
    return () => window.clearTimeout(t);
  }, [toast]);

  const showToast = useCallback((message, type = "success") => setToast({ message, type }), []);

  const runWithBusy = useCallback(async (key, task) => {
    setActionBusy((current) => ({ ...current, [key]: true }));
    try {
      return await task();
    } finally {
      setActionBusy((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    }
  }, []);

  const loadAll = useCallback(async (options = {}) => {
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
      setSelectedJobId((cur) => cur || jobsData.jobs?.[0]?.id || null);
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  const updateStatus = useCallback(async (job, status) => {
    return runWithBusy(`status:${job.id}`, async () => {
      try {
        const updated = await request(`/api/jobs/${job.id}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
        setSelectedJobId(updated.id);
        showToast(`Estado: ${displayStatus(status)}`);
        await loadAll({ silent: true });
      } catch (err) { showToast(err.message, "error"); }
    });
  }, [loadAll, runWithBusy, showToast]);

  const analyze = useCallback(async (job) => {
    return runWithBusy(`analyze:${job.id}`, async () => {
      try {
        await request(`/api/jobs/${job.id}/analyze`, { method: "POST", body: JSON.stringify({ use_ai: false }) });
        showToast("Compatibilidad calculada");
        await loadAll({ silent: true });
      } catch (err) { showToast(err.message, "error"); }
    });
  }, [loadAll, runWithBusy, showToast]);

  const analyzeMany = useCallback(async (items) => {
    const candidates = items.filter((job) => job?.id && job.status !== "Descartada");
    if (!candidates.length) {
      showToast("No hay ofertas pendientes para analizar.", "error");
      return;
    }
    return runWithBusy("analyze:bulk", async () => {
      let ok = 0;
      let failed = 0;
      for (const job of candidates) {
        try {
          await request(`/api/jobs/${job.id}/analyze`, { method: "POST", body: JSON.stringify({ use_ai: false }) });
          ok += 1;
        } catch {
          failed += 1;
        }
      }
      if (ok) showToast(`Analizadas ${ok} ofertas${failed ? `, ${failed} con error` : ""}`);
      if (!ok && failed) showToast("No se pudo analizar ninguna oferta.", "error");
      await loadAll({ silent: true });
    });
  }, [loadAll, runWithBusy, showToast]);

  const generateDocuments = useCallback(async (job) => {
    return runWithBusy(`documents:${job.id}`, async () => {
      try {
        await request(`/api/jobs/${job.id}/documents`, { method: "POST" });
        showToast("CV y carta generados");
        await loadAll({ silent: true });
      } catch (err) { showToast(err.message, "error"); }
    });
  }, [loadAll, runWithBusy, showToast]);

  const markAsApplied = useCallback(async (job) => {
    return runWithBusy(`apply:${job.id}`, async () => {
      try {
        await request(`/api/jobs/${job.id}/apply`, { method: "POST" });
        showToast("Marcada como aplicada");
        await loadAll({ silent: true });
      } catch (err) { showToast(err.message, "error"); }
    });
  }, [loadAll, runWithBusy, showToast]);

  const markViewed = useCallback(async (job) => {
    if (job.viewed) return;
    try {
      await request(`/api/jobs/${job.id}/viewed`, { method: "PATCH" });
      await loadAll({ silent: true });
    } catch { /* silent */ }
  }, [loadAll]);

  const discardJob = useCallback(async (job) => {
    return runWithBusy(`discard:${job.id}`, async () => {
      try {
        await request(`/api/jobs/${job.id}/discard`, { method: "POST" });
        setSelectedJobId(null);
        showToast("Oferta descartada");
        await loadAll({ silent: true });
      } catch (err) { showToast(err.message, "error"); }
    });
  }, [loadAll, runWithBusy, showToast]);

  useEffect(() => { loadAll(); }, [loadAll]);

  function navigate(target) {
    setView(target);
    setNavOpen(false);
  }

  const newJobsCount = jobs.filter((j) => !j.viewed).length;

  return (
    <div className="app-shell">
      {/* Sidebar overlay for mobile */}
      {navOpen && <div className="sb-overlay" onClick={() => setNavOpen(false)} />}

      {/* Sidebar */}
      <Sidebar
        view={view}
        navigate={navigate}
        overview={overview}
        theme={theme}
        toggleTheme={() => setTheme((t) => t === "dark" ? "light" : "dark")}
        onRefresh={() => loadAll({ silent: true })}
        navOpen={navOpen}
        newCount={newJobsCount}
      />

      {/* Main content */}
      <div className="main-col">
        {/* Mobile top bar */}
        <div className="mobile-bar">
          <div className="mobile-bar-logo">AJ</div>
          <span className="mobile-bar-title">AutoJob Assistant</span>
          <button className="mobile-bar-btn" onClick={() => setTheme((t) => t === "dark" ? "light" : "dark")} type="button">
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <button className="mobile-bar-btn" onClick={() => setNavOpen((o) => !o)} type="button" aria-label="Menú">
            {navOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>

        {/* Toast */}
        {toast && (
          <div className="toast-wrap">
            <button className={`toast ${toast.type}`} onClick={() => setToast(null)} type="button">
              {toast.type === "error"
                ? <AlertCircle size={15} />
                : <CheckCircle2 size={15} />}
              {toast.message}
            </button>
          </div>
        )}

        {/* Page content */}
        <div className="page-scroll" id="main-content">
          {loading && !overview ? (
            <div className="loading-center" style={{ height: "100%" }}>
              <div className="spinner" />
              Cargando AutoJob Assistant...
            </div>
          ) : (
            <ErrorBoundary key={view}>
              {view === "dashboard" && (
                <Dashboard overview={overview} jobs={jobs} documents={documents} profile={profile} setView={navigate} />
              )}
              {view === "jobs" && (
                <JobsView
                  jobs={jobs} visibleJobs={visibleJobs} documents={documents}
                  documentJobIds={documentJobIds} filters={filters} setFilters={setFilters}
                  selectedJob={selectedJob} setSelectedJobId={setSelectedJobId}
                  setView={navigate} profile={profile}
                  onAnalyze={analyze} onGenerate={generateDocuments}
                  onStatus={updateStatus} onMarkApplied={markAsApplied}
                  onView={markViewed} onDiscard={discardJob}
                  actionBusy={actionBusy}
                />
              )}
              {view === "analysis" && (
                <AnalysisView
                  jobs={jobs}
                  documents={documents}
                  actionBusy={actionBusy}
                  onAnalyze={analyze}
                  onAnalyzeMany={analyzeMany}
                  onGenerate={generateDocuments}
                  setView={navigate}
                  setSelectedJobId={setSelectedJobId}
                />
              )}
              {view === "sources" && (
                <SourcesView showToast={showToast} setView={navigate} />
              )}
              {view === "saved" && (
                <SavedSearchesView showToast={showToast} reload={() => loadAll({ silent: true })} />
              )}
              {view === "search" && (
                <SearchView reload={() => loadAll({ silent: true })} showToast={showToast} setView={navigate} profile={profile} />
              )}
              {view === "documents" && (
                <DocumentsView documents={documents} jobs={jobs} onGenerate={generateDocuments} setView={navigate} setSelectedJobId={setSelectedJobId} />
              )}
              {view === "profile" && (
                <ProfileView profile={profile} setProfile={setProfile} reload={() => loadAll({ silent: true })} showToast={showToast} />
              )}
              {view === "history" && (
                <HistoryView showToast={showToast} setView={navigate} setSelectedJobId={setSelectedJobId} />
              )}
              {view === "settings" && <SettingsView overview={overview} />}
            </ErrorBoundary>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Sidebar
// ============================================================
function Sidebar({ view, navigate, overview, theme, toggleTheme, onRefresh, navOpen, newCount }) {
  const healthOk = overview?.health?.ok;
  const groups = [
    { key: "primary",   label: "Principal" },
    { key: "secondary", label: "Herramientas" },
    { key: "technical", label: "Sistema" },
  ];

  return (
    <nav className={`sidebar ${navOpen ? "mobile-open" : ""}`} aria-label="Navegación principal">
      <div className="sb-brand">
        <div className="sb-logo">AJ</div>
        <div className="sb-title">
          <strong>AutoJob</strong>
          <span>Assistant</span>
        </div>
      </div>

      <div className="sb-nav">
        {groups.map((g) => (
          <div key={g.key} className="sb-group">
            <div className="sb-group-label">{g.label}</div>
            {NAV_ITEMS.filter((item) => item.group === g.key).map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                className={`sb-item ${view === key ? "active" : ""}`}
                onClick={() => navigate(key)}
                type="button"
              >
                <Icon size={16} />
                <span style={{ flex: 1 }}>{label}</span>
                {key === "jobs" && newCount > 0 && (
                  <span className="sb-badge">{newCount}</span>
                )}
              </button>
            ))}
          </div>
        ))}
      </div>

      <div className="sb-footer">
        <div className={`sb-health ${healthOk ? "ok" : "bad"}`} title={overview?.health?.database_url || ""}>
          <div className="sb-dot" />
          <span className="truncate" style={{ fontSize: 11 }}>
            {healthOk ? "DB conectada" : "Revisar DB"}
          </span>
        </div>
        <button className="sb-icon-btn" onClick={toggleTheme} title="Cambiar tema" type="button">
          {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
        </button>
        <button className="sb-icon-btn" onClick={onRefresh} title="Actualizar datos" type="button">
          <RefreshCw size={15} />
        </button>
      </div>
    </nav>
  );
}

// ============================================================
// Dashboard
// ============================================================
function Dashboard({ overview, jobs, documents, profile, setView }) {
  const profileProgress = profileCompletion(profile);
  const counts = overview?.counts || {};
  const totalJobs        = overview?.total_jobs || 0;
  const unanalyzedCount  = overview?.unanalyzed_count || 0;
  const highPriorityCount= overview?.high_priority_count || 0;
  const documentsCount   = overview?.documents_count || documents.length || 0;
  const appliedCount     = overview?.applied_count || counts.Aplicada || 0;

  const stepStatus = computeStepStatus({ profileProgress, totalJobs, unanalyzedCount, highPriorityCount, documentsCount, appliedCount });
  const nextStep   = stepStatus.find((s) => s.state === "current") || stepStatus[stepStatus.length - 1];
  const recommendation = buildPrimaryRecommendation({ nextStep, totalJobs, unanalyzedCount, highPriorityCount, documentsCount, profileProgress });
  const homeAction = profileProgress < 70
    ? { title: "Completa tu perfil", description: "Con habilidades y experiencia, el score y los documentos serán más precisos.", target: "profile", icon: UserRound, cta: "Ir al perfil" }
    : recommendation;

  const activeJobs = jobs.filter((j) => !["Aplicada", "Descartada"].includes(j.status));
  const pendingCount = activeJobs.filter((j) => !j.viewed || j.score == null).length;
  const bestScore    = jobs.reduce((b, j) => (j.score == null ? b : Math.max(b, Number(j.score))), -1);
  const recentJobs   = (overview?.new_jobs?.length ? overview.new_jobs : overview?.recent_jobs || jobs).slice(0, 5);

  const metrics = [
    { icon: Briefcase, label: "Ofertas guardadas",    value: totalJobs,       detail: "En tu bandeja",          color: "blue" },
    { icon: ListChecks, label: "Pendientes",          value: pendingCount,    detail: "Sin revisar o analizar", color: "amber" },
    { icon: FileArchive, label: "Documentos",         value: documentsCount,  detail: "CV y cartas generados",  color: "violet" },
    { icon: Target, label: "Mejor match",             value: bestScore >= 0 ? `${Math.round(bestScore)}%` : "—", detail: bestScore >= 60 ? "Listo para aplicar" : "Mejora el perfil", color: "green" },
  ];

  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <div className="page-header-row">
        <div className="page-header">
          <span className="eyebrow">Inicio</span>
          <h1>{homeAction.title}</h1>
          <p>{homeAction.description}</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          <button className="btn btn-primary" onClick={() => setView(homeAction.target)} type="button">
            <homeAction.icon size={15} />
            {homeAction.cta}
          </button>
          <button className="btn btn-secondary" onClick={() => setView("search")} type="button">
            <Search size={15} />
            Buscar ofertas
          </button>
        </div>
      </div>

      {/* Metrics */}
      <div className="metrics-grid mb-4">
        {metrics.map((m) => (
          <div key={m.label} className="metric-card">
            <div className={`metric-icon ${m.color}`}><m.icon size={17} /></div>
            <div className="metric-value">{m.value}</div>
            <div className="metric-label">{m.label}</div>
            <div className="metric-detail">{m.detail}</div>
          </div>
        ))}
      </div>

      {/* Two-column content */}
      <div className="dash-grid">
        <div className="dash-left">
          {/* Next action hero */}
          <div className="hero-card">
            <h2>Siguiente acción</h2>
            <p>{nextStep?.label || "Completar flujo"} — {nextStep?.detail || ""}</p>
            <div className="hero-actions">
              <button className="btn btn-glass" onClick={() => setView(homeAction.target)} type="button">
                <homeAction.icon size={15} />
                {homeAction.cta}
              </button>
              <button className="btn btn-glass-outline" onClick={() => setView("search")} type="button">
                <Search size={15} />
                Buscar más
              </button>
            </div>
          </div>

          {/* Recent jobs */}
          <div className="card">
            <div className="card-header">
              <div className="card-icon"><Briefcase size={15} /></div>
              <span className="card-title">Últimas ofertas</span>
              <span className="card-meta">{recentJobs.length} recientes</span>
            </div>
            <div className="card-body" style={{ padding: "0 18px" }}>
              {recentJobs.length ? (
                <>
                  <div className="compact-list">
                    {recentJobs.map((job) => (
                      <div key={job.id} className="compact-job">
                        <div className="compact-job-info">
                          <div className="compact-job-title">{job.title}</div>
                          <div className="compact-job-meta">{job.company} · {job.source}</div>
                        </div>
                        <ScorePill value={job.score} />
                      </div>
                    ))}
                  </div>
                  <div style={{ padding: "12px 0" }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => setView("jobs")} type="button">
                      Ver todas <ArrowRight size={13} />
                    </button>
                  </div>
                </>
              ) : (
                <EmptyState icon={Search} title="Sin ofertas aún" text="Busca tu primera oportunidad." action="Buscar" onClick={() => setView("search")} />
              )}
            </div>
          </div>
        </div>

        <div className="dash-right">
          {/* Profile card */}
          <div className="profile-sidebar">
            <div className="profile-sidebar-top">
              <div className="profile-avatar"><UserRound size={18} /></div>
              <div>
                <div className="profile-avatar-name">{profile?.full_name || "Tu nombre"}</div>
                <div className="profile-avatar-role">{profile?.target_role || "Sin rol objetivo"}</div>
              </div>
            </div>
            <div className="mb-3">
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontSize: 12, color: "var(--text-3)" }}>Perfil completado</span>
                <span style={{ fontSize: 12, fontWeight: 600 }}>{profileProgress}%</span>
              </div>
              <div className="progress-track">
                <div
                  className={`progress-fill ${profileProgress < 40 ? "bad" : profileProgress < 70 ? "warn" : ""}`}
                  style={{ width: `${profileProgress}%` }}
                />
              </div>
            </div>
            <button className="btn btn-secondary btn-sm" style={{ width: "100%" }} onClick={() => setView("profile")} type="button">
              {profileProgress < 70 ? "Completar perfil" : "Editar perfil"} <ArrowRight size={13} />
            </button>
          </div>

          {/* Counts card */}
          <div className="card">
            <div className="card-header">
              <div className="card-icon"><Gauge size={15} /></div>
              <span className="card-title">Por estado</span>
            </div>
            <div className="card-body" style={{ padding: "12px 18px" }}>
              {STATUSES.filter((s) => s !== "Descartada").map((s) => (
                <div key={s} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid var(--border-soft)", fontSize: 13 }}>
                  <span style={{ color: "var(--text-2)" }}>{s}</span>
                  <span style={{ fontWeight: 600 }}>{counts[s] || 0}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Profile nudge */}
      {profileProgress < 70 && (
        <div className="profile-nudge mt-4">
          <AlertTriangle size={16} />
          <div>
            <strong>Completa tu perfil para mejores resultados</strong>
            <span> Con habilidades y experiencia el análisis y los documentos serán más precisos.</span>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={() => setView("profile")} type="button">
            Ir al perfil
          </button>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Jobs View
// ============================================================
function JobsView({ jobs, visibleJobs, documents, documentJobIds, filters, setFilters, selectedJob, setSelectedJobId, setView, onAnalyze, onGenerate, onStatus, onMarkApplied, onView, onDiscard, profile, actionBusy }) {
  const counts = useMemo(() => buildFilterCounts(jobs, documentJobIds), [jobs, documentJobIds]);
  const selectedDocuments = selectedJob ? documents.filter((d) => d.job_id === selectedJob.id) : [];
  const profileProgress   = profileCompletion(profile);

  function clearFilters() { setFilters({ category: "all", search: "", minScore: 0 }); }

  return (
    <div className="jobs-layout">
      {/* List column */}
      <div className="jobs-list-col">
        <div className="jobs-list-head">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <h2 className="jobs-list-head" style={{ border: "none", padding: 0 }}>
              Ofertas <span style={{ fontSize: 12, fontWeight: 400, color: "var(--text-3)" }}>({visibleJobs.length})</span>
            </h2>
            <button className="btn btn-primary btn-sm" onClick={() => setView("search")} type="button">
              <Plus size={14} /> Buscar
            </button>
          </div>

          {/* Filter tabs */}
          <div className="filter-tabs mb-3">
            {JOB_FILTERS.map(({ key, label }) => (
              <button
                key={key}
                className={`filter-tab ${filters.category === key ? "active" : ""}`}
                onClick={() => setFilters({ ...filters, category: key })}
                type="button"
              >
                {label}
                <span className="filter-tab-count">{counts[key] || 0}</span>
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="search-wrap">
            <Search size={14} />
            <input
              value={filters.search}
              placeholder="Buscar cargo, empresa..."
              onChange={(e) => setFilters({ ...filters, search: e.target.value })}
              style={{ fontSize: 13 }}
            />
          </div>
        </div>

        <div className="jobs-list-body">
          {visibleJobs.length === 0 ? (
            <EmptyState icon={Search} title="Sin resultados" text="Prueba con otros filtros." action="Limpiar filtros" onClick={clearFilters} />
          ) : (
            visibleJobs.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                active={selectedJob?.id === job.id}
                hasDocuments={documentJobIds.has(job.id)}
                onSelect={() => setSelectedJobId(job.id)}
              />
            ))
          )}
        </div>
      </div>

      {/* Detail column */}
      <div className="job-detail-col">
        {selectedJob ? (
          <div className="job-detail-scroll">
            <JobDetail
              job={selectedJob}
              documents={selectedDocuments}
              hasDocuments={documentJobIds.has(selectedJob.id)}
              profileProgress={profileProgress}
              onCompleteProfile={() => setView("profile")}
              onAnalyze={() => onAnalyze(selectedJob)}
              onGenerate={() => onGenerate(selectedJob)}
              onStatus={(s) => onStatus(selectedJob, s)}
              onMarkApplied={() => onMarkApplied(selectedJob)}
              onView={() => onView(selectedJob)}
              onDiscard={() => onDiscard(selectedJob)}
              busy={{
                analyze: Boolean(actionBusy[`analyze:${selectedJob.id}`]),
                generate: Boolean(actionBusy[`documents:${selectedJob.id}`]),
                status: Boolean(actionBusy[`status:${selectedJob.id}`]),
                apply: Boolean(actionBusy[`apply:${selectedJob.id}`]),
                discard: Boolean(actionBusy[`discard:${selectedJob.id}`]),
              }}
            />
          </div>
        ) : (
          <EmptyState icon={Briefcase} title="Selecciona una oferta" text="Aquí verás compatibilidad, documentos y acciones." />
        )}
      </div>
    </div>
  );
}

function JobCard({ job, active, hasDocuments, onSelect }) {
  return (
    <button className={`job-card ${active ? "active" : ""}`} onClick={onSelect} type="button">
      <div className="job-card-top">
        <div className="job-card-title">{job.title || "Cargo sin título"}</div>
        <ScorePill value={job.score} />
      </div>
      <div className="job-card-company">{job.company || "Empresa no indicada"}</div>
      <div className="job-card-row">
        <span className="job-card-row-item"><Globe2 size={11} />{job.source}</span>
        {job.location && <span className="job-card-row-item"><MapPin size={11} />{job.location}</span>}
        <span className="job-card-row-item"><CalendarDays size={11} />{formatDate(job.first_seen_at || job.created_at)}</span>
      </div>
      <div className="job-card-badges">
        {!job.viewed && <span className="badge badge-new"><Sparkles size={10} />Nueva</span>}
        <StatusBadge status={job.status} />
        {hasDocuments && <span className="badge badge-success">Docs listos</span>}
      </div>
    </button>
  );
}

function JobDetail({ job, documents, hasDocuments, profileProgress, onCompleteProfile, onAnalyze, onGenerate, onStatus, onMarkApplied, onView, onDiscard, busy = {} }) {
  const isApplied       = job.status === "Aplicada";
  const scoreText       = scoreSummary(job.score);
  const profileLow      = profileProgress < 70;
  const lowScore        = job.score != null && Number(job.score) < 60;

  return (
    <div>
      {/* Header */}
      <div className="job-detail-header">
        <div style={{ flex: 1 }}>
          <div className="job-detail-title">{job.title || "Oferta sin título"}</div>
          <div className="job-detail-sub">
            {job.company} · {job.source} · {formatDate(job.first_seen_at || job.created_at)}
          </div>
        </div>
        <div style={{ textAlign: "center", flexShrink: 0 }}>
          <ScorePill value={job.score} large />
          <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>{scoreText}</div>
        </div>
      </div>

      {/* Badges */}
      <div className="job-detail-badges">
        {!job.viewed && <span className="badge badge-new"><Sparkles size={10} />Nueva</span>}
        <StatusBadge status={job.status} />
        {hasDocuments && <span className="badge badge-success">Documentos listos</span>}
      </div>

      {/* Profile nudge */}
      {profileLow && (
        <div className="profile-nudge">
          <AlertTriangle size={15} />
          <div>
            <strong>Perfil incompleto</strong>
            <span> Completa tu perfil para un análisis más preciso.</span>
          </div>
          <button className="btn btn-secondary btn-xs" onClick={onCompleteProfile} type="button">
            Completar
          </button>
        </div>
      )}

      {/* Actions */}
      <div className="job-actions">
        {job.score == null && (
          <button className="btn btn-primary" onClick={onAnalyze} disabled={busy.analyze} type="button">
            {busy.analyze ? <><div className="spinner spinner-sm" />Analizando...</> : <><WandSparkles size={15} />Analizar compatibilidad</>}
          </button>
        )}
        {job.score != null && (
          <button className="btn btn-ghost btn-sm" onClick={onAnalyze} disabled={busy.analyze} type="button">
            {busy.analyze ? <><div className="spinner spinner-sm" />Recalculando...</> : <><RotateCcw size={13} />Recalcular</>}
          </button>
        )}
        <button
          className={`btn ${!profileLow && !lowScore && job.score != null ? "btn-primary" : "btn-secondary"}`}
          onClick={onGenerate}
          disabled={busy.generate || job.status === "Descartada"}
          type="button"
        >
          {busy.generate ? <><div className="spinner spinner-sm" />Generando...</> : <><FileText size={15} />{hasDocuments ? "Regenerar CV/carta" : "Generar CV y carta"}</>}
        </button>
        {job.url ? (
          <a className="btn btn-secondary" href={job.url} target="_blank" rel="noreferrer" onClick={() => onView?.()}>
            <ExternalLink size={15} />Abrir oferta
          </a>
        ) : (
          <button className="btn btn-secondary" disabled type="button"><ExternalLink size={15} />Sin URL</button>
        )}
        {!isApplied && (
          <button className="btn btn-secondary" onClick={onMarkApplied} disabled={busy.apply || job.status === "Descartada"} type="button">
            {busy.apply ? <><div className="spinner spinner-sm" />Guardando...</> : <><CheckCircle2 size={15} />Marcar aplicada</>}
          </button>
        )}
        <button className="btn btn-danger btn-sm" onClick={onDiscard} disabled={busy.discard || job.status === "Descartada"} type="button">
          {busy.discard ? <><div className="spinner spinner-sm" />Descartando...</> : <><Trash2 size={13} />Descartar</>}
        </button>
      </div>

      {/* Status selector */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
        <span style={{ fontSize: 12.5, color: "var(--text-3)", fontWeight: 500 }}>Estado</span>
        <select
          className="status-select"
          value={STATUSES.includes(job.status) ? job.status : "Nueva"}
          onChange={(e) => onStatus(e.target.value)}
          disabled={busy.status}
        >
          {STATUSES.map((s) => <option key={s} value={s}>{displayStatus(s)}</option>)}
        </select>
      </div>

      <div className="divider" />

      {/* Why it fits */}
      <div className="job-section">
        <div className="job-section-head"><Target size={12} />Por qué encaja</div>
        {job.reasons?.length ? (
          <ul className="reasons-list">
            {job.reasons.slice(0, 5).map((r) => <li key={r}>{r}</li>)}
          </ul>
        ) : (
          <p style={{ fontSize: 13, color: "var(--text-3)" }}>Ejecuta el análisis para ver razones de compatibilidad.</p>
        )}
      </div>

      <div className="divider" />

      {/* Gaps */}
      <div className="job-section">
        <div className="job-section-head">
          <AlertCircle size={12} />Brechas a reforzar
          {job.gaps?.length > 0 && <span className="badge badge-warning" style={{ marginLeft: "auto" }}>{job.gaps.length}</span>}
        </div>
        {job.gaps?.length ? (
          <div className="gap-chips">
            {job.gaps.slice(0, 8).map((g) => <span key={g} className="gap-chip">{g}</span>)}
          </div>
        ) : (
          <p style={{ fontSize: 13, color: "var(--text-3)" }}>Sin brechas detectadas todavía.</p>
        )}
      </div>

      <div className="divider" />

      {/* Documents */}
      <div className="job-section">
        <div className="job-section-head">
          <FileText size={12} />CV y carta
          {documents.length > 0 && <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-3)" }}>{documents.length} archivos</span>}
        </div>
        {documents.length ? (
          <div className="doc-links">
            {documents.map((doc) => (
              <a key={`${doc.id}-${doc.created_at}`} className="doc-link" href={documentViewUrl(doc)} target="_blank" rel="noreferrer">
                <FileText size={13} />{humanDocType(doc.doc_type)}
              </a>
            ))}
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0" }}>
            <FileArchive size={18} style={{ color: "var(--text-3)" }} />
            <span style={{ fontSize: 13, color: "var(--text-3)" }}>Sin documentos — genera CV y carta cuando estés listo.</span>
          </div>
        )}
      </div>

      <div className="divider" />

      {/* Description */}
      <details className="desc-details">
        <summary className="desc-summary">
          <Eye size={13} />Ver descripción guardada
        </summary>
        <div className="desc-body">{job.description || "Sin descripción guardada."}</div>
      </details>
    </div>
  );
}

// ============================================================
// Analysis View
// ============================================================
function AnalysisView({ jobs, documents, actionBusy, onAnalyze, onAnalyzeMany, onGenerate, setView, setSelectedJobId }) {
  const [onlyPending, setOnlyPending] = useState(false);
  const documentJobIds = useMemo(() => new Set(documents.map((d) => d.job_id).filter(Boolean)), [documents]);
  const activeJobs = jobs.filter((job) => !["Aplicada", "Descartada"].includes(job.status));
  const pending = activeJobs.filter((job) => job.score == null);
  const analyzed = activeJobs.filter((job) => job.score != null);
  const strongMatches = analyzed.filter((job) => Number(job.score) >= 80);
  const readyWithoutDocs = analyzed.filter((job) => Number(job.score) >= 60 && !documentJobIds.has(job.id));
  const avgScore = analyzed.length
    ? Math.round(analyzed.reduce((total, job) => total + Number(job.score || 0), 0) / analyzed.length)
    : 0;
  const rows = (onlyPending ? pending : activeJobs)
    .slice()
    .sort((a, b) => Number(b.score ?? -1) - Number(a.score ?? -1));

  return (
    <div className="page">
      <div className="page-header-row">
        <div className="page-header">
          <span className="eyebrow">Analisis</span>
          <h1>Compatibilidad y prioridades</h1>
          <p>Scores, brechas y documentos pendientes calculados con el perfil guardado.</p>
        </div>
        <div className="header-actions">
          <button className="btn btn-secondary" onClick={() => setOnlyPending((value) => !value)} type="button">
            <Filter size={15} />{onlyPending ? "Ver todas" : "Solo pendientes"}
          </button>
          <button className="btn btn-primary" onClick={() => onAnalyzeMany(pending)} disabled={!pending.length || actionBusy["analyze:bulk"]} type="button">
            {actionBusy["analyze:bulk"] ? <><div className="spinner spinner-sm" />Analizando...</> : <><WandSparkles size={15} />Analizar pendientes</>}
          </button>
        </div>
      </div>

      <div className="metrics-grid mb-4">
        <div className="metric-card">
          <div className="metric-icon amber"><WandSparkles size={17} /></div>
          <div className="metric-value">{pending.length}</div>
          <div className="metric-label">Sin score</div>
          <div className="metric-detail">Listas para analizar</div>
        </div>
        <div className="metric-card">
          <div className="metric-icon green"><Target size={17} /></div>
          <div className="metric-value">{strongMatches.length}</div>
          <div className="metric-label">Matches fuertes</div>
          <div className="metric-detail">Score igual o mayor a 80</div>
        </div>
        <div className="metric-card">
          <div className="metric-icon violet"><FileArchive size={17} /></div>
          <div className="metric-value">{readyWithoutDocs.length}</div>
          <div className="metric-label">Sin documentos</div>
          <div className="metric-detail">Buen match por preparar</div>
        </div>
        <div className="metric-card">
          <div className="metric-icon blue"><Activity size={17} /></div>
          <div className="metric-value">{analyzed.length ? `${avgScore}%` : "0%"}</div>
          <div className="metric-label">Promedio activo</div>
          <div className="metric-detail">{analyzed.length} ofertas analizadas</div>
        </div>
      </div>

      <div className="analysis-grid">
        <div className="card">
          <div className="card-header">
            <div className="card-icon"><ListChecks size={15} /></div>
            <span className="card-title">Cola de analisis</span>
            <span className="card-meta">{rows.length} ofertas</span>
          </div>
          <div className="card-body">
            {rows.length ? (
              <div className="analysis-list">
                {rows.map((job) => {
                  const hasDocs = documentJobIds.has(job.id);
                  return (
                    <div key={job.id} className="analysis-row">
                      <div className="analysis-main">
                        <div className="analysis-title">{job.title || "Oferta sin titulo"}</div>
                        <div className="analysis-meta">{job.company || "Empresa no indicada"} · {job.source} · {formatDate(job.updated_at || job.created_at)}</div>
                        <div className="analysis-badges">
                          <ScorePill value={job.score} />
                          <StatusBadge status={job.status} />
                          {hasDocs && <span className="badge badge-success">Docs listos</span>}
                          {job.gaps?.length > 0 && <span className="badge badge-warning">{job.gaps.length} brechas</span>}
                        </div>
                      </div>
                      <div className="analysis-actions">
                        <button className="btn btn-secondary btn-sm" onClick={() => { setSelectedJobId(job.id); setView("jobs"); }} type="button">
                          <Eye size={13} />Ver
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => onAnalyze(job)} disabled={actionBusy[`analyze:${job.id}`]} type="button">
                          {actionBusy[`analyze:${job.id}`] ? <><div className="spinner spinner-sm" />...</> : <><WandSparkles size={13} />{job.score == null ? "Analizar" : "Recalcular"}</>}
                        </button>
                        {Number(job.score || 0) >= 60 && (
                          <button className="btn btn-ghost btn-sm" onClick={() => onGenerate(job)} disabled={hasDocs || actionBusy[`documents:${job.id}`]} type="button">
                            {hasDocs ? "Docs listos" : actionBusy[`documents:${job.id}`] ? <><div className="spinner spinner-sm" />...</> : <><FileText size={13} />Generar</>}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyState icon={WandSparkles} title="Nada pendiente" text="No hay ofertas activas para analizar con los filtros actuales." action="Buscar ofertas" onClick={() => setView("search")} />
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div className="card-icon"><Target size={15} /></div>
            <span className="card-title">Mejores oportunidades</span>
          </div>
          <div className="card-body">
            {strongMatches.length ? (
              <div className="compact-list">
                {strongMatches.slice(0, 8).map((job) => (
                  <button key={job.id} className="compact-job compact-button" onClick={() => { setSelectedJobId(job.id); setView("jobs"); }} type="button">
                    <div className="compact-job-info">
                      <div className="compact-job-title">{job.title}</div>
                      <div className="compact-job-meta">{job.company || job.source}</div>
                    </div>
                    <ScorePill value={job.score} />
                  </button>
                ))}
              </div>
            ) : (
              <EmptyState icon={Target} title="Sin matches fuertes" text="Analiza mas ofertas o mejora el perfil para subir los scores." />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Sources View
// ============================================================
function SourcesView({ showToast, setView }) {
  const [sources, setSources] = useState([]);
  const [health, setHealth] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [srcData, healthData] = await Promise.all([
        request("/api/sources"),
        request("/api/search/sources/health"),
      ]);
      setSources(Array.isArray(srcData) ? srcData : srcData.sources || []);
      setHealth(healthData.sources || []);
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  const healthById = useMemo(() => new Map(health.map((item) => [item.id, item])), [health]);
  const merged = sources.map((source) => ({ ...source, health: healthById.get(source.id) }));
  const active = merged.filter((source) => source.enabled && source.configured);
  const missing = merged.filter((source) => source.requires_api_key && !source.configured);

  return (
    <div className="page">
      <div className="page-header-row">
        <div className="page-header">
          <span className="eyebrow">Fuentes</span>
          <h1>Proveedores de empleo</h1>
          <p>Estado real de las fuentes disponibles para las busquedas multi-fuente.</p>
        </div>
        <div className="header-actions">
          <button className="btn btn-secondary" onClick={load} disabled={loading} type="button">
            {loading ? <><div className="spinner spinner-sm" />Actualizando...</> : <><RefreshCw size={15} />Actualizar</>}
          </button>
          <button className="btn btn-primary" onClick={() => setView("search")} disabled={!active.length} type="button">
            <Search size={15} />Buscar con activas
          </button>
        </div>
      </div>

      <div className="metrics-grid mb-4">
        <div className="metric-card">
          <div className="metric-icon green"><RadioTower size={17} /></div>
          <div className="metric-value">{active.length}</div>
          <div className="metric-label">Activas</div>
          <div className="metric-detail">Configuradas y habilitadas</div>
        </div>
        <div className="metric-card">
          <div className="metric-icon amber"><AlertCircle size={17} /></div>
          <div className="metric-value">{missing.length}</div>
          <div className="metric-label">Sin clave</div>
          <div className="metric-detail">Requieren variables de entorno</div>
        </div>
        <div className="metric-card">
          <div className="metric-icon blue"><Globe2 size={17} /></div>
          <div className="metric-value">{merged.length}</div>
          <div className="metric-label">Total</div>
          <div className="metric-detail">Proveedores registrados</div>
        </div>
        <div className="metric-card">
          <div className="metric-icon violet"><Activity size={17} /></div>
          <div className="metric-value">{health.filter((item) => item.status === "available").length}</div>
          <div className="metric-label">Health OK</div>
          <div className="metric-detail">Respondieron al chequeo</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-icon"><Database size={15} /></div>
          <span className="card-title">Estado por fuente</span>
          <span className="card-meta">{loading ? "cargando..." : `${merged.length} fuentes`}</span>
        </div>
        <div className="card-body">
          {loading && <div className="loading-center" style={{ height: 120 }}><div className="spinner" />Verificando fuentes...</div>}
          {!loading && !merged.length && <EmptyState icon={RadioTower} title="Sin fuentes" text="El backend no devolvio proveedores configurados." />}
          {!loading && merged.length > 0 && (
            <div className="source-status-grid">
              {merged.map((source) => {
                const healthStatus = source.health?.status || source.status;
                const ready = source.enabled && source.configured;
                const badgeClass = ready && healthStatus === "available" ? "badge-success" : !source.configured ? "badge-warning" : "badge-neutral";
                return (
                  <div key={source.id} className="source-status-card">
                    <div className="source-status-head">
                      <div>
                        <div className="source-status-name">{source.name}</div>
                        <div className="source-status-id">{source.id}</div>
                      </div>
                      <span className={`badge ${badgeClass}`}>{formatSourceStatus(healthStatus, source)}</span>
                    </div>
                    {source.description && <p>{source.description}</p>}
                    {source.requires_api_key && source.env_vars?.length > 0 && (
                      <div className="env-row">
                        {source.env_vars.map((envVar) => <code key={envVar}>{envVar}</code>)}
                      </div>
                    )}
                    {(source.error || source.health?.error) && (
                      <div className="inline-error">{source.health?.error || source.error}</div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Saved Searches
// ============================================================
function SavedSearchesView({ showToast, reload }) {
  const [items, setItems]               = useState([]);
  const [sources, setSources]           = useState([]);
  const [loading, setLoading]           = useState(true);
  const [editing, setEditing]           = useState(null);
  const [pendingDeleteId, setPendingDeleteId] = useState(null);
  const [form, setForm]                 = useState(emptySavedSearchForm());

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const [savedData, srcData] = await Promise.all([
        request("/api/saved-searches"),
        request("/api/sources"),
      ]);
      setItems(savedData.saved_searches || []);
      setSources(Array.isArray(srcData) ? srcData : srcData.sources || []);
    } catch (err) { showToast(err.message, "error"); }
    finally { setLoading(false); }
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
      name: saved.name, query: saved.query, location: saved.location,
      remote_only: saved.remote_only, junior_only: saved.junior_only,
      internship_allowed: saved.internship_allowed,
      selected_sources: saved.selected_sources || [],
      date_filter: saved.date_filter, score_threshold: saved.score_threshold,
      interval_minutes: saved.interval_minutes, enabled: saved.enabled,
    });
    setEditing(saved.id);
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
    } catch (err) { showToast(err.message, "error"); }
  }

  async function remove(id) {
    try {
      await request(`/api/saved-searches/${id}`, { method: "DELETE" });
      setPendingDeleteId(null);
      showToast("Búsqueda eliminada");
      await load();
    } catch (err) { showToast(err.message, "error"); }
  }

  async function runNow(id) {
    try {
      const result = await request(`/api/saved-searches/${id}/run`, { method: "POST" });
      const sr = result.search_result || {};
      showToast(`Ejecutada: ${sr.total_new || 0} nuevas, ${sr.total_updated || 0} actualizadas`);
      await load();
      await reload();
    } catch (err) { showToast(err.message, "error"); }
  }

  async function toggleEnabled(saved) {
    try {
      await request(`/api/saved-searches/${saved.id}`, { method: "PUT", body: JSON.stringify({ ...saved, enabled: !saved.enabled }) });
      await load();
    } catch (err) { showToast(err.message, "error"); }
  }

  return (
    <div className="page">
      <div className="page-header-row">
        <div className="page-header">
          <span className="eyebrow">Automatización</span>
          <h1>Búsquedas guardadas</h1>
          <p>Ejecuta búsquedas de forma recurrente y acumula oportunidades automáticamente.</p>
        </div>
        <button className="btn btn-primary" onClick={startNew} type="button">
          <Plus size={15} />Crear búsqueda
        </button>
      </div>

      {/* Form */}
      {editing !== null && (
        <div className="card mb-4">
          <div className="card-header">
            <div className="card-icon"><Filter size={15} /></div>
            <span className="card-title">{editing === "new" ? "Nueva búsqueda automática" : "Editar búsqueda"}</span>
          </div>
          <div className="card-body">
            <SavedSearchForm form={form} setForm={setForm} sources={sources} />
            <div className="form-footer">
              <button className="btn btn-ghost" onClick={() => setEditing(null)} type="button">Cancelar</button>
              <button className="btn btn-primary" onClick={save} type="button">
                <CheckCircle2 size={15} />{editing === "new" ? "Crear" : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* List */}
      <div className="card">
        <div className="card-header">
          <div className="card-icon"><Bell size={15} /></div>
          <span className="card-title">Búsquedas configuradas</span>
          <span className="card-meta">{items.length} total</span>
        </div>
        <div className="card-body">
          {loading && <div className="loading-center" style={{ height: 80 }}><div className="spinner spinner-sm" /></div>}
          {!loading && !items.length && (
            <EmptyState icon={Bell} title="Sin búsquedas" text="Crea tu primera búsqueda para encontrar ofertas automáticamente." action="Crear" onClick={startNew} />
          )}
          {!loading && items.length > 0 && (
            <div className="saved-list">
              {items.map((saved) => (
                <div key={saved.id} className={`saved-item ${saved.enabled ? "" : "paused"}`}>
                  <div className="saved-item-head">
                    <div>
                      <div className="saved-item-name">{saved.name}</div>
                      <div className="saved-item-query">{saved.query}{saved.location ? ` · ${saved.location}` : ""}</div>
                    </div>
                    <span className={`badge ${saved.enabled ? "badge-success" : "badge-neutral"}`}>
                      {saved.enabled ? "Activa" : "Pausada"}
                    </span>
                  </div>
                  <div className="saved-item-meta">
                    <span className="saved-meta-val">Cada <strong>{saved.interval_minutes}min</strong></span>
                    <span className="saved-meta-val">Última vez: <strong>{saved.last_run_at ? formatDate(saved.last_run_at) : "Nunca"}</strong></span>
                    <span className="saved-meta-val">Fuentes: <strong>{saved.selected_sources?.length || 0}</strong></span>
                    <span className="saved-meta-val">Score mín: <strong>{saved.score_threshold}%</strong></span>
                  </div>
                  <div className="saved-item-actions">
                    <button className="btn btn-primary btn-sm" onClick={() => runNow(saved.id)} type="button">
                      <Play size={13} />Ejecutar ahora
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => toggleEnabled(saved)} type="button">
                      {saved.enabled ? <><Pause size={13} />Pausar</> : <><Play size={13} />Reanudar</>}
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => startEdit(saved)} type="button">
                      <Filter size={13} />Editar
                    </button>
                    {pendingDeleteId === saved.id ? (
                      <>
                        <span style={{ fontSize: 12, color: "var(--text-3)" }}>¿Confirmar?</span>
                        <button className="btn btn-danger btn-sm" onClick={() => remove(saved.id)} type="button">Eliminar</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => setPendingDeleteId(null)} type="button">No</button>
                      </>
                    ) : (
                      <button className="btn btn-ghost btn-sm" onClick={() => setPendingDeleteId(saved.id)} type="button">
                        <Trash2 size={13} />Eliminar
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SavedSearchForm({ form, setForm, sources }) {
  function upd(k, v) { setForm({ ...form, [k]: v }); }
  function toggleSrc(id) {
    const has = form.selected_sources.includes(id);
    upd("selected_sources", has ? form.selected_sources.filter((s) => s !== id) : [...form.selected_sources, id]);
  }

  return (
    <div className="form-grid">
      <Field label="Nombre"     value={form.name}     onChange={(v) => upd("name", v)}     placeholder="Java junior remoto" />
      <Field label="Query"      value={form.query}    onChange={(v) => upd("query", v)}    placeholder="java junior" />
      <Field label="Ubicación"  value={form.location} onChange={(v) => upd("location", v)} placeholder="Remote, Bogotá..." />
      <Field label="Intervalo (min)" value={String(form.interval_minutes)} onChange={(v) => upd("interval_minutes", Math.max(15, Math.min(1440, Number(v)||360)))} placeholder="360" />
      <Field label="Score mínimo (0-100)" value={String(form.score_threshold)} onChange={(v) => upd("score_threshold", Math.max(0, Math.min(100, Number(v)||0)))} placeholder="70" />
      <div className="field">
        <span className="field-label">Filtro de fecha</span>
        <select value={form.date_filter} onChange={(e) => upd("date_filter", e.target.value)}>
          {DATE_FILTER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      <div className="field-full" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <label className="toggle-row"><input type="checkbox" checked={form.remote_only} onChange={(e) => upd("remote_only", e.target.checked)} /><span>Solo remoto</span></label>
        <label className="toggle-row"><input type="checkbox" checked={form.junior_only} onChange={(e) => upd("junior_only", e.target.checked)} /><span>Solo junior</span></label>
        <label className="toggle-row"><input type="checkbox" checked={form.internship_allowed} onChange={(e) => upd("internship_allowed", e.target.checked)} /><span>Aceptar prácticas</span></label>
        <label className="toggle-row"><input type="checkbox" checked={form.enabled} onChange={(e) => upd("enabled", e.target.checked)} /><span>Activa (automática)</span></label>
      </div>

      <div className="field-full">
        <div className="field-label mb-3">Fuentes</div>
        <div className="source-grid">
          {sources.map((s) => (
            <label key={s.id} className={`source-opt ${!s.configured ? "unconfigured" : ""}`}>
              <input type="checkbox" checked={form.selected_sources.includes(s.id)} disabled={!s.enabled || !s.configured} onChange={() => toggleSrc(s.id)} />
              <div><div className="source-opt-name">{s.name}</div><div className="source-opt-status">{s.configured ? s.status : "Sin API key"}</div></div>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Search View
// ============================================================
function SearchView({ reload, showToast, setView, profile }) {
  const [tab, setTab] = useState("auto");
  const [sources, setSources] = useState([]);

  useEffect(() => {
    let active = true;
    request("/api/sources")
      .then((d) => { if (active) setSources(Array.isArray(d) ? d : d.sources || []); })
      .catch((e) => showToast(e.message, "error"));
    return () => { active = false; };
  }, []);

  const tabs = [
    { key: "auto",     label: "Buscar",     icon: Search },
    { key: "url",      label: "Pegar URL",  icon: LinkIcon },
    { key: "linkedin", label: "Pegar texto",icon: FileText },
    { key: "manual",   label: "Manual",     icon: Plus },
  ];

  return (
    <div className="page">
      <div className="page-header">
        <span className="eyebrow">Buscar ofertas</span>
        <h1>Encuentra oportunidades reales</h1>
        <p>Usa la búsqueda multi-fuente, pega una URL, texto de LinkedIn o registra manualmente.</p>
      </div>

      <div className="tab-bar">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button key={key} className={`tab-btn ${tab === key ? "active" : ""}`} onClick={() => setTab(key)} type="button">
            <Icon size={14} />{label}
          </button>
        ))}
      </div>

      {tab === "auto"     && <AutoSearchPanel sources={sources} reload={reload} showToast={showToast} setView={setView} profile={profile} />}
      {tab === "url"      && <UrlImportPanel reload={reload} showToast={showToast} />}
      {tab === "linkedin" && <LinkedInTextPanel reload={reload} showToast={showToast} />}
      {tab === "manual"   && <ManualPanel reload={reload} showToast={showToast} />}
    </div>
  );
}

function AutoSearchPanel({ sources, reload, showToast, setView, profile }) {
  const [keywords, setKeywords]         = useState(profile?.target_role || "");
  const [location, setLocation]         = useState("Remote");
  const [remoteOnly, setRemoteOnly]     = useState(true);
  const [juniorOnly, setJuniorOnly]     = useState(true);
  const [autoAnalyze, setAutoAnalyze]   = useState(true);
  const [dateFilter, setDateFilter]     = useState("4d");
  const [selectedSourceIds, setSelectedSourceIds] = useState([]);
  const [summary, setSummary]           = useState(null);
  const [running, setRunning]           = useState(false);

  const availableIds = useMemo(() => sources.filter((s) => s.enabled && s.configured).map((s) => s.id), [sources]);

  useEffect(() => {
    setSelectedSourceIds((cur) => {
      const valid = cur.filter((id) => availableIds.includes(id));
      return valid.length ? valid : availableIds;
    });
  }, [availableIds]);

  const activeNames = sources.filter((s) => selectedSourceIds.includes(s.id)).map((s) => s.name);
  function toggleSrc(id) { setSelectedSourceIds((c) => c.includes(id) ? c.filter((s) => s !== id) : [...c, id]); }

  async function run() {
    if (keywords.trim().length < 2) { showToast("Escribe al menos 2 caracteres.", "error"); return; }
    if (!availableIds.length) { showToast("No hay fuentes disponibles.", "error"); return; }
    const baseSrcIds = selectedSourceIds.filter((id) => availableIds.includes(id));
    const srcIds = baseSrcIds.length ? baseSrcIds : availableIds;
    setRunning(true);
    try {
      const attempts = buildSearchAttempts(srcIds, availableIds, dateFilter);
      let result = null;
      for (const attempt of attempts) {
        result = await runSearchAttempt({ keywords, location, remoteOnly, juniorOnly, autoAnalyze, sourceIds: attempt.sourceIds, dateFilter: attempt.dateFilter });
        if ((result.total_found || 0) > 0 || (result.total_new || 0) > 0) break;
      }
      setSummary(result);
      const newCount = result.total_new ?? 0;
      if ((result.total_found || 0) > 0) {
        showToast(newCount > 0 ? `${newCount} ofertas nuevas guardadas` : `${result.total_found} encontradas, ${result.duplicates || 0} duplicadas`);
      } else {
        showToast("No aparecieron ofertas. Prueba quitar 'Solo junior' o ampliar el filtro de fecha.", "error");
      }
      await reload();
    } catch (err) { showToast(err.message, "error"); }
    finally { setRunning(false); }
  }

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-icon"><Search size={15} /></div>
        <span className="card-title">Búsqueda multi-fuente</span>
        <span className="card-meta">Método principal</span>
      </div>
      <div className="card-body">
        {summary && (
          <div className={`result-banner mb-3 ${(summary.total_found || 0) === 0 ? "err" : ""}`}>
            {(summary.total_found || 0) > 0 ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
            <span>
              <strong>{summary.total_found} encontradas</strong> · {summary.total_new ?? 0} nuevas · {summary.total_updated ?? 0} actualizadas · {summary.duplicates} duplicadas
            </span>
          </div>
        )}

        <div className="form-grid">
          <Field label="Rol o palabra clave" value={keywords} onChange={setKeywords} placeholder="java junior, react developer..." />
          <Field label="Ubicación" value={location} onChange={setLocation} placeholder="Remote, Colombia..." />
          <div className="field">
            <span className="field-label">Antigüedad máxima</span>
            <select value={dateFilter} onChange={(e) => setDateFilter(e.target.value)}>
              {DATE_FILTER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="field-full" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <label className="toggle-row"><input type="checkbox" checked={remoteOnly} onChange={(e) => setRemoteOnly(e.target.checked)} /><span>Solo remoto</span></label>
            <label className="toggle-row"><input type="checkbox" checked={juniorOnly} onChange={(e) => setJuniorOnly(e.target.checked)} /><span>Solo junior</span></label>
            <label className="toggle-row"><input type="checkbox" checked={autoAnalyze} onChange={(e) => setAutoAnalyze(e.target.checked)} /><span>Analizar compatibilidad al guardar</span></label>
          </div>

          <div className="field-full">
            <details>
              <summary style={{ fontSize: 13, color: "var(--text-2)", cursor: "pointer", marginBottom: 8 }}>
                Fuentes activas: <strong>{activeNames.join(", ") || "Ninguna"}</strong> — Cambiar
              </summary>
              <div className="source-grid mt-2">
                {sources.map((s) => (
                  <label key={s.id} className={`source-opt ${!s.configured ? "unconfigured" : ""}`}>
                    <input type="checkbox" checked={selectedSourceIds.includes(s.id)} disabled={!s.enabled || !s.configured} onChange={() => toggleSrc(s.id)} />
                    <div><div className="source-opt-name">{s.name}</div><div className="source-opt-status">{s.configured ? s.status : "Sin clave"}</div></div>
                  </label>
                ))}
              </div>
            </details>
          </div>
        </div>

        <div className="form-footer">
          <button className="btn btn-ghost btn-sm" onClick={() => setView("saved")} type="button">
            <Bell size={14} />Guardar búsqueda
          </button>
          <button className="btn btn-primary" onClick={run} disabled={running || !availableIds.length} type="button">
            {running ? <><div className="spinner spinner-sm" />Buscando...</> : <><Search size={15} />Buscar y guardar</>}
          </button>
        </div>
      </div>
    </div>
  );
}

async function runSearchAttempt({ keywords, location, remoteOnly, juniorOnly, autoAnalyze, sourceIds, dateFilter }) {
  return request("/api/search/jobs", {
    method: "POST",
    body: JSON.stringify({
      query: keywords, location, remote_only: remoteOnly, junior_only: juniorOnly,
      internship_allowed: true, limit: 50, selected_sources: sourceIds,
      auto_analyze: autoAnalyze, save_results: true, date_filter: dateFilter,
    }),
  });
}

function buildSearchAttempts(selectedIds, availableIds, dateFilter) {
  const attempts = [];
  const selected = uniqueList(selectedIds);
  const available = uniqueList(availableIds);
  const base = selected.length ? selected : available;
  attempts.push({ sourceIds: base, dateFilter, reason: "" });
  if (available.length > base.length) attempts.push({ sourceIds: available, dateFilter, reason: "Todas las fuentes." });
  const relaxed = relaxedFreshDateFilter(dateFilter);
  if (relaxed !== dateFilter) attempts.push({ sourceIds: available, dateFilter: relaxed, reason: "Ampliando filtro de fecha." });
  return dedupeSearchAttempts(attempts);
}

function relaxedFreshDateFilter(v) { return ["24h","1d","2d","3d"].includes(v) ? "4d" : v; }
function dedupeSearchAttempts(attempts) {
  const seen = new Set();
  return attempts.filter((a) => { const k = `${a.dateFilter}:${a.sourceIds.join(",")}`; if (seen.has(k)) return false; seen.add(k); return a.sourceIds.length > 0; });
}
function uniqueList(vals) { return Array.from(new Set(vals.filter(Boolean))); }

function UrlImportPanel({ reload, showToast }) {
  const [url, setUrl]           = useState("");
  const [useBrowser, setUseBrowser] = useState(false);
  const ready = isValidUrl(url);

  async function run() {
    if (!ready) { showToast("Pega una URL completa (http/https).", "error"); return; }
    try {
      await request("/api/jobs/import-url", { method: "POST", body: JSON.stringify({ url, use_browser: useBrowser }) });
      setUrl("");
      showToast("Oferta importada desde URL");
      await reload();
    } catch (err) { showToast(`No se pudo importar. ${err.message}`, "error"); }
  }

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-icon"><LinkIcon size={15} /></div>
        <span className="card-title">Importar desde URL</span>
      </div>
      <div className="card-body">
        <div className="form-grid">
          <Field className="field-full" label="URL de la oferta" value={url} onChange={setUrl} placeholder="https://empresa.com/jobs/..." error={url && !ready ? "URL inválida." : ""} />
          <label className="toggle-row field-full"><input type="checkbox" checked={useBrowser} onChange={(e) => setUseBrowser(e.target.checked)} /><span>Lectura avanzada (página dinámica)</span></label>
        </div>
        <div className="form-footer">
          <button className="btn btn-primary" onClick={run} disabled={!ready} type="button"><Plus size={15} />Importar</button>
        </div>
      </div>
    </div>
  );
}

function LinkedInTextPanel({ reload, showToast }) {
  const [rawText, setRawText] = useState("");
  const [url, setUrl]         = useState("");
  const [title, setTitle]     = useState("");
  const [company, setCompany] = useState("");
  const [location, setLocation] = useState("");
  const ready = rawText.trim().length >= 80;

  async function run() {
    if (!ready) { showToast("Pega al menos 80 caracteres.", "error"); return; }
    try {
      await request("/api/jobs/import-text", { method: "POST", body: JSON.stringify({ raw_text: rawText, url, title, company, location }) });
      setRawText(""); setUrl(""); setTitle(""); setCompany(""); setLocation("");
      showToast("Oferta capturada desde texto");
      await reload();
    } catch (err) { showToast(err.message, "error"); }
  }

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-icon"><FileText size={15} /></div>
        <span className="card-title">Captura desde texto (LinkedIn / Indeed)</span>
        <span className="card-meta">sin login</span>
      </div>
      <div className="card-body">
        <p style={{ fontSize: 13, marginBottom: 16 }}>Abre la oferta en tu navegador, copia el contenido y pégalo aquí.</p>
        <div className="form-grid">
          <Field className="field-full" label="Texto de la oferta (mín. 80 chars)" textarea value={rawText} onChange={setRawText} placeholder="Pega título, empresa, descripción, requisitos..." error={rawText && !ready ? "Mínimo 80 caracteres." : ""} />
          <Field label="URL (opcional)" value={url} onChange={setUrl} placeholder="https://linkedin.com/jobs/..." />
          <Field label="Título (override)" value={title} onChange={setTitle} placeholder="Senior Backend Engineer" />
          <Field label="Empresa" value={company} onChange={setCompany} />
          <Field label="Ubicación" value={location} onChange={setLocation} placeholder="Remote" />
        </div>
        <div className="form-footer">
          <button className="btn btn-primary" onClick={run} disabled={!ready} type="button"><CheckCircle2 size={15} />Capturar oferta</button>
        </div>
      </div>
    </div>
  );
}

function ManualPanel({ reload, showToast }) {
  const [form, setForm] = useState({ title: "", company: "", location: "", url: "", salary: "", tags: "", description: "" });
  const ready = form.title.trim().length > 2;

  async function save() {
    if (!ready) { showToast("Escribe un cargo válido.", "error"); return; }
    try {
      await request("/api/jobs/manual", { method: "POST", body: JSON.stringify(form) });
      setForm({ title: "", company: "", location: "", url: "", salary: "", tags: "", description: "" });
      showToast("Oferta manual guardada");
      await reload();
    } catch (err) { showToast(err.message, "error"); }
  }

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-icon"><Plus size={15} /></div>
        <span className="card-title">Registrar manualmente</span>
      </div>
      <div className="card-body">
        <div className="form-grid">
          <Field label="Cargo *" value={form.title}    onChange={(v) => setForm({ ...form, title: v })}    placeholder="Frontend Engineer" />
          <Field label="Empresa"  value={form.company}  onChange={(v) => setForm({ ...form, company: v })} />
          <Field label="Ubicación" value={form.location} onChange={(v) => setForm({ ...form, location: v })} placeholder="Remoto, Bogotá..." />
          <Field label="URL"      value={form.url}     onChange={(v) => setForm({ ...form, url: v })} />
          <Field label="Salario"  value={form.salary}  onChange={(v) => setForm({ ...form, salary: v })}  placeholder="Opcional" />
          <Field label="Etiquetas" value={form.tags}   onChange={(v) => setForm({ ...form, tags: v })}   placeholder="React, remoto" />
          <Field className="field-full" label="Descripción" textarea value={form.description} onChange={(v) => setForm({ ...form, description: v })} placeholder="Responsabilidades, requisitos, beneficios..." />
        </div>
        <div className="form-footer">
          <button className="btn btn-primary" onClick={save} disabled={!ready} type="button"><CheckCircle2 size={15} />Guardar</button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Documents View
// ============================================================
function DocumentsView({ documents, jobs, onGenerate, setView, setSelectedJobId }) {
  const groups = useMemo(() => groupDocumentsByJob(documents, jobs), [documents, jobs]);
  const jobsWithDocs = new Set(documents.map((d) => d.job_id));
  const suggested = jobs
    .filter((j) => !jobsWithDocs.has(j.id) && !["Aplicada","Descartada"].includes(j.status) && (j.score||0) >= 60)
    .slice(0, 6);

  return (
    <div className="page">
      <div className="page-header-row">
        <div className="page-header">
          <span className="eyebrow">Documentos</span>
          <h1>CV y cartas por oferta</h1>
          <p>Genera documentos personalizados para cada oportunidad y descárgalos cuando necesites.</p>
        </div>
        <button className="btn btn-secondary" onClick={() => setView("jobs")} type="button">
          <ArrowRight size={15} />Ir a la bandeja
        </button>
      </div>

      <div className="documents-grid">
        {/* Documents by job */}
        <div className="card">
          <div className="card-header">
            <div className="card-icon"><FileArchive size={15} /></div>
            <span className="card-title">Documentos generados</span>
            <span className="card-meta">{groups.length} ofertas</span>
          </div>
          <div className="card-body">
            {groups.length ? (
              <div className="docs-list">
                {groups.map((g) => (
                  <div key={g.key} className="docs-item">
                    <div className="docs-item-head">
                      <div>
                        <div className="docs-item-title">{g.title}</div>
                        <div className="docs-item-sub">{g.company} · {g.documents.length} archivos</div>
                      </div>
                      {g.job && <ScorePill value={g.job.score} />}
                    </div>
                    <div className="docs-files">
                      {g.documents.map((doc) => (
                        <a key={`${doc.id}-${doc.created_at}`} className="doc-link" href={documentViewUrl(doc)} target="_blank" rel="noreferrer">
                          <Eye size={13} />{humanDocType(doc.doc_type)}
                        </a>
                      ))}
                      {g.documents.map((doc) => (
                        <a key={`dl-${doc.id}`} className="doc-link" href={documentDownloadUrl(doc)} download>
                          <Download size={13} />Descargar
                        </a>
                      ))}
                      {g.job && (
                        <button className="btn btn-ghost btn-sm" onClick={() => onGenerate(g.job)} type="button">
                          <RotateCcw size={12} />Regenerar
                        </button>
                      )}
                    </div>
                    {g.job && (
                      <div style={{ padding: "8px 16px", borderTop: "1px solid var(--border-soft)", display: "flex", gap: 8 }}>
                        <StatusBadge status={g.job.status} />
                        <button className="btn btn-ghost btn-xs" onClick={() => { setSelectedJobId(g.job.id); setView("jobs"); }} type="button">
                          Ver oferta <ChevronRight size={12} />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState icon={FileArchive} title="Sin documentos aún" text="Genera CV y carta desde la ficha de una oferta." action="Ir a la bandeja" onClick={() => setView("jobs")} />
            )}
          </div>
        </div>

        {/* Suggested */}
        <div className="card">
          <div className="card-header">
            <div className="card-icon"><Sparkles size={15} /></div>
            <span className="card-title">Sugeridas para preparar</span>
          </div>
          <div className="card-body">
            {suggested.length ? (
              <div className="compact-list">
                {suggested.map((job) => (
                  <div key={job.id} className="compact-job">
                    <div className="compact-job-info">
                      <div className="compact-job-title">{job.title}</div>
                      <div className="compact-job-meta">{job.company}</div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, flexShrink: 0 }}>
                      <ScorePill value={job.score} />
                      <button className="btn btn-secondary btn-xs" onClick={() => onGenerate(job)} type="button">
                        <FileText size={11} />Generar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState icon={CheckCircle2} title="Todo cubierto" text="Todas las ofertas con buen match ya tienen documentos." />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Profile View
// ============================================================
function ProfileView({ profile, setProfile, reload, showToast }) {
  const [form, setForm] = useState(profile || {});
  const [saving, setSaving] = useState(false);
  useEffect(() => setForm(profile || {}), [profile]);

  const completion = profileCompletion(form);
  const fields = ["full_name","target_role","summary","skills","experience","education","projects","links","keywords"];

  async function save() {
    setSaving(true);
    try {
      const saved = await request("/api/profile", { method: "POST", body: JSON.stringify(form) });
      setProfile(saved);
      showToast("Perfil guardado");
      await reload();
    } catch (err) { showToast(err.message, "error"); }
    finally { setSaving(false); }
  }

  function upd(k, v) { setForm({ ...form, [k]: v }); }

  return (
    <div className="page">
      <div className="page-header-row">
        <div className="page-header">
          <span className="eyebrow">Perfil</span>
          <h1>{form.full_name || "Tu perfil profesional"}</h1>
          <p>La app usa estos datos para calcular compatibilidad y generar CV/carta personalizados.</p>
        </div>
        <button className="btn btn-primary" onClick={save} disabled={saving} type="button">
          {saving ? <><div className="spinner spinner-sm" />Guardando...</> : <><CheckCircle2 size={15} />Guardar perfil</>}
        </button>
      </div>

      <div className="profile-layout">
        {/* Left: form */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {[
            { title: "Información básica",  icon: UserRound, fields: [["Nombre completo","full_name","Tu nombre completo","",false]] },
            { title: "Rol objetivo",         icon: Target,    fields: [["Rol objetivo","target_role","React Frontend Engineer","",false],["Resumen profesional","summary","Describe tu experiencia...","",true]] },
            { title: "Habilidades",          icon: Layers3,   fields: [["Tecnologías y herramientas","skills","React, TypeScript, Python...","",true]] },
            { title: "Experiencia",          icon: Briefcase, fields: [["Experiencia laboral","experience","","",true]] },
            { title: "Educación",            icon: FileText,  fields: [["Formación y certificaciones","education","","",true]] },
            { title: "Proyectos",            icon: Sparkles,  fields: [["Proyectos destacados","projects","","",true]] },
            { title: "Links profesionales",  icon: Globe2,    fields: [["GitHub, LinkedIn, portafolio","links","","",true]] },
            { title: "Palabras clave",       icon: Filter,    fields: [["Preferencias de búsqueda","keywords","Remote, SaaS, React...","",true]] },
          ].map(({ title, icon: Icon, fields: sFields }) => (
            <div key={title} className="card">
              <div className="card-header">
                <div className="card-icon"><Icon size={15} /></div>
                <span className="card-title">{title}</span>
              </div>
              <div className="card-body">
                <div className="form-grid">
                  {sFields.map(([label, key, placeholder, hint, textarea]) => (
                    <Field
                      key={key}
                      className="field-full"
                      label={label}
                      value={form[key] || ""}
                      onChange={(v) => upd(key, v)}
                      placeholder={placeholder}
                      textarea={textarea}
                    />
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Right: completion sidebar */}
        <div className="profile-stat">
          <div className="profile-stat-num">{completion}%</div>
          <div className="profile-stat-label">completado</div>
          <div className="progress-track" style={{ height: 8, marginBottom: 16 }}>
            <div className={`progress-fill ${completion < 40 ? "bad" : completion < 70 ? "warn" : ""}`} style={{ width: `${completion}%` }} />
          </div>
          <div className="profile-fields-hint">
            {fields.map((f) => {
              const filled = String(form[f] || "").trim().length > 0;
              return (
                <div key={f} className={`profile-fields-hint-item ${filled ? "filled" : ""}`}>
                  {filled ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
                  {f.replace(/_/g, " ")}
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 16, padding: "12px", background: "var(--primary-bg)", borderRadius: "var(--r-md)", fontSize: 12, color: "var(--text-2)" }}>
            {completion >= 70 ? "✓ Listo para analizar y generar documentos." : `Completa ${Math.ceil((70 - completion) / (100/fields.length))} campo(s) más para activar el análisis.`}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// History View
// ============================================================
function HistoryView({ showToast, setView, setSelectedJobId }) {
  const [runs, setRuns] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [applications, setApplications] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [runsData, jobsData, appsData] = await Promise.all([
        request("/api/search/runs?limit=50"),
        request("/api/jobs?status=Todos&search=&min_score=0&include_discarded=true"),
        request("/api/jobs/applications?limit=100"),
      ]);
      setRuns(runsData.runs || []);
      setJobs(jobsData.jobs || []);
      setApplications(appsData.applications || []);
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  const jobsById = useMemo(() => new Map(jobs.map((job) => [job.id, job])), [jobs]);
  const appliedJobs = jobs.filter((job) => job.status === "Aplicada");
  const discardedJobs = jobs.filter((job) => job.status === "Descartada");
  const failedRuns = runs.filter((run) => run.status && run.status !== "success" && run.status !== "completed");
  const applicationRows = applications.length
    ? applications.map((application) => ({ application, job: jobsById.get(application.job_id) }))
    : appliedJobs.map((job) => ({ application: null, job }));

  return (
    <div className="page">
      <div className="page-header-row">
        <div className="page-header">
          <span className="eyebrow">Historial</span>
          <h1>Actividad reciente</h1>
          <p>Runs de busqueda, aplicaciones manuales y descartes guardados por el backend.</p>
        </div>
        <button className="btn btn-secondary" onClick={load} disabled={loading} type="button">
          {loading ? <><div className="spinner spinner-sm" />Actualizando...</> : <><RefreshCw size={15} />Actualizar</>}
        </button>
      </div>

      <div className="metrics-grid mb-4">
        <div className="metric-card">
          <div className="metric-icon blue"><History size={17} /></div>
          <div className="metric-value">{runs.length}</div>
          <div className="metric-label">Busquedas</div>
          <div className="metric-detail">Ultimos runs registrados</div>
        </div>
        <div className="metric-card">
          <div className="metric-icon green"><CheckCircle2 size={17} /></div>
          <div className="metric-value">{appliedJobs.length}</div>
          <div className="metric-label">Aplicadas</div>
          <div className="metric-detail">Marcadas manualmente</div>
        </div>
        <div className="metric-card">
          <div className="metric-icon amber"><Trash2 size={17} /></div>
          <div className="metric-value">{discardedJobs.length}</div>
          <div className="metric-label">Descartadas</div>
          <div className="metric-detail">Ocultas de la bandeja</div>
        </div>
        <div className="metric-card">
          <div className="metric-icon violet"><AlertCircle size={17} /></div>
          <div className="metric-value">{failedRuns.length}</div>
          <div className="metric-label">Con errores</div>
          <div className="metric-detail">Runs para revisar</div>
        </div>
      </div>

      <div className="history-grid">
        <div className="card">
          <div className="card-header">
            <div className="card-icon"><Search size={15} /></div>
            <span className="card-title">Historial de busquedas</span>
            <span className="card-meta">{runs.length} runs</span>
          </div>
          <div className="card-body">
            {loading && <div className="loading-center" style={{ height: 100 }}><div className="spinner spinner-sm" />Cargando historial...</div>}
            {!loading && !runs.length && <EmptyState icon={History} title="Sin busquedas aun" text="Cuando ejecutes una busqueda multi-fuente aparecera aqui." action="Buscar ofertas" onClick={() => setView("search")} />}
            {!loading && runs.length > 0 && (
              <div className="run-list">
                {runs.map((run) => (
                  <div key={run.id || `${run.query}-${run.started_at}`} className="run-row">
                    <div className="run-row-head">
                      <div>
                        <div className="run-query">{run.query || "Busqueda sin query"}</div>
                        <div className="run-meta">{formatDate(run.started_at)} · {run.selected_sources?.length || 0} fuentes</div>
                      </div>
                      <span className={`badge ${run.status === "success" || run.status === "completed" ? "badge-success" : "badge-warning"}`}>{run.status || "sin estado"}</span>
                    </div>
                    <div className="run-stats">
                      <span>{run.total_found || 0} encontradas</span>
                      <span>{run.total_saved || 0} guardadas</span>
                      <span>{run.duplicates || 0} duplicadas</span>
                      {run.errors?.length > 0 && <span>{run.errors.length} errores</span>}
                    </div>
                    {run.errors?.length > 0 && (
                      <div className="inline-error">{run.errors.map((error) => error.error || error.message || String(error)).join(" · ")}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div className="card-icon"><CheckCircle2 size={15} /></div>
            <span className="card-title">Aplicaciones manuales</span>
            <span className="card-meta">{applicationRows.length} registros</span>
          </div>
          <div className="card-body">
            {loading && <div className="loading-center" style={{ height: 100 }}><div className="spinner spinner-sm" /></div>}
            {!loading && !applicationRows.length && <EmptyState icon={CheckCircle2} title="Sin aplicaciones" text="Marca una oferta como aplicada para crear historial." />}
            {!loading && applicationRows.length > 0 && (
              <div className="saved-list">
                {applicationRows.map(({ application, job }) => (
                  <div key={application?.id || `job-${job?.id}`} className="saved-item">
                    <div className="saved-item-head">
                      <div>
                        <div className="saved-item-name">{job?.title || "Oferta eliminada"}</div>
                        <div className="saved-item-query">{job?.company || application?.portal || "Portal no indicado"}</div>
                      </div>
                      <span className="badge badge-success">{application?.status || "Aplicada"}</span>
                    </div>
                    <div className="saved-item-meta">
                      <span className="saved-meta-val">Fecha: <strong>{formatDate(application?.created_at || job?.updated_at)}</strong></span>
                      <span className="saved-meta-val">Documentos: <strong>{application?.documents_used?.length || 0}</strong></span>
                      <span className="saved-meta-val">Portal: <strong>{application?.portal || job?.source || "N/D"}</strong></span>
                    </div>
                    <div className="saved-item-actions">
                      {job && (
                        <button className="btn btn-secondary btn-sm" onClick={() => { setSelectedJobId(job.id); setView("jobs"); }} type="button">
                          <Eye size={13} />Ver oferta
                        </button>
                      )}
                      {(application?.url || job?.url) && (
                        <a className="btn btn-ghost btn-sm" href={application?.url || job?.url} target="_blank" rel="noreferrer">
                          <ExternalLink size={13} />Abrir portal
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Settings View
// ============================================================
function SettingsView({ overview }) {
  const [sources, setSources]       = useState([]);
  const [sourcesLoading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    request("/api/sources")
      .then((d) => { if (active) setSources(Array.isArray(d) ? d : d.sources || []); })
      .catch(() => {})
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const activeSources  = sources.filter((s) => s.configured && s.enabled);
  const missingApiKey  = sources.filter((s) => !s.configured && s.requires_api_key);

  return (
    <div className="page">
      <div className="page-header">
        <span className="eyebrow">Configuración</span>
        <h1>Estado del sistema</h1>
        <p>Revisa la base de datos, las fuentes activas y los servicios opcionales.</p>
      </div>

      {/* System cards */}
      <div className="system-grid">
        {[
          {
            icon: Database, title: "Base de datos",
            ok: overview?.health?.ok,
            label: overview?.health?.ok ? "Conectada" : "Con error",
            detail: overview?.health?.database_url || "URL no disponible",
            error: overview?.health?.error,
          },
          {
            icon: WandSparkles, title: "Análisis",
            ok: true, label: "Local activo",
            detail: "Configura OPENAI_API_KEY para análisis con IA.",
          },
          {
            icon: Bell, title: "Alertas Telegram",
            ok: null, label: "Configurable",
            detail: "Configura TELEGRAM_BOT_TOKEN y TELEGRAM_CHAT_ID.",
          },
        ].map(({ icon: Icon, title, ok, label, detail, error }) => (
          <div key={title} className="card">
            <div className="card-header">
              <div className="card-icon"><Icon size={15} /></div>
              <span className="card-title">{title}</span>
              <span className={`badge ${ok === true ? "badge-success" : ok === false ? "badge-danger" : "badge-warning"}`}>{label}</span>
            </div>
            <div className="card-body" style={{ fontSize: 13, color: "var(--text-2)" }}>
              <code style={{ fontSize: 11, wordBreak: "break-all" }}>{detail}</code>
              {error && <div style={{ color: "var(--danger)", marginTop: 6, fontSize: 12 }}>{error}</div>}
            </div>
          </div>
        ))}
      </div>

      {/* Sources */}
      <div className="card">
        <div className="card-header">
          <div className="card-icon"><Globe2 size={15} /></div>
          <span className="card-title">Fuentes de empleo</span>
          <span className="card-meta">{sourcesLoading ? "cargando..." : `${activeSources.length} activas · ${missingApiKey.length} sin configurar`}</span>
        </div>
        <div className="card-body">
          {sourcesLoading && <div className="loading-center" style={{ height: 80 }}><div className="spinner spinner-sm" /></div>}
          {!sourcesLoading && (
            <div className="health-grid">
              {sources.map((s) => {
                const isActive  = s.configured && s.enabled;
                const isMissing = !s.configured && s.requires_api_key;
                const dot = isActive ? "ok" : isMissing ? "warn" : !s.enabled ? "idle" : "err";
                const badge = isActive ? "badge-success" : isMissing ? "badge-warning" : !s.enabled ? "badge-neutral" : "badge-danger";
                const label = isActive ? "Activa" : isMissing ? "Sin API key" : !s.enabled ? "Deshabilitada" : "Error";
                return (
                  <div key={s.id} className="health-card">
                    <div className="health-card-head">
                      <div className={`health-dot ${dot}`} />
                      <span className="health-name">{s.name}</span>
                      <span className={`badge ${badge}`} style={{ marginLeft: "auto" }}>{label}</span>
                    </div>
                    {s.description && <div className="health-status">{s.description}</div>}
                    {isMissing && s.env_vars?.length > 0 && (
                      <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 6 }}>
                        Requiere: {s.env_vars.map((v) => <code key={v} style={{ background: "var(--surface-3)", padding: "1px 4px", borderRadius: 3, marginLeft: 4 }}>{v}</code>)}
                      </div>
                    )}
                    {s.error && !isMissing && <div style={{ fontSize: 11, color: "var(--danger)", marginTop: 4 }}>{s.error}</div>}
                  </div>
                );
              })}
              {!sources.length && <p style={{ fontSize: 13, color: "var(--text-3)" }}>No se pudieron cargar las fuentes. Verifica el backend.</p>}
            </div>
          )}
          {!sourcesLoading && missingApiKey.length > 0 && (
            <div style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 14, padding: "10px 12px", background: "var(--warning-bg)", borderRadius: "var(--r-md)", fontSize: 13, color: "var(--text)" }}>
              <AlertCircle size={15} style={{ color: "var(--warning)", flexShrink: 0 }} />
              <span>Las fuentes sin configurar necesitan variables de entorno en <code>.env</code>. Reinicia el backend tras agregarlas.</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Atomic / Shared Components
// ============================================================
function ScorePill({ value, large = false }) {
  const cls = value == null ? "score-none" : value >= 80 ? "score-high" : value >= 60 ? "score-mid" : "score-low";
  return (
    <span className={`score-pill ${cls} ${large ? "score-lg" : ""}`}>
      {value == null ? "—" : `${Math.round(value)}%`}
    </span>
  );
}

function StatusBadge({ status, label }) {
  const cls = {
    Aplicada: "badge-success",
    "Lista para aplicar": "badge-primary",
    Interesante: "badge-primary",
    Descartada: "badge-danger",
    "Captcha requerido": "badge-warning",
    "Necesita revision": "badge-warning",
    Error: "badge-danger",
  }[status] || "badge-neutral";
  return <span className={`badge ${cls}`}>{label || displayStatus(status)}</span>;
}

function EmptyState({ icon: Icon = Sparkles, title, text, action, onClick }) {
  return (
    <div className="empty-state">
      <div className="empty-icon"><Icon size={22} /></div>
      <h3>{title}</h3>
      <p>{text}</p>
      {action && <button className="btn btn-secondary btn-sm" onClick={onClick} type="button">{action}</button>}
    </div>
  );
}

function Field({ label, value = "", onChange, textarea = false, placeholder = "", error = "", className = "" }) {
  return (
    <div className={`field ${className}`}>
      <span className="field-label">{label}</span>
      {textarea ? (
        <textarea value={value || ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      ) : (
        <input value={value || ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      )}
      {error && <span style={{ fontSize: 11.5, color: "var(--danger)" }}>{error}</span>}
    </div>
  );
}

const DATE_FILTER_OPTIONS = [
  { value: "",    label: "Cualquier fecha" },
  { value: "24h", label: "Últimas 24h" },
  { value: "2d",  label: "Últimos 2 días" },
  { value: "3d",  label: "Últimos 3 días" },
  { value: "4d",  label: "Últimos 4 días" },
  { value: "7d",  label: "Última semana" },
  { value: "14d", label: "Últimos 14 días" },
  { value: "30d", label: "Últimos 30 días" },
];

// ============================================================
// Utilities (unchanged logic)
// ============================================================
function emptySavedSearchForm() {
  return { name: "", query: "", location: "", remote_only: false, junior_only: false, internship_allowed: false, selected_sources: [], date_filter: "", score_threshold: 70, interval_minutes: 360, enabled: true };
}

function computeStepStatus({ profileProgress, totalJobs, unanalyzedCount, highPriorityCount, documentsCount, appliedCount }) {
  const hasProfile = profileProgress >= 70;
  const hasJobs    = totalJobs > 0;
  const allAnalyzed= hasJobs && unanalyzedCount === 0;
  const hasTop     = highPriorityCount > 0;
  const hasDocs    = documentsCount > 0;
  const hasApplied = appliedCount > 0;
  const states = [
    { done: hasProfile, detail: hasProfile ? "Perfil listo" : `${profileProgress}%` },
    { done: hasJobs,    detail: hasJobs ? `${totalJobs} guardadas` : "Sin búsquedas" },
    { done: hasJobs,    detail: hasJobs ? "Bandeja activa" : "—" },
    { done: hasJobs && allAnalyzed, detail: hasJobs ? (allAnalyzed ? "Todas analizadas" : `${unanalyzedCount} pendientes`) : "—" },
    { done: hasTop,     detail: hasTop ? `${highPriorityCount} con ≥80%` : "—" },
    { done: hasDocs,    detail: hasDocs ? `${documentsCount} documentos` : "—" },
    { done: hasApplied, detail: hasApplied ? `${appliedCount} aplicadas` : "—" },
  ];
  const firstPendingIdx = states.findIndex((s) => !s.done);
  return FLOW_STEPS.map((flow, idx) => {
    const s = states[idx];
    let state = s.done ? "done" : "pending";
    if (!s.done && firstPendingIdx === idx) state = "current";
    return { ...flow, state, detail: s.detail };
  });
}

function buildPrimaryRecommendation({ nextStep, totalJobs, unanalyzedCount, highPriorityCount, documentsCount, profileProgress }) {
  switch (nextStep?.key) {
    case "profile":   return { title: "Completa tu perfil", description: `Tu perfil está al ${profileProgress}%.`, target: "profile", icon: UserRound, cta: "Completar perfil" };
    case "search":    return { title: "Busca tus primeras ofertas", description: "Configura una búsqueda multi-fuente.", target: "search", icon: Search, cta: "Buscar ofertas" };
    case "review":    return { title: "Revisa la bandeja", description: `${totalJobs} ofertas te esperan.`, target: "jobs", icon: ListChecks, cta: "Abrir bandeja" };
    case "analyze":   return { title: "Analiza compatibilidad", description: `${unanalyzedCount} ofertas sin score.`, target: "jobs", icon: WandSparkles, cta: "Ir a analizar" };
    case "top":       return { title: "Encuentra mejores matches", description: "Captura más o ajusta tu perfil.", target: "search", icon: Target, cta: "Capturar más" };
    case "documents": return { title: "Genera CV y carta", description: `${highPriorityCount} ofertas con alta compatibilidad.`, target: "jobs", icon: FileText, cta: "Ir a generar" };
    default:          return { title: "Aplica manualmente", description: `${documentsCount} documentos listos.`, target: "jobs", icon: ExternalLink, cta: "Ver ofertas" };
  }
}

function buildFilterCounts(jobs, documentJobIds) {
  return {
    all:     jobs.length,
    new:     jobs.filter((j) => !j.viewed).length,
    viewed:  jobs.filter((j) => j.viewed).length,
    good:    jobs.filter((j) => (j.score||0) >= 60 && !["Aplicada","Descartada"].includes(j.status)).length,
    docs:    jobs.filter((j) => documentJobIds.has(j.id)).length,
    applied: jobs.filter((j) => j.status === "Aplicada").length,
  };
}

function filterJobs(jobs, filters, documentJobIds) {
  const query = filters.search.trim().toLowerCase();
  return jobs.filter((job) => {
    const haystack = [job.title, job.company, job.location, job.description, ...(Array.isArray(job.tags) ? job.tags : [])].filter(Boolean).join(" ").toLowerCase();
    const matchesQuery = !query || haystack.includes(query);
    const matchesScore = !filters.minScore || (job.score||0) >= Number(filters.minScore);
    const cat = filters.category;
    const matchesCat =
      cat === "all" ||
      (cat === "new"     && !job.viewed) ||
      (cat === "viewed"  && job.viewed) ||
      (cat === "good"    && (job.score||0) >= 60 && !["Aplicada","Descartada"].includes(job.status)) ||
      (cat === "docs"    && documentJobIds.has(job.id)) ||
      (cat === "applied" && job.status === "Aplicada");
    return matchesQuery && matchesScore && matchesCat;
  });
}

function profileCompletion(profile = {}) {
  const fields = ["full_name","target_role","summary","skills","experience","education","projects","links","keywords"];
  const done = fields.filter((f) => String(profile?.[f]||"").trim().length > 0).length;
  return Math.round((done / fields.length) * 100);
}

function groupDocumentsByJob(documents, jobs) {
  const jobsById = new Map(jobs.map((j) => [j.id, j]));
  const groups = new Map();
  documents.forEach((doc) => {
    const job = jobsById.get(doc.job_id);
    const key = doc.job_id || `${doc.job_title}-${doc.company}`;
    if (!groups.has(key)) {
      groups.set(key, { key, job, title: job?.title || doc.job_title || "Oferta", company: job?.company || doc.company || "—", documents: [] });
    }
    groups.get(key).documents.push(doc);
  });
  return Array.from(groups.values());
}

function formatSourceStatus(status = "", source = {}) {
  if (!source.enabled) return "Deshabilitada";
  if (!source.configured) return "Sin clave";
  if (status === "available") return "Disponible";
  if (status === "unavailable") return "No responde";
  if (status === "missing_api_key") return "Sin clave";
  return status || "Sin estado";
}

function displayStatus(status = "") { return STATUS_LABELS[status] || status || "Sin estado"; }
function humanDocType(type = "") {
  const n = type.toLowerCase();
  if (n.includes("cv")) return type.includes("PDF") ? "CV PDF" : "CV DOCX";
  if (n.includes("carta")) return type.includes("PDF") ? "Carta PDF" : "Carta DOCX";
  return type || "Documento";
}
function scoreSummary(v) {
  if (v == null) return "Sin analizar";
  if (v >= 80) return "Match fuerte";
  if (v >= 60) return "Buen match";
  if (v >= 40) return "Match parcial";
  return "Bajo encaje";
}
function formatDate(value) {
  if (!value) return "sin fecha";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat("es-CO", { day:"2-digit", month:"short", year:"numeric" }).format(d);
}
function isValidUrl(v) {
  try { const u = new URL(v); return ["http:","https:"].includes(u.protocol); } catch { return false; }
}

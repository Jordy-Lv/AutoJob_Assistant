import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { CheckCircle2, ClipboardList, FilePlus2, Globe2, Link as LinkIcon, Search } from "lucide-react";
import { endpoints } from "@/api/endpoints";
import { request } from "@/api/client";
import { AppContext } from "@/context/AppContext";
import { useFetch } from "@/hooks/useFetch";
import { useToast } from "@/hooks/useToast";
import Badge from "@/components/ui/Badge/Badge";
import Button from "@/components/ui/Button/Button";
import Card from "@/components/ui/Card/Card";
import EmptyState from "@/components/ui/EmptyState/EmptyState";
import Input from "@/components/ui/Input/Input";
import Spinner from "@/components/ui/Spinner/Spinner";
import { isValidUrl, normalizeListPayload } from "@/utils/formatters";
import styles from "./BuscarOfertas.module.css";

const modes = [
  { key: "buscar", label: "Buscar", icon: Search },
  { key: "url", label: "Pegar URL", icon: LinkIcon },
  { key: "texto", label: "Pegar texto", icon: ClipboardList },
  { key: "manual", label: "Manual", icon: FilePlus2 },
];

const defaultSearch = {
  query: "",
  location: "",
  remote_only: true,
  junior_only: false,
  internship_allowed: false,
  date_filter: "",
  limit: 25,
  auto_analyze: false,
  save_results: true,
};

export default function BuscarOfertas() {
  const fetchSources = useCallback(() => request(endpoints.sources.list()), []);
  const { data, loading, error, refetch } = useFetch(fetchSources);
  const sources = useMemo(() => normalizeListPayload(data, "sources"), [data]);
  const configuredSources = sources.filter((source) => source.enabled && source.configured);

  const { success, error: toastError } = useToast();
  const { refreshCounters } = useContext(AppContext);
  const [mode, setMode] = useState("buscar");
  const [selectedSources, setSelectedSources] = useState([]);
  const [searchForm, setSearchForm] = useState(defaultSearch);
  const [urlForm, setUrlForm] = useState({ url: "", use_browser: false });
  const [textForm, setTextForm] = useState({ raw_text: "", url: "", title: "", company: "", location: "" });
  const [manualForm, setManualForm] = useState({ title: "", company: "", location: "", url: "", salary: "", tags: "", description: "" });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!selectedSources.length && configuredSources.length) {
      setSelectedSources(configuredSources.slice(0, 3).map((source) => source.id));
    }
  }, [configuredSources, selectedSources.length]);

  if (loading) return <Spinner full label="Cargando fuentes..." />;
  if (error) return <PageError message={error.message} onRetry={refetch} />;

  async function runMutation(endpoint, options, validate, okMessage) {
    setBusy(true);
    setResult(null);
    try {
      const payload = await request(endpoint, options);
      validate(payload);
      setResult(payload);
      await refreshCounters();
      success(okMessage);
      return payload;
    } catch (err) {
      toastError(err.message || "La accion no se pudo completar.");
      throw err;
    } finally {
      setBusy(false);
    }
  }

  async function handleSearch(event) {
    event.preventDefault();
    const payload = { ...searchForm, selected_sources: selectedSources, limit: Number(searchForm.limit) || 25 };
    await runMutation(
      endpoints.search.jobs(),
      { method: "POST", body: payload },
      (response) => {
        if (!response || response.status === "error") throw new Error(response?.message || "La busqueda fallo.");
      },
      "Busqueda ejecutada y resultados validados.",
    );
  }

  async function handleUrl(event) {
    event.preventDefault();
    if (!isValidUrl(urlForm.url)) {
      toastError("Pega una URL http/https valida.");
      return;
    }
    await runMutation(
      endpoints.jobs.importUrl(),
      { method: "POST", body: urlForm },
      (response) => {
        if (!response?.id) throw new Error("El backend no devolvio la oferta importada.");
      },
      "Oferta importada desde URL.",
    );
  }

  async function handleText(event) {
    event.preventDefault();
    await runMutation(
      endpoints.jobs.importText(),
      { method: "POST", body: textForm },
      (response) => {
        if (!response?.id) throw new Error("El backend no devolvio la oferta capturada.");
      },
      "Oferta creada desde el texto pegado.",
    );
  }

  async function handleManual(event) {
    event.preventDefault();
    await runMutation(
      endpoints.jobs.manual(),
      { method: "POST", body: manualForm },
      (response) => {
        if (!response?.id) throw new Error("El backend no devolvio la oferta manual.");
      },
      "Oferta manual guardada.",
    );
  }

  function toggleSource(sourceId) {
    setSelectedSources((current) => (
      current.includes(sourceId) ? current.filter((id) => id !== sourceId) : [...current, sourceId]
    ));
  }

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <span className={styles.eyebrow}>Buscar ofertas</span>
        <h1>Captura oportunidades desde cuatro entradas</h1>
        <p>Usa fuentes conectadas, URL, texto pegado o carga manual cuando una oferta no se pueda leer automaticamente.</p>
      </header>

      <div className={styles.tabs} role="tablist" aria-label="Modo de captura">
        {modes.map((item) => {
          const Icon = item.icon;
          return (
            <label className={[styles.tab, mode === item.key ? styles.active : ""].join(" ")} key={item.key}>
              <input checked={mode === item.key} name="search-mode" onChange={() => setMode(item.key)} type="radio" value={item.key} />
              <Icon size={16} aria-hidden="true" />
              {item.label}
            </label>
          );
        })}
      </div>

      <div className={styles.grid}>
        <Card title="Entrada" icon={modes.find((item) => item.key === mode)?.icon || Search} hover={false}>
          {mode === "buscar" && (
            <form className={styles.form} onSubmit={handleSearch}>
              <Input label="Busqueda" value={searchForm.query} onChange={(e) => setSearchForm({ ...searchForm, query: e.target.value })} required placeholder="Java developer remoto" />
              <Input label="Ubicacion" value={searchForm.location} onChange={(e) => setSearchForm({ ...searchForm, location: e.target.value })} placeholder="Colombia, Remote, USA" />
              <div className={styles.twoCols}>
                <Input label="Limite" min="1" max="100" type="number" value={searchForm.limit} onChange={(e) => setSearchForm({ ...searchForm, limit: e.target.value })} />
                <Input
                  label="Fecha"
                  select
                  value={searchForm.date_filter}
                  onChange={(e) => setSearchForm({ ...searchForm, date_filter: e.target.value })}
                  options={[
                    { value: "", label: "Cualquier fecha" },
                    { value: "24h", label: "Ultimas 24h" },
                    { value: "7d", label: "Ultima semana" },
                    { value: "30d", label: "Ultimo mes" },
                  ]}
                />
              </div>
              <Toggle label="Solo remoto" checked={searchForm.remote_only} onChange={(checked) => setSearchForm({ ...searchForm, remote_only: checked })} />
              <Toggle label="Junior/entry-level" checked={searchForm.junior_only} onChange={(checked) => setSearchForm({ ...searchForm, junior_only: checked })} />
              <Toggle label="Permitir practicas" checked={searchForm.internship_allowed} onChange={(checked) => setSearchForm({ ...searchForm, internship_allowed: checked })} />
              <Toggle label="Analizar automaticamente" checked={searchForm.auto_analyze} onChange={(checked) => setSearchForm({ ...searchForm, auto_analyze: checked })} />
              <Button disabled={busy || searchForm.query.trim().length < 2} icon={Search} type="submit">Buscar en fuentes</Button>
            </form>
          )}

          {mode === "url" && (
            <form className={styles.form} onSubmit={handleUrl}>
              <Input label="URL de la oferta" value={urlForm.url} onChange={(e) => setUrlForm({ ...urlForm, url: e.target.value })} required placeholder="https://..." />
              <Toggle label="Usar navegador si la pagina es dinamica" checked={urlForm.use_browser} onChange={(checked) => setUrlForm({ ...urlForm, use_browser: checked })} />
              <Button disabled={busy || !urlForm.url} icon={LinkIcon} type="submit">Importar URL</Button>
            </form>
          )}

          {mode === "texto" && (
            <form className={styles.form} onSubmit={handleText}>
              <Input label="Texto de la oferta" textarea value={textForm.raw_text} onChange={(e) => setTextForm({ ...textForm, raw_text: e.target.value })} required placeholder="Pega descripcion, requisitos, empresa..." />
              <div className={styles.twoCols}>
                <Input label="Titulo opcional" value={textForm.title} onChange={(e) => setTextForm({ ...textForm, title: e.target.value })} />
                <Input label="Empresa opcional" value={textForm.company} onChange={(e) => setTextForm({ ...textForm, company: e.target.value })} />
              </div>
              <Input label="URL opcional" value={textForm.url} onChange={(e) => setTextForm({ ...textForm, url: e.target.value })} />
              <Input label="Ubicacion opcional" value={textForm.location} onChange={(e) => setTextForm({ ...textForm, location: e.target.value })} />
              <Button disabled={busy || textForm.raw_text.trim().length < 80} icon={ClipboardList} type="submit">Crear desde texto</Button>
            </form>
          )}

          {mode === "manual" && (
            <form className={styles.form} onSubmit={handleManual}>
              <div className={styles.twoCols}>
                <Input label="Titulo" value={manualForm.title} onChange={(e) => setManualForm({ ...manualForm, title: e.target.value })} required />
                <Input label="Empresa" value={manualForm.company} onChange={(e) => setManualForm({ ...manualForm, company: e.target.value })} />
              </div>
              <div className={styles.twoCols}>
                <Input label="Ubicacion" value={manualForm.location} onChange={(e) => setManualForm({ ...manualForm, location: e.target.value })} />
                <Input label="Salario" value={manualForm.salary} onChange={(e) => setManualForm({ ...manualForm, salary: e.target.value })} />
              </div>
              <Input label="URL" value={manualForm.url} onChange={(e) => setManualForm({ ...manualForm, url: e.target.value })} />
              <Input label="Tags" value={manualForm.tags} onChange={(e) => setManualForm({ ...manualForm, tags: e.target.value })} placeholder="Java, Spring, AWS" />
              <Input label="Descripcion" textarea value={manualForm.description} onChange={(e) => setManualForm({ ...manualForm, description: e.target.value })} />
              <Button disabled={busy || !manualForm.title.trim()} icon={FilePlus2} type="submit">Guardar manual</Button>
            </form>
          )}
        </Card>

        <aside className={styles.side}>
          <Card title="Fuentes disponibles" icon={Globe2} meta={`${configuredSources.length}/${sources.length} activas`}>
            {sources.length ? (
              <div className={styles.sources}>
                {sources.map((source) => {
                  const enabled = source.enabled && source.configured;
                  return (
                    <label className={[styles.source, !enabled ? styles.disabled : ""].join(" ")} key={source.id}>
                      <input
                        checked={selectedSources.includes(source.id)}
                        disabled={!enabled}
                        onChange={() => toggleSource(source.id)}
                        type="checkbox"
                      />
                      <span>
                        <strong>{source.name}</strong>
                        <small>{enabled ? "Lista para buscar" : source.requires_api_key ? "Sin clave" : "Deshabilitada"}</small>
                      </span>
                    </label>
                  );
                })}
              </div>
            ) : (
              <EmptyState title="Sin fuentes" text="El endpoint /api/sources no devolvio proveedores configurados." />
            )}
          </Card>

          <Card title="Resultado" icon={CheckCircle2} hover={false}>
            {result ? (
              <div className={styles.result}>
                <Badge tone="success">Validado</Badge>
                <pre>{JSON.stringify(result, null, 2)}</pre>
              </div>
            ) : (
              <div className={styles.resultIdle}>
                <p>El resultado real del backend aparecera aqui despues de ejecutar una accion.</p>
              </div>
            )}
          </Card>
        </aside>
      </div>
    </section>
  );
}

function Toggle({ label, checked, onChange }) {
  return (
    <label className={styles.toggle}>
      <input checked={checked} onChange={(event) => onChange(event.target.checked)} type="checkbox" />
      <span>{label}</span>
    </label>
  );
}

function PageError({ message, onRetry }) {
  return (
    <div className={styles.error}>
      <strong>No se pudieron cargar las fuentes</strong>
      <p>{message}</p>
      <Button onClick={onRetry} variant="secondary">Reintentar</Button>
    </div>
  );
}

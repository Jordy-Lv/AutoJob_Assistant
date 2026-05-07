import { useCallback, useContext, useMemo, useState } from "react";
import { Bell, Pause, Play, Plus, RadioTower, Save, Trash2 } from "lucide-react";
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
import Modal from "@/components/ui/Modal/Modal";
import Spinner from "@/components/ui/Spinner/Spinner";
import { formatDateTime, normalizeListPayload } from "@/utils/formatters";
import styles from "./Guardados.module.css";

const emptyForm = {
  name: "",
  query: "",
  location: "",
  remote_only: true,
  junior_only: false,
  internship_allowed: false,
  selected_sources: [],
  date_filter: "",
  score_threshold: 70,
  interval_minutes: 360,
  enabled: true,
};

export default function Guardados() {
  const fetchSaved = useCallback(async () => {
    const [savedPayload, sourcesPayload] = await Promise.all([
      request(endpoints.savedSearches.list()),
      request(endpoints.sources.list()),
    ]);
    return {
      saved: savedPayload.saved_searches || [],
      sources: normalizeListPayload(sourcesPayload, "sources"),
    };
  }, []);

  const { data, loading, error, refetch } = useFetch(fetchSaved);
  const { success, error: toastError } = useToast();
  const { refreshCounters } = useContext(AppContext);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [busyKey, setBusyKey] = useState("");

  const configuredSources = useMemo(() => (data?.sources || []).filter((source) => source.enabled && source.configured), [data]);

  if (loading) return <Spinner full label="Cargando busquedas guardadas..." />;
  if (error) return <PageError message={error.message} onRetry={refetch} />;

  async function afterMutation(message) {
    await refetch();
    await refreshCounters();
    success(message);
  }

  function openCreate() {
    setEditingId(null);
    setForm({ ...emptyForm, selected_sources: configuredSources.slice(0, 3).map((source) => source.id) });
    setModalOpen(true);
  }

  function openEdit(saved) {
    setEditingId(saved.id);
    setForm({ ...emptyForm, ...saved, selected_sources: saved.selected_sources || [] });
    setModalOpen(true);
  }

  async function saveSearch(event) {
    event.preventDefault();
    setBusyKey("save");
    try {
      const endpoint = editingId ? endpoints.savedSearches.update(editingId) : endpoints.savedSearches.create();
      const method = editingId ? "PUT" : "POST";
      const response = await request(endpoint, { method, body: form });
      if (!response?.id) throw new Error("El backend no confirmo la busqueda guardada.");
      setModalOpen(false);
      await afterMutation(editingId ? "Busqueda actualizada." : "Busqueda guardada creada.");
    } catch (err) {
      toastError(err.message || "No se pudo guardar la busqueda.");
    } finally {
      setBusyKey("");
    }
  }

  async function toggleEnabled(saved) {
    setBusyKey(`toggle:${saved.id}`);
    try {
      const response = await request(endpoints.savedSearches.update(saved.id), {
        method: "PUT",
        body: { ...saved, enabled: !saved.enabled },
      });
      if (response?.enabled === saved.enabled) throw new Error("El cambio de estado no fue confirmado.");
      await afterMutation(response.enabled ? "Busqueda activada." : "Busqueda pausada.");
    } catch (err) {
      toastError(err.message || "No se pudo cambiar el estado.");
    } finally {
      setBusyKey("");
    }
  }

  async function runSaved(saved) {
    setBusyKey(`run:${saved.id}`);
    try {
      const response = await request(endpoints.savedSearches.run(saved.id), { method: "POST" });
      if (!response?.search_result) throw new Error("La ejecucion no devolvio resultado.");
      await afterMutation("Busqueda guardada ejecutada.");
    } catch (err) {
      toastError(err.message || "No se pudo ejecutar la busqueda.");
    } finally {
      setBusyKey("");
    }
  }

  async function deleteSaved(saved) {
    setBusyKey(`delete:${saved.id}`);
    try {
      await request(endpoints.savedSearches.delete(saved.id), { method: "DELETE" });
      await afterMutation("Busqueda eliminada.");
    } catch (err) {
      toastError(err.message || "No se pudo eliminar la busqueda.");
    } finally {
      setBusyKey("");
    }
  }

  function toggleSource(sourceId) {
    setForm((current) => ({
      ...current,
      selected_sources: current.selected_sources.includes(sourceId)
        ? current.selected_sources.filter((id) => id !== sourceId)
        : [...current.selected_sources, sourceId],
    }));
  }

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>Guardados</span>
          <h1>Busquedas automaticas guardadas</h1>
          <p>Configura consultas recurrentes y ejecutalas manualmente cuando quieras refrescar oportunidades.</p>
        </div>
        <Button icon={Plus} onClick={openCreate}>Crear busqueda</Button>
      </header>

      {data?.saved?.length ? (
        <div className={styles.list}>
          {data.saved.map((saved) => (
            <Card key={saved.id} title={saved.name} icon={Bell} meta={saved.query}>
              <div className={styles.saved}>
                <div className={styles.meta}>
                  <Badge tone={saved.enabled ? "success" : "neutral"}>{saved.enabled ? "Activa" : "Pausada"}</Badge>
                  <Badge tone="info">{saved.interval_minutes} min</Badge>
                  <Badge tone="warning">Score {saved.score_threshold}%</Badge>
                  <span>Ultima ejecucion: {formatDateTime(saved.last_run_at)}</span>
                </div>
                <div className={styles.sources}>
                  {(saved.selected_sources || []).map((source) => <Badge key={source}>{source}</Badge>)}
                </div>
                <div className={styles.actions}>
                  <Button disabled={busyKey === `run:${saved.id}` || !saved.enabled} icon={RadioTower} onClick={() => runSaved(saved)} size="sm" variant="secondary">Ejecutar</Button>
                  <Button disabled={busyKey === `toggle:${saved.id}`} icon={saved.enabled ? Pause : Play} onClick={() => toggleEnabled(saved)} size="sm" variant="secondary">
                    {saved.enabled ? "Pausar" : "Activar"}
                  </Button>
                  <Button onClick={() => openEdit(saved)} size="sm" variant="secondary">Editar</Button>
                  <Button disabled={busyKey === `delete:${saved.id}`} icon={Trash2} onClick={() => deleteSaved(saved)} size="sm" variant="danger">Eliminar</Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Bell}
          title="No hay busquedas guardadas"
          text="Crea una consulta recurrente para mantener la bandeja viva sin repetir configuracion."
          action={<Button icon={Plus} onClick={openCreate}>Crear busqueda</Button>}
        />
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editingId ? "Editar busqueda" : "Crear busqueda"}>
        <form className={styles.form} onSubmit={saveSearch}>
          <div className={styles.twoCols}>
            <Input label="Nombre" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
            <Input label="Busqueda" value={form.query} onChange={(event) => setForm({ ...form, query: event.target.value })} required />
          </div>
          <Input label="Ubicacion" value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} />
          <div className={styles.twoCols}>
            <Input label="Umbral score" min="0" max="100" type="number" value={form.score_threshold} onChange={(event) => setForm({ ...form, score_threshold: Number(event.target.value) })} />
            <Input label="Intervalo min" min="15" max="1440" type="number" value={form.interval_minutes} onChange={(event) => setForm({ ...form, interval_minutes: Number(event.target.value) })} />
          </div>
          <label className={styles.toggle}>
            <input checked={form.remote_only} onChange={(event) => setForm({ ...form, remote_only: event.target.checked })} type="checkbox" />
            <span>Solo remoto</span>
          </label>
          <label className={styles.toggle}>
            <input checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} type="checkbox" />
            <span>Busqueda activa</span>
          </label>
          <div className={styles.sourceGrid}>
            {configuredSources.map((source) => (
              <label className={styles.sourceOption} key={source.id}>
                <input checked={form.selected_sources.includes(source.id)} onChange={() => toggleSource(source.id)} type="checkbox" />
                <span>{source.name}</span>
              </label>
            ))}
          </div>
          <Button disabled={busyKey === "save" || form.query.trim().length < 2 || !form.name.trim()} icon={Save} type="submit">
            Guardar
          </Button>
        </form>
      </Modal>
    </section>
  );
}

function PageError({ message, onRetry }) {
  return (
    <div className={styles.error}>
      <strong>No se pudieron cargar busquedas guardadas</strong>
      <p>{message}</p>
      <Button onClick={onRetry} variant="secondary">Reintentar</Button>
    </div>
  );
}

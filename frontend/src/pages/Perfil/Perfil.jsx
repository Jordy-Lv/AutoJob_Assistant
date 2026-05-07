import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { CheckCircle2, GraduationCap, Save, UserRound } from "lucide-react";
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
import { profileCompletion } from "@/utils/formatters";
import styles from "./Perfil.module.css";

const emptyProfile = {
  full_name: "",
  target_role: "",
  summary: "",
  skills: "",
  experience: "",
  education: "",
  projects: "",
  links: "",
  keywords: "",
};

const sections = [
  { title: "Info basica", fields: ["full_name", "summary"] },
  { title: "Rol objetivo", fields: ["target_role", "keywords"] },
  { title: "Habilidades", fields: ["skills", "projects"] },
  { title: "Experiencia", fields: ["experience"] },
  { title: "Educacion", fields: ["education", "links"] },
];

const labels = {
  full_name: "Nombre completo",
  target_role: "Rol objetivo",
  summary: "Resumen profesional",
  skills: "Habilidades",
  experience: "Experiencia",
  education: "Educacion",
  projects: "Proyectos",
  links: "Links",
  keywords: "Palabras clave",
};

export default function Perfil() {
  const fetchProfile = useCallback(() => request(endpoints.profile()), []);
  const { data, loading, error, refetch } = useFetch(fetchProfile);
  const { success, error: toastError } = useToast();
  const { setUser, refreshCounters } = useContext(AppContext);
  const [form, setForm] = useState(emptyProfile);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data) setForm({ ...emptyProfile, ...data });
  }, [data]);

  const progress = profileCompletion(form);
  const filledFields = useMemo(
    () => Object.keys(emptyProfile).filter((field) => String(form[field] || "").trim().length > 0),
    [form],
  );

  if (loading) return <Spinner full label="Cargando perfil..." />;
  if (error) return <PageError message={error.message} onRetry={refetch} />;
  if (!data) return <EmptyState title="No se encontro perfil" text="El endpoint de perfil no devolvio datos." />;

  async function saveProfile(event) {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await request(endpoints.profile(), { method: "POST", body: form });
      if (!response || typeof response !== "object") throw new Error("El backend no devolvio perfil actualizado.");
      setForm({ ...emptyProfile, ...response });
      setUser(response);
      await refreshCounters();
      success("Perfil guardado.");
    } catch (err) {
      toastError(err.message || "No se pudo guardar el perfil.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <span className={styles.eyebrow}>Perfil</span>
        <h1>Base profesional para analisis y documentos</h1>
        <p>Completa los campos que el motor usa para calcular compatibilidad y generar textos personalizados.</p>
      </header>

      <div className={styles.layout}>
        <form className={styles.form} onSubmit={saveProfile}>
          {sections.map((section) => (
            <Card key={section.title} title={section.title} icon={section.title === "Educacion" ? GraduationCap : UserRound} hover={false}>
              <div className={styles.fields}>
                {section.fields.map((field) => (
                  <Input
                    key={field}
                    label={labels[field]}
                    onChange={(event) => setForm({ ...form, [field]: event.target.value })}
                    textarea={!["full_name", "target_role"].includes(field)}
                    value={form[field] || ""}
                  />
                ))}
              </div>
            </Card>
          ))}
          <Button disabled={saving} icon={Save} type="submit">Guardar perfil</Button>
        </form>

        <aside className={styles.progress}>
          <Card title="Progreso" icon={CheckCircle2} meta={`${progress}% completo`} hover={false}>
            <div className={styles.progressValue}>{progress}%</div>
            <div className={styles.track}>
              <span style={{ width: `${progress}%` }} />
            </div>
            <div className={styles.fieldList}>
              {Object.keys(emptyProfile).map((field) => (
                <div className={styles.fieldState} key={field}>
                  <Badge tone={filledFields.includes(field) ? "success" : "neutral"}>
                    {filledFields.includes(field) ? "OK" : "Pendiente"}
                  </Badge>
                  <span>{labels[field]}</span>
                </div>
              ))}
            </div>
          </Card>
        </aside>
      </div>
    </section>
  );
}

function PageError({ message, onRetry }) {
  return (
    <div className={styles.error}>
      <strong>No se pudo cargar Perfil</strong>
      <p>{message}</p>
      <Button onClick={onRetry} variant="secondary">Reintentar</Button>
    </div>
  );
}

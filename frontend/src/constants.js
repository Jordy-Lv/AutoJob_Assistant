import {
  Bell,
  Briefcase,
  Database,
  ExternalLink,
  FileArchive,
  FileText,
  Gauge,
  History,
  ListChecks,
  Search,
  Target,
  UserRound,
  WandSparkles,
} from "lucide-react";

export const THEME_KEY = "autojob-theme";

export const STATUSES = ["Nueva", "Vista", "Interesante", "Lista para aplicar", "Aplicada", "Descartada"];

export const STATUS_LABELS = {
  Nueva: "Nueva",
  Vista: "Vista",
  Interesante: "Interesante",
  "Lista para aplicar": "Lista para aplicar",
  Aplicada: "Aplicada manualmente",
  Descartada: "Descartada",
  Aprobada: "Lista para aplicar",
  "En aplicacion": "Aplicada manualmente",
  "Captcha requerido": "Aplicada manualmente",
  "Necesita revision": "Lista para aplicar",
  Error: "Descartada",
};

export const NAV_ITEMS = [
  { key: "inicio", path: "/", label: "Inicio", icon: Gauge, hint: "Resumen y siguiente accion", group: "primary" },
  { key: "buscar", path: "/buscar", label: "Buscar ofertas", icon: Search, hint: "Buscar o capturar oportunidades", group: "primary" },
  { key: "ofertas", path: "/ofertas", label: "Ofertas", icon: Briefcase, hint: "Revisar oportunidades", group: "primary", counterKey: "ofertas" },
  { key: "analisis", path: "/analisis", label: "Analisis", icon: WandSparkles, hint: "Scores y brechas", group: "primary", counterKey: "pendientes" },
  { key: "guardados", path: "/guardados", label: "Guardados", icon: Bell, hint: "Busquedas automaticas", group: "secondary", counterKey: "guardados" },
  { key: "documentos", path: "/documentos", label: "Documentos", icon: FileArchive, hint: "CV y carta por oferta", group: "secondary", counterKey: "documentos" },
  { key: "perfil", path: "/perfil", label: "Perfil", icon: UserRound, hint: "Tu base profesional", group: "secondary" },
  { key: "historial", path: "/historial", label: "Historial", icon: History, hint: "Busquedas y aplicaciones", group: "secondary" },
  { key: "configuracion", path: "/configuracion", label: "Configuracion", icon: Database, hint: "Estado tecnico", group: "technical" },
];

export const FLOW_STEPS = [
  { key: "profile", label: "Configurar perfil", icon: UserRound, target: "profile" },
  { key: "search", label: "Buscar ofertas", icon: Search, target: "search" },
  { key: "review", label: "Revisar bandeja", icon: ListChecks, target: "jobs" },
  { key: "analyze", label: "Analizar compatibilidad", icon: WandSparkles, target: "jobs" },
  { key: "top", label: "Mejores oportunidades", icon: Target, target: "jobs" },
  { key: "documents", label: "Generar CV / carta", icon: FileText, target: "documents" },
  { key: "apply", label: "Aplicar manualmente", icon: ExternalLink, target: "jobs" },
];

export const JOB_FILTERS = [
  { key: "all", label: "Todas" },
  { key: "new", label: "Nuevas" },
  { key: "viewed", label: "Vistas" },
  { key: "good", label: "Buen match" },
  { key: "docs", label: "Con documentos" },
  { key: "applied", label: "Aplicadas" },
];

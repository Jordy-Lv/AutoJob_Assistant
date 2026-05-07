# AutoJob Assistant

MVP local para automatizar parte del proceso de busqueda y preparacion de aplicaciones laborales.

## Funciones

- Guardar perfil profesional, habilidades, experiencia, proyectos y links.
- Buscar ofertas remotas desde Remotive.
- Importar ofertas desde URL con `requests` + BeautifulSoup o Playwright.
- Guardar ofertas en PostgreSQL.
- Analizar compatibilidad entre perfil y oferta.
- Enriquecer el analisis con IA si configuras una API key.
- Gestionar estados: nueva, interesante, lista para aplicar, aplicada y descartada.
- Generar CV y carta personalizados en DOCX y PDF.
- Cola de automatizacion para ofertas aprobadas.
- Pausa asistida cuando una aplicacion encuentra captcha.

## Instalacion

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m playwright install chromium
```

Playwright solo es necesario si vas a importar paginas dinamicas desde URL.

## PostgreSQL

La app usa `DATABASE_URL`. Crea `.env` desde el ejemplo:

```powershell
Copy-Item .env.example .env
```

Opcion A, servicio local de Windows:

```env
DATABASE_URL=postgresql+psycopg://autojob:autojob@localhost:5432/autojob
```

Debes crear previamente el usuario `autojob`, la base `autojob` y darle permisos.

Opcion B, Docker Compose:

```powershell
.\scripts\init_postgres_docker.ps1
```

Luego usa:

```env
DATABASE_URL=postgresql+psycopg://autojob:autojob@localhost:5433/autojob
```

## IA opcional

La app funciona sin llaves externas. Si quieres analisis asistido por IA:

```powershell
Copy-Item .env.example .env
notepad .env
```

Agrega `OPENAI_API_KEY` y, si quieres, `OPENAI_MODEL`. Luego activa la casilla "Usar IA si esta configurada" en la barra lateral.

## Ejecucion

Frontend nuevo con React:

```powershell
.\.venv\Scripts\python -m uvicorn api:app --host 127.0.0.1 --port 8501
cd frontend
npm install
npm run dev
```

Abre `http://localhost:5173`.
En modo Vite dev, `/api` se proxifica al backend en `http://127.0.0.1:8501`. Si levantas FastAPI en otro puerto, define `VITE_API_PROXY_TARGET`, por ejemplo:

```powershell
$env:VITE_API_PROXY_TARGET="http://127.0.0.1:8000"
npm run dev
```

## Frontend React

El dashboard fue reestructurado como una app React 18 + Vite con React Router v6, CSS Modules y fetch nativo centralizado.

Estructura principal:

```text
frontend/src/
  styles/              variables.css, reset.css, global.css
  api/                 client.js, endpoints.js
  context/             AppContext.jsx, ToastContext.jsx
  hooks/               useFetch.js, useToast.js, useTheme.js
  components/ui/       Button, Card, Input, Badge, EmptyState, StatCard, Toast, Modal, Spinner
  components/layout/   Sidebar, TopBar, Layout
  pages/               Inicio, BuscarOfertas, Ofertas, Analisis, Fuentes, Guardados, Documentos, Perfil, Historial, Configuracion
  utils/               formatters.js
  App.jsx              providers + router
```

Paleta y tema:

- Los tokens viven en `frontend/src/styles/variables.css`.
- `:root` define la paleta central con capas `--bg-base`, `--bg-elevated`, `--bg-card`, `--bg-card-hover`, `--bg-input`, bordes `--border-subtle/default/strong/focus`, texto `--text-primary/secondary/tertiary/disabled`, marca `--primary-*`, acento `--accent-*` y estados semanticos.
- Los colores de componentes deben salir de esos tokens; no agregues colores literales en CSS Modules.
- Los componentes consumen variables CSS desde sus `.module.css`; no se usa Tailwind, styled-components ni CSS-in-JS.

Agregar una vista nueva:

1. Crear `frontend/src/pages/NuevaVista/NuevaVista.jsx` y `NuevaVista.module.css`.
2. Registrar la ruta en `frontend/src/App.jsx`.
3. Agregar el item de navegacion en `frontend/src/constants.js` con `path`, `group`, `icon` y `counterKey` si necesita contador real.
4. Consumir datos mediante `useFetch` y endpoints definidos en `frontend/src/api/endpoints.js`.

Extender el tema:

1. Agregar el token en `variables.css` bajo `:root`.
2. Si cambia en modo claro, agregar su override en `[data-theme="light"]`.
3. Usar el token desde CSS Modules, nunca desde estilos inline salvo valores dinamicos como progreso.

El wrapper `frontend/src/api/client.js` registra el ultimo error HTTP real. El layout muestra el badge inferior derecho con status, endpoint, mensaje y timestamp, y el boton inferior izquierdo `Revisar DB` ejecuta `GET /api/health`.

Dashboard anterior en Streamlit:

```powershell
streamlit run app.py
```

La base de datos vive en PostgreSQL. Los documentos se generan en `outputs/`.
`data/` se usa para perfil de navegador, screenshots y archivos auxiliares.

## Flujo sugerido

1. Completa tu perfil en la barra lateral.
2. Busca ofertas con tus palabras clave o importa una URL.
3. En el dashboard, selecciona una oferta y analiza compatibilidad.
4. Genera CV y carta.
5. Revisa los documentos antes de aplicar.
6. Aprueba la oferta para automatizacion.
7. En la pestana Automatizacion, aplica solo ofertas aprobadas.
8. Si aparece captcha, resuelvelo manualmente en el navegador visible y pulsa continuar.

## Busqueda multi-fuente

Endpoint principal:

```powershell
curl.exe -X POST http://127.0.0.1:8501/api/search/jobs `
  -H "Content-Type: application/json" `
  -d "{\"query\":\"Java Developer\",\"remote_only\":true,\"limit\":10,\"selected_sources\":[\"remotive\",\"arbeitnow\",\"remoteok\"]}"
```

Tambien puedes consultar fuentes y ejecuciones:

```powershell
curl.exe http://127.0.0.1:8501/api/search/sources
curl.exe http://127.0.0.1:8501/api/search/runs
```

Fuentes integradas: Remotive, Arbeitnow y RemoteOK. Adzuna se activa con `ADZUNA_APP_ID` + `ADZUNA_APP_KEY`; SerpAPI se activa con `SERPAPI_KEY` para Google Jobs y para la fuente `LinkedIn via SerpAPI`. La fuente de LinkedIn revisa la pagina publica de cada oferta y descarta las que muestren textos como "Ya no se aceptan solicitudes" o "No longer accepting applications".

Para agregar nuevas fuentes, revisa `docs/search_providers.md`.

Las claves se configuran en el archivo `.env` de la raiz del proyecto:

```env
ADZUNA_APP_ID=
ADZUNA_APP_KEY=
ADZUNA_COUNTRY=us
SERPAPI_KEY=
SERPAPI_LINKEDIN_VERIFY_APPLY_STATUS=true
SERPAPI_LINKEDIN_PAGE_TIMEOUT=6
SERPAPI_LINKEDIN_VERIFY_WORKERS=5
RAPIDAPI_KEY=
```

Despues de editar `.env`, reinicia FastAPI para que lea las nuevas variables.

## Consideraciones

La app no aplica ofertas que no hayas aprobado primero. El objetivo es reducir trabajo repetitivo y mantener siempre la revision final del usuario.
No intenta romper captchas, usar OCR, resolver audio-captchas ni evadir protecciones anti-bot. Cuando detecta captcha, pausa y espera intervencion humana.

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

Fuentes integradas: Remotive, Arbeitnow y RemoteOK. Adzuna se activa con `ADZUNA_APP_ID` + `ADZUNA_APP_KEY`; SerpAPI se activa con `SERPAPI_KEY` para Google Jobs y para la fuente `LinkedIn via SerpAPI`.

Para agregar nuevas fuentes, revisa `docs/search_providers.md`.

Las claves se configuran en el archivo `.env` de la raiz del proyecto:

```env
ADZUNA_APP_ID=
ADZUNA_APP_KEY=
ADZUNA_COUNTRY=us
SERPAPI_KEY=
RAPIDAPI_KEY=
```

Despues de editar `.env`, reinicia FastAPI para que lea las nuevas variables.

## Consideraciones

La app no aplica ofertas que no hayas aprobado primero. El objetivo es reducir trabajo repetitivo y mantener siempre la revision final del usuario.
No intenta romper captchas, usar OCR, resolver audio-captchas ni evadir protecciones anti-bot. Cuando detecta captcha, pausa y espera intervencion humana.

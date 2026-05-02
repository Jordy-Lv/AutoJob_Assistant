# Motor de busqueda de ofertas

El backend usa una arquitectura de proveedores en `autojob/job_sources/`.
Cada fuente implementa `JobSourceProvider`:

```python
class MyProvider(JobSourceProvider):
    source_id = "my_source"
    display_name = "My Source"
    enabled = True
    requires_api_key = False

    def search(self, params: SearchParams) -> list[JobOffer]:
        payload = self._get_json("https://example.com/jobs", {"q": params.query})
        return [self.normalize(item) for item in payload["jobs"]]

    def normalize(self, raw_item: dict[str, Any]) -> JobOffer:
        return JobOffer(
            source="My Source",
            external_id=str(raw_item["id"]),
            title=raw_item["title"],
            company=raw_item.get("company", ""),
            location=raw_item.get("location", ""),
            url=raw_item.get("url", ""),
            description=raw_item.get("description", ""),
            salary=raw_item.get("salary", ""),
            tags=raw_item.get("tags", []),
            published_at=raw_item.get("published_at", ""),
            remote=bool(raw_item.get("remote")),
            seniority=infer_seniority(raw_item["title"], raw_item.get("description", "")),
            employment_type=normalize_employment_type(raw_item.get("employment_type", ""), raw_item["title"]),
        )
```

Luego agrega el proveedor en `autojob/job_sources/registry.py`.

Reglas importantes:

- Usa APIs publicas, feeds JSON/RSS o proveedores configurables.
- No automatices login ni intentes resolver captchas.
- Respeta timeouts y limites. `_get_json()` usa timeout y retry controlado.
- Normaliza siempre a `JobOffer`.
- Si una fuente falla, lanza `ProviderError`; el motor devolvera resultados parciales.

Endpoint principal:

```http
POST /api/search/jobs
```

Payload:

```json
{
  "query": "Java Developer",
  "location": "Remote",
  "remote_only": true,
  "junior_only": false,
  "internship_allowed": false,
  "limit": 25,
  "selected_sources": ["remotive", "arbeitnow", "remoteok", "adzuna", "serpapi"],
  "date_filter": "7d",
  "page": 1,
  "auto_analyze": false,
  "save_results": true
}
```

Fuentes iniciales:

- `remotive`: API publica de Remotive.
- `arbeitnow`: API publica de Arbeitnow.
- `remoteok`: JSON feed publico de RemoteOK.
- `adzuna`: API oficial de Adzuna. Requiere `ADZUNA_APP_ID` y `ADZUNA_APP_KEY`.
- `serpapi`: SerpAPI Google Jobs. Requiere `SERPAPI_KEY`.

Las claves se agregan en `.env`:

```env
ADZUNA_APP_ID=
ADZUNA_APP_KEY=
ADZUNA_COUNTRY=us
SERPAPI_KEY=
RAPIDAPI_KEY=
```

Reinicia el backend despues de cambiar `.env`.

Fuentes y estado:

```http
GET /api/sources
```

Cada busqueda queda registrada en `search_runs` con filtros, fuentes, totales, duplicados, errores y estado.

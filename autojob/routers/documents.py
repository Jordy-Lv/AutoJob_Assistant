from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, StreamingResponse

from autojob import db
from autojob.documents import (
    DOCUMENT_FILENAMES,
    generate_cv_docx,
    generate_cv_pdf,
    generate_letter_docx,
    generate_letter_pdf,
)

from .utils import all_documents, analysis_from_job, resolve_output_file

router = APIRouter(prefix="/api/documents")

_GENERATORS = {
    "CV DOCX": generate_cv_docx,
    "CV PDF": generate_cv_pdf,
    "Carta DOCX": generate_letter_docx,
    "Carta PDF": generate_letter_pdf,
}


def _stream_document(document_id: int, disposition: str):
    document = db.get_document(document_id)
    if document is None:
        raise HTTPException(status_code=404, detail="El documento todavia no existe")
    path = str(document.get("path") or "")
    doc_type = document.get("doc_type", "")
    if path:
        file_path = resolve_output_file(path)
        return FileResponse(file_path, filename=file_path.name, media_type="text/plain", headers={"Content-Disposition": f'{disposition}; filename="{file_path.name}"'})

    job_id = document.get("job_id")
    job = db.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Oferta no encontrada")
    generator = _GENERATORS.get(doc_type)
    if generator is None:
        raise HTTPException(status_code=400, detail=f"Tipo de documento no soportado: {doc_type}")
    profile = db.get_profile()
    analysis = analysis_from_job(job)
    filename, media_type = DOCUMENT_FILENAMES[doc_type]
    buffer = generator(profile, job, analysis)
    return StreamingResponse(
        buffer,
        media_type=media_type,
        headers={"Content-Disposition": f'{disposition}; filename="{filename}"'},
    )


@router.get("")
def list_all_documents() -> dict[str, Any]:
    jobs = db.list_jobs()
    return {"documents": all_documents(jobs)}


@router.get("/{document_id}")
def serve_document(document_id: int):
    return _stream_document(document_id, "inline")


@router.get("/{document_id}/download")
def download_document(document_id: int):
    return _stream_document(document_id, "attachment")

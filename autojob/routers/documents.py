from __future__ import annotations

import mimetypes
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from autojob import db

from .utils import all_documents, resolve_output_file


router = APIRouter(prefix="/api/documents")


@router.get("")
def list_all_documents() -> dict[str, Any]:
    jobs = db.list_jobs()
    return {"documents": all_documents(jobs)}


@router.get("/{document_id}")
def serve_document(document_id: int):
    document = db.get_document(document_id)
    if document is None:
        raise HTTPException(status_code=404, detail="El documento todavia no existe")
    path = resolve_output_file(str(document.get("path") or ""))
    media_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    return FileResponse(
        path,
        media_type=media_type,
        filename=path.name,
        content_disposition_type="inline",
    )


@router.get("/{document_id}/download")
def download_document(document_id: int):
    document = db.get_document(document_id)
    if document is None:
        raise HTTPException(status_code=404, detail="El documento todavia no existe")
    path = resolve_output_file(str(document.get("path") or ""))
    media_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    return FileResponse(
        path,
        media_type=media_type,
        filename=path.name,
        content_disposition_type="attachment",
    )

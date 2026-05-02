from __future__ import annotations

import socket
import subprocess
import sys
import webbrowser
from pathlib import Path


HOST = "127.0.0.1"
PORT = 8501
URL = f"http://{HOST}:{PORT}"


def _port_is_open(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as client:
        client.settimeout(0.5)
        return client.connect_ex((host, port)) == 0


def _running_inside_streamlit() -> bool:
    try:
        from streamlit.runtime.scriptrunner import get_script_run_ctx

        return get_script_run_ctx() is not None
    except Exception:
        return False


def _render_streamlit_notice() -> None:
    import streamlit as st

    st.set_page_config(page_title="AutoJob Assistant", layout="centered")
    st.title("AutoJob Assistant ahora usa React + FastAPI")
    st.write(
        "La interfaz anterior de Streamlit fue reemplazada por el nuevo dashboard. "
        "Ejecuta este comando y abre la URL:"
    )
    st.code(r".\.venv\Scripts\python.exe -m uvicorn api:app --host 127.0.0.1 --port 8501", language="powershell")
    st.link_button("Abrir dashboard nuevo", URL)


def main() -> int:
    if _running_inside_streamlit():
        _render_streamlit_notice()
        return 0

    root = Path(__file__).resolve().parent
    if _port_is_open(HOST, PORT):
        print(f"AutoJob Assistant ya esta corriendo en {URL}")
        webbrowser.open(URL)
        return 0

    print(f"Iniciando AutoJob Assistant en {URL}")
    webbrowser.open(URL)
    return subprocess.call(
        [sys.executable, "-m", "uvicorn", "api:app", "--host", HOST, "--port", str(PORT)],
        cwd=root,
    )


if __name__ == "__main__":
    raise SystemExit(main())

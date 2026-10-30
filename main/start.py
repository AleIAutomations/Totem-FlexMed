from __future__ import annotations

import os
import shutil
import socket
import subprocess
import sys
import time
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PY = sys.executable
CERTS = ROOT / "backend" / "certs"
CERT, KEY = CERTS / "flexmed.crt", CERTS / "flexmed.key"


def ip_na_rede() -> str:
    """IP deste notebook na rede local (o que o totem usa para acessar)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))  # não envia nada; só escolhe a interface de saída
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


def garantir_certificado() -> bool:
    """Certificado autoassinado: o Android só libera a câmera do navegador em HTTPS."""
    if CERT.exists() and KEY.exists():
        return True
    if not shutil.which("openssl"):
        print("[aviso] openssl não encontrado: rodando sem HTTPS (a câmera do totem não vai abrir).")
        return False
    CERTS.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "825",
         "-keyout", str(KEY), "-out", str(CERT), "-subj", "/CN=FlexMed",
         "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"],
        check=True, capture_output=True,
    )
    print(f"Certificado HTTPS criado em {CERTS}")
    return True


https = garantir_certificado()
esquema = "https" if https else "http"

# 0.0.0.0 = aceita conexões da rede local (o totem acessa pelo IP do notebook).
# O backend também serve o frontend, então totem e admin usam a porta 5050.
env = {**os.environ, "FLEXMED_HOST": os.environ.get("FLEXMED_HOST", "0.0.0.0"),
       "FLEXMED_HTTPS": "1" if https else "0"}
backend = subprocess.Popen([PY, str(ROOT / "backend" / "app.py")], cwd=str(ROOT / "backend"), env=env)

try:
    time.sleep(2)
    ip = ip_na_rede()
    print("\nFlexMed v5 rodando:")
    print(f"  Totem (Android) : {esquema}://{ip}:5050/index.html   <- abra este endereço no totem")
    print(f"  Admin           : {esquema}://localhost:5050/admin.html")
    print("  O totem precisa estar na mesma rede Wi-Fi que este notebook.")
    if https:
        print("  Na primeira vez o navegador avisa que o certificado não é confiável:")
        print("  toque em 'Avançado' > 'Continuar' (no Fully Kiosk: ative 'Ignore SSL errors').\n")
    webbrowser.open(f"{esquema}://localhost:5050/admin.html")
    backend.wait()
except KeyboardInterrupt:
    print("\nEncerrando FlexMed...")
finally:
    if backend.poll() is None:
        backend.terminate()
        time.sleep(0.5)
    if backend.poll() is None:
        backend.kill()

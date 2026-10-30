#!/bin/bash
# FlexMed — inicia backend + frontend no notebook; o totem Android acessa pela rede.
cd "$(dirname "$0")/.."

# Usa o Python do ambiente virtual do projeto, se existir
PY=python3
[ -x .venv/bin/python ] && PY=.venv/bin/python

exec "$PY" main/start.py

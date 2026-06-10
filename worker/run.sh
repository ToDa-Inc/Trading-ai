#!/usr/bin/env bash
# Arranca el worker de ingesta en local.
set -e
cd "$(dirname "$0")"

if [ ! -d venv ]; then
  echo "Creando venv..."
  /opt/homebrew/opt/python@3.12/bin/python3.12 -m venv venv
  ./venv/bin/pip install --upgrade pip -q
  ./venv/bin/pip install -r requirements.txt
fi

exec ./venv/bin/uvicorn app.main:app --reload --port "${PORT:-8000}"

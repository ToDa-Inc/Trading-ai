import json
import time
from pathlib import Path

import httpx
from google import genai
from google.genai import types

from app.config import settings

client = genai.Client(api_key=settings.gemini_api_key)

OPENROUTER_BASE = "https://openrouter.ai/api/v1"

# deploy-trigger: 2026-06-11 (verificar auto-deploy en Railway)

_TRANSIENT_MARKERS = ("503", "UNAVAILABLE", "overloaded", "high demand", "429", "RESOURCE_EXHAUSTED")


def _with_retry(fn, *, attempts: int = 5, base_delay: float = 5.0):
    """Run fn(), retrying on transient Gemini errors with exponential backoff."""
    last_err = None
    for i in range(attempts):
        try:
            return fn()
        except Exception as e:  # noqa: BLE001
            msg = str(e)
            if not any(m in msg for m in _TRANSIENT_MARKERS):
                raise
            last_err = e
            if i < attempts - 1:
                time.sleep(base_delay * (2 ** i))
    raise last_err

ANALYSIS_PROMPT = """Analiza este video de trading en detalle. El usuario explica su técnica y estrategia de trading.

Devuelve un JSON con esta estructura exacta:
{
  "transcript": "transcripción completa con timestamps en formato [MM:SS] cuando cambie de tema",
  "strategy": {
    "name": "nombre de la estrategia si se menciona",
    "description": "descripción general",
    "entry_rules": ["regla de entrada 1", "regla 2"],
    "exit_rules": ["regla de salida 1", "regla 2"],
    "risk_management": ["gestión de riesgo 1", "regla 2"],
    "indicators": ["indicador 1", "indicador 2"],
    "timeframes": ["timeframe 1"],
    "patterns": ["patrón 1", "patrón 2"],
    "do_not_trade": ["condiciones donde NO operar"]
  },
  "segments": [
    {
      "topic": "tema del segmento",
      "ts_start": 0,
      "ts_end": 120,
      "content": "resumen detallado de lo explicado en este segmento",
      "rules": ["reglas específicas mencionadas"]
    }
  ]
}

Sé exhaustivo. Captura TODAS las reglas, condiciones, indicadores y matices que el trader mencione.
Responde SOLO con el JSON válido, sin markdown ni texto adicional."""

STRATEGY_MERGE_PROMPT = """Tienes un perfil de estrategia de trading existente y un nuevo análisis de video.
Fusiona la información en un único documento markdown completo que capture TODAS las reglas,
condiciones de entrada/salida, gestión de riesgo, indicadores y patrones del trader.

Perfil existente:
{existing}

Nuevo análisis:
{new_analysis}

Genera un markdown estructurado con secciones claras. No pierdas ninguna regla del perfil existente ni del nuevo análisis.
Responde SOLO con el markdown."""


def upload_video_to_gemini(file_path: str, mime_type: str = "video/mp4"):
    """Upload video file to Gemini File API and wait until ACTIVE."""
    uploaded = client.files.upload(file=Path(file_path))

    while uploaded.state.name == "PROCESSING":
        time.sleep(5)
        uploaded = client.files.get(name=uploaded.name)

    if uploaded.state.name != "ACTIVE":
        raise RuntimeError(f"Gemini file processing failed: {uploaded.state.name}")

    return uploaded


def analyze_video(gemini_file) -> dict:
    """Analyze video with Gemini and return structured JSON."""
    response = _with_retry(lambda: client.models.generate_content(
        model=settings.gemini_video_model,
        contents=[
            types.Content(
                role="user",
                parts=[
                    types.Part.from_uri(file_uri=gemini_file.uri, mime_type=gemini_file.mime_type),
                    types.Part.from_text(text=ANALYSIS_PROMPT),
                ],
            )
        ],
        config=types.GenerateContentConfig(
            temperature=0.2,
            response_mime_type="application/json",
        ),
    ))

    text = response.text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1].rsplit("```", 1)[0].strip()

    return json.loads(text)


def embed_text(text: str) -> list[float]:
    """Generate embedding for text via OpenRouter (OpenAI-compatible)."""
    resp = httpx.post(
        f"{OPENROUTER_BASE}/embeddings",
        headers={
            "Authorization": f"Bearer {settings.openrouter_api_key}",
            "Content-Type": "application/json",
            "X-Title": "Trading Coach Worker",
        },
        json={"model": settings.openrouter_embedding_model, "input": text},
        timeout=60,
    )
    resp.raise_for_status()
    return resp.json()["data"][0]["embedding"]


def merge_strategy_profile(existing: str, new_analysis: dict) -> str:
    """Merge existing strategy profile with new video analysis."""
    response = _with_retry(lambda: client.models.generate_content(
        model=settings.gemini_chat_model,
        contents=STRATEGY_MERGE_PROMPT.format(
            existing=existing or "Ninguno (primer video)",
            new_analysis=json.dumps(new_analysis, ensure_ascii=False, indent=2),
        ),
        config=types.GenerateContentConfig(temperature=0.2),
    ))
    return response.text.strip()

import base64
import json
from pathlib import Path

import httpx
from json_repair import repair_json

from app.config import settings

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


def _headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {settings.openrouter_api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": settings.openrouter_site_url,
        "X-Title": settings.openrouter_app_name,
    }


def _extract_json_blob(text: str) -> str:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[1].rsplit("```", 1)[0].strip()
        if cleaned.lower().startswith("json"):
            cleaned = cleaned[4:].lstrip()

    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start != -1 and end > start:
        cleaned = cleaned[start : end + 1]

    return cleaned


def _parse_json_response(text: str) -> dict:
    cleaned = _extract_json_blob(text)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        repaired = repair_json(cleaned, return_objects=True)
        if isinstance(repaired, dict):
            return repaired
        raise


def _video_data_url(file_path: str, mime_type: str) -> str:
    data = Path(file_path).read_bytes()
    encoded = base64.b64encode(data).decode("utf-8")
    return f"data:{mime_type};base64,{encoded}"


VIDEO_ANALYSIS_SCHEMA = {
    "type": "object",
    "properties": {
        "transcript": {"type": "string"},
        "strategy": {
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "description": {"type": "string"},
                "entry_rules": {"type": "array", "items": {"type": "string"}},
                "exit_rules": {"type": "array", "items": {"type": "string"}},
                "risk_management": {"type": "array", "items": {"type": "string"}},
                "indicators": {"type": "array", "items": {"type": "string"}},
                "timeframes": {"type": "array", "items": {"type": "string"}},
                "patterns": {"type": "array", "items": {"type": "string"}},
                "do_not_trade": {"type": "array", "items": {"type": "string"}},
            },
        },
        "segments": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "topic": {"type": "string"},
                    "ts_start": {"type": "number"},
                    "ts_end": {"type": ["number", "null"]},
                    "content": {"type": "string"},
                    "rules": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["topic", "content"],
            },
        },
    },
    "required": ["transcript", "strategy", "segments"],
}


def _video_analysis_request_body(video_url: str, *, force_ai_studio: bool = False) -> dict:
    body: dict = {
        "model": settings.openrouter_video_model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "video_url", "video_url": {"url": video_url}},
                    {"type": "text", "text": ANALYSIS_PROMPT},
                ],
            }
        ],
        "temperature": 0.2,
        "max_tokens": 16384,
        "response_format": {
            "type": "json_schema",
            "json_schema": {
                "name": "video_analysis",
                "strict": False,
                "schema": VIDEO_ANALYSIS_SCHEMA,
            },
        },
        "plugins": [{"id": "response-healing"}],
    }
    if force_ai_studio:
        body["provider"] = {"only": ["google-ai-studio"]}
    return body


def _run_video_analysis(request_body: dict) -> dict:
    with httpx.Client(timeout=600.0) as client:
        response = client.post(
            f"{settings.openrouter_base_url}/chat/completions",
            headers=_headers(),
            json=request_body,
        )
        response.raise_for_status()
        payload = response.json()

    text = payload["choices"][0]["message"]["content"]
    if not text:
        raise ValueError("OpenRouter returned empty video analysis content")

    return _parse_json_response(text)


def analyze_video(file_path: str, mime_type: str = "video/mp4") -> dict:
    """Analyze a local video via OpenRouter multimodal chat (base64 data URL)."""
    video_url = _video_data_url(file_path, mime_type)
    return _run_video_analysis(_video_analysis_request_body(video_url))


def analyze_youtube_video(youtube_url: str) -> dict:
    """Analyze a public YouTube video via OpenRouter (requires Google AI Studio)."""
    return _run_video_analysis(
        _video_analysis_request_body(youtube_url, force_ai_studio=True)
    )


def embed_text(text: str) -> list[float]:
    """Generate a document embedding for RAG indexing."""
    with httpx.Client(timeout=60.0) as client:
        response = client.post(
            f"{settings.openrouter_base_url}/embeddings",
            headers=_headers(),
            json={
                "model": settings.openrouter_embedding_model,
                "input": text,
                "input_type": "search_document",
                "dimensions": settings.openrouter_embedding_dimensions,
            },
        )
        response.raise_for_status()
        payload = response.json()

    return payload["data"][0]["embedding"]


def merge_strategy_profile(existing: str, new_analysis: dict) -> str:
    """Merge existing strategy profile with new video analysis."""
    with httpx.Client(timeout=120.0) as client:
        response = client.post(
            f"{settings.openrouter_base_url}/chat/completions",
            headers=_headers(),
            json={
                "model": settings.openrouter_chat_model,
                "messages": [
                    {
                        "role": "user",
                        "content": STRATEGY_MERGE_PROMPT.format(
                            existing=existing or "Ninguno (primer video)",
                            new_analysis=json.dumps(new_analysis, ensure_ascii=False, indent=2),
                        ),
                    }
                ],
                "temperature": 0.2,
            },
        )
        response.raise_for_status()
        payload = response.json()

    return payload["choices"][0]["message"]["content"].strip()

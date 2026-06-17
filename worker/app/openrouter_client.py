import base64
import json
from pathlib import Path

import httpx

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


def _parse_json_response(text: str) -> dict:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[1].rsplit("```", 1)[0].strip()
    return json.loads(cleaned)


def _video_data_url(file_path: str, mime_type: str) -> str:
    data = Path(file_path).read_bytes()
    encoded = base64.b64encode(data).decode("utf-8")
    return f"data:{mime_type};base64,{encoded}"


def analyze_video(file_path: str, mime_type: str = "video/mp4") -> dict:
    """Analyze a local video via OpenRouter multimodal chat."""
    video_url = _video_data_url(file_path, mime_type)

    with httpx.Client(timeout=600.0) as client:
        response = client.post(
            f"{settings.openrouter_base_url}/chat/completions",
            headers=_headers(),
            json={
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
            },
        )
        response.raise_for_status()
        payload = response.json()

    text = payload["choices"][0]["message"]["content"]
    return _parse_json_response(text)


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

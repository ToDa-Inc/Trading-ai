"""Prueba real del pipeline de vídeo con OpenRouter (sin tocar Supabase).
Uso: ./venv/bin/python test_video.py <ruta_video.mp4>
"""
import json
import sys

from app.openrouter_client import analyze_video


def main(path: str):
    print(f"1) Analizando {path} con OpenRouter (JSON estructurado)...")
    analysis = analyze_video(path, "video/mp4")

    keys = list(analysis.keys())
    print(f"   OK JSON parseado. Claves: {keys}")
    strat = analysis.get("strategy", {})
    print(f"   strategy.entry_rules: {len(strat.get('entry_rules', []))} regla(s)")
    print(f"   segments: {len(analysis.get('segments', []))}")
    print("\n--- Muestra del JSON (recortado) ---")
    print(json.dumps(analysis, ensure_ascii=False)[:600])


if __name__ == "__main__":
    main(sys.argv[1])

# Trading Coach — RAG SaaS MVP

SaaS de coaching de trading con IA. Los usuarios suben videos explicando su estrategia; la IA los analiza, construye un RAG y responde en un chat basándose 100% en su contenido.

## Arquitectura

- **Frontend + Chat API**: Next.js en Vercel
- **Worker de ingesta**: Python/FastAPI en Railway
- **Base de datos + Auth + Storage**: Supabase (Postgres + pgvector)

## Estructura

```
├── web/                  # Next.js (Vercel)
├── worker/               # FastAPI (Railway)
├── supabase/migrations/  # SQL schema + RLS + pgvector
└── README.md
```

## Setup local

### 1. Supabase

1. Crea un proyecto en [supabase.com](https://supabase.com)
2. Ejecuta las migraciones en el SQL Editor:
   - `supabase/migrations/20250605000000_init.sql`
   - `supabase/migrations/20250605000001_storage.sql`
3. Habilita Realtime en la tabla `videos` (Database → Replication)
4. Crea un usuario de prueba en Authentication → Users

### 2. Variables de entorno

**web/.env.local** (copia desde `web/.env.example`)
```env
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
OPENROUTER_API_KEY=sk-or-v1-...
OPENROUTER_CHAT_MODEL=google/gemini-3.1-flash-lite
OPENROUTER_EMBEDDING_MODEL=openai/text-embedding-3-small
OPENROUTER_EMBEDDING_DIMENSIONS=768
WORKER_SECRET=tu-secreto-aleatorio
```

**worker/.env** (copia desde `worker/.env.example`)
```env
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
OPENROUTER_API_KEY=sk-or-v1-...
OPENROUTER_VIDEO_MODEL=google/gemini-3.1-flash-lite
OPENROUTER_EMBEDDING_MODEL=openai/text-embedding-3-small
OPENROUTER_EMBEDDING_DIMENSIONS=768
WORKER_SECRET=tu-secreto-aleatorio
```

### 3. Instalar dependencias

```bash
npm run setup
```

Esto instala dependencias de `web/` y crea `worker/venv` con las dependencias Python.

### 4. Ejecutar frontend + worker

```bash
npm run dev
```

- Frontend: http://localhost:3000
- Web health: http://localhost:3000/api/health
- Worker health: http://localhost:8000/health

También puedes arrancarlos por separado:

```bash
npm run dev:web
npm run dev:worker
```

## Endpoints locales

| Servicio | Endpoint | Uso |
|----------|----------|-----|
| Web | `GET /api/health` | Health check del frontend/API de Next.js |
| Web | `POST /api/chat` | Chat RAG con streaming SSE, requiere usuario autenticado |
| Worker | `GET /health` | Health check para local/Railway |
| Worker | `POST /ingest` | Webhook Supabase para videos nuevos, requiere `X-Worker-Secret` |
| Worker | `POST /ingest/{video_id}` | Ingesta manual de un video, requiere `X-Worker-Secret` |

## Deploy

### Vercel (frontend)

1. Conecta el repo, root directory: `web`
2. Añade las variables de entorno de `web/.env.example`
3. Deploy

### Railway (worker)

1. Nuevo proyecto → Deploy from repo
2. Root: `worker/` (usa el Dockerfile)
3. Variables de entorno de `worker/.env.example`
4. Copia la URL pública (ej: `https://xxx.up.railway.app`)

### Supabase Webhook

En Supabase Dashboard → Database → Webhooks:

- **Name**: video-ingest
- **Table**: `videos`
- **Events**: INSERT
- **URL**: `https://tu-worker.railway.app/ingest`
- **Headers**: `X-Worker-Secret: tu-secreto-aleatorio`

## Flujo de uso

1. **Registro/Login** con email y contraseña
2. **Videos**: sube videos en bulk (drag & drop). El worker los procesa automáticamente
3. **Chat**: pregunta sobre tu estrategia o adjunta capturas de operaciones

## Modelos IA (todo vía OpenRouter)

| Uso | Modelo | Endpoint |
|-----|--------|----------|
| Análisis de video (worker) | `google/gemini-3.1-flash-lite` | `/chat/completions` + `video_url` |
| Chat + capturas (web) | `google/gemini-3.1-flash-lite` | `/chat/completions` + `image_url` |
| Embeddings RAG (index + query) | `openai/text-embedding-3-small` @ 768d | `/embeddings` |

Solo necesitas `OPENROUTER_API_KEY`. El modelo multimodal recibe video/imagen; el modelo de embeddings es independiente y optimizado para retrieval (`search_document` al indexar, `search_query` al buscar).

## RAG

- Videos → segmentos con embeddings en `chunks` (pgvector HNSW)
- Perfil acumulado en `strategy_profiles` (siempre en contexto del chat)
- Retrieval via RPC `match_chunks` (top-25, filtrado por user_id)
- Respuestas con citas a video + timestamp

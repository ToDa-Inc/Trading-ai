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

**web/.env.local**
```env
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
GEMINI_API_KEY=AIza...
GEMINI_CHAT_MODEL=gemini-2.5-flash
GEMINI_EMBEDDING_MODEL=text-embedding-004
WORKER_SECRET=tu-secreto-aleatorio
```

**worker/.env** (mismas credenciales + secret)
```env
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
GEMINI_API_KEY=AIza...
WORKER_SECRET=tu-secreto-aleatorio
```

### 3. Frontend

```bash
cd web
npm install
npm run dev
```

Abre http://localhost:3000

### 4. Worker

```bash
cd worker
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

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

## Modelos IA

| Uso | Modelo |
|-----|--------|
| Análisis de video | `gemini-2.5-flash` |
| Chat + visión | `gemini-2.5-flash` |
| Embeddings RAG | `text-embedding-004` |

La capa de abstracción en `web/src/lib/gemini.ts` permite cambiar a Claude u otro modelo.

## RAG

- Videos → segmentos con embeddings en `chunks` (pgvector HNSW)
- Perfil acumulado en `strategy_profiles` (siempre en contexto del chat)
- Retrieval via RPC `match_chunks` (top-25, filtrado por user_id)
- Respuestas con citas a video + timestamp

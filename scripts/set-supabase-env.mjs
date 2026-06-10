#!/usr/bin/env node
// Actualiza web/.env.local y worker/.env con las credenciales de un proyecto Supabase.
//
// Uso:
//   node scripts/set-supabase-env.mjs \
//     --url https://NUEVO.supabase.co \
//     --anon sb_publishable_xxx \
//     --service sb_secret_xxx
//
// Conserva el resto de variables (GEMINI_API_KEY, WORKER_SECRET, modelos, etc.).

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const val = argv[i + 1];
      out[key] = val;
      i++;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

if (!args.url || !args.anon || !args.service) {
  console.error(`
Faltan argumentos.

Uso:
  node scripts/set-supabase-env.mjs \\
    --url https://NUEVO.supabase.co \\
    --anon  <anon / publishable key> \\
    --service <service_role / secret key>
`);
  process.exit(1);
}

// Actualiza (o añade) una clave en el contenido de un .env
function upsert(content, key, value) {
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, "m");
  if (re.test(content)) return content.replace(re, line);
  return content.trimEnd() + "\n" + line + "\n";
}

function updateFile(path, mapping) {
  let content = existsSync(path) ? readFileSync(path, "utf8") : "";
  for (const [key, value] of Object.entries(mapping)) {
    content = upsert(content, key, value);
  }
  if (!content.endsWith("\n")) content += "\n";
  writeFileSync(path, content);
  console.log(`✓ Actualizado ${path}`);
}

// web/.env.local
updateFile(resolve(root, "web/.env.local"), {
  NEXT_PUBLIC_SUPABASE_URL: args.url,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: args.anon,
  SUPABASE_SERVICE_ROLE_KEY: args.service,
});

// worker/.env
updateFile(resolve(root, "worker/.env"), {
  SUPABASE_URL: args.url,
  SUPABASE_SERVICE_ROLE_KEY: args.service,
});

console.log("\nListo. Verifica con:  cd web && node scripts/test-supabase.mjs\n");

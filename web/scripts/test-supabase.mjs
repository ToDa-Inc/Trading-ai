import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "../.env.local");

function loadEnv() {
  const raw = readFileSync(envPath, "utf8");
  const get = (key) => raw.match(new RegExp(`^${key}=(.+)$`, "m"))?.[1]?.trim();
  return {
    url: get("NEXT_PUBLIC_SUPABASE_URL"),
    anon: get("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    service: get("SUPABASE_SERVICE_ROLE_KEY"),
  };
}

const { url, anon, service } = loadEnv();

const checks = [];

function ok(name, detail) {
  checks.push({ name, ok: true, detail });
  console.log(`✓ ${name}: ${detail}`);
}

function fail(name, detail) {
  checks.push({ name, ok: false, detail });
  console.log(`✗ ${name}: ${detail}`);
}

console.log("\n=== Test Supabase ===\n");

if (!url || url.includes("placeholder")) {
  fail("URL", "NEXT_PUBLIC_SUPABASE_URL no configurada en web/.env.local");
  process.exit(1);
}
if (!anon || anon.includes("placeholder")) {
  fail("Anon key", "NEXT_PUBLIC_SUPABASE_ANON_KEY no configurada");
  process.exit(1);
}
if (!service || service.includes("placeholder")) {
  fail("Service key", "SUPABASE_SERVICE_ROLE_KEY no configurada");
  process.exit(1);
}

ok("Env vars", "las 3 claves de Supabase están presentes");

const admin = createClient(url, service);

const tables = [
  { name: "videos", col: "id" },
  { name: "chunks", col: "id" },
  { name: "strategy_profiles", col: "user_id" },
  { name: "chat_sessions", col: "id" },
  { name: "chat_messages", col: "id" },
  { name: "video_analyses", col: "id" },
];
for (const { name: table, col } of tables) {
  const { error } = await admin.from(table).select(col).limit(1);
  if (error) fail(`Tabla ${table}`, error.message);
  else ok(`Tabla ${table}`, "accesible");
}

const { data: buckets, error: bucketsError } = await admin.storage.listBuckets();
if (bucketsError) {
  fail("Storage buckets", bucketsError.message);
} else {
  const names = buckets.map((b) => b.name);
  for (const bucket of ["trading-videos", "chat-uploads"]) {
    if (names.includes(bucket)) ok(`Bucket ${bucket}`, "existe");
    else fail(`Bucket ${bucket}`, "no encontrado — ejecuta 20250605000001_storage.sql");
  }
}

const { data: rpcTest, error: rpcError } = await admin.rpc("match_chunks", {
  query_embedding: Array(1536).fill(0),
  match_count: 1,
  filter_user_id: "00000000-0000-0000-0000-000000000000",
});
if (rpcError) fail("RPC match_chunks", rpcError.message);
else ok("RPC match_chunks", `funciona (devolvió ${rpcTest?.length ?? 0} filas)`);

const anonClient = createClient(url, anon);
const { error: authError } = await anonClient.auth.getSession();
if (authError) fail("Auth", authError.message);
else ok("Auth", "servicio accesible");

console.log("\n=== Resumen ===");
const passed = checks.filter((c) => c.ok).length;
const total = checks.length;
console.log(`${passed}/${total} comprobaciones OK\n`);

if (passed === total) {
  console.log("Supabase está listo. Puedes arrancar: npm run dev\n");
} else {
  process.exit(1);
}

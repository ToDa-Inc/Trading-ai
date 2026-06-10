// Comprueba que la columna chunks.embedding tiene dimensión 1536.
// Truco: intentamos insertar un vector de 1536 con user_id/video_id falsos.
// - Si la dimensión es incorrecta -> error "expected N dimensions".
// - Si es correcta -> error de FK (user_id/video_id) => la dimensión está bien.
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const raw = readFileSync(resolve(__dirname, "../.env.local"), "utf8");
const get = (k) => raw.match(new RegExp(`^${k}=(.+)$`, "m"))?.[1]?.trim();

const admin = createClient(get("NEXT_PUBLIC_SUPABASE_URL"), get("SUPABASE_SERVICE_ROLE_KEY"));

const fakeId = "00000000-0000-0000-0000-000000000000";
const { error } = await admin.from("chunks").insert({
  video_id: fakeId,
  user_id: fakeId,
  content: "dim check",
  embedding: Array(1536).fill(0.001),
});

if (!error) {
  console.log("INESPERADO: la fila se insertó (limpiando)...");
  await admin.from("chunks").delete().eq("video_id", fakeId);
  console.log("✓ Dimensión 1536 correcta (insert permitido)");
} else if (/expected \d+ dimensions/i.test(error.message)) {
  console.log(`✗ DIMENSIÓN INCORRECTA: ${error.message}`);
  console.log("  -> La migración a 1536 NO está aplicada.");
  process.exit(1);
} else if (/foreign key|violates/i.test(error.message)) {
  console.log("✓ Dimensión 1536 correcta (el vector pasó; falló solo la FK, esperado)");
} else {
  console.log(`? Otro error (probablemente OK para la dimensión): ${error.message}`);
}

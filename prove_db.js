import { createClient } from '@supabase/supabase-js';

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(url, key);

async function run() {
  console.log("=== Evidência de Estado do Banco ===");
  const { data, error } = await supabase.from('barbershops').select('*').limit(1);
  console.log("Resultado de barbershops (REST):", error || "Sucesso");
}
run();

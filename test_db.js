import { createClient } from '@supabase/supabase-js';

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(url, key);

async function run() {
  console.log("=== testing barbershops ===");
  const r1 = await supabase.from('barbershops').select('*').limit(1);
  console.log("barbershops:", r1.error ? r1.error.message : "OK");

  console.log("=== testing barbershop_members ===");
  const r2 = await supabase.from('barbershop_members').select('*').limit(1);
  console.log("barbershop_members:", r2.error ? r2.error.message : "OK");

  console.log("=== fetching staff_profiles by GET ===");
  const res = await fetch(`${url}/rest/v1/staff_profiles`, {
    headers: { 'apikey': key, 'Authorization': `Bearer ${key}` }
  });
  console.log("staff_profiles status:", res.status);
  const text = await res.text();
  console.log("staff_profiles body:", text.substring(0, 200));
}
run();

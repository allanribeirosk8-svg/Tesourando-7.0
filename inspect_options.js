const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  console.error("VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY is not defined");
  process.exit(1);
}

async function inspectOptions() {
  try {
    const res = await fetch(`${url}/rest/v1/staff_profiles`, {
      method: 'OPTIONS',
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`
      }
    });

    if (!res.ok) {
      throw new Error(`HTTP error: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    console.log("=== OPTIONS RESPONSE FOR staff_profiles ===");
    console.log(JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Failed to fetch OPTIONS:", err);
  }
}

inspectOptions();

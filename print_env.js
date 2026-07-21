console.log(Object.keys(process.env).filter(k => k.toLowerCase().includes('supabase') || k.toLowerCase().includes('key') || k.toLowerCase().includes('db')));

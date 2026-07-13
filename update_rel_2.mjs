import fs from 'fs';
let content = fs.readFileSync('pages/AdminApp.tsx', 'utf8');

// 3 chips compactos
// Orig: className="bg-surface  p-3 py-4 rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] border border-title/30  flex flex-col justify-center relative"
content = content.replace(
  /className="bg-surface\s*p-3 py-4 rounded-2xl shadow-\[0_1px_4px_rgba\(0,0,0,0\.06\)\] border border-title\/30\s*flex flex-col justify-center relative"/g,
  'className="bg-surface p-3 py-4 rounded-2xl border border-white/8 shadow-[0_2px_8px_rgba(0,0,0,0.3)] flex flex-col justify-center relative"'
);

// Card faturamento (Hero)
// Orig: className="bg-surface  p-5 rounded-[2rem] shadow-[0_1px_4px_rgba(0,0,0,0.06)] flex flex-col items-center justify-center border border-title/30  relative"
content = content.replace(
  /className="bg-surface\s*p-5 rounded-\[2rem\] shadow-\[0_1px_4px_rgba\(0,0,0,0\.06\)\] flex flex-col items-center justify-center border border-title\/30\s*relative"/g,
  'className="bg-surface p-5 rounded-[2rem] border border-white/8 shadow-[0_4px_16px_rgba(0,0,0,0.4)] flex flex-col items-center justify-center relative"'
);

// Grafico / Top 5 / Ranking Services 
// Orig: className="bg-surface  p-5 rounded-[2rem] shadow-[0_1px_4px_rgba(0,0,0,0.06)] border border-title/30  relative" (sometimes without relative)
content = content.replace(
  /className="bg-surface\s*p-5 rounded-\[2rem\] shadow-\[0_1px_4px_rgba\(0,0,0,0\.06\)\] border border-title\/30\s*(relative)?"/g,
  'className="bg-surface p-5 rounded-[2rem] border border-white/8 shadow-[0_4px_16px_rgba(0,0,0,0.4)] $1"'
);
// Make sure "relative" space is well handled
content = content.replace(/shadow-\[0_4px_16px_rgba\(0,0,0,0\.4\)\]  "/g, 'shadow-[0_4px_16px_rgba(0,0,0,0.4)]"'); // cleanup hanging spaces

fs.writeFileSync('pages/AdminApp.tsx', content);

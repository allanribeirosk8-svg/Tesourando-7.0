import fs from 'fs';
let content = fs.readFileSync('pages/AdminApp.tsx', 'utf8');

// 1. Container selector
content = content.replace(
  /<div className="grid grid-cols-4 gap-1 w-full relative z-20">/g,
  '<div className="grid grid-cols-4 gap-1 w-full relative z-20 bg-surface/50 p-1 rounded-2xl border border-white/8 shadow-[0_2px_8px_rgba(0,0,0,0.3)]">'
);

// 2. Button class replacement HOJE
content = content.replace(
  /className=\{`py-2 px-1 rounded-full text-xs font-semibold text-center transition-all truncate\s*\$\{period === 'dia'\s*\? 'bg-secondary text-white shadow-sm border border-secondary'\s*: 'bg-surface\s*text-title\s*border border-title\/30\s*shadow-\[0_1px_3px_rgba\(0,0,0,0\.06\)\]'\}`\}/g,
  "className={`py-2 px-1 rounded-xl text-xs font-semibold text-center transition-all truncate ${period === 'dia' ? 'bg-surface border border-white/8 shadow-[0_2px_8px_rgba(0,0,0,0.3)] text-secondary' : 'bg-transparent text-title shadow-none border-none'}`}"
);

// 3. SEMANA/MES/ANO buttons:
content = content.replace(
  /className=\{`py-2 px-1 rounded-full text-xs font-semibold text-center transition-all\s*\$\{period === p\s*\? 'bg-secondary text-white shadow-sm border border-secondary'\s*: 'bg-surface\s*text-title\s*border border-title\/30\s*shadow-\[0_1px_3px_rgba\(0,0,0,0\.06\)\]'\}`\}/g,
  "className={`py-2 px-1 rounded-xl text-xs font-semibold text-center transition-all ${period === p ? 'bg-surface border border-white/8 shadow-[0_2px_8px_rgba(0,0,0,0.3)] text-secondary' : 'bg-transparent text-title shadow-none border-none'}`}"
);

fs.writeFileSync('pages/AdminApp.tsx', content);

import fs from 'fs';

let content = fs.readFileSync('pages/AdminApp.tsx', 'utf8');

// The block to replace is the motion.div for appointments
const lines = content.split('\n');

// We know the motion.div starts around 1706
const startIdx = lines.findIndex((l, index) => index > 1700 && l.includes('<motion.div') && lines[index+1]?.includes('key={apt.id}'));
let endIdx = -1;
let open = 0;
for (let i = startIdx; i < lines.length; i++) {
  if (lines[i].includes('<motion.div')) open++;
  if (lines[i].includes('</motion.div>')) open--;
  if (open === 0) {
    endIdx = i;
    break;
  }
}

if (startIdx === -1 || endIdx === -1) {
  console.log("Could not find block");
  process.exit(1);
}

const originalBlock = lines.slice(startIdx, endIdx + 1).join('\n');
let block = originalBlock;

// 1. Fundo e borda do card principal
block = block.replace(
  /isActuallyCompleted \? 'bg-\[\#D1FAE5\] border-green-200 opacity-60' : \s*isNoShow \? 'bg-amber-50 border-amber-200 opacity-50' : \s*isFinishing \? 'bg-\[\#D1FAE5\] border-green-200' : 'bg-\[\#EBF5FF\]  border-l-4 border-l-secondary '/g,
  `isActuallyCompleted ? 'bg-green-500/10 border-l-4 border-l-green-400 opacity-70' : 
                                  isNoShow ? 'bg-amber-500/10 border-l-4 border-l-amber-400 opacity-60' : 
                                  isFinishing ? 'bg-green-500/10 border-l-4 border-l-green-400' : 'bg-surface border-l-4 border-l-secondary'`
);
block = block.replace(
  /shadow-\[0_1px_4px_rgba\(0,0,0,0\.06\)\]/g,
  `shadow-[0_2px_12px_rgba(0,0,0,0.25)]`
);

// 2. Texto do horário (time) 
block = block.replace(
  /isActuallyCompleted \? 'text-green-700' : isNoShow \? 'text-amber-700' : 'text-white '/g,
  `isActuallyCompleted ? 'text-green-300' : isNoShow ? 'text-amber-300' : 'text-white'`
);

// 3. Nome do cliente
block = block.replace(
  /isActuallyCompleted \? 'text-green-800 line-through opacity-70' : isNoShow \? 'text-amber-800 line-through opacity-70' : 'text-white '/g,
  `isActuallyCompleted ? 'text-green-300 line-through opacity-70' : isNoShow ? 'text-amber-300 line-through opacity-70' : 'text-white'`
);

// 4. Label do serviço + valor
block = block.replace(
  /isActuallyCompleted \? 'text-green-700\/60' : isNoShow \? 'text-amber-700\/60' : 'text-secondary'/g,
  `isActuallyCompleted ? 'text-green-400/60' : isNoShow ? 'text-amber-400/60' : 'text-secondary'`
);

// 5. Observação/nota 
block = block.replace(
  /isActuallyCompleted \? 'text-green-800 line-through opacity-40' : isNoShow \? 'text-amber-800 line-through opacity-40' : 'text-title '/g,
  `isActuallyCompleted ? 'text-green-300/40 line-through' : isNoShow ? 'text-amber-300/40 line-through' : 'text-title'`
);

// 6 & 7. Ícones de ação
// Foto
block = block.replace(
  /w-10 h-10 flex items-center justify-center transition-colors rounded-xl \$\{isNoShow \? 'text-muted' : 'text-amber-500 hover:bg-amber-50'\}/g,
  `w-10 h-10 flex items-center justify-center rounded-xl transition-colors \${isActuallyCompleted || isNoShow ? 'text-muted opacity-30 cursor-not-allowed' : 'text-secondary hover:bg-secondary/10'}`
);

// Cliente
block = block.replace(
  /w-10 h-10 flex items-center justify-center rounded-xl transition-colors text-secondary hover:bg-blue-50/g,
  `w-10 h-10 flex items-center justify-center rounded-xl transition-colors \${isActuallyCompleted || isNoShow ? 'text-muted opacity-30 cursor-not-allowed' : 'text-secondary hover:bg-secondary/10'}`
);

// Editar
block = block.replace(
  /w-10 h-10 flex items-center justify-center transition-colors rounded-xl \$\{isActuallyCompleted \|\| isNoShow \? 'text-muted' : 'text-emerald-500 hover:bg-emerald-50'\}/g,
  `w-10 h-10 flex items-center justify-center rounded-xl transition-colors \${isActuallyCompleted || isNoShow ? 'text-muted opacity-30 cursor-not-allowed' : 'text-secondary hover:bg-secondary/10'}`
);

// Falta
block = block.replace(
  /w-10 h-10 flex items-center justify-center transition-colors rounded-xl \$\{isActuallyCompleted \|\| isNoShow \? 'text-muted' : 'text-red-500 hover:bg-red-50'\}/g,
  `w-10 h-10 flex items-center justify-center rounded-xl transition-colors \${isActuallyCompleted || isNoShow ? 'text-muted opacity-30 cursor-not-allowed' : 'text-red-400 hover:bg-red-400/10'}`
);

// Labels dos Ícones
// This matches exactly: `className="text-[10px] text-title "`
// The original was `#8A98A8`, we changed to `text-title `, let's ensure it's `text-title` without trailing space if that matters.
// It says to replace `className="text-[10px] text-[#8A98A8]"` with `className="text-[10px] text-title"`.
// I will just do a sweeping replace for the text label classes since they are simple.
block = block.replace(/text-\[10px\] text-title /g, 'text-[10px] text-title');

// 8. Coluna lateral direita (Trash + Check)
block = block.replace(
  /w-14 flex flex-col items-center justify-center gap-4 border-l border-title\/30\/30  bg-primary\/40\/50  shrink-0/g,
  `w-14 flex flex-col items-center justify-center gap-4 border-l border-white/5 bg-white/5 shrink-0`
);

// 9. Botão Trash
block = block.replace(
  /w-8 h-8 rounded-full flex items-center justify-center transition-all shrink-0 \$\{isActuallyCompleted \|\| isNoShow \? 'text-title opacity-30' : 'text-\[\#EF4444\] hover:bg-red-50'\}/g,
  `w-8 h-8 rounded-full flex items-center justify-center transition-all shrink-0 \${isActuallyCompleted || isNoShow ? 'text-muted opacity-30 cursor-not-allowed' : 'text-red-400 hover:bg-red-400/15 transition-all'}`
);

// 10. Botão Check/Retornar
block = block.replace(
    /bg-surface text-green-600 shadow-sm border border-green-100/g,
    `bg-white/10 text-green-300 border border-green-400/20 hover:bg-white/20`
);
block = block.replace(
    /bg-surface text-amber-600 shadow-sm border border-amber-100/g,
    `bg-white/10 text-amber-300 border border-amber-400/20 hover:bg-white/20`
);
block = block.replace(
    /bg-\[\#10B981\] text-white shadow-md active:scale-90/g,
    `bg-secondary text-white shadow-md shadow-secondary/30 active:scale-90`
);


// 11. Badge de "FALTA"
block = block.replace(
  /bg-amber-100 text-amber-700 text-\[8px\] font-black px-1\.5 py-0\.5 rounded-full/g,
  `bg-amber-500/20 text-amber-300 text-[8px] font-black px-1.5 py-0.5 rounded-full`
);

// 12. Divisor 
block = block.replace(
  /border-b border-title\/30\/20 /g,
  `border-b border-white/5`
);

content = content.replace(originalBlock, block);
fs.writeFileSync('pages/AdminApp.tsx', content);
console.log("Done");

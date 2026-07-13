import fs from 'fs';

let content = fs.readFileSync('pages/AdminApp.tsx', 'utf8');

// ---------------------------
// PARTE 1 - ICONES DE ACAO
// ---------------------------
// Foto
content = content.replace(
  /<button\s+disabled=\{isNoShow\}\s+onClick=\{\(\) => handleCameraClick\(apt\.phone\)\}\s+className=\{`w-10 h-10[^`]+`\}\s*>/g,
  `<button 
                                            disabled={isNoShow}
                                            onClick={() => handleCameraClick(apt.phone)}
                                            className={\`w-10 h-10 flex items-center justify-center transition-colors rounded-xl \${isNoShow ? 'text-muted opacity-30 cursor-not-allowed' : 'text-violet-400 hover:bg-violet-400/15'}\`}
                                        >`
);

// Cliente
content = content.replace(
  /<button\s+onClick=\{\(\) => onOpenCustomer\(apt\.phone\)\}\s+className=\{`w-10 h-10[^`]+`\}\s*>/g,
  `<button 
                                            onClick={() => onOpenCustomer(apt.phone)}
                                            className="w-10 h-10 flex items-center justify-center rounded-xl transition-colors text-sky-400 hover:bg-sky-400/15"
                                        >`
);

// Editar
content = content.replace(
  /<button\s+disabled=\{isActuallyCompleted \|\| isNoShow\}\s+onClick=\{\(\) => onReschedule\(apt\)\}\s+className=\{`w-10 h-10[^`]+`\}\s*>/g,
  `<button 
                                            disabled={isActuallyCompleted || isNoShow}
                                            onClick={() => onReschedule(apt)}
                                            className={\`w-10 h-10 flex items-center justify-center transition-colors rounded-xl \${isActuallyCompleted || isNoShow ? 'text-muted opacity-30 cursor-not-allowed' : 'text-emerald-400 hover:bg-emerald-400/15'}\`}
                                        >`
);

// Falta
content = content.replace(
  /<button\s+disabled=\{isActuallyCompleted \|\| isNoShow\}\s+onClick=\{\(\) => setActiveNoShowMenu\(apt\.id\)\}\s+className=\{`w-10 h-10[^`]+`\}\s*>/g,
  `<button 
                                            disabled={isActuallyCompleted || isNoShow}
                                            onClick={() => setActiveNoShowMenu(apt.id)}
                                            className={\`w-10 h-10 flex items-center justify-center transition-colors rounded-xl \${isActuallyCompleted || isNoShow ? 'text-muted opacity-30 cursor-not-allowed' : 'text-red-400 hover:bg-red-400/15'}\`}
                                        >`
);

// ---------------------------
// PARTE 2 - Fundo e borda do card
// ---------------------------
content = content.replace(
  /\$\{isActuallyCompleted \? 'bg-green-500\/10 border-l-4 border-l-green-400 opacity-70' : \s*isNoShow \? 'bg-amber-500\/10 border-l-4 border-l-amber-400 opacity-60' : \s*isFinishing \? 'bg-green-500\/10 border-l-4 border-l-green-400' : 'bg-surface border-l-4 border-l-secondary'\}/g,
  `\${isActuallyCompleted ? 'bg-green-500/10 border-l-4 border-l-green-400 opacity-75' : isNoShow ? 'bg-amber-500/10 border-l-4 border-l-amber-400 opacity-65' : isFinishing ? 'bg-green-500/10 border-l-4 border-l-green-400' : 'bg-surface border-l-4 border-l-secondary'}`
);

content = content.replace(
  /shadow-\[0_2px_12px_rgba\(0,0,0,0\.25\)\]/g,
  `shadow-[0_2px_12px_rgba(0,0,0,0.3)]`
);

// ---------------------------
// PARTE 3 - Textos internos dos cards
// ---------------------------
// Label do serviço + valor
content = content.replace(
  /isActuallyCompleted \? 'text-green-400\/60' : isNoShow \? 'text-amber-400\/60' : 'text-secondary'/g,
  `isActuallyCompleted ? 'text-green-400/70' : isNoShow ? 'text-amber-400/70' : 'text-secondary'`
);

// ---------------------------
// PARTE 4 - Coluna lateral direita (Trash + Check)
// ---------------------------
// Trash
content = content.replace(
  /\$\{isActuallyCompleted \|\| isNoShow \? 'text-muted opacity-30 cursor-not-allowed' : 'text-red-400 hover:bg-red-400\/15 transition-all'\}/g,
  `\${isActuallyCompleted || isNoShow ? 'text-muted opacity-20 cursor-not-allowed' : 'text-red-400 hover:bg-red-400/15 transition-all'}`
);

// Check/Retornar
content = content.replace(
  /bg-green-400\/15 text-green-300 border border-green-400\/25 hover:bg-green-400\/25/g,
  `bg-green-400/15 text-green-300 border border-green-400/25 hover:bg-green-400/25`
);
content = content.replace(
  /bg-white\/10 text-green-300 border border-green-400\/20 hover:bg-white\/20/g,
  `bg-green-400/15 text-green-300 border border-green-400/25 hover:bg-green-400/25`
);
content = content.replace(
  /bg-white\/10 text-amber-300 border border-amber-400\/20 hover:bg-white\/20/g,
  `bg-amber-400/15 text-amber-300 border border-amber-400/25 hover:bg-amber-400/25`
);

fs.writeFileSync('pages/AdminApp.tsx', content);

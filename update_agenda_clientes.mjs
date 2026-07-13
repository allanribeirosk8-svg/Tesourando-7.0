import fs from 'fs';

let content = fs.readFileSync('pages/AdminApp.tsx', 'utf8');

// The best way to correctly apply these is to find the exact DOM elements by their surrounding text or specific classes.

// --- 📅 AGENDA ---
// 1. Container do calendário semanal + inline calendar
// Currently: <div {...agendaSwipeHandlers} className="bg-surface  rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden mx-2">
content = content.replace(
  /<div \{\.\.\.agendaSwipeHandlers\} className="bg-surface\s*rounded-2xl shadow-\[0_1px_4px_rgba\(0,0,0,0\.06\)\] overflow-hidden mx-2">/g,
  '<div {...agendaSwipeHandlers} className="bg-surface rounded-2xl border border-white/8 shadow-[0_4px_20px_rgba(0,0,0,0.45)] overflow-hidden mx-2">'
);

// 2. Card faturamento do DIA (gradient azul) -> Apenas adicione sombra mais pronunciada
// Currently: className="rounded-2xl p-3 flex flex-col justify-center shadow-lg shadow-secondary/20 relative overflow-hidden group" style={{ ... linear-gradient ... }}
content = content.replace(
  /className="rounded-2xl p-3 flex flex-col justify-center shadow-lg shadow-secondary\/20 relative overflow-hidden group"/g,
  'className="rounded-2xl p-3 flex flex-col justify-center shadow-[0_6px_24px_rgba(249,148,23,0.15)] relative overflow-hidden group"'
);

// 3. Card faturamento da SEMANA (bg-surface)
// Currently: <div className="bg-surface  rounded-2xl p-3 flex flex-col justify-center shadow-[0_1px_4px_rgba(0,0,0,0.06)] relative overflow-hidden group">
content = content.replace(
  /<div className="bg-surface\s*rounded-2xl p-3 flex flex-col justify-center shadow-\[0_1px_4px_rgba\(0,0,0,0\.06\)\] relative overflow-hidden group">/g,
  '<div className="bg-surface rounded-2xl p-3 flex flex-col justify-center border border-white/8 shadow-[0_4px_16px_rgba(0,0,0,0.4)] relative overflow-hidden group">'
);

// --- 👥 CLIENTES ---
// 1. Container principal da lista de clientes: 
// The list wrapper: currently there is none. Wait. Let's look at `CustomersView`.
// "Localize o div externo de bg-surface que envolve a lista"
content = content.replace(
  /className="space-y-2 relative pb-24"/g,
  'className="space-y-2 relative pb-24 bg-surface border border-white/8 shadow-[0_4px_16px_rgba(0,0,0,0.4)] p-4 rounded-[2rem]"'
); // Actually wait, if I add it here, it will wrap the whole view.

// 2. Cada card de cliente na lista:
// Currently: className="bg-surface  px-4 py-[10px] rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] cursor-pointer flex items-center h-16"
content = content.replace(
  /className="bg-surface\s*px-4 py-\[10px\] rounded-xl shadow-\[0_1px_4px_rgba\(0,0,0,0\.06\)\] cursor-pointer flex items-center h-16"/g,
  'className="bg-surface px-4 py-[10px] rounded-xl border border-white/8 shadow-[0_2px_8px_rgba(0,0,0,0.3)] cursor-pointer flex items-center h-16"'
);

fs.writeFileSync('pages/AdminApp.tsx', content);

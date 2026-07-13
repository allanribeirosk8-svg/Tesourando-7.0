import fs from 'fs';
let content = fs.readFileSync('pages/AdminApp.tsx', 'utf8');

// 1. Calendário semanal
content = content.replace(
  /className="([^"]*)border border-white\/8 shadow-\[0_4px_20px_rgba\(0,0,0,0\.45\)\]([^"]*)"/g,
  (match, p1, p2) => 'className="' + p1 + 'shadow-[0_3px_12px_rgba(0,0,0,0.3)]' + p2 + '"'
);

// 2. Cards de faturamento Hoje/Semana
// Hoje:
content = content.replace(
  /className="([^"]*)shadow-\[0_6px_24px_rgba\(249,148,23,0\.15\)\]([^"]*)"/g,
  (match, p1, p2) => 'className="' + p1 + 'shadow-[0_3px_12px_rgba(0,0,0,0.3)]' + p2 + '"'
);
// Semana:
// The original replacement string for Semana was: `div className="bg-surface rounded-2xl p-3 flex flex-col justify-center border border-white/8 shadow-[0_4px_16px_rgba(0,0,0,0.4)] relative overflow-hidden group"`
content = content.replace(
  /className="bg-surface rounded-2xl p-3 flex flex-col justify-center border border-white\/8 shadow-\[0_4px_16px_rgba\(0,0,0,0\.4\)\] relative overflow-hidden group"/g,
  'className="bg-surface rounded-2xl p-3 flex flex-col justify-center shadow-[0_3px_12px_rgba(0,0,0,0.3)] relative overflow-hidden group"'
);

// 3. Card agendamento PENDENTE
// Line 1712 `className={"relative rounded-2xl border border-white/8 shadow-[0_4px_16px_rgba(0,0,0,0.4)] min-h-[44px] overflow-hidden transition-all duration-500 flex ...}` 
content = content.replace(
  /relative rounded-2xl border border-white\/8 shadow-\[0_4px_16px_rgba\(0,0,0,0\.4\)\] /g,
  'relative rounded-2xl shadow-[0_3px_12px_rgba(0,0,0,0.35)] '
);

// Also catching the one in normal list view:
// className="border rounded-[12px] border border-white/8 shadow-[0_4px_16px_rgba(0,0,0,0.4)]
content = content.replace(
  /border rounded-\[12px\] border border-white\/8 shadow-\[0_4px_16px_rgba\(0,0,0,0\.4\)\] /g,
  'rounded-[12px] shadow-[0_3px_12px_rgba(0,0,0,0.35)] '
);

// 4. Cards de métricas (Ticket / Novos clientes / Faltas)
// bg-surface p-3 py-4 rounded-2xl border border-white/8 shadow-[0_2px_8px_rgba(0,0,0,0.3)]
content = content.replace(
  /bg-surface p-3 py-4 rounded-2xl border border-white\/8 shadow-\[0_2px_8px_rgba\(0,0,0,0\.3\)\] /g,
  'bg-surface p-3 py-4 rounded-2xl '
);

// 5. Cards de cliente na lista
content = content.replace(
  /className="bg-surface px-4 py-\[10px\] rounded-xl border border-white\/8 shadow-\[0_2px_8px_rgba\(0,0,0,0\.3\)\] cursor-pointer flex items-center h-16"/g,
  'className="bg-surface px-4 py-[10px] cursor-pointer flex items-center h-16 border-b border-white/5 last:border-0"'
);

// And we should also look at the historic items if they have borders:
content = content.replace(
  /bg-surface border border-white\/8 shadow-\[0_2px_8px_rgba\(0,0,0,0\.3\)\] /g,
  'bg-surface '
);

// 6. Card de serviço cadastrado
content = content.replace(
  /className="bg-surface\s*p-3 rounded-2xl border border-white\/8 shadow-\[0_4px_16px_rgba\(0,0,0,0\.4\)\] flex items-center gap-3 group"/g,
  'className="bg-surface p-3 flex items-center gap-3 group border-b border-white/5 last:border-0"'
);

// 7. Slots disponíveis da agenda
content = content.replace(
  /border border-white\/8 shadow-\[0_4px_16px_rgba\(0,0,0,0\.4\)\] /g,
  ''
);

// 8. Formulário "Novo Serviço"
// "bg-surface p-4 rounded-3xl border border-white/8 shadow-[0_4px_16px_rgba(0,0,0,0.4)] space-y-3"
content = content.replace(
  /bg-surface p-4 rounded-3xl border border-white\/8 shadow-\[0_4px_16px_rgba\(0,0,0,0\.4\)\] /g,
  'bg-surface p-4 rounded-3xl '
);

fs.writeFileSync('pages/AdminApp.tsx', content);

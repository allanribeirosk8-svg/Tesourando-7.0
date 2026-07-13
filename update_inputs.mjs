import fs from 'fs';
let content = fs.readFileSync('pages/AdminApp.tsx', 'utf8');

// Input de busca de clientes
content = content.replace(
  /<Input label="Buscar Cliente" placeholder="Nome ou telefone..." value=\{searchTerm\} onChange=\{e => setSearchTerm\(e\.target\.value\)\} \/>/g,
  '<Input label="Buscar Cliente" placeholder="Nome ou telefone..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} inputClassName="bg-surface border-white/10 text-white placeholder-muted shadow-[0_2px_8px_rgba(0,0,0,0.3)]" />'
);

// Form de Novo Serviço (Wrapper)
content = content.replace(
  /<div className="bg-surface\s*p-4 rounded-3xl shadow-\[0_1px_4px_rgba\(0,0,0,0\.06\)\] space-y-3">/g,
  '<div className="bg-surface p-4 rounded-3xl border border-white/8 shadow-[0_4px_16px_rgba(0,0,0,0.4)] space-y-3">'
);

// Input nome do serviço (Novo/Editar)
content = content.replace(
  /<Input\s*label="Nome do Serviço"/g,
  '<Input \n            inputClassName="bg-primary/60 border-white/10 text-white placeholder-muted"\n            label="Nome do Serviço"'
);

// Input preço do serviço
content = content.replace(
  /<Input\s*label="Preço"/g,
  '<Input \n                inputClassName="bg-primary/60 border-white/10 text-white placeholder-muted"\n                label="Preço"'
);

// Select duração
content = content.replace(
  /className="bg-surface\s*border border-title\/30\s*px-3 h-10 rounded-xl text-base font-semibold text-white\s*tracking-tight focus:ring-2 focus:ring-secondary outline-none flex-1 w-full min-w-0 shadow-sm transition-all"/g,
  'className="bg-primary/60 border border-white/10 px-3 h-10 rounded-xl text-base font-semibold text-white tracking-tight focus:ring-2 focus:ring-secondary outline-none flex-1 w-full min-w-0 shadow-sm transition-all"'
);

// Divisor SERVIÇOS CADASTRADOS
content = content.replace(
  /<h3 className="text-\[10px\] font-black text-title uppercase tracking-\[0\.2em\]">Serviços Cadastrados<\/h3>/g,
  '<h3 className="text-[10px] font-black text-title border-white/10 uppercase tracking-[0.2em]">Serviços Cadastrados</h3>'
);

// Cada card de serviço cadastrado
// <div key={s.id} className="bg-surface  p-3 rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] flex items-center gap-3 group">
content = content.replace(
  /<div key=\{s\.id\} className="bg-surface\s*p-3 rounded-2xl shadow-\[0_1px_4px_rgba\(0,0,0,0\.06\)\] flex items-center gap-3 group">/g,
  '<div key={s.id} className="bg-surface p-3 rounded-2xl border border-white/8 shadow-[0_2px_8px_rgba(0,0,0,0.3)] flex items-center gap-3 group">'
);

fs.writeFileSync('pages/AdminApp.tsx', content);

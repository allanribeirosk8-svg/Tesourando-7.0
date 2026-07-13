import fs from 'fs';
let content = fs.readFileSync('pages/AdminApp.tsx', 'utf8');

// The profile badges
content = content.replace(
  /className="bg-secondary text-white px-6 py-2 rounded-2xl shadow-lg shadow-secondary\/20 flex-1 max-w-\[120px\]"/g,
  'className="bg-secondary/20 text-secondary border border-secondary/30 px-6 py-2 rounded-2xl shadow-lg flex-1 max-w-[120px]"'
);

content = content.replace(
  /'bg-amber-500 text-white shadow-amber-100'/g,
  "'bg-amber-500/20 text-amber-300 border border-amber-400/20'"
);

// The list wrapper of historico
content = content.replace(
  /<div className="bg-surface\s*rounded-3xl border border-title\/30\s*overflow-hidden divide-y divide-\[\#D0D8E4\] ">/g,
  '<div className="space-y-3">'
);

// The history item
content = content.replace(
  /<div key=\{i\} className=\{`p-4 flex justify-between items-center \$\{isNoShow \? 'bg-amber-50\/30 ' : ''\}`\}>/g,
  '<div key={i} className={`p-4 rounded-xl flex justify-between items-center bg-surface border border-white/8 shadow-[0_2px_8px_rgba(0,0,0,0.3)] ${isNoShow ? "border-amber-400/20" : ""}`}>'
);

// Price of the history item? No, the text-color.
content = content.replace(
  /<span className=\{`text-xs font-bold block \$\{isNoShow \? 'text-amber-700 ' : 'text-white '\}`\}>/g,
  '<span className={`text-xs font-bold block ${isNoShow ? "text-amber-300 " : "text-white "}`}>'
);

// The check / thumbsdown wrappers
content = content.replace(
  /className=\{`w-7 h-7 rounded-full flex items-center justify-center text-xs \$\{isNoShow \? 'bg-amber-100 text-amber-600' : 'bg-green-50 text-green-600'\}`\}/g,
  'className={`w-7 h-7 rounded-full flex items-center justify-center text-xs ${isNoShow ? "bg-amber-500/10 text-amber-300" : "bg-green-500/10 text-green-400"}`}'
);

fs.writeFileSync('pages/AdminApp.tsx', content);

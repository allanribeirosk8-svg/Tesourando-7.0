import fs from 'fs';

let content = fs.readFileSync('pages/AdminApp.tsx', 'utf8');

const tokenMap = [
  { match: /bg-\[\#FFFFFF\]|bg-white/g, replace: 'bg-surface' },
  { match: /bg-\[\#F4F7FB\]|bg-\[\#F8FAFB\]|bg-\[\#F0F4F8\]|bg-slate-50/g, replace: 'bg-primary/40' },
  { match: /bg-\[\#E8EEF5\]|bg-\[\#E8F4FC\]|bg-\[\#EAF4FC\]/g, replace: 'bg-surface/80' },
  { match: /bg-\[\#2898D8\]|bg-brand-500|bg-brand-600/g, replace: 'bg-secondary' },
  { match: /text-\[\#2898D8\]|text-brand-500|text-brand-600/g, replace: 'text-secondary' },
  { match: /ring-\[\#2898D8\]/g, replace: 'ring-secondary' },
  { match: /border-\[\#2898D8\]/g, replace: 'border-secondary' },
  { match: /shadow-\[\#2898D8\](\/\d+)?/g, replace: 'shadow-secondary/20' },
  { match: /text-\[\#1A2332\]|text-\[\#5A6878\]/g, replace: 'text-white' },
  { match: /text-\[\#8A98A8\]|text-\[\#B0BCC7\]|text-\[\#C0CAD4\]/g, replace: 'text-title' },
  { match: /border-\[\#D0D8E4\]|border-\[\#D8EBF8\]/g, replace: 'border-title/30' },
  { match: /bg-\[\#D0D8E4\]/g, replace: 'bg-title/30' },
  { match: /text-\[\#F59E0B\]/g, replace: 'text-secondary' },
  { match: /bg-\[\#F59E0B\]/g, replace: 'bg-secondary' },
  { match: /bg-\[\#374151\]/g, replace: 'bg-primary' },
  { match: /text-\[\#B8C0C0\]/g, replace: 'text-muted' },
];

tokenMap.forEach(r => {
  content = content.replace(r.match, r.replace);
});

// Since the instructions say to remove dark mode logic we replace any dark: variants or just leave them since we stripped them earlier?
content = content.replace(/dark:[\w-\[\]#./%+]+/g, '');

fs.writeFileSync('pages/AdminApp.tsx', content);

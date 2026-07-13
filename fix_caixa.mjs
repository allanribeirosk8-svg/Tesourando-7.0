import fs from 'fs';

let content = fs.readFileSync('pages/CaixaView.tsx', 'utf8');

const rules = [
  // 1. Core Backgrounds
  { match: /bg-white dark:bg-\[\#162032\]/g, replace: 'bg-surface' },
  { match: /bg-\[\#EEF2F7\] dark:bg-\[\#0D1B2A\]/g, replace: 'bg-primary/40' },
  { match: /bg-\[\#EEF2F7\]/g, replace: 'bg-primary/40' },

  // 2. Borders
  { match: /border-\[\#D0D8E4\] dark:border-\[\#1E3148\]/g, replace: 'border-title/30' },
  
  // 3. Texts
  { match: /text-\[\#1A2332\] dark:text-\[\#E2EAF4\]/g, replace: 'text-white' },
  { match: /text-\[\#8A98A8\]/g, replace: 'text-title' },
  { match: /text-\[\#1A2332\]/g, replace: 'text-white' },

  // 4. Accent Colors
  { match: /bg-\[\#2898D8\]/g, replace: 'bg-secondary' },
  { match: /text-\[\#2898D8\]/g, replace: 'text-secondary' },

  // 5. Special tags mapping (Saída/Entrada etc) -> the red/green colors we can keep for literal semantic meaning, or map.
  // Actually, leave the F87171 (red) and 34D399 (green) as is because they represent income/expense. But they can be surface too if we want? The AdminApp left green/red for semantic stuff.

  // 6. Shadows
  // 'shadow-[0_1px_4px_rgba(0,0,0,0.06)]' -> 'shadow-sm border border-title/30' or 'border border-title/30' inside surface.
  // We'll leave the shadow utility alone or map `shadow-[xyz]` to `shadow-[0_2px_8px_rgba(0,0,0,0.3)]` or something.
];

rules.forEach(r => {
  content = content.replace(r.match, r.replace);
});

fs.writeFileSync('pages/CaixaView.tsx', content);

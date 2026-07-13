import fs from 'fs';
let content = fs.readFileSync('pages/AdminApp.tsx', 'utf8');

// Global replacement of the old shadow with the new shadow
content = content.replace(/shadow-\[0_1px_4px_rgba\(0,0,0,0\.06\)\]/g, 'border border-white/8 shadow-[0_4px_16px_rgba(0,0,0,0.4)]');

// And there was another one: shadow-[0_2px_4px_rgba(0,0,0,0.1)] ? Let's just catch that if it exists.
content = content.replace(/shadow-\[0_2px_4px_rgba\([^\]]+\)\]/g, 'border border-white/8 shadow-[0_4px_16px_rgba(0,0,0,0.4)]');
content = content.replace(/shadow-\[0_2px_12px_rgba\([^\]]+\)\]/g, 'border border-white/8 shadow-[0_4px_16px_rgba(0,0,0,0.4)]');

// But make sure we don't duplicate `border border-white/8` if it's already there
content = content.replace(/border border-white\/8\s*border border-white\/8/g, 'border border-white/8');

// "E adicionar border border-white/8 em qualquer bg-surface que ainda não tenha borda."
// This is slightly tricky with regex because we don't have AST parsing, so let's try replacing
// className="...bg-surface..."
// I will not manually replace all bg-surface. I'll just find className="bg-surface " and append border border-white/8.
// Since most are already done, it should be fine. But let's check one by one because that could break if they already have `border-` classes.

fs.writeFileSync('pages/AdminApp.tsx', content);

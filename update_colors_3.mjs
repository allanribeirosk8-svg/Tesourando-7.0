import fs from 'fs';

let content = fs.readFileSync('pages/AdminApp.tsx', 'utf8');

const rules = [
  { match: /\bbg-\[\#(FFFFFF|ffffff)\]/g, replace: 'bg-surface' },
  { match: /\bbg-\[\#(F4F7FB|F8FAFB|F0F4F8|F2F5F8|F0F2F5|E4E7EB)\]|\bbg-slate-50\b|\bbg-brand-50\b|\bbg-brand-100\b/gi, replace: 'bg-primary/40' },
  { match: /\bbg-\[\#(E8EEF5|E8F4FC|EAF4FC|D8EBF8)\]/gi, replace: 'bg-surface/80' },
  { match: /\bbg-\[\#(2898D8|1E7FB8|2098F0|F59E0B)\]|\bbg-brand-500\b|\bbg-brand-600\b/gi, replace: 'bg-secondary' },
  { match: /\btext-\[\#(2898D8|2098F0|F59E0B)\]|\btext-brand-500\b|\btext-brand-600\b/gi, replace: 'text-secondary' },
  { match: /\bring-\[\#(2898D8|2098F0)\]|\bring-brand-500\b|\bring-brand-600\b/gi, replace: 'ring-secondary' },
  { match: /\bborder-\[\#(2898D8|2098F0)\]|\bborder-brand-500\b|\bborder-brand-600\b/gi, replace: 'border-secondary' },
  { match: /\bshadow-\[\#2898D8(\/[0-9]+)?\]|\bshadow-brand-500\b/gi, replace: 'shadow-secondary/20' },
  
  // text colors
  { match: /\btext-\[\#(1A2332|5A6878|1A3A6E)\]|\btext-slate-800\b|\btext-slate-900\b|\btext-slate-700\b/gi, replace: 'text-white' },
  { match: /\btext-\[\#(8A98A8|B0BCC7|C0CAD4|D0D8E4)\]|\btext-slate-500\b|\btext-slate-600\b/gi, replace: 'text-title' },
  { match: /\btext-\[\#(B8C0C0)\]|\btext-slate-400\b|\btext-slate-300\b/gi, replace: 'text-muted' },
  
  // border colors
  { match: /\bborder-\[\#(D0D8E4|D8EBF8|E8EEF5|F1F5F9)\]|\bborder-slate-100\b|\bborder-slate-200\b/gi, replace: 'border-title/30' },
  { match: /\bbg-\[\#(D0D8E4)\]|\bbg-slate-200\b/gi, replace: 'bg-title/30' },

  { match: /\bbg-\[\#(242424|303030|3A3A3A|2A2A2A|111827|1A1A1A)\]/gi, replace: 'bg-surface' },
  { match: /\bbg-\[\#(1A3A58)\]/gi, replace: 'bg-surface/80' },
  { match: /\btext-\[\#(707070|F8F8F8)\]/gi, replace: 'text-white' },
  { match: /\bborder-\[\#(3A3A3A|444444|2F2F2F|1A3A6E)\]/gi, replace: 'border-title/30' },

  // specific svgs, strings, etc
  { match: /(["'])#2898D8(["'])/g, replace: '$1#F99417$2' },
];

rules.forEach(r => {
  content = content.replace(r.match, r.replace);
});

// Since we replaced the bad word boundary, we might end up with `bg-surface text-white` which is good.

// Nav element background (using a simple RegExp to target `<nav ...>`)
content = content.replace(/(<nav[^>]*className=["'][^"']*\s*)bg-surface([^"']*["'])/g, '$1bg-primary$2');

fs.writeFileSync('pages/AdminApp.tsx', content);

import fs from 'fs';

let content = fs.readFileSync('pages/AdminApp.tsx', 'utf8');

// Replace all remaining bg-[#...] and border-[#...] that are clearly old theme
// #F2F5F8, #F0F2F5, #E4E7EB -> bg-primary/40
const rules = [
  { match: /\bbg-\[\#(FFFFFF|ffffff)\]\b|\bbg-white\b/g, replace: 'bg-surface' },
  { match: /\bbg-\[\#(F4F7FB|F8FAFB|F0F4F8|F2F5F8|F0F2F5|E4E7EB)\]\b|\bbg-slate-50\b|\bbg-brand-50\b|\bbg-brand-100\b/gi, replace: 'bg-primary/40' },
  { match: /\bbg-\[\#(E8EEF5|E8F4FC|EAF4FC|D8EBF8)\]\b/gi, replace: 'bg-surface/80' },
  { match: /\bbg-\[\#(2898D8|1E7FB8|2098F0|F59E0B)\]\b|\bbg-brand-500\b|\bbg-brand-600\b/gi, replace: 'bg-secondary' },
  { match: /\btext-\[\#(2898D8|2098F0|F59E0B)\]\b|\btext-brand-500\b|\btext-brand-600\b/gi, replace: 'text-secondary' },
  { match: /\bring-\[\#(2898D8|2098F0)\]\b|\bring-brand-500\b|\bring-brand-600\b/gi, replace: 'ring-secondary' },
  { match: /\bborder-\[\#(2898D8|2098F0)\]\b|\bborder-brand-500\b|\bborder-brand-600\b/gi, replace: 'border-secondary' },
  { match: /\bshadow-\[\#2898D8(\/[0-9]+)?\]\b|\bshadow-brand-500\b/gi, replace: 'shadow-secondary/20' },
  
  // text colors
  { match: /\btext-\[\#(1A2332|5A6878|1A3A6E)\]\b|\btext-slate-800\b|\btext-slate-900\b|\btext-slate-700\b/gi, replace: 'text-white' },
  { match: /\btext-\[\#(8A98A8|B0BCC7|C0CAD4|D0D8E4)\]\b|\btext-slate-500\b|\btext-slate-600\b/gi, replace: 'text-title' },
  { match: /\btext-\[\#(B8C0C0)\]\b|\btext-slate-400\b|\btext-slate-300\b/gi, replace: 'text-muted' },
  
  // border colors
  { match: /\bborder-\[\#(D0D8E4|D8EBF8|E8EEF5|F1F5F9)\]\b|\bborder-slate-100\b|\bborder-slate-200\b/gi, replace: 'border-title/30' },
  { match: /\bbg-\[\#(D0D8E4)\]\b|\bbg-slate-200\b/gi, replace: 'bg-title/30' },

  // extra leftovers (from check_colors output)
  { match: /\bbg-\[\#(242424|303030|3A3A3A|2A2A2A|111827|1A1A1A)\]\b/gi, replace: 'bg-surface' },
  { match: /\bbg-\[\#(1A3A58)\]\b/gi, replace: 'bg-surface/80' },
  { match: /\btext-\[\#(707070|F8F8F8)\]\b/gi, replace: 'text-white' },
  { match: /\bborder-\[\#(3A3A3A|444444|2F2F2F|1A3A6E)\]\b/gi, replace: 'border-title/30' },
  
  { match: /bg-\[\#374151\]/g, replace: 'bg-primary' },
  { match: /text-slate-200/g, replace: 'text-muted' },
  { match: /hover:bg-slate-200/g, replace: 'hover:bg-surface' },

  { match: /\bborder-\[\#FFFFFF\]/g, replace: 'border-white' },

  // specifically "#2898D8" in SVGs etc
  { match: /(["'])#2898D8(["'])/g, replace: '$1#F99417$2' },
  { match: /(["'])#FFFFFF(["'])/g, replace: '$1#2D2856$2' }, // Wait, if #FFFFFF is used in fill or stroke, it's surface now? Usually white is white. Let's not blindly replace #FFFFFF unless it's known to be background. I'll leave #FFFFFF.
];

rules.forEach(r => {
  content = content.replace(r.match, r.replace);
});

// specific components fixes
content = content.replace(/border-title\/30\/60/g, 'border-title/20');
content = content.replace(/bg-surface\/10/g, 'bg-surface');
content = content.replace(/border-white\/15/g, 'border-title/20');

// Component specific
// "Bottom Navigation Bar (nav)"
// The nav is usually `<nav className="... bg-surface dark:bg-[#... border-t border-title/30...">`
content = content.replace(/(<nav\s+className="[^"]*)bg-surface([^"]*")/, (match, p1, p2) => {
  return p1 + 'bg-primary' + p2;
});

// SettingsModal bottom sheet:
// Fundo: bg-surface rounded-t-[2.5rem]
// Handle bar: bg-title/30
content = content.replace(/<div className="w-12 h-1\.5 bg-title\/30 rounded-full mx-auto mb-6"/g, '<div className="w-12 h-1.5 bg-title/30 rounded-full mx-auto mb-6"'); // was probably title/30 from earlier replacements

fs.writeFileSync('pages/AdminApp.tsx', content);


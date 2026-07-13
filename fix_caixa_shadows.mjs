import fs from 'fs';

let content = fs.readFileSync('pages/CaixaView.tsx', 'utf8');

// The standard replacement for bg-surface block styling from AdminApp
// Replace common block elements with standardized surface look
content = content.replace(/shadow-\[0_1px_4px_rgba\(0,0,0,0\.0(?:6|8)\)\]/g, 'border border-white/8 shadow-[0_4px_16px_rgba(0,0,0,0.3)]');

// Fix the dark mode classes that are left explicitly
content = content.replace(/dark:bg-\[\#[A-Fa-f0-9]+\]/gi, '');
content = content.replace(/dark:text-\[\#[A-Fa-f0-9]+\]/gi, '');

// Specifically for those background colors that look weird in the new dark theme:
// Alerts:
content = content.replace(/bg-\[\#FEF2F2\]/g, 'bg-red-500/10 border border-red-500/20');
content = content.replace(/bg-\[\#F0FDF4\]/g, 'bg-green-500/10 border border-green-500/20');

// Sub-surface backgrounds (e.g. for icon buttons or empty tracks)
content = content.replace(/bg-\[\#EEF2F7\]/g, 'bg-primary/40');
content = content.replace(/bg-\[\#0D1B2A\]/gi, 'bg-primary/40');

fs.writeFileSync('pages/CaixaView.tsx', content);

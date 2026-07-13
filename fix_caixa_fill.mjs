import fs from 'fs';
let content = fs.readFileSync('pages/CaixaView.tsx', 'utf8');

// Replace specific hex colors to match new theme
content = content.replace(/(["'])#2898D8(["'])/g, '$1#F99417$2');
content = content.replace(/bg-\[\#2898D8\]\/20/g, 'bg-secondary/20');
content = content.replace(/text-\[\#2898D8\]/g, 'text-secondary');
content = content.replace(/bg-secondary/g, 'bg-secondary'); // no change just reminder
content = content.replace(/fill="#2898D8"/g, 'fill="#F99417"');

fs.writeFileSync('pages/CaixaView.tsx', content);

const fs = require('fs');
let content = fs.readFileSync('pages/CaixaView.tsx', 'utf8');
content = content.replace(/dark:bg-\[#242438\]/g, 'dark:bg-[#1A2B3C]');
content = content.replace(/bg-\[#F4F7FB\]/g, 'bg-[#F0F4F8]');
content = content.replace(/dark:bg-\[#1A1A2E\]/g, 'dark:bg-[#0D1B2A]');
content = content.replace(/dark:text-white/g, 'dark:text-[#E8F0F8]');
fs.writeFileSync('pages/CaixaView.tsx', content);

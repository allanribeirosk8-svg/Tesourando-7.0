import fs from 'fs';

let content = fs.readFileSync('pages/AdminApp.tsx', 'utf8');

// 1516
content = content.replace(/linear-gradient\(135deg, #1E7FB8 0%, #2898D8 45%, #3AABFF 100%\)/g, 'linear-gradient(135deg, #FFB75E 0%, #F99417 100%)'); // secondary gradient

// 1527
content = content.replace(/text-\[\#FFFFFF\]\/60/g, 'text-white/60');

// 1715
content = content.replace(/border-l-\[\#2898D8\]/g, 'border-l-secondary');

// 2643, 2782
content = content.replace(/:bg-\[\#2F2F2F\]\/50/g, '');
content = content.replace(/:bg-\[\#2F2F2F\]/g, '');

// 3560
content = content.replace(/from-\[\#FFFFFF\]/g, 'from-primary');

// 4038
content = content.replace(/bg-\[\#1A2332\]/g, 'bg-surface');

fs.writeFileSync('pages/AdminApp.tsx', content);

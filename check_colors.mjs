import fs from 'fs';
const content = fs.readFileSync('pages/AdminApp.tsx', 'utf8');
const counts = {};
const matches = content.match(/bg-\[[^\]]+\]|text-\[[^\]]+\]|border-\[[^\]]+\]|#2898D8|#FFFFFF|#1A2332|#5A6878/g) || [];
matches.forEach(m => counts[m] = (counts[m] || 0) + 1);
console.log(counts);

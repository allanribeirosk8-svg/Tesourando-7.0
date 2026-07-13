import fs from 'fs';
const content = fs.readFileSync('pages/CaixaView.tsx', 'utf8');
const matched = content.match(/bg-\[#[A-Fa-f0-9]*\]/g);
if (matched) {
  const counts = matched.reduce((acc, v) => { acc[v] = (acc[v] || 0) + 1; return acc; }, {});
  console.log(counts);
} else {
  console.log("No bg matches");
}
const textMatched = content.match(/text-\[#[A-Fa-f0-9]*\]/g);
if (textMatched) {
  const counts = textMatched.reduce((acc, v) => { acc[v] = (acc[v] || 0) + 1; return acc; }, {});
  console.log(counts);
}

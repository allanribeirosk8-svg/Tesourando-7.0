import fs from 'fs';
let content = fs.readFileSync('pages/AdminApp.tsx', 'utf8');

// The remaining borders
content = content.replace(
  /border border-white\/8 shadow-\[0_4px_16px_rgba\(0,0,0,0\.4\)\]/g,
  ''
);

content = content.replace(
  /border border-white\/8 shadow-\[0_2px_8px_rgba\(0,0,0,0\.3\)\]/g,
  ''
);

fs.writeFileSync('pages/AdminApp.tsx', content);

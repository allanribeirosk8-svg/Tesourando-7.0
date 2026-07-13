import fs from 'fs';
let content = fs.readFileSync('pages/AdminApp.tsx', 'utf8');

// For Services `Reorder.Group`
content = content.replace(
  /className="space-y-2">\s*\{services\.map/g,
  'className="flex flex-col">\n          {services.map'
);

// For Customers list wrapper
content = content.replace(
  /\} \:\ \(\s*customerList\.map/g,
  `} : (\n        <div className="flex flex-col">\n          {customerList.map`
);

content = content.replace(
  /\s*\}\)\s*\)\}\s*<\/div>\s*<\/div>\s*\)\;\s*\}\;/g,
  '\n            })\n          }\n        </div>\n      )}\n    </div>\n  );\n};'
);

// We need to be careful with the last one.
// The end of `customerList.map` should be closed with `</div>`.
// A better way is:
// find \)\s*\)\}\s*<\/div>\s*<\/div>\s*\)\; for CustomerList View.
fs.writeFileSync('pages/AdminApp.tsx', content);

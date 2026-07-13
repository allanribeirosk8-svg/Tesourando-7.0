import fs from 'fs';

function replaceInFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');

  // Replace brand palette remnants
  content = content.replace(/\btext-brand-600\b|\btext-brand-500\b/g, 'text-[#2898D8]');
  content = content.replace(/\bbg-brand-500\b|\bbg-brand-600\b/g, 'bg-[#2898D8]');
  content = content.replace(/\bbg-brand-50\b|\bbg-brand-100\b/g, 'bg-[#E8F4FC]');
  content = content.replace(/hover:bg-brand-50\b|hover:bg-brand-100\b/g, 'hover:bg-[#E8F4FC]');
  content = content.replace(/hover:bg-brand-500\b|hover:bg-brand-600\b|hover:bg-brand-700\b/g, 'hover:bg-[#1E7FB8]');
  content = content.replace(/\bborder-brand-100\b/g, 'border-[#D0D8E4]');
  content = content.replace(/shadow-brand-500\/20|shadow-brand-200\b/g, 'shadow-[#2898D8]/20');
  content = content.replace(/ring-brand-500\b|focus:ring-brand-500\b/g, 'ring-[#2898D8]');
  
  // Specific missing ones from components/Calendar.tsx
  content = content.replace(/\bborder-brand-500\b/g, 'border-[#2898D8]');
  content = content.replace(/\bbg-brand-900\/20/g, 'bg-[#1A3A58]');
  content = content.replace(/\bbg-brand-900\/40/g, 'bg-[#1A3A58]');
  content = content.replace(/\btext-brand-400\b|\btext-brand-700\b|\btext-brand-300\b/g, 'text-[#2898D8]');

  // Replace slate remnants
  content = content.replace(/\bbg-slate-900\/95/g, 'bg-[#111827]/95');
  content = content.replace(/\bbg-slate-700\b/g, 'bg-[#374151]');
  content = content.replace(/\bbg-slate-900\b/g, 'bg-[#242424]');
  content = content.replace(/dark:border-slate-800\/50/g, 'dark:border-[#3A3A3A]');
  content = content.replace(/dark:border-slate-800\b/g, 'dark:border-[#3A3A3A]');
  content = content.replace(/dark:bg-slate-800\/40/g, 'dark:bg-[#303030]');
  content = content.replace(/dark:bg-slate-800\b/g, 'dark:bg-[#303030]');
  content = content.replace(/dark:hover:bg-slate-700\b/g, 'dark:hover:bg-[#3A3A3A]');
  content = content.replace(/\bbg-slate-100\b/g, 'bg-[#E8EEF5]');
  content = content.replace(/\bborder-slate-50\b/g, 'border-[#D0D8E4]/60');
  content = content.replace(/\bbg-slate-50\/50/g, 'bg-[#F4F7FB]/50');
  content = content.replace(/\bbg-slate-50\/30/g, 'bg-[#F4F7FB]/30');
  content = content.replace(/\bborder-slate-100\b/g, 'border-[#D0D8E4]');
  content = content.replace(/\bbg-slate-50\b/g, 'bg-[#F4F7FB]');
  content = content.replace(/\bbg-slate-400\b/g, 'bg-[#8A98A8]');

  content = content.replace(/\btext-slate-400\s+hover:text-slate-600\b/g, 'text-[#8A98A8] hover:text-[#1A2332]');
  content = content.replace(/\btext-slate-400\b|\btext-slate-300\b/g, 'text-[#8A98A8]');
  content = content.replace(/\btext-slate-800\b|\btext-slate-900\b/g, 'text-[#1A2332]');
  content = content.replace(/hover:text-slate-600\b/g, 'hover:text-[#1A2332]');
  content = content.replace(/\btext-slate-500\b|\btext-slate-600\b|\btext-slate-700\b/g, 'text-[#5A6878]');

  content = content.replace(/dark:text-slate-900\b/g, 'dark:border-[#242424]'); // Kept original weird replacement
  content = content.replace(/dark:text-slate-500\b|dark:text-slate-400\b|dark:text-slate-300\b|dark:text-slate-600\b|dark:text-slate-700\b/g, 'dark:text-[#B8C0C0]');
  content = content.replace(/dark:text-slate-200\b/g, 'dark:text-[#F8F8F8]'); // Found text-slate-200 in admin app just now
  content = content.replace(/dark:text-white\b/g, 'dark:text-[#F8F8F8]');
  content = content.replace(/hover:bg-slate-50\b/g, 'hover:bg-[#F4F7FB]');
  content = content.replace(/hover:bg-slate-100\b/g, 'hover:bg-[#E8EEF5]');
  content = content.replace(/dark:hover:bg-slate-800\/20/g, 'dark:hover:bg-[#303030]/30');
  content = content.replace(/dark:hover:bg-slate-800\b/g, 'dark:hover:bg-[#303030]');
  content = content.replace(/dark:border-slate-700\b/g, 'dark:border-[#3A3A3A]');

  fs.writeFileSync(filePath, content);
}

replaceInFile('components/Calendar.tsx');

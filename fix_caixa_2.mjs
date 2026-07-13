import fs from 'fs';
let content = fs.readFileSync('pages/CaixaView.tsx', 'utf8');

// The replacement logic:

content = content.replace(
  `  // Filter local state appointments for current period
  const periodAppointments = useMemo(() => {
    return appointments.filter(a => a.date >= dateRange.start && a.date <= dateRange.end);
  }, [appointments, dateRange]);`,
  `  const txNoPeriodo = useMemo(() => {
    return transactions.filter(t => {
      const txDate = (t.date || '').split('T')[0];
      return txDate >= dateRange.start && txDate <= dateRange.end;
    });
  }, [transactions, dateRange]);

  // Filter local state appointments for current period
  const periodAppointments = useMemo(() => {
    return appointments.filter(a => {
      const aptDate = a.date.split('T')[0];
      return aptDate >= dateRange.start && aptDate <= dateRange.end;
    });
  }, [appointments, dateRange]);`
);

content = content.replace(
  `  const incomeTotal = transactions.filter(t => t.type === 'income').reduce((sum, t) => sum + t.amount, 0);
  const expenseTotal = transactions.filter(t => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0);
  const lucroEstimado = incomeTotal - expenseTotal;`,
  `  const manualIncome = txNoPeriodo.filter(t => t.type === 'income' && t.category !== 'walk_in' && !(t as any).appointment_id && !(t as any).source).reduce((sum, t) => sum + t.amount, 0);
  const expenseTotal = txNoPeriodo.filter(t => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0);
  const lucroEstimado = (faturamento + manualIncome) - expenseTotal;`
);

content = content.replace(
  `      // Atendimentos concluídos como entradas
      const fromApts = completedApts.map(a => ({
        id: \`apt-\${a.id}\`,
        type: 'income' as const,
        category: 'appointment' as string,
        description: \`\${a.service} — \${a.clientName}\`,
        amount: a.price || 0,
        date: a.date,
        isAppointment: true,
        time: a.time,
      }));
      // Transações manuais
      const fromTx = transactions.map(t => ({ ...t, isAppointment: false }));
      // Unir e ordenar por data desc, depois por hora desc
      return [...fromApts, ...fromTx].sort((a, b) => {
        if (b.date !== a.date) return b.date.localeCompare(a.date);
        return ((b.time as string) || '').localeCompare((a.time as string) || '');
      });`,
  `      // Atendimentos concluídos como entradas
      const fromApts = completedApts.map(a => ({
        id: \`apt-\${a.id}\`,
        type: 'income' as const,
        category: 'appointment' as string,
        description: \`\${a.service} — \${a.clientName}\`,
        amount: a.price || 0,
        date: a.date.split('T')[0],
        isAppointment: true,
        time: a.time,
      }));
      // Transações manuais automáticas geradas por atendimentos
      const manualTx = txNoPeriodo.filter(t => 
        t.category !== 'walk_in' && 
        t.category !== 'appointment' && 
        !(t as any).appointment_id && 
        !(t as any).source
      ).map(t => ({ ...t, date: (t.date || '').split('T')[0], isAppointment: false }));
      
      // Unir e ordenar por data desc, depois por hora desc
      return [...fromApts, ...manualTx].sort((a, b) => {
        if (b.date !== a.date) return b.date.localeCompare(a.date);
        return ((b.time as string) || '00:00').localeCompare((a.time as string) || '00:00');
      });`
);

content = content.replace(
  `<div className="flex overflow-x-auto gap-3 pb-2 -mx-4 px-4 hide-scrollbar snap-x snap-mandatory">
          <Chip titulo="Faturamento" valor={formatCurrency(faturamento)} diff={faturamentoDiff} />
          <Chip titulo="Atendimentos" valor={String(atendimentos)} diff={atendDiff} sub={faltas > 0 ? \`\${faltas} falta\${faltas > 1 ? 's' : ''}\` : undefined} />
          <Chip titulo="Ticket Médio" valor={formatCurrency(ticketMedio)} diff={ticketDiff} />
          <Chip titulo="Lucro Estimado" valor={formatCurrency(lucroEstimado)} sub={expenseTotal === 0 ? 'Cadastre saídas' : undefined} />
        </div>`,
  `<div className="grid grid-cols-2 gap-3">
          <Chip titulo="Faturamento" valor={formatCurrency(faturamento)} diff={faturamentoDiff} />
          <Chip titulo="Atendimentos" valor={String(atendimentos)} diff={atendDiff} sub={faltas > 0 ? \`\${faltas} falta\${faltas > 1 ? 's' : ''}\` : undefined} />
          <Chip titulo="Ticket Médio" valor={formatCurrency(ticketMedio)} diff={ticketDiff} />
          <Chip titulo="Lucro Estimado" valor={formatCurrency(lucroEstimado)} sub={expenseTotal === 0 ? 'Cadastre saídas' : undefined} />
        </div>`
);

content = content.replace(
  `    const Chip = ({ titulo, valor, diff, sub }: { titulo: string; valor: string; diff?: number | null; sub?: string }) => (
      <div className="min-w-[140px] max-w-[180px] rounded-[2rem] bg-white dark:bg-[#162032] shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-4 flex flex-col gap-1 flex-shrink-0 snap-start">
        <span className="text-[10px] font-bold uppercase text-[#8A98A8]">{titulo}</span>
        <span className="text-lg font-black text-[#1A2332] dark:text-[#E2EAF4] min-w-0 break-words leading-tight">{valor}</span>
        {diff !== undefined && diff !== null && (
          <span className={\`text-[11px] font-bold flex items-center gap-0.5 \${diff >= 0 ? 'text-[#34D399]' : 'text-[#F87171]'}\`}>
            {diff >= 0 ? '▲' : '▼'} {Math.abs(diff).toFixed(1)}% vs anterior
          </span>
        )}
        {sub && <span className="text-[10px] text-[#8A98A8]">{sub}</span>}
      </div>
    );`,
  `    const Chip = ({ titulo, valor, diff, sub }: { titulo: string; valor: string; diff?: number | null; sub?: string }) => (
      <div className="rounded-[1.5rem] bg-white dark:bg-[#162032] shadow-[0_1px_4px_rgba(0,0,0,0.08)] p-4 flex flex-col gap-1 w-full">
        <span className="text-[10px] font-bold uppercase text-[#8A98A8] truncate">{titulo}</span>
        <span className="text-base font-black text-[#1A2332] dark:text-[#E2EAF4] leading-tight break-words min-w-0">{valor}</span>
        {diff !== undefined && diff !== null && (
          <span className={\`text-[10px] font-bold flex items-center gap-0.5 \${diff >= 0 ? 'text-[#34D399]' : 'text-[#F87171]'}\`}>
            {diff >= 0 ? '▲' : '▼'} {Math.abs(diff).toFixed(1)}% vs anterior
          </span>
        )}
        {sub && <span className="text-[10px] text-[#8A98A8]">{sub}</span>}
      </div>
    );`
);

fs.writeFileSync('pages/CaixaView.tsx', content);

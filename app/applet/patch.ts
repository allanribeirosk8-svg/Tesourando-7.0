import fs from 'fs';

let content = fs.readFileSync('pages/AdminApp.tsx', 'utf8');

const startPattern = 'const ReportsView: React.FC = () => {';
const endPattern = 'export default AdminApp;';

const startIdx = content.indexOf(startPattern);
const endIdx = content.lastIndexOf('};', content.indexOf(endPattern));

if (startIdx === -1) { 
  console.log('not found');
  process.exit(1); 
}

const replacement = `const ReportsView: React.FC = () => {
  const { appointments, customers, isDarkMode, weeklySchedule } = useStore();
  const [period, setPeriod] = useState<'dia' | 'semana' | 'mes' | 'ano'>('dia');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [showSelector, setShowSelector] = useState(false);
  const [viewDate, setViewDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<'days' | 'years'>('days');
  const [slideDirection, setSlideDirection] = useState(0);

  const handleReportsSwipeLeft = () => {
    if (viewMode !== 'days') return;
    setSlideDirection(1);
    setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1));
  };

  const handleReportsSwipeRight = () => {
    if (viewMode !== 'days') return;
    setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1));
    setSlideDirection(-1);
  };

  const reportsSwipeHandlers = useSwipe(handleReportsSwipeLeft, handleReportsSwipeRight);

  const getRange = (p: 'dia' | 'semana' | 'mes' | 'ano', date: Date) => {
    const d = new Date(date);
    if (p === 'dia') {
      const s = d.toISOString().split('T')[0];
      return { start: s, end: s };
    }
    if (p === 'semana') {
      const start = new Date(d);
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1);
      start.setDate(diff);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      end.setHours(23, 59, 59, 999);
      return { start: start.toISOString().split('T')[0], end: end.toISOString().split('T')[0] };
    }
    if (p === 'mes') {
      const start = new Date(d.getFullYear(), d.getMonth(), 1);
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      return { start: start.toISOString().split('T')[0], end: end.toISOString().split('T')[0] };
    }
    if (p === 'ano') {
      const start = new Date(d.getFullYear(), 0, 1);
      const end = new Date(d.getFullYear(), 11, 31);
      return { start: start.toISOString().split('T')[0], end: end.toISOString().split('T')[0] };
    }
    return { start: '', end: '' };
  };

  const getPreviousRange = (p: 'dia' | 'semana' | 'mes' | 'ano', date: Date) => {
    const d = new Date(date);
    if (p === 'dia') {
      d.setDate(d.getDate() - 1);
    } else if (p === 'semana') {
      d.setDate(d.getDate() - 7);
    } else if (p === 'mes') {
      d.setMonth(d.getMonth() - 1);
    } else if (p === 'ano') {
      d.setFullYear(d.getFullYear() - 1);
    }
    return getRange(p, d);
  };

  const currentRange = getRange(period, currentDate);
  const previousRange = getPreviousRange(period, currentDate);

  const stats = useMemo(() => {
    const filterApts = (range: { start: string, end: string }) => 
      appointments.filter(a => a.date >= range.start && a.date <= range.end);

    const currentApts = filterApts(currentRange);
    const previousApts = filterApts(previousRange);

    const calcMetrics = (apts: Appointment[]) => {
      const completed = apts.filter(a => a.status === 'completed');
      const revenueApts = apts.filter(a => a.status === 'completed');
      const noShows = apts.filter(a => a.status === 'no-show');
      
      const count = completed.length;
      const revenue = revenueApts.reduce((sum, a) => sum + (a.price || 0), 0);
      const ticket = count > 0 ? revenue / count : 0;
      const noShowRate = (count + noShows.length) > 0 ? (noShows.length / (count + noShows.length)) * 100 : 0;
      
      return { count, revenue, ticket, noShowRate, apts };
    };

    const current = calcMetrics(currentApts);
    const previous = calcMetrics(previousApts);

    // Chart Data
    let chartData: any[] = [];
    let chartTitle = "";
    if (period === 'dia') {
      chartTitle = "Horários mais movimentados";
      for (let h = 8; h <= 20; h++) {
        const hourStr = h.toString().padStart(2, '0');
        const count = current.apts.filter(a => a.status === 'completed' && a.time.startsWith(hourStr)).length;
        chartData.push({ name: \`\${h}h\`, value: count });
      }
    } else if (period === 'semana') {
      chartTitle = "Dias da semana";
      const dayNames = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab', 'Dom'];
      const start = new Date(currentRange.start + 'T12:00:00');
      for (let i = 0; i < 7; i++) {
        const d = new Date(start);
        d.setDate(start.getDate() + i);
        const dateStr = d.toISOString().split('T')[0];
        const count = current.apts.filter(a => a.status === 'completed' && a.date === dateStr).length;
        chartData.push({ name: dayNames[i], value: count });
      }
    } else if (period === 'mes') {
      chartTitle = "Semanas do mês";
      const start = new Date(currentRange.start + 'T12:00:00');
      const end = new Date(currentRange.end + 'T12:00:00');
      let week = 1;
      let curr = new Date(start);
      while (curr <= end) {
        const wStart = new Date(curr);
        const wEnd = new Date(curr);
        wEnd.setDate(curr.getDate() + 6);
        const count = current.apts.filter(a => a.status === 'completed' && a.date >= wStart.toISOString().split('T')[0] && a.date <= wEnd.toISOString().split('T')[0]).length;
        chartData.push({ name: \`Sem \${week}\`, value: count });
        curr.setDate(curr.getDate() + 7);
        week++;
      }
    } else if (period === 'ano') {
      chartTitle = "Meses do ano";
      const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
      for (let m = 0; m < 12; m++) {
        const count = current.apts.filter(a => {
          const aptDate = new Date(a.date + 'T12:00:00');
          return a.status === 'completed' && aptDate.getMonth() === m;
        }).length;
        chartData.push({ name: months[m], value: count });
      }
    }

    // Clientes Tab Data
    const clientStats: Record<string, { name: string, count: number, spent: number, noShows: number }> = {};
    current.apts.forEach(a => {
      if (!clientStats[a.phone]) {
        clientStats[a.phone] = { name: a.clientName, count: 0, spent: 0, noShows: 0 };
      }
      if (a.status === 'completed') {
        clientStats[a.phone].count++;
        clientStats[a.phone].spent += (a.price || 0);
      } else if (a.status === 'no-show') {
        clientStats[a.phone].noShows++;
      }
    });

    const topClients = Object.values(clientStats)
      .sort((a, b) => b.spent - a.spent)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const newClients = Object.keys(clientStats).filter(phone => {
      const firstApt = appointments.find(a => a.phone === phone);
      return firstApt && firstApt.date >= currentRange.start && firstApt.date <= currentRange.end;
    }).length;

    const returningClients = Object.values(clientStats).filter(c => c.count > 1).length;
    const totalClientsWithApts = Object.keys(clientStats).filter(phone => {
      return current.apts.some(a => a.phone === phone && a.status === 'completed');
    }).length;
    const returnRate = totalClientsWithApts > 0 ? (returningClients / totalClientsWithApts) * 100 : 0;

    // Serviços Tab Data
    const serviceStats: Record<string, { count: number, revenue: number }> = {};
    current.apts.forEach(a => {
      if (a.status === 'completed') {
        if (!serviceStats[a.service]) {
          serviceStats[a.service] = { count: 0, revenue: 0 };
        }
        serviceStats[a.service].count++;
        serviceStats[a.service].revenue += (a.price || 0);
      }
    });

    const topServices = Object.entries(serviceStats)
      .map(([name, s]) => ({ name, ...s, ticket: s.count > 0 ? s.revenue / s.count : 0 }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);

    return {
      current,
      previous,
      chartData,
      chartTitle,
      topClients,
      newClients,
      returnRate,
      topServices,
      totalCustomers: totalClientsWithApts
    };
  }, [appointments, period, currentDate, currentRange, previousRange]);

  const occupancyRatio = useMemo(() => {
    let totalSlots = 0;
    
    if (period === 'dia') {
       const dayOfWeek = currentDate.getDay();
       const config = weeklySchedule[dayOfWeek];
       if (config?.isOpen) {
         totalSlots = generateTimeSlots(config.start, config.end).length;
       }
    } else {
       const start = new Date(currentRange.start + 'T12:00:00');
       const end = new Date(currentRange.end + 'T12:00:00');
       let curr = new Date(start);
       while (curr <= end) {
         const dayOfWeek = curr.getDay();
         const config = weeklySchedule[dayOfWeek];
         if (config?.isOpen) {
             totalSlots += generateTimeSlots(config.start, config.end).length;
         }
         curr.setDate(curr.getDate() + 1);
       }
    }
    if (totalSlots === 0) return 0;
    const completed = stats.current.count;
    return Math.min(completed / totalSlots, 1);
  }, [weeklySchedule, currentDate, currentRange, period, stats.current.count]);

  const renderComparison = (current: number, previous: number) => {
    if (previous === 0) return <p className="text-[9px] text-[#9CA3AF] mt-0.5">✦ Primeiro registro neste período</p>;
    const diff = ((current - previous) / previous) * 100;
    const isUp = diff > 0;
    
    const absDiff = Math.abs(diff).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 1 });

    if (diff === 0) return <p className="text-[9px] text-[#8A98A8] mt-0.5">Mesmo que o período anterior</p>;
    
    return (
      <p className={\`flex items-center gap-1 font-bold text-sm \${isUp ? 'text-green-500' : 'text-red-500'}\`}>
        {isUp ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
        {absDiff}%
      </p>
    );
  };

  const renderAlertCard = () => {
    const { noShowRate } = stats.current;
    const { returnRate } = stats;
    let alertType: 'red' | 'yellow' | 'green' | null = null;
    let message = "";

    if (noShowRate > 20) {
      alertType = 'red';
      message = "Taxa de circular no-show alta neste período";
    } else if (returnRate < 30 && period !== 'dia') {
      alertType = 'yellow';
      message = "Poucos clientes retornando";
    } else if (stats.current.revenue > stats.previous.revenue * 1.3 && stats.previous.revenue > 0) {
      alertType = 'green';
      const diff = ((stats.current.revenue - stats.previous.revenue) / stats.previous.revenue) * 100;
      message = \`Ótimo período! Faturamento \${diff.toFixed(0)}% acima\`;
    }

    if (!alertType) return null;

    const colors = {
      red: 'bg-red-50 text-red-600 border-red-200 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/20',
      yellow: 'bg-amber-50 text-amber-600 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20',
      green: 'bg-green-50 text-green-600 border-green-200 dark:bg-green-500/10 dark:text-green-400 dark:border-green-500/20',
    };
    
    const icons = {
      red: <AlertTriangle size={16} />,
      yellow: <AlertTriangle size={16} />,
      green: <TrendingUp size={16} />
    };

    return (
      <div className={\`p-4 rounded-[1.25rem] border flex items-center gap-3 \${colors[alertType]}\`}>
        <div className="shrink-0">{icons[alertType]}</div>
        <p className="text-xs font-bold leading-tight">{message}</p>
      </div>
    );
  };

  const formatPeriodDisplay = () => {
    const monthsShort = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    const monthsFull = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    
    if (period === 'dia') {
      return \`\${currentDate.getDate()} de \${monthsShort[currentDate.getMonth()]}. \${currentDate.getFullYear()}\`;
    }
    if (period === 'semana') {
      const start = new Date(currentRange.start + 'T12:00:00');
      const end = new Date(currentRange.end + 'T12:00:00');
      return \`\${start.getDate()}–\${end.getDate()} \${monthsShort[start.getMonth()]}. \${start.getFullYear()}\`;
    }
    if (period === 'mes') {
      return \`\${monthsFull[currentDate.getMonth()]} \${currentDate.getFullYear()}\`;
    }
    if (period === 'ano') {
      return currentDate.getFullYear().toString();
    }
    return '';
  };

  const renderCalendar = () => {
    if (viewMode === 'years') {
      const currentYear = new Date().getFullYear();
      const years = [];
      for (let y = 2026; y <= currentYear + 2; y++) {
        years.push(y);
      }

      return (
        <div className="p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold text-[#5A6878] dark:text-[#F8F8F8]">Selecionar Ano</h4>
            <button onClick={() => setViewMode('days')} className="text-[10px] font-bold text-[#2898D8]">Voltar</button>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {years.map(year => (
              <button
                key={year}
                onClick={() => {
                  setViewDate(new Date(year, viewDate.getMonth(), 1));
                  setViewMode('days');
                }}
                className={\`h-10 rounded-xl flex items-center justify-center text-[11px] font-bold transition-all
                  \${viewDate.getFullYear() === year ? 'bg-[#2898D8] text-white shadow-sm' : 'bg-[#F4F7FB] dark:bg-[#303030] text-[#5A6878] dark:text-[#8A98A8] hover:bg-[#E8EEF5]'}\`}
              >
                {year}
              </button>
            ))}
          </div>
        </div>
      );
    }

    const daysInMonth = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0).getDate();
    const firstDayOfMonth = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1).getDay();
    const offset = firstDayOfMonth; // 0 is Sunday
    
    const days = [];
    const prevMonthLastDay = new Date(viewDate.getFullYear(), viewDate.getMonth(), 0).getDate();
    
    // Previous month
    for (let i = offset - 1; i >= 0; i--) {
      days.push(<div key={\`prev-\${i}\`} className="h-8 flex items-center justify-center opacity-20 text-[10px] font-bold text-[#8A98A8]">{prevMonthLastDay - i}</div>);
    }
    
    // Current month
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(viewDate.getFullYear(), viewDate.getMonth(), d);
      const dateStr = date.toISOString().split('T')[0];
      const isSelected = period === 'dia' && dateStr === currentDate.toISOString().split('T')[0];
      const isWeekSelected = period === 'semana' && dateStr >= currentRange.start && dateStr <= currentRange.end;
      const isToday = dateStr === getTodayString();
      const isBefore2026 = date.getFullYear() < 2026;

      days.push(
        <button
          key={d}
          disabled={isBefore2026 && (period === 'semana' || period === 'mes')}
          onClick={() => {
            setCurrentDate(date);
            setShowSelector(false);
          }}
          className={\`h-8 w-full rounded-lg flex items-center justify-center text-[11px] font-bold transition-all relative
            \${isSelected || isWeekSelected ? 'bg-[#2898D8] text-white shadow-sm' : isToday ? 'bg-[#E8F4FC] dark:bg-[#1A3A58] dark:text-[#2098F0] text-[#2898D8]' : 'hover:bg-[#F4F7FB] dark:hover:bg-[#3A3A3A] text-[#5A6878] dark:text-[#F8F8F8]'}
            \${isBefore2026 && (period === 'semana' || period === 'mes') ? 'opacity-20 cursor-not-allowed' : ''}\`}
        >
          {d}
        </button>
      );
    }
    
    // Next month
    const remaining = 42 - days.length;
    for (let d = 1; d <= remaining; d++) {
      days.push(<div key={\`next-\${d}\`} className="h-8 flex items-center justify-center opacity-20 text-[10px] font-bold text-[#8A98A8]">{d}</div>);
    }

    return (
      <div {...reportsSwipeHandlers} className="p-4 space-y-4 overflow-hidden">
        <div className="flex items-center justify-between">
          <button onClick={handleReportsSwipeRight} className="p-1 text-[#8A98A8] hover:text-[#2898D8]">
            <ChevronLeft size={16} />
          </button>
          <button 
            onClick={() => setViewMode('years')}
            className="text-xs font-bold text-[#5A6878] dark:text-[#F8F8F8] capitalize hover:text-[#2898D8] transition-colors"
          >
            {viewDate.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
          </button>
          <button onClick={handleReportsSwipeLeft} className="p-1 text-[#8A98A8] hover:text-[#2898D8]">
            <ChevronRight size={16} />
          </button>
        </div>
        <AnimatePresence mode="wait">
          <motion.div
            key={\`month-\${viewDate.getTime()}\`}
            initial={{ opacity: 0, x: slideDirection * 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -slideDirection * 20 }}
            transition={{ duration: 0.2 }}
          >
            <div className="grid grid-cols-7 gap-1">
              {['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map(d => (
                <div key={d} className="h-8 flex items-center justify-center text-[9px] font-black text-[#8A98A8] uppercase">{d}</div>
              ))}
              {days}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    );
  };

  const renderMonthGrid = () => {
    const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

    return (
      <div className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <button onClick={() => setViewDate(new Date(viewDate.getFullYear() - 1, viewDate.getMonth(), 1))} className="p-1 text-[#8A98A8] hover:text-[#2898D8]">
            <ChevronLeft size={16} />
          </button>
          <span className="text-xs font-bold text-[#5A6878] dark:text-[#F8F8F8]">
            {viewDate.getFullYear()}
          </span>
          <button onClick={() => setViewDate(new Date(viewDate.getFullYear() + 1, viewDate.getMonth(), 1))} className="p-1 text-[#8A98A8] hover:text-[#2898D8]">
            <ChevronRight size={16} />
          </button>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {months.map((m, idx) => {
            const isSelected = currentDate.getMonth() === idx && currentDate.getFullYear() === viewDate.getFullYear();
            const isBefore2026 = viewDate.getFullYear() < 2026;

            return (
              <button
                key={m}
                disabled={isBefore2026}
                onClick={() => {
                  setCurrentDate(new Date(viewDate.getFullYear(), idx, 1));
                  setShowSelector(false);
                }}
                className={\`h-10 rounded-xl flex items-center justify-center text-[11px] font-bold transition-all
                  \${isSelected ? 'bg-[#2898D8] text-white shadow-sm' : 'bg-[#F4F7FB] dark:bg-[#303030] text-[#5A6878] dark:text-[#8A98A8] hover:bg-[#E8EEF5]'}
                  \${isBefore2026 ? 'opacity-20 cursor-not-allowed' : ''}\`}
              >
                {m}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const renderYearGrid = () => {
    const currentYear = new Date().getFullYear();
    const years = [];
    for (let y = 2026; y <= currentYear + 1; y++) {
      years.push(y);
    }

    return (
      <div className="p-4 grid grid-cols-3 gap-2">
        {years.map(year => (
          <button
            key={year}
            onClick={() => {
              setCurrentDate(new Date(year, 0, 1));
              setShowSelector(false);
            }}
            className={\`h-10 rounded-xl flex items-center justify-center text-[11px] font-bold transition-all
              \${currentDate.getFullYear() === year ? 'bg-[#2898D8] text-white shadow-sm' : 'bg-[#F4F7FB] dark:bg-[#303030] text-[#5A6878] dark:text-[#8A98A8] hover:bg-[#E8EEF5]'}\`}
          >
            {year}
          </button>
        ))}
      </div>
    );
  };

  const handleChipClick = (targetPeriod: 'dia' | 'semana' | 'mes' | 'ano') => {
    if (period === targetPeriod) {
      setShowSelector(!showSelector);
    } else {
      setPeriod(targetPeriod);
      setCurrentDate(new Date());
      setShowSelector(false);
    }
  };

  const periodLabels = {
    dia: 'Hoje',
    semana: 'Esta Semana',
    mes: 'Este Mês',
    ano: 'Este Ano'
  };

  return (
    <div className="space-y-6 pb-24 max-w-full overflow-x-hidden">
      {/* Scroll de chips horizontal */}
      <div className="overflow-x-auto hide-scrollbar -mx-4 px-4 sticky top-0 bg-[#F4F7FB] dark:bg-[#1A1A1A] z-10 pt-2 pb-3">
        <div className="flex gap-2 w-max">
          {(['dia', 'semana', 'mes', 'ano'] as const).map(p => {
             const isActive = period === p;
             const isCurrentDate = getRange(p, currentDate).start === getRange(p, new Date()).start;
             
             let text = periodLabels[p];
             if (isActive && !isCurrentDate) {
                 text = formatPeriodDisplay();
             }
             
             return (
               <button
                 key={p}
                 onClick={() => handleChipClick(p)}
                 className={\`flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-bold transition-all whitespace-nowrap \${
                   isActive ? 'bg-[#2898D8] text-white shadow-md border border-[#2898D8]' : 'bg-white dark:bg-[#242424] text-[#8A98A8] dark:text-[#707070] border border-[#D0D8E4] dark:border-[#3A3A3A]'
                 }\`}
               >
                 {text}
                 {isActive && (
                   <ChevronDown size={14} className={\`transition-transform \${showSelector ? 'rotate-180' : ''}\`} />
                 )}
               </button>
             );
          })}
        </div>
      </div>

      <AnimatePresence>
        {showSelector && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="w-full overflow-hidden bg-[#FFFFFF] dark:bg-[#242424] rounded-3xl shadow-[0_10px_25px_rgba(0,0,0,0.1)] -mt-2 border border-[#D0D8E4] dark:border-[#3A3A3A]"
          >
            {(period === 'dia' || period === 'semana') && renderCalendar()}
            {period === 'mes' && renderMonthGrid()}
            {period === 'ano' && renderYearGrid()}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Hero card faturamento */}
      <div className="bg-[#FFFFFF] dark:bg-[#242424] p-5 rounded-[2rem] shadow-[0_1px_4px_rgba(0,0,0,0.06)] flex flex-col items-center justify-center border border-[#D0D8E4] dark:border-[#3A3A3A]">
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-[#8A98A8] dark:text-[#707070] mb-2">Faturamento</h3>
        <p className="text-[32px] font-black text-[#1A2332] dark:text-[#F8F8F8] tracking-tighter leading-none mb-3">
          {formatCurrency(stats.current.revenue)}
        </p>
        <div className="flex items-center justify-center">
            {renderComparison(stats.current.revenue, stats.previous.revenue)}
        </div>
        
        <div className="w-full mt-6 space-y-1.5">
          <div className="flex justify-between items-center px-1">
            <span className="text-[9px] font-bold uppercase tracking-widest text-[#8A98A8]">Ocupação</span>
            <span className="text-[10px] font-black text-[#2898D8] bg-[#E8F4FC] dark:bg-[#1A3A58] dark:text-[#2098F0] px-2 py-0.5 rounded-full">
               {Math.round(occupancyRatio * 100)}%
            </span>
          </div>
          <div className="h-2 w-full bg-[#E8EEF5] dark:bg-[#3A3A3A] rounded-full overflow-hidden">
             <div className="h-full bg-[#2898D8] rounded-full transition-all duration-1000 ease-out" style={{ width: \`\${Math.round(occupancyRatio * 100)}%\` }} />
          </div>
        </div>
      </div>

      {/* 3 chips compactos */}
      <div className="grid grid-cols-3 gap-2">
         <div className="bg-[#FFFFFF] dark:bg-[#242424] p-3 py-4 rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] border border-[#E8EEF5] dark:border-[#3A3A3A] text-center flex flex-col justify-center gap-1.5">
            <p className="text-[9px] font-bold uppercase tracking-widest text-[#8A98A8] leading-tight">Ticket Méd.</p>
            <p className="text-sm font-black text-[#1A2332] dark:text-[#F8F8F8]">{formatCurrency(stats.current.ticket)}</p>
         </div>
         <div className="bg-[#FFFFFF] dark:bg-[#242424] p-3 py-4 rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] border border-[#E8EEF5] dark:border-[#3A3A3A] text-center flex flex-col justify-center gap-1.5">
            <p className="text-[9px] font-bold uppercase tracking-widest text-[#8A98A8] leading-tight">Novos Appts</p>
            <p className="text-sm font-black text-[#1A2332] dark:text-[#F8F8F8]">{stats.newClients}</p>
         </div>
         <div className="bg-[#FFFFFF] dark:bg-[#242424] p-3 py-4 rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] border border-[#E8EEF5] dark:border-[#3A3A3A] text-center flex flex-col justify-center gap-1.5">
            <p className="text-[9px] font-bold uppercase tracking-widest text-[#8A98A8] leading-tight">No-show</p>
            <p className="text-sm font-black text-[#EF4444]">{stats.current.noShowRate.toFixed(1)}%</p>
         </div>
      </div>

      {renderAlertCard()}

      {/* Gráfico */}
      <div className="bg-[#FFFFFF] dark:bg-[#242424] p-5 rounded-[2rem] shadow-[0_1px_4px_rgba(0,0,0,0.06)] border border-[#D0D8E4] dark:border-[#3A3A3A] relative">
        <h4 className="text-[10px] font-bold uppercase tracking-widest text-[#8A98A8] dark:text-[#707070] mb-4 text-center">
          {stats.chartTitle}
        </h4>
        <div className="h-[200px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={stats.chartData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={isDarkMode ? '#3A3A3A' : '#E8EEF5'} />
              <XAxis 
                dataKey="name" 
                axisLine={false} 
                tickLine={false} 
                tick={{ fontSize: 9, fontWeight: 700, fill: isDarkMode ? '#707070' : '#8A98A8' }}
                dy={10}
              />
              <Tooltip 
                cursor={{ fill: isDarkMode ? '#2F2F2F' : '#F4F7FB' }}
                contentStyle={{ 
                  borderRadius: '12px', border: 'none', 
                  backgroundColor: isDarkMode ? '#1A1A1A' : '#FFFFFF', 
                  boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                  color: isDarkMode ? '#F8F8F8' : '#1A2332', fontSize: '11px', fontWeight: 700
                }}
                formatter={(value: number) => [\`\${value} atendimentos\`, '']}
                labelStyle={{ display: 'none' }}
              />
              <Bar dataKey="value" radius={[4, 4, 0, 0]} barSize={period === 'dia' ? 12 : 24}>
                {stats.chartData.map((entry, index) => {
                  const max = Math.max(...stats.chartData.map(d => d.value));
                  const isMax = entry.value === max && max > 0;
                  return (
                    <Cell 
                      key={\`cell-\${index}\`} 
                      fill="#2898D8"
                      fillOpacity={isMax ? 1 : 0.3}
                    />
                  );
                })}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Top 5 Clientes */}
      <div className="bg-[#FFFFFF] dark:bg-[#242424] p-5 rounded-[2rem] shadow-[0_1px_4px_rgba(0,0,0,0.06)] border border-[#D0D8E4] dark:border-[#3A3A3A]">
        <h4 className="text-[10px] font-bold uppercase tracking-widest text-[#8A98A8] mb-4">Top 5 Clientes</h4>
        <div className="space-y-4">
          {stats.topClients.length > 0 ? stats.topClients.map((client, idx) => (
            <div key={idx} className="flex items-center gap-3">
              <div className={\`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-xs shrink-0 \${getAvatarColor(client.name)}\`}>
                {getInitials(client.name)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-[#1A2332] dark:text-[#F8F8F8] truncate leading-tight">{client.name}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <p className="text-[10px] font-medium text-[#8A98A8]">{client.count} visitas</p>
                  <span className="w-1 h-1 bg-[#D0D8E4] dark:bg-[#3A3A3A] rounded-full"></span>
                  <p className="text-[10px] font-bold text-green-500">{formatCurrency(client.spent)}</p>
                </div>
              </div>
              {client.noShows > 0 && (
                <div className="bg-red-50 text-red-500 dark:bg-red-500/10 dark:text-red-400 px-2.5 py-1 rounded-full text-[9px] font-bold shrink-0">
                  {client.noShows} faltas
                </div>
              )}
            </div>
          )) : (
            <p className="text-center text-[#8A98A8] text-xs py-4 font-medium">Nenhum cliente no período</p>
          )}
        </div>
      </div>

      {/* Ranking de Serviços */}
      <div className="bg-[#FFFFFF] dark:bg-[#242424] p-5 rounded-[2rem] shadow-[0_1px_4px_rgba(0,0,0,0.06)] border border-[#D0D8E4] dark:border-[#3A3A3A]">
        <h4 className="text-[10px] font-bold uppercase tracking-widest text-[#8A98A8] mb-4">Ranking de Serviços</h4>
        <div className="space-y-5">
          {stats.topServices.length > 0 ? stats.topServices.map((service, idx) => {
            const maxRevenue = Math.max(...stats.topServices.map(s => s.revenue));
            const percentage = maxRevenue > 0 ? (service.revenue / maxRevenue) * 100 : 0;
            return (
              <div key={idx} className="space-y-1.5 relative">
                <div className="flex justify-between items-center text-sm">
                  <span className="font-bold text-[#1A2332] dark:text-[#F8F8F8] truncate pr-2">{service.name}</span>
                  <span className="font-black text-[#2898D8] shrink-0">{formatCurrency(service.revenue)}</span>
                </div>
                <div className="flex justify-between items-center text-[10px] text-[#8A98A8] mb-1 font-medium">
                  <span>{service.count} atendimentos</span>
                </div>
                <div className="w-full h-1.5 bg-[#E8EEF5] dark:bg-[#3A3A3A] rounded-full overflow-hidden">
                  <div className="h-full bg-[#2898D8] rounded-full transition-all duration-1000" style={{ width: \`\${percentage}%\` }} />
                </div>
              </div>
            );
          }) : (
            <p className="text-center text-[#8A98A8] text-xs py-4 font-medium">Nenhum serviço no período</p>
          )}
        </div>
      </div>
    </div>
  );
};`;

content = content.slice(0, startIdx) + replacement + content.slice(endIdx + 2);
fs.writeFileSync('pages/AdminApp.tsx', content);

console.log('Replaced successfully!');

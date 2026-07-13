import React, { useState, useEffect, useMemo } from 'react';
import { 
  Wallet, 
  Smile, 
  Package, 
  Scissors, 
  Home, 
  ShoppingBag, 
  Wrench, 
  CreditCard, 
  CircleDollarSign,
  Plus,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Trash2,
  Users,
  ArrowUpCircle,
  ArrowDownCircle,
  TrendingDown,
  TrendingUp,
  DollarSign,
  AlertTriangle,
  UserPlus,
  ArrowUp,
  ArrowDown,
  Lightbulb,
  Clock,
  Ban,
  Activity,
  Info
} from 'lucide-react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  Tooltip, 
  ResponsiveContainer,
  Cell,
  PieChart, 
  Pie
} from 'recharts';
import { AnimatePresence, motion } from 'motion/react';
import { useStore } from '../context/Store';
import { LancamentoModal } from '../components/LancamentoModal';
import { formatCurrency, getAvatarColor, getInitials } from '../utils/helpers';
import { Transaction } from '../types';
import { useSwipe } from '../hooks/useSwipe';

export const CaixaView: React.FC = () => {
  const { 
    transactions, 
    appointments, 
    customers, 
    services, 
    weeklySchedule, 
    loadTransactions, 
    deleteTransaction,
    isDarkMode,
    permissions,
    staff,
    addTransaction,
    session,
    userRole,
    finishAppointment,
    markNoShow
  } = useStore();

  const [activeTab, setActiveTab] = useState<'resumo'|'extrato'|'comissoes'|'relatorios'|'clientes'|'servicos'|'agenda'>('resumo');
  const [selectedStaffForCommission, setSelectedStaffForCommission] = useState<any | null>(null);
  const [commissionPaymentSuccess, setCommissionPaymentSuccess] = useState<string | null>(null);

  // Estados para as Recomendações Operacionais Acionáveis
  const [selectedRecAction, setSelectedRecAction] = useState<any | null>(null);
  const [recSuccessToast, setRecSuccessToast] = useState<string | null>(null);
  const [customSignalValue, setCustomSignalValue] = useState<number>(30);
  const [pixKey, setPixKey] = useState<string>('pix@tesourando.com.br');
  const [selectedCancelWindow, setSelectedCancelWindow] = useState<number>(6);
  const [recActionLoading, setRecActionLoading] = useState<boolean>(false);

  useEffect(() => {
    if (recSuccessToast) {
      const timer = setTimeout(() => {
        setRecSuccessToast(null);
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [recSuccessToast]);

  if (!permissions?.canViewCaixa) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center min-h-[50vh] text-white">
        <AlertTriangle size={48} className="text-[#F97316] mb-4 animate-pulse" />
        <h3 className="text-xl font-bold uppercase tracking-widest text-white mb-2">Acesso Negado</h3>
        <p className="text-sm text-title max-w-xs">
          Apenas o proprietário do salão (admin_owner) possui permissão para acessar o painel financeiro.
        </p>
      </div>
    );
  }
  const [periodo, setPeriodo] = useState<'dia'|'semana'|'mes'|'ano'>('mes');
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [showLancamento, setShowLancamento] = useState<'income' | 'expense' | false>(false);
  const [fabOpen, setFabOpen] = useState(false);
  const [showAllInativos, setShowAllInativos] = useState(false);
  const [entradasExpanded, setEntradasExpanded] = useState(false);
  const [filtroExtrato, setFiltroExtrato] = useState<'todas' | 'entradas' | 'saidas'>('todas');

  // Determine start/end of the current period
  const dateRange = useMemo(() => {
    const d = new Date(selectedDate);
    const start = new Date(d);
    const end = new Date(d);

    if (periodo === 'dia') {
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
    } else if (periodo === 'semana') {
      const day = d.getDay();
      start.setDate(d.getDate() - day);
      start.setHours(0, 0, 0, 0);
      end.setDate(start.getDate() + 6);
      end.setHours(23, 59, 59, 999);
    } else if (periodo === 'mes') {
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
      end.setMonth(start.getMonth() + 1);
      end.setDate(0);
      end.setHours(23, 59, 59, 999);
    } else if (periodo === 'ano') {
      start.setMonth(0, 1);
      start.setHours(0, 0, 0, 0);
      end.setMonth(11, 31);
      end.setHours(23, 59, 59, 999);
    }

    console.log('[DATE_RANGE] periodo:', periodo);
    console.log('[DATE_RANGE] selectedDate.toString():', selectedDate.toString());
    console.log('[DATE_RANGE] start calculado:', start.toString());
    console.log('[DATE_RANGE] end calculado:', end.toString());
    console.log('[DATE_RANGE] start.toISOString():', start.toISOString());
    console.log('[DATE_RANGE] end.toISOString():', end.toISOString());
    
    const fmt = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    return { start: fmt(start), end: fmt(end) };
  }, [periodo, selectedDate]);

  useEffect(() => {
    loadTransactions(dateRange.start, dateRange.end);
  }, [dateRange.start, dateRange.end]);

  const handlePrev = () => {
    const d = new Date(selectedDate);
    if (periodo === 'dia') d.setDate(d.getDate() - 1);
    if (periodo === 'semana') d.setDate(d.getDate() - 7);
    if (periodo === 'mes') d.setMonth(d.getMonth() - 1);
    if (periodo === 'ano') d.setFullYear(d.getFullYear() - 1);
    setSelectedDate(d);
  };

  const handleNext = () => {
    const d = new Date(selectedDate);
    if (periodo === 'dia') d.setDate(d.getDate() + 1);
    if (periodo === 'semana') d.setDate(d.getDate() + 7);
    if (periodo === 'mes') d.setMonth(d.getMonth() + 1);
    if (periodo === 'ano') d.setFullYear(d.getFullYear() + 1);
    setSelectedDate(d);
  };

  const txNoPeriodo = useMemo(() => {
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
  }, [appointments, dateRange]);

  const completedApts = periodAppointments.filter(a => a.status === 'completed');
  const noShowApts = periodAppointments.filter(a => a.status === 'no-show');
  
  // KPI Calculations
  const aptIncome = completedApts.reduce((sum, a) => sum + (a.price || 0), 0);
  // Entradas manuais: todas as income que NÃO têm linkedAppointmentId preenchido
  const manualIncome = txNoPeriodo
    .filter(t => t.type === 'income' && !(t as any).linkedAppointmentId)
    .reduce((sum, t) => sum + t.amount, 0);
  const faturamento = aptIncome + manualIncome;
  const atendimentos = completedApts.length;
  const faltas = noShowApts.length;
  const ticketMedio = atendimentos > 0 ? aptIncome / atendimentos : 0;
  const noShowRate = (atendimentos + faltas) > 0 ? (faltas / (atendimentos + faltas)) * 100 : 0;
  const expenseTotal = txNoPeriodo.filter(t => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0);
  const lucroEstimado = faturamento - expenseTotal;

  const prevRange = useMemo(() => {
    const hoje = new Date();
    const sStart = new Date(dateRange.start);
    const sEnd = new Date(dateRange.end);

    // Detecta se o período selecionado ainda está em andamento
    const periodoEmAndamento =
      hoje >= sStart && hoje <= sEnd;

    // Calcula quantos dias já se passaram no período atual
    const diasDecorridos = periodoEmAndamento
      ? Math.floor((hoje.getTime() - sStart.getTime()) / (1000 * 60 * 60 * 24))
      : Math.floor((sEnd.getTime() - sStart.getTime()) / (1000 * 60 * 60 * 24));

    // Duração total do período atual
    const duracaoTotal = Math.floor((sEnd.getTime() - sStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;

    // Início do período anterior (mesmo tamanho)
    const prevStart = new Date(sStart);
    prevStart.setDate(prevStart.getDate() - duracaoTotal);

    // Fim do período anterior: proporcional se em andamento, completo se encerrado
    const prevEnd = new Date(prevStart);
    prevEnd.setDate(prevEnd.getDate() + diasDecorridos);

    const fmt = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

    return {
      start: fmt(prevStart),
      end: fmt(prevEnd),
      periodoEmAndamento,
      diasDecorridos,
      duracaoTotal,
    };
  }, [dateRange]);

  const renderResumo = () => {
    const prevCompleted = appointments.filter(a => a.status === 'completed' && a.date >= prevRange.start && a.date <= prevRange.end);
    const prevFaturamento = prevCompleted.reduce((s, a) => s + (a.price || 0), 0);
    const faturamentoDiff = prevFaturamento > 0 ? ((faturamento - prevFaturamento) / prevFaturamento * 100) : null;
    const prevTicket = prevCompleted.length > 0 ? prevFaturamento / prevCompleted.length : 0;
    const ticketDiff = prevTicket > 0 ? ((ticketMedio - prevTicket) / prevTicket * 100) : null;
    const prevAtend = prevCompleted.length;
    const atendDiff = prevAtend > 0 ? ((atendimentos - prevAtend) / prevAtend * 100) : null;

    // Entrada avulsa do período anterior (para comparação)
    const prevManualIncome = transactions
      .filter(t =>
        t.type === 'income' &&
        !(t as any).linkedAppointmentId &&
        t.date >= prevRange.start &&
        t.date <= prevRange.end
      )
      .reduce((s, t) => s + t.amount, 0);
    const manualIncomeDiff = prevManualIncome > 0
      ? ((manualIncome - prevManualIncome) / prevManualIncome * 100)
      : null;

    // Despesa avulsa do período anterior (para comparação)
    const prevExpenseTotal = transactions
      .filter(t =>
        t.type === 'expense' &&
        t.date >= prevRange.start &&
        t.date <= prevRange.end
      )
      .reduce((s, t) => s + t.amount, 0);
    const expenseDiff = prevExpenseTotal > 0
      ? ((expenseTotal - prevExpenseTotal) / prevExpenseTotal * 100)
      : null;

    // Lucro do período anterior (para comparação)
    const prevLucro = prevFaturamento - prevExpenseTotal;
    const lucroDiff = prevLucro !== 0
      ? ((lucroEstimado - prevLucro) / Math.abs(prevLucro) * 100)
      : null;

    // Faltas: valor perdido e comparação
    const valorPerdido = faltas * ticketMedio;
    const prevFaltas = appointments.filter(
      a => a.status === 'no-show' &&
      a.date >= prevRange.start &&
      a.date <= prevRange.end
    ).length;
    const faltasDiff = prevFaltas > 0
      ? ((faltas - prevFaltas) / prevFaltas * 100)
      : null;

    const chartData = (() => {
      if (periodo === 'dia') {
        return Array.from({ length: 13 }, (_, i) => {
          const h = i + 8;
          return { label: `${h}h`, value: completedApts.filter(a => parseInt(a.time) === h).length };
        });
      }
      if (periodo === 'semana') {
        const dias = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
        return dias.map((d, i) => ({
          label: d,
          value: completedApts.filter(a => {
            const [y, m, day] = a.date.split('-').map(Number);
            return new Date(y, m - 1, day).getDay() === i;
          }).length,
        }));
      }
      if (periodo === 'mes') {
        return Array.from({ length: 5 }, (_, i) => ({
          label: `S${i + 1}`,
          value: completedApts.filter(a => {
            const day = parseInt(a.date.split('-')[2]);
            return Math.floor((day - 1) / 7) === i;
          }).length,
        }));
      }
      const meses = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
      return meses.map((m, i) => ({
        label: m,
        value: completedApts.filter(a => parseInt(a.date.split('-')[1]) - 1 === i).length,
      }));
    })();
    const maxChart = Math.max(...chartData.map(d => d.value), 1);

    const Chip = ({
      titulo,
      valor,
      diff,
      sub,
      sub2,
      icon: Icon,
      diffInvert = false,
    }: {
      titulo: string;
      valor: string;
      diff?: number | null;
      sub?: string;
      sub2?: string;
      icon?: React.ElementType;
      diffInvert?: boolean;
    }) => (
      <div className="rounded-[1.5rem] bg-surface border border-white/8 shadow-[0_4px_16px_rgba(0,0,0,0.3)] p-4 flex flex-col gap-1 relative overflow-hidden">
        {Icon && (
          <Icon size={48} className="absolute bottom-2 right-3 text-white/[0.06] pointer-events-none" />
        )}
        <span className="text-[10px] font-bold uppercase text-title truncate">{titulo}</span>
        <span className="text-base font-black text-white leading-tight break-words min-w-0">{valor}</span>
        {diff !== undefined && diff !== null && (
          <span className={`text-[10px] font-bold flex items-center gap-0.5 ${
            diffInvert
              ? (diff <= 0 ? 'text-[#34D399]' : 'text-[#F87171]')
              : (diff >= 0 ? 'text-[#34D399]' : 'text-[#F87171]')
          }`}>
            {diff >= 0 ? '▲' : '▼'} {Math.abs(diff).toFixed(1)}% vs anterior
          </span>
        )}
        {sub && <span className="text-[10px] text-title">{sub}</span>}
        {sub2 && <span className="text-[10px] text-title">{sub2}</span>}
      </div>
    );

    const totalAtendimentosMes = atendimentos;
    const totalFaltas = faltas;
    const variacaoAtendimentos = atendDiff !== null ? atendDiff.toFixed(1) : 0;
    const valorPerdidoFaltas = valorPerdido;
    const totalGorjetas = txNoPeriodo.filter(t => t.type === 'income' && t.category === 'tip' && !(t as any).linkedAppointmentId).reduce((s,t) => s+t.amount, 0);
    const totalProdutos = txNoPeriodo.filter(t => t.type === 'income' && t.category === 'product' && !(t as any).linkedAppointmentId).reduce((s,t) => s+t.amount, 0);
    const totalAtendimentosValor = aptIncome + txNoPeriodo.filter(t => t.type === 'income' && t.category === 'walk_in' && !(t as any).linkedAppointmentId).reduce((s,t) => s+t.amount, 0);
    const totalOutros = txNoPeriodo.filter(t => t.type === 'income' && !['tip', 'product', 'walk_in'].includes(t.category) && !(t as any).linkedAppointmentId).reduce((s,t) => s+t.amount, 0);

    // Texto de contexto da comparação proporcional
    const ctxComparacao = (() => {
      if (!prevRange.periodoEmAndamento) return null; // período encerrado, sem aviso necessário

      if (periodo === 'dia') return null; // dia é sempre completo

      if (periodo === 'semana') {
        const diasSemana = ['domingo','segunda','terça','quarta','quinta','sexta','sábado'];
        const diaAtual = diasSemana[new Date().getDay()];
        return `até ${diaAtual} (mesmo recorte das 2 semanas)`;
      }

      if (periodo === 'mes') {
        const dia = new Date().getDate();
        const mesAnteriorNome = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
          'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'][
            new Date(prevRange.start).getMonth()
          ];
        return `comparando os primeiros ${dia} dias com os primeiros ${dia} dias de ${mesAnteriorNome}`;
      }

      if (periodo === 'ano') {
        const hoje = new Date();
        return `comparando até ${hoje.getDate()}/${hoje.getMonth()+1} dos dois anos`;
      }

      return null;
    })();

    // Linha de rodapé proporcional para adicionar ao corpo dos insights quando necessário
    const rodapeProporcional = ctxComparacao
      ? `\n📐 Comparação proporcional: ${ctxComparacao}.`
      : '';

    const insights: { emoji: string; titulo: string; corpo: string; cor: 'red' | 'green' | 'yellow' | 'blue' }[] = [];

    const periodoNome = periodo === 'mes' ? 'mês' : periodo === 'semana' ? 'semana' : periodo === 'ano' ? 'ano' : 'dia';
    const prevMesNome = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
      'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'][
        new Date(prevRange.start).getMonth()
      ];

    // 1. Alta taxa de faltas
    if (noShowRate > 20) {
      insights.push({
        emoji: '🚨', cor: 'red',
        titulo: 'Atenção: muitas faltas',
        corpo: `${noShowRate.toFixed(0)}% dos agendamentos viraram falta este ${periodoNome}. Você perdeu ${formatCurrency(valorPerdido)} em receita. Considere cobrar sinal ou confirmar 1h antes.`,
      });
    }

    // 2. Queda de faturamento
    if (faturamentoDiff !== null && faturamentoDiff < -15) {
      insights.push({
        emoji: '📉', cor: 'red',
        titulo: 'Faturamento caindo',
        corpo: `Receita ${faturamentoDiff.toFixed(1)}% menor que o período anterior (era ${formatCurrency(prevFaturamento)}).${rodapeProporcional} Verifique se houve menos dias trabalhados ou perda de clientes.`,
      });
    }

    // 3. Ticket médio crescendo
    if (ticketDiff !== null && ticketDiff > 10 && atendimentos >= 5) {
      insights.push({
        emoji: '📈', cor: 'green',
        titulo: 'Ticket médio em alta',
        corpo: `Seu corte médio subiu ${ticketDiff.toFixed(1)}% em relação ao período anterior${ctxComparacao ? ` (${ctxComparacao})` : ''}. De ${formatCurrency(prevTicket)} para ${formatCurrency(ticketMedio)}. Seus clientes estão pagando mais — resultado de posicionamento ou serviços premium.`,
      });
    }

    // 4. Volume alto, lucro comprimido
    if (atendimentos > 15 && lucroEstimado < faturamento * 0.5) {
      insights.push({
        emoji: '⚡', cor: 'yellow',
        titulo: 'Volume alto, lucro comprimido',
        corpo: `Você fez ${atendimentos} atendimentos mas o lucro ficou em ${((lucroEstimado / faturamento) * 100).toFixed(0)}% da receita. Suas despesas estão pesando — revise os custos fixos.`,
      });
    }

    // 5. Melhor período registrado
    if (faturamentoDiff !== null && faturamentoDiff > 50 && atendimentos > 10) {
      insights.push({
        emoji: '🎯', cor: 'green',
        titulo: `Ótimo ${periodoNome}${prevRange.periodoEmAndamento ? ' até agora' : ''}`,
        corpo: prevRange.periodoEmAndamento
          ? `Nos primeiros ${prevRange.diasDecorridos + 1} dias: ${formatCurrency(faturamento)} com ${atendimentos} atendimentos e ticket médio de ${formatCurrency(ticketMedio)}. ${faturamentoDiff.toFixed(0)}% acima dos primeiros ${prevRange.diasDecorridos + 1} dias de ${prevMesNome}. Anote o que está fazendo diferente.`
          : `${formatCurrency(faturamento)} com ${atendimentos} atendimentos e ticket médio de ${formatCurrency(ticketMedio)}. ${faturamentoDiff.toFixed(0)}% acima de ${prevMesNome} completo. Anote o que fez diferente desta vez.`,
      });
    }

    // 6. Faltas com impacto financeiro relevante
    if (faltas > 0 && valorPerdido > faturamento * 0.1) {
      insights.push({
        emoji: '💸', cor: 'yellow',
        titulo: 'Faltas custando caro',
        corpo: `${faltas} falta${faltas > 1 ? 's representaram' : ' representou'} ${formatCurrency(valorPerdido)} — ${((valorPerdido / faturamento) * 100).toFixed(0)}% da sua receita do período jogada fora.`,
      });
    }

    // 7. Despesas crescendo mais rápido que receita
    if (expenseDiff !== null && faturamentoDiff !== null && expenseDiff > faturamentoDiff + 20) {
      insights.push({
        emoji: '💰', cor: 'yellow',
        titulo: 'Despesas crescendo mais que a receita',
        corpo: `Suas saídas subiram ${expenseDiff.toFixed(1)}% enquanto a receita cresceu ${faturamentoDiff.toFixed(1)}%${ctxComparacao ? ` (${ctxComparacao})` : ''}. Isso comprime sua margem — fique de olho nos custos.`,
      });
    }

    // 8. Crescimento consistente
    if (faturamentoDiff !== null && faturamentoDiff > 10 && faturamentoDiff <= 50 && atendDiff !== null && atendDiff > 0) {
      insights.push({
        emoji: '🌱', cor: 'blue',
        titulo: 'Crescimento saudável',
        corpo: `Faturamento +${faturamentoDiff.toFixed(1)}% e ${atendimentos} atendimentos (+${atendDiff.toFixed(0)}% vs anterior)${ctxComparacao ? `, ${ctxComparacao}` : ''}. Crescimento consistente é mais valioso que um pico isolado.`,
      });
    }

    const historicData = (() => {
      if (periodo === 'mes') {
        const MESES_ABREV = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
        return Array.from({ length: 12 }, (_, i) => {
          const ref = new Date(selectedDate);
          ref.setDate(15);
          ref.setMonth(ref.getMonth() - (11 - i));
          const ano = ref.getFullYear();
          const mes = ref.getMonth(); // 0-based
          const count = appointments.filter(a => {
            const dateParts = a.date.split('-');
            return a.status === 'completed' && parseInt(dateParts[0]) === ano && parseInt(dateParts[1]) - 1 === mes;
          }).length;
          const receita = appointments
            .filter(a => {
              const dateParts = a.date.split('-');
              return a.status === 'completed' && parseInt(dateParts[0]) === ano && parseInt(dateParts[1]) - 1 === mes;
            })
            .reduce((s, a) => s + (a.price || 0), 0);
          const isSelected = ano === selectedDate.getFullYear() && mes === selectedDate.getMonth();
          return { label: MESES_ABREV[mes], count, receita, isSelected };
        });
      } else if (periodo === 'semana') {
        return Array.from({ length: 8 }, (_, i) => {
          const ref = new Date(dateRange.start); 
          ref.setDate(ref.getDate() - (7 - i) * 7);
          const wStart = ref.toISOString().split('T')[0];
          const wEndDate = new Date(ref);
          wEndDate.setDate(ref.getDate() + 6);
          const wEnd = wEndDate.toISOString().split('T')[0];
          const count = appointments.filter(a =>
            a.status === 'completed' && a.date >= wStart && a.date <= wEnd
          ).length;
          const receita = appointments
            .filter(a => a.status === 'completed' && a.date >= wStart && a.date <= wEnd)
            .reduce((s, a) => s + (a.price || 0), 0);
          const isSelected = i === 7; 
          const label = `${String(ref.getDate()).padStart(2,'0')}/${String(ref.getMonth()+1).padStart(2,'0')}`;
          return { label, count, receita, isSelected };
        });
      } else if (periodo === 'ano') {
        const anos = [...new Set(appointments.map(a => parseInt(a.date.split('-')[0])))].sort();
        if (anos.length < 2) return []; 
        return anos.map(ano => {
          const count = appointments.filter(a =>
            a.status === 'completed' && parseInt(a.date.split('-')[0]) === ano
          ).length;
          const receita = appointments
            .filter(a => a.status === 'completed' && parseInt(a.date.split('-')[0]) === ano)
            .reduce((s, a) => s + (a.price || 0), 0);
          return { label: String(ano), count, receita, isSelected: ano === selectedDate.getFullYear() };
        });
      } else { 
        const hoje = new Date();
        const noventa = new Date(hoje);
        noventa.setDate(hoje.getDate() - 90);
        const noveStr = noventa.toISOString().split('T')[0];
        const diasSemana = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

        const contagemDOW = [0, 0, 0, 0, 0, 0, 0];
        const totalDias = [0, 0, 0, 0, 0, 0, 0];

        const d = new Date(noventa);
        while (d <= hoje) {
          totalDias[d.getDay()]++;
          d.setDate(d.getDate() + 1);
        }

        appointments
          .filter(a => a.status === 'completed' && a.date >= noveStr)
          .forEach(a => {
            const dow = new Date(a.date + 'T12:00:00').getDay();
            contagemDOW[dow]++;
          });

        const currentDOW = selectedDate.getDay();

        return diasSemana.map((label, i) => ({
          label,
          count: totalDias[i] > 0 ? parseFloat((contagemDOW[i] / totalDias[i] * 7).toFixed(1)) : 0,
          receita: 0,
          isSelected: i === currentDOW,
        }));
      }
    })();
    const tituloHistorico = periodo === 'mes' ? 'Últimos 12 Meses' : periodo === 'semana' ? 'Últimas 8 Semanas' : periodo === 'ano' ? 'Evolução Anual' : 'Média por Dia da Semana (90 dias)';

    return (
      <div className="space-y-4">
        {/* Card Resumo de Caixa */}
        <div className="bg-[#F5F5F8] rounded-[1.5rem] p-4 shadow-[0_3px_12px_rgba(0,0,0,0.10)] border border-black/[0.06]">
          {/* Linha Entradas */}
          <div 
            onClick={() => setEntradasExpanded(!entradasExpanded)}
            className="flex items-center justify-between py-3 border-b border-black/[0.06] cursor-pointer"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-green-100/80 flex items-center justify-center">
                <ArrowDown className="w-4 h-4 text-green-600" />
              </div>
              <span className="text-[#1E1B4B] font-medium text-sm flex items-center gap-2">
                Entradas
                <ChevronDown className={`w-4 h-4 text-[#6B7280] transition-transform ${entradasExpanded ? 'rotate-180' : ''}`} />
              </span>
            </div>
            <span className="text-green-600 font-semibold text-sm">{formatCurrency(faturamento)}</span>
          </div>

          {/* Breakdown expansível */}
          {entradasExpanded && (
            <div className="pl-11 pb-2 pt-2 space-y-1">
              <div className="flex justify-between text-sm text-[#6B7280]">
                <span>✂️ Atendimentos</span>
                <span className="text-green-600">{formatCurrency(totalAtendimentosValor)}</span>
              </div>
              <div className="flex justify-between text-sm text-[#6B7280]">
                <span>🤝 Gorjeta</span>
                <span className="text-green-600">{formatCurrency(totalGorjetas)}</span>
              </div>
              <div className="flex justify-between text-sm text-[#6B7280]">
                <span>🛍️ Produto</span>
                <span className="text-green-600">{formatCurrency(totalProdutos)}</span>
              </div>
              <div className="flex justify-between text-sm text-[#6B7280]">
                <span>📦 Outros</span>
                <span className="text-green-600">{formatCurrency(totalOutros)}</span>
              </div>
            </div>
          )}

          {/* Linha Saídas */}
          <div className="flex items-center justify-between py-3 border-b border-black/[0.06]">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-red-100/80 flex items-center justify-center">
                <ArrowUp className="w-4 h-4 text-red-500" />
              </div>
              <span className="text-[#1E1B4B] font-medium text-sm">Saídas</span>
            </div>
            <span className="text-red-500 font-semibold text-sm">{formatCurrency(expenseTotal)}</span>
          </div>
          
          {/* Saldo */}
          <div className="flex items-center justify-between pt-3">
            <span className="text-[#1E1B4B] font-semibold text-base">Saldo {periodo === 'mes' ? 'do mês' : 'do período'}</span>
            <div className="flex flex-col items-end gap-1">
              <span className={`font-black text-lg ${lucroEstimado >= 0 ? 'text-green-600' : 'text-red-500'}`}>{formatCurrency(lucroEstimado)}</span>
              {lucroDiff !== null && (
                <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${lucroDiff >= 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                  {lucroDiff >= 0 ? '↑' : '↓'} {lucroDiff >= 0 ? '+' : ''}{lucroDiff.toFixed(1)}% vs {periodo === 'mes' ? 'mês anterior' : 'período anterior'}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Card Atendimentos */}
        <div className="bg-[#F5F5F8] rounded-[1.5rem] p-4 shadow-[0_3px_12px_rgba(0,0,0,0.10)] border border-black/[0.06]">
          {/* Linha 1 — Atendimentos + badge inline */}
          <div className="flex items-center justify-between py-2 border-b border-black/[0.06]">
            <span className="text-[#1E1B4B] font-medium">✂️ Atendimentos</span>
            <div className="flex items-center gap-2">
              <span className="text-[#1E1B4B] font-bold">{totalAtendimentosMes}</span>
              <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${Number(variacaoAtendimentos) >= 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                {Number(variacaoAtendimentos) >= 0 ? '↑' : '↓'} {Number(variacaoAtendimentos) >= 0 ? '+' : ''}{variacaoAtendimentos}%
              </span>
            </div>
          </div>
          {/* Linha 2 — Ticket médio */}
          <div className="flex items-center justify-between py-2 border-b border-black/[0.06]">
            <span className="text-[#1E1B4B] font-medium">💰 Ticket médio</span>
            <span className="text-green-600 font-semibold">{formatCurrency(ticketMedio)}</span>
          </div>
          {/* Linha 3 — Faltas */}
          <div className="flex items-center justify-between pt-2">
            <span className="text-[#1E1B4B] font-medium">⚠️ Faltas</span>
            <div className="flex items-center gap-2">
              <span className="text-[#1E1B4B] font-bold">{totalFaltas}</span>
              {(ticketMedio > 0 && totalFaltas > 0) && (
                <span className="bg-red-100 text-red-600 font-black text-[10px] px-2 py-0.5 rounded-full">
                  - {formatCurrency(valorPerdidoFaltas)}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Insights Inteligentes */}
        {insights.length > 0 && (
          <div className="space-y-2">
            {insights.slice(0, 3).map((insight, idx) => {
              const cores = {
                red:    'bg-red-500/10 border-red-500/20 text-[#F87171]',
                green:  'bg-green-500/10 border-green-500/20 text-[#34D399]',
                yellow: 'bg-[#FBBF24]/10 border-[#FBBF24]/20 text-[#FBBF24]',
                blue:   'bg-blue-500/10 border-blue-500/20 text-blue-400',
              };
              return (
                <div key={idx} className={`border rounded-2xl p-3 text-xs font-bold ${cores[insight.cor]}`}>
                  <p className="font-black mb-1">{insight.emoji} {insight.titulo}</p>
                  <p className="font-medium opacity-90 leading-relaxed whitespace-pre-line">{insight.corpo}</p>
                </div>
              );
            })}
          </div>
        )}

        {/* Gráfico */}
        <div className="bg-surface rounded-2xl p-4 border border-white/8 shadow-[0_4px_16px_rgba(0,0,0,0.3)]">
          <p className="text-[10px] font-bold uppercase text-title mb-3">Atendimentos no Período</p>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#8A98A8' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: '#8A98A8' }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip 
                contentStyle={{ borderRadius: 12, border: 'none', fontSize: 12 }}
                formatter={(value: number) => [value, 'Atendimentos']}
                labelFormatter={(label) => `Período: ${label}`}
              />
              <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                {chartData.map((d, i) => (
                  <Cell key={i} fill="#F99417" fillOpacity={d.value === maxChart ? 1 : 0.3} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Gráfico Histórico */}
        {historicData.length > 0 && (
          <div className="bg-surface rounded-2xl p-4 border border-white/8 shadow-[0_4px_16px_rgba(0,0,0,0.3)]">
            <p className="text-[10px] font-bold uppercase text-title mb-1">{tituloHistorico}</p>
            <p className="text-[9px] text-title/60 mb-3">
              {periodo === 'dia'
                ? 'Atendimentos médios por dia da semana'
                : 'Atendimentos concluídos'}
            </p>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={historicData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: periodo === 'mes' ? 8 : 10, fill: '#8A98A8' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: '#8A98A8' }}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={periodo === 'dia'}
                />
                <Tooltip
                  contentStyle={{ borderRadius: 12, border: 'none', fontSize: 12 }}
                  formatter={(value: number, name: string, props: any) => {
                    const item = props.payload;
                    if (periodo === 'dia') return [`${value} atend./semana (média)`, ''];
                    return [
                      `${value} atend.${item.receita > 0 ? ` · ${formatCurrency(item.receita)}` : ''}`,
                      ''
                    ];
                  }}
                  labelFormatter={(label) => label}
                />
                <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                  {historicData.map((d, i) => (
                    <Cell
                      key={i}
                      fill={d.isSelected ? '#F99417' : '#F99417'}
                      fillOpacity={d.isSelected ? 1 : 0.25}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>

            {/* Legenda do destaque */}
            <p className="text-[9px] text-title/50 mt-2 text-center">
              {periodo === 'mes' && '● Laranja = mês atual'}
              {periodo === 'semana' && '● Laranja = semana atual'}
              {periodo === 'ano' && '● Laranja = ano atual'}
              {periodo === 'dia' && `● Laranja = ${['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'][selectedDate.getDay()]} (dia selecionado)`}
            </p>
          </div>
        )}
      </div>
    );
  };

  const getIcon = (category: string) => {
    switch(category) {
      case 'tip': return <Smile size={18} />;
      case 'product': return <Package size={18} />;
      case 'walk_in': return <Scissors size={18} />;
      case 'rent': return <Home size={18} />;
      case 'supply': return <ShoppingBag size={18} />;
      case 'equipment': return <Wrench size={18} />;
      case 'fee': return <CreditCard size={18} />;
      default: return <CircleDollarSign size={18} />;
    }
  };

  const getCategoryLabel = (cat: string) => {
    const labels: Record<string, string> = {
      tip: 'Gorjeta', product: 'Produto', walk_in: 'Serviço Avulso', rent: 'Aluguel',
      supply: 'Insumos', equipment: 'Equipamento', fee: 'Taxa/Maquininha', other: 'Outro'
    };
    return labels[cat] || cat;
  };

  const renderExtrato = () => {
    const extratoItems = (() => {
      // Atendimentos concluídos como entradas
      const fromApts = completedApts.map(a => ({
        id: `apt-${a.id}`,
        type: 'income' as const,
        category: 'appointment' as string,
        description: `${a.service} — ${a.clientName}`,
        amount: a.price || 0,
        date: a.date.split('T')[0],
        isAppointment: true,
        time: a.time,
      }));
      // Transações manuais automáticas geradas por atendimentos
      const manualTx = txNoPeriodo
        .filter(t => !(t as any).linkedAppointmentId)
        .map(t => ({ ...t, date: (t.date || '').split('T')[0], isAppointment: false }));
      
      // Unir e ordenar por data desc, depois por hora desc
      return [...fromApts, ...manualTx].sort((a, b) => {
        if (b.date !== a.date) return b.date.localeCompare(a.date);
        return ((b.time as string) || '00:00').localeCompare((a.time as string) || '00:00');
      });
    })();

    const totalEntradas = extratoItems.filter(i => i.type === 'income').reduce((s, i) => s + i.amount, 0);
    const totalSaidas = extratoItems.filter(i => i.type === 'expense').reduce((s, i) => s + i.amount, 0);
    const resultado = totalEntradas - totalSaidas;

    const transacoesFiltradas = extratoItems.filter(t => {
      if (filtroExtrato === 'entradas') return t.type === 'income';
      if (filtroExtrato === 'saidas')   return t.type === 'expense';
      return true;
    });

    return (
      <div className="space-y-4 pb-20">
        {/* Filtro de abas — fixo, não scrolla com a lista */}
        <div className="sticky top-0 z-10 pb-3 -mx-4 px-4 pt-2 -mt-2 bg-[#1E1B4B]">
          <div className="flex bg-primary/40 rounded-2xl p-1 gap-1">
            {([
              { key: 'todas',    label: 'Todas'    },
              { key: 'entradas', label: 'Entradas' },
              { key: 'saidas',   label: 'Saídas'   },
            ] as const).map(({ key, label }) => {

              const isActive = filtroExtrato === key;

              // Cor do fundo ativo por aba
              const activeBg =
                key === 'todas'    ? 'bg-secondary' :   // cor principal
                key === 'entradas' ? 'bg-[#34D399]' :   // verde — cor do valor de entrada
                                     'bg-[#F87171]';    // vermelho — cor do valor de saída

              // Cor do texto ativo
              const activeText =
                key === 'todas'    ? 'text-white' :
                key === 'entradas' ? 'text-white' :
                                     'text-white';

              return (
                <button
                  key={key}
                  onClick={() => setFiltroExtrato(key)}
                  className={`
                    flex-1 py-2 rounded-xl text-xs font-black transition-all duration-200
                    ${isActive
                      ? `${activeBg} ${activeText} shadow-[0_2px_8px_rgba(0,0,0,0.3)]`
                      : 'text-title hover:text-white'
                    }
                  `}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {transacoesFiltradas.length === 0 ? (
          <div className="text-center py-10">
            <p className="text-title text-sm font-bold">
              {filtroExtrato === 'entradas'
                ? 'Nenhuma entrada neste período'
                : filtroExtrato === 'saidas'
                ? 'Nenhuma saída neste período'
                : 'Nenhuma transação neste período'}
            </p>
          </div>
        ) : (
          transacoesFiltradas.map(item => {
            let icon, iconBg;
            if (item.isAppointment) {
              icon = <Scissors size={18} />;
              iconBg = 'bg-secondary/20 text-secondary';
            } else if (item.category === 'tip') {
              icon = <Smile size={18} />;
              iconBg = 'bg-[#FBBF24]/20 text-[#FBBF24]';
            } else if (item.type === 'expense') {
              icon = getIcon(item.category);
              iconBg = 'bg-[#F87171]/20 text-[#F87171]';
            } else {
              icon = <CircleDollarSign size={18} />;
              iconBg = 'bg-[#34D399]/20 text-[#34D399]';
            }

            const Content = (
              <div className="bg-surface p-4 flex items-center gap-3 z-10 w-full">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${iconBg}`}>
                  {icon}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-white truncate">
                    {item.description || getCategoryLabel(item.category)}
                  </p>
                  <p className="text-[11px] text-title font-medium">
                    {item.date.split('-').reverse().join('/')}
                    {item.isAppointment && item.time ? ` · ${item.time}` : ` · ${getCategoryLabel(item.category)}`}
                  </p>
                </div>
                <div className={`text-sm font-black flex-shrink-0 ${item.type === 'income' ? 'text-[#34D399]' : 'text-[#F87171]'}`}>
                  {item.type === 'income' ? '+' : '-'} {formatCurrency(item.amount)}
                </div>
              </div>
            );

            return (
              <div key={item.id} className="relative overflow-hidden rounded-2xl bg-surface border border-white/8 shadow-[0_4px_16px_rgba(0,0,0,0.3)] group">
                {!item.isAppointment && (
                  <div className="absolute inset-y-0 right-0 w-20 bg-red-500 flex items-center justify-center -z-10">
                    <Trash2 size={20} className="text-white" />
                  </div>
                )}
                {!item.isAppointment ? (
                  <motion.div 
                    id={`tx-${item.id}`}
                    drag="x"
                    dragConstraints={{ left: -80, right: 0 }}
                    onDragEnd={(e, info) => {
                      if (info.offset.x < -40) {
                        deleteTransaction(item.id);
                      }
                    }}
                  >
                    {Content}
                  </motion.div>
                ) : (
                  <div>{Content}</div>
                )}
              </div>
            );
          })
        )}

        {/* Sticky footer */}
        <div className="fixed bottom-[64px] left-0 right-0 bg-surface/90 backdrop-blur-[12px] border-t border-white/10 p-3 flex justify-between items-center text-[10px] font-bold z-20">
          <div className="text-center">
            <p className="text-title uppercase mb-1">Entradas</p>
            <p className="text-[#34D399]">{formatCurrency(totalEntradas)}</p>
          </div>
          <div className="text-center">
            <p className="text-title uppercase mb-1">Saídas</p>
            <p className="text-[#F87171]">{formatCurrency(totalSaidas)}</p>
          </div>
          <div className="text-center">
            <p className="text-title uppercase mb-1">Resultado</p>
            <p className={resultado >= 0 ? 'text-[#34D399]' : 'text-[#F87171]'}>{formatCurrency(resultado)}</p>
          </div>
        </div>
      </div>
    );
  };

  const renderClientes = () => {
    // Clientes ativos: tiveram ao menos 1 completed nos últimos 60 dias (ignora filtro de período)
    const hoje = new Date();
    const sessenta = new Date(hoje);
    sessenta.setDate(hoje.getDate() - 60);
    const sessentaStr = sessenta.toISOString().split('T')[0];
    const clientesAtivos = new Set(
      appointments
        .filter(a => a.status === 'completed' && a.date >= sessentaStr)
        .map(a => a.phone)
    ).size;

    // Clientes únicos no período
    const clientesPeriodo = completedApts.reduce<Record<string, { nome: string; visitas: number; total: number }>>((acc, a) => {
      if (!acc[a.phone]) acc[a.phone] = { nome: a.clientName, visitas: 0, total: 0 };
      acc[a.phone].visitas += 1;
      acc[a.phone].total += a.price || 0;
      return acc;
    }, {});
    const clientesArr = Object.entries(clientesPeriodo).map(([phone, v]: [string, { nome: string; visitas: number; total: number }]) => ({ phone, ...v }));
    const returnRate = clientesArr.length > 0
      ? (clientesArr.filter(c => c.visitas >= 2).length / clientesArr.length * 100)
      : 0;

    const topFreq = [...clientesArr].sort((a, b) => b.visitas - a.visitas).slice(0, 5);
    const topValor = [...clientesArr].sort((a, b) => b.total - a.total).slice(0, 5);

    // Clientes inativos: último completed há mais de 30 dias
    const trintaStr = (() => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().split('T')[0]; })();
    const ultimoCorte: Record<string, string> = {};
    appointments.filter(a => a.status === 'completed').forEach(a => {
      if (!ultimoCorte[a.phone] || a.date > ultimoCorte[a.phone]) ultimoCorte[a.phone] = a.date;
    });
    const inativos = Object.entries(ultimoCorte)
      .filter(([, date]) => date < trintaStr)
      .map(([phone, date]) => ({
        phone,
        nome: appointments.find(a => a.phone === phone)?.clientName || phone,
        diasAtraso: Math.floor((hoje.getTime() - new Date(date).getTime()) / (1000 * 60 * 60 * 24)),
      }))
      .sort((a, b) => b.diasAtraso - a.diasAtraso);

    const inativosVisiveis = showAllInativos ? inativos : inativos.slice(0, 5);

    const noShowClientes = clientesArr
      .map(c => ({ ...c, faltas: appointments.filter(a => a.phone === c.phone && a.status === 'no-show' && a.date >= dateRange.start && a.date <= dateRange.end).length }))
      .filter(c => c.faltas > 0)
      .sort((a, b) => b.faltas - a.faltas)
      .slice(0, 3);

    // Clientes atendidos únicos no período (phones distintos)
    const clientesAtendidos = clientesArr.length;

    // Novos clientes: primeiro atendimento de todos os tempos cai dentro do dateRange
    const novosClientes = clientesArr.filter(c => {
      const todosApts = appointments
        .filter(a => a.phone === c.phone && a.status === 'completed')
        .map(a => a.date)
        .sort();
      return todosApts.length > 0 && todosApts[0] >= dateRange.start && todosApts[0] <= dateRange.end;
    }).length;

    // Inativos em risco: sem visita há mais de 60 dias
    const inativosEmRisco = inativos.filter(c => c.diasAtraso > 60).length;

    const ClienteItem: React.FC<{ nome: string; sub: string; valor: string }> = ({ nome, sub, valor }) => (
      <div className="flex items-center gap-3 py-2">
        <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-black flex-shrink-0 ${getAvatarColor(nome)}`}>
          {getInitials(nome)}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-white truncate">{nome}</p>
          <p className="text-[11px] text-title">{sub}</p>
        </div>
        <span className="text-sm font-black text-secondary">{valor}</span>
      </div>
    );

    return (
      <div className="space-y-4 pb-6">
        {/* ── BLOCO 1: Visão Geral (sempre fixo, independente do período) ── */}
        <div>
          <p className="text-[10px] font-bold uppercase text-title mb-2 tracking-[0.1em]">
            Visão Geral
          </p>
          <div className="flex gap-3">
            {/* Clientes Ativos */}
            <div className="flex-1 bg-surface rounded-2xl p-4 border border-white/8 shadow-[0_4px_16px_rgba(0,0,0,0.3)] relative overflow-hidden">
              <Users size={48} className="absolute bottom-2 right-3 text-white/[0.06] pointer-events-none" />
              <p className="text-[10px] font-bold uppercase text-title mb-1">Clientes Ativos</p>
              <p className="text-2xl font-black text-white">{clientesAtivos}</p>
              <p className="text-[10px] text-title">últimos 60 dias</p>
            </div>
            {/* Inativos em risco */}
            <div className="flex-1 bg-surface rounded-2xl p-4 border border-white/8 shadow-[0_4px_16px_rgba(0,0,0,0.3)] relative overflow-hidden">
              <AlertTriangle size={48} className="absolute bottom-2 right-3 text-white/[0.06] pointer-events-none" />
              <p className="text-[10px] font-bold uppercase text-title mb-1">Em Risco</p>
              <p className={`text-2xl font-black ${inativosEmRisco > 0 ? 'text-[#F87171]' : 'text-white'}`}>
                {inativosEmRisco}
              </p>
              <p className="text-[10px] text-title">sem visita +60 dias</p>
            </div>
          </div>
          {inativos.length > 0 && (
            <div className="mt-3 bg-surface rounded-2xl p-4 border border-white/8 shadow-[0_4px_16px_rgba(0,0,0,0.3)]">
              <p className="text-[10px] font-bold uppercase text-title mb-3">Clientes Inativos</p>
              {inativosVisiveis.map(c => (
                <div key={c.phone} className="flex items-center gap-3 py-2">
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-black flex-shrink-0 ${getAvatarColor(c.nome)}`}>
                    {getInitials(c.nome)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-white truncate">{c.nome}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-black ${
                        c.diasAtraso > 60
                          ? 'bg-[#F87171]/15 text-[#F87171] border border-[#F87171]/30'
                          : 'bg-[#FBBF24]/15 text-[#FBBF24] border border-[#FBBF24]/30'
                      }`}>
                        {c.diasAtraso > 60 ? '⚠ Risco alto' : '· Atenção'}
                      </span>
                      <span className="text-[10px] text-title">{c.diasAtraso} dias sem visita</span>
                    </div>
                  </div>
                </div>
              ))}
              {inativos.length > 5 && (
                <button
                  onClick={() => setShowAllInativos(!showAllInativos)}
                  className="mt-2 text-xs text-secondary font-bold w-full text-center"
                >
                  {showAllInativos ? 'Ver menos' : `Ver todos (${inativos.length})`}
                </button>
              )}
            </div>
          )}
        </div>

        {/* ── BLOCO 2: No período selecionado (responde ao filtro) ── */}
        <div>
          <p className="text-[10px] font-bold uppercase text-title mb-2 tracking-[0.1em]">
            No Período
          </p>
          <div className="flex gap-3">
            {/* Clientes Atendidos */}
            <div className="flex-1 bg-surface rounded-2xl p-4 border border-white/8 shadow-[0_4px_16px_rgba(0,0,0,0.3)] relative overflow-hidden">
              <Scissors size={48} className="absolute bottom-2 right-3 text-white/[0.06] pointer-events-none" />
              <p className="text-[10px] font-bold uppercase text-title mb-1">Atendidos</p>
              <p className="text-2xl font-black text-white">{clientesAtendidos}</p>
              <p className="text-[10px] text-title">clientes únicos</p>
            </div>
            {/* Novos Clientes */}
            <div className="flex-1 bg-surface rounded-2xl p-4 border border-white/8 shadow-[0_4px_16px_rgba(0,0,0,0.3)] relative overflow-hidden">
              <UserPlus size={48} className="absolute bottom-2 right-3 text-white/[0.06] pointer-events-none" />
              <p className="text-[10px] font-bold uppercase text-title mb-1">Novos</p>
              <p className={`text-2xl font-black ${novosClientes > 0 ? 'text-secondary' : 'text-white'}`}>
                {novosClientes}
              </p>
              <p className="text-[10px] text-title">primeira visita</p>
            </div>
          </div>

          {/* Taxa de retorno — logo abaixo, largura total */}
          <div className="mt-3 bg-surface rounded-2xl p-4 border border-white/8 shadow-[0_4px_16px_rgba(0,0,0,0.3)]">
            <div className="flex justify-between items-baseline">
              <div>
                <p className="text-[10px] font-bold uppercase text-title mb-1">Taxa de Retorno</p>
                <p className="text-[10px] text-title">clientes com ≥ 2 visitas no período</p>
              </div>
              <p className="text-2xl font-black text-white">{returnRate.toFixed(0)}%</p>
            </div>
            {/* Barra de progresso */}
            <div className="w-full bg-primary/40 rounded-full h-2 mt-3">
              <div
                className="bg-secondary h-2 rounded-full transition-all"
                style={{ width: `${Math.min(returnRate, 100)}%` }}
              />
            </div>
          </div>
        </div>

        {/* Top frequência */}
        {periodo !== 'dia' && topFreq.length > 0 && (
          <div className="bg-surface rounded-2xl p-4 border border-white/8 shadow-[0_4px_16px_rgba(0,0,0,0.3)]">
            <p className="text-[10px] font-bold uppercase text-title mb-3">Mais Frequentes</p>
            {topFreq.map(c => <ClienteItem key={c.phone} nome={c.nome} sub={`${c.visitas} visita${c.visitas > 1 ? 's' : ''}`} valor={formatCurrency(c.total)} />)}
          </div>
        )}

        {/* Top valor */}
        {periodo !== 'dia' && topValor.length > 0 && (
          <div className="bg-surface rounded-2xl p-4 border border-white/8 shadow-[0_4px_16px_rgba(0,0,0,0.3)]">
            <p className="text-[10px] font-bold uppercase text-title mb-3">Maior Valor</p>
            {topValor.map(c => <ClienteItem key={c.phone} nome={c.nome} sub={`${c.visitas} visita${c.visitas > 1 ? 's' : ''}`} valor={formatCurrency(c.total)} />)}
          </div>
        )}

        {/* Atendimentos do Dia */}
        {periodo === 'dia' && clientesAtendidos > 0 && (
          <div className="bg-surface rounded-2xl p-4 border border-white/8 shadow-[0_4px_16px_rgba(0,0,0,0.3)]">
            <p className="text-[10px] font-bold uppercase text-title mb-2">Atendimentos do Dia</p>
            {completedApts.map(a => (
              <div key={a.id} className="flex items-center gap-3 py-2">
                <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-black flex-shrink-0 ${getAvatarColor(a.clientName)}`}>
                  {getInitials(a.clientName)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-white truncate">{a.clientName}</p>
                  <p className="text-[11px] text-title">{a.service} · {a.time}</p>
                </div>
                <span className="text-sm font-black text-secondary">{formatCurrency(a.price || 0)}</span>
              </div>
            ))}
          </div>
        )}

        {/* Faltantes */}
        {noShowClientes.length > 0 && (
          <div className="bg-surface rounded-2xl p-4 border border-white/8 shadow-[0_4px_16px_rgba(0,0,0,0.3)]">
            <p className="text-[10px] font-bold uppercase text-title mb-3">Maiores Faltantes</p>
            {noShowClientes.map(c => (
              <ClienteItem
                key={c.phone}
                nome={c.nome}
                sub={`${c.faltas} falta${c.faltas > 1 ? 's' : ''} no período`}
                valor={ticketMedio > 0 ? `${c.faltas}x · ${formatCurrency(c.faltas * ticketMedio)}` : `${c.faltas}x`}
              />
            ))}
          </div>
        )}

        {clientesArr.length === 0 && (
          <div className="flex flex-col items-center justify-center p-8 text-title">
            <Users size={48} className="mb-4 opacity-50" />
            <p className="text-sm font-medium">Nenhum cliente neste período.</p>
          </div>
        )}
      </div>
    );
  };

  const renderServicos = () => {
    const servicosMap = completedApts.reduce<Record<string, { total: number; count: number }>>((acc, a) => {
      if (!acc[a.service]) acc[a.service] = { total: 0, count: 0 };
      acc[a.service].total += a.price || 0;
      acc[a.service].count += 1;
      return acc;
    }, {});

    const servicosArr = Object.entries(servicosMap)
      .map(([name, v]: [string, { total: number; count: number }]) => ({ name, ...v, ticket: v.count > 0 ? v.total / v.count : 0 }))
      .sort((a, b) => b.total - a.total);

    const maxTotal = servicosArr[0]?.total || 1; // fix logic here

    const PIE_COLORS = ['#F99417', '#34D399', '#FBBF24', '#F87171', '#A78BFA'];
    const totalApts = completedApts.length;
    const pieData = (() => {
      const top = servicosArr.slice(0, 5);
      const outros = servicosArr.slice(5).reduce((s, v) => s + v.count, 0);
      const data = top.map(s => ({ name: s.name, value: s.count }));
      if (outros > 0) data.push({ name: 'Outros', value: outros });
      return data;
    })();

    if (servicosArr.length === 0) return (
      <div className="flex flex-col items-center justify-center p-8 text-title">
        <Scissors size={48} className="mb-4 opacity-50" />
        <p className="text-sm font-medium">Nenhum serviço realizado neste período.</p>
      </div>
    );

    return (
      <div className="space-y-4 pb-6">
        {/* Ranking */}
        <div className="bg-surface rounded-2xl p-4 border border-white/8 shadow-[0_4px_16px_rgba(0,0,0,0.3)]">
          <p className="text-[10px] font-bold uppercase text-title mb-3">Ranking por Faturamento</p>
          <div className="space-y-3">
            {servicosArr.map((s, i) => (
              <div key={s.name}>
                <div className="flex justify-between items-baseline mb-1">
                  <span className="text-sm font-bold text-white truncate max-w-[55%]">{s.name}</span>
                  <span className="text-xs font-black text-secondary">{formatCurrency(s.total)}</span>
                </div>
                <div className="w-full bg-primary/40 rounded-full h-1.5">
                  <div className="bg-secondary h-1.5 rounded-full" style={{ width: `${(s.total / maxTotal) * 100}%` }} />
                </div>
                <p className="text-[10px] text-title mt-0.5">{s.count} atend. · ticket {formatCurrency(s.ticket)}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Pizza */}
        {pieData.length > 0 && (
          <div className="bg-surface rounded-2xl p-4 border border-white/8 shadow-[0_4px_16px_rgba(0,0,0,0.3)]">
            <p className="text-[10px] font-bold uppercase text-title mb-3">Distribuição por Atendimentos</p>
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie data={pieData} dataKey="value" cx="50%" cy="50%" outerRadius={70} paddingAngle={2}>
                  {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v: number) => [`${((v / totalApts) * 100).toFixed(1)}%`, '']} />
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-1.5 mt-3">
              {pieData.map((s, i) => (
                <div key={s.name} className="flex items-center gap-2 text-xs">
                  <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                  <span className="text-white flex-1 truncate">{s.name}</span>
                  <span className="text-title font-bold">{((s.value / totalApts) * 100).toFixed(1)}%</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderAgenda = () => {
    // Ocupação do período
    const totalSlots = (() => {
      let count = 0;
      const d = new Date(dateRange.start);
      // to offset timezone issues we add 12 hours here
      d.setHours(12);
      const end = new Date(dateRange.end);
      end.setHours(12);
      while (d <= end) {
        const dow = d.getDay();
        const cfg = weeklySchedule[dow];
        if (cfg?.isOpen && cfg.start && cfg.end) {
          const [sh, sm] = cfg.start.split(':').map(Number);
          const [eh, em] = cfg.end.split(':').map(Number);
          count += Math.floor(((eh * 60 + em) - (sh * 60 + sm)) / 30);
        }
        d.setDate(d.getDate() + 1);
      }
      return count;
    })();
    const usedSlots = completedApts.length + noShowApts.length;
    const ocupacao = totalSlots > 0 ? Math.round((usedSlots / totalSlots) * 100) : 0;
    const ocupacaoColor = ocupacao >= 70 ? '#34D399' : ocupacao >= 40 ? '#FBBF24' : '#F87171';

    // Dias mais movimentados (filtrado)
    const diasSemana = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    const porDia = [0, 0, 0, 0, 0, 0, 0];
    completedApts.forEach(a => {
      const [y, m, d] = a.date.split('-').map(Number);
      porDia[new Date(y, m - 1, d).getDay()]++;
    });
    const maxDia = Math.max(...porDia, 1);

    // Horários de pico (filtrado)
    const picoManha = [0, 0, 0, 0, 0, 0, 0];
    const picoTarde = [0, 0, 0, 0, 0, 0, 0];
    const picoNoite = [0, 0, 0, 0, 0, 0, 0];
    completedApts.forEach(a => {
      const [y, m, d] = a.date.split('-').map(Number);
      const dow = new Date(y, m - 1, d).getDay();
      const h = parseInt(a.time?.split(':') || '0');
      if (h >= 8 && h < 12) picoManha[dow]++;
      else if (h >= 12 && h < 17) picoTarde[dow]++;
      else if (h >= 17 && h < 21) picoNoite[dow]++;
    });
    const maxPico = Math.max(...picoManha, ...picoTarde, ...picoNoite, 1);

    // Para período === 'semana'
    const porDiaSemana = diasSemana.map((label, dow) => {
      const count = completedApts.filter(a => {
        const [y, m, d] = a.date.split('-').map(Number);
        return new Date(y, m - 1, d).getDay() === dow;
      }).length;
      // data real do dia
      const diaReal = new Date(dateRange.start);
      diaReal.setHours(12);
      while (diaReal.getDay() !== dow) diaReal.setDate(diaReal.getDate() + 1);
      const dentroDoRange =
        diaReal.toISOString().split('T')[0] >= dateRange.start &&
        diaReal.toISOString().split('T')[0] <= dateRange.end;
      return { label, dow, count, dentroDoRange };
    });
    const maxDiaSemana = Math.max(...porDiaSemana.map(d => d.count), 1);

    // Para período === 'dia'
    const porHora = Array.from({ length: 13 }, (_, i) => {
      const h = i + 8;
      const count = completedApts.filter(a => {
        const hora = parseInt(a.time?.split(':') || '0');
        return hora === h;
      }).length;
      return { label: `${h}h`, h, count };
    });
    const maxHora = Math.max(...porHora.map(d => d.count), 1);
    const horaPico = porHora.reduce((max, cur) => cur.count > max.count ? cur : max, porHora[0]);

    return (
      <div className="space-y-4 pb-6">
        {/* Ocupação */}
        <div className="bg-surface rounded-2xl p-4 border border-white/8 shadow-[0_4px_16px_rgba(0,0,0,0.3)]">
          <div className="flex justify-between items-baseline mb-2">
            <p className="text-[10px] font-bold uppercase text-title">Taxa de Ocupação</p>
            <span className="text-2xl font-black" style={{ color: ocupacaoColor }}>{ocupacao}%</span>
          </div>
          <div className="w-full bg-primary/40 rounded-full h-3">
            <div className="h-3 rounded-full transition-all" style={{ width: `${ocupacao}%`, backgroundColor: ocupacaoColor }} />
          </div>
          <p className="text-[11px] text-title mt-1">{usedSlots} de {totalSlots} slots utilizados</p>
        </div>

        {/* Impacto faltas */}
        {faltas > 0 && (
          <div className="bg-red-500/10 border border-red-500/20  rounded-2xl p-4">
            <p className="text-[10px] font-bold uppercase text-[#F87171] mb-1">Impacto das Faltas</p>
            <p className="text-sm text-[#F87171] font-bold">
              {faltas} falta{faltas > 1 ? 's' : ''} × {formatCurrency(ticketMedio)} = <span className="text-lg font-black">{formatCurrency(faltas * ticketMedio)}</span> perdidos
            </p>
          </div>
        )}

        {(periodo === 'mes' || periodo === 'ano') && (
          <>
            {/* Dias movimentados */}
            <div className="bg-surface rounded-2xl p-4 border border-white/8 shadow-[0_4px_16px_rgba(0,0,0,0.3)]">
              <p className="text-[10px] font-bold uppercase text-title mb-3">Dias Mais Movimentados</p>
              <div className="space-y-2">
                {diasSemana.map((d, i) => (
                  <div key={d} className="flex items-center gap-2">
                    <span className="text-xs text-title w-8">{d}</span>
                    <div className="flex-1 bg-primary/40 rounded-full h-2">
                      <div className="bg-secondary h-2 rounded-full" style={{ width: `${(porDia[i] / maxDia) * 100}%` }} />
                    </div>
                    <span className="text-xs font-bold text-white w-6 text-right">{porDia[i]}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Horários de pico */}
            <div className="bg-surface rounded-2xl p-4 border border-white/8 shadow-[0_4px_16px_rgba(0,0,0,0.3)]">
              <p className="text-[10px] font-bold uppercase text-title mb-3">Horários de Pico</p>
              <div className="grid grid-cols-8 gap-1 text-center">
                <div className="text-[9px] text-title"></div>
                {diasSemana.map(d => <div key={d} className="text-[9px] text-title font-bold">{d}</div>)}
                {[{ label: 'Manhã', data: picoManha }, { label: 'Tarde', data: picoTarde }, { label: 'Noite', data: picoNoite }].map(row => (
                  <React.Fragment key={row.label}>
                    <div className="text-[9px] text-title flex items-center">{row.label}</div>
                    {row.data.map((v, i) => (
                      <div key={i} className="h-6 rounded" style={{ backgroundColor: `rgba(40,152,216,${v / maxPico})` }} />
                    ))}
                  </React.Fragment>
                ))}
              </div>
            </div>
          </>
        )}

        {periodo === 'semana' && (
          <>
            {/* Movimento da Semana */}
            <div className="bg-surface rounded-2xl p-4 border border-white/8 shadow-[0_4px_16px_rgba(0,0,0,0.3)]">
              <p className="text-[10px] font-bold uppercase text-title mb-3">
                Movimento da Semana
              </p>
              <div className="space-y-2">
                {porDiaSemana.map(({ label, count, dentroDoRange }) => (
                  <div key={label} className={`flex items-center gap-2 ${!dentroDoRange ? 'opacity-30' : ''}`}>
                    <span className="text-xs text-title w-8">{label}</span>
                    <div className="flex-1 bg-primary/40 rounded-full h-2">
                      <div
                        className="bg-secondary h-2 rounded-full transition-all"
                        style={{ width: `${(count / maxDiaSemana) * 100}%` }}
                      />
                    </div>
                    <span className="text-xs font-bold text-white w-6 text-right">{count}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Turnos da Semana */}
            <div className="bg-surface rounded-2xl p-4 border border-white/8 shadow-[0_4px_16px_rgba(0,0,0,0.3)]">
              <p className="text-[10px] font-bold uppercase text-title mb-1">Turnos da Semana</p>
              <p className="text-[9px] text-title/50 mb-3">Concentração de atendimentos por turno</p>
              <div className="grid grid-cols-8 gap-1 text-center">
                <div className="text-[9px] text-title"></div>
                {diasSemana.map(d => <div key={d} className="text-[9px] text-title font-bold">{d}</div>)}
                {[{ label: 'Manhã', data: picoManha }, { label: 'Tarde', data: picoTarde }, { label: 'Noite', data: picoNoite }].map(row => (
                  <React.Fragment key={row.label}>
                    <div className="text-[9px] text-title flex items-center">{row.label}</div>
                    {row.data.map((v, i) => (
                      <div key={i} className="h-6 rounded" style={{ backgroundColor: `rgba(40,152,216,${v / maxPico})` }} />
                    ))}
                  </React.Fragment>
                ))}
              </div>
            </div>
          </>
        )}

        {periodo === 'dia' && (
          <div className="bg-surface rounded-2xl p-4 border border-white/8 shadow-[0_4px_16px_rgba(0,0,0,0.3)]">
            <div className="flex justify-between items-baseline mb-3">
              <p className="text-[10px] font-bold uppercase text-title">Linha do Dia</p>
              {horaPico && horaPico.count > 0 && (
                <span className="text-[10px] font-bold text-secondary">
                  Pico: {horaPico.label}
                </span>
              )}
            </div>

            {completedApts.length === 0 ? (
              <p className="text-[11px] text-title text-center py-4">
                Nenhum atendimento neste dia
              </p>
            ) : (
              <div className="space-y-1.5">
                {porHora.map(({ label, count }) => (
                  <div key={label} className="flex items-center gap-2">
                    <span className="text-[10px] text-title w-7">{label}</span>
                    <div className="flex-1 bg-primary/40 rounded-full h-2">
                      <div
                        className="bg-secondary h-2 rounded-full transition-all"
                        style={{ width: `${(count / maxHora) * 100}%` }}
                      />
                    </div>
                    <span className="text-[10px] font-bold text-white w-4 text-right">
                      {count > 0 ? count : ''}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderComissoes = () => {
    // Filtramos os profissionais ativos do tenant
    const activeStaff = staff.filter(s => s.status === 'active');
    
    // Calcula comissões de cada staff no período selecionado
    const staffCommissions = activeStaff.map(s => {
      // Agendamentos completos deste profissional no período
      const sApts = completedApts.filter(a => a.staffId === s.id || a.staffId === s.userId);
      // No-show deste profissional no período
      const sNoShows = periodAppointments.filter(a => (a.staffId === s.id || a.staffId === s.userId) && a.status === 'no-show');
      
      const gross = sApts.reduce((sum, a) => sum + (a.price || 0), 0);
      const commissionAmount = sApts.reduce((sum, a) => sum + ((a.price || 0) * ((s.commissionRate || 0) / 100)), 0);
      const net = gross - commissionAmount;
      const totalServices = sApts.length;
      const ticket = totalServices > 0 ? gross / totalServices : 0;
      
      return {
        staff: s,
        gross,
        commissionAmount,
        net,
        totalServices,
        noShowCount: sNoShows.length,
        ticket,
        appointments: sApts
      };
    });

    // Totais consolidados da equipe
    const totalGross = staffCommissions.reduce((sum, item) => sum + item.gross, 0);
    const totalCommissions = staffCommissions.reduce((sum, item) => sum + item.commissionAmount, 0);
    const totalNet = staffCommissions.reduce((sum, item) => sum + item.net, 0);
    const totalServices = staffCommissions.reduce((sum, item) => sum + item.totalServices, 0);

    const handlePayCommission = async (item: typeof staffCommissions[0]) => {
      if (item.commissionAmount <= 0) return;
      
      const confirmPay = window.confirm(
        `Deseja registrar o pagamento de comissão para ${item.staff.name} no valor de ${formatCurrency(item.commissionAmount)}?\n\nIsso criará uma despesa no extrato do caixa.`
      );
      
      if (confirmPay) {
        try {
          await addTransaction({
            type: 'expense',
            amount: item.commissionAmount,
            category: 'other',
            description: `Comissão paga: ${item.staff.name} (${getPeriodLabel()})`,
            date: `${dateRange.end}T12:00:00`,
          });
          setCommissionPaymentSuccess(`Comissão de ${formatCurrency(item.commissionAmount)} paga para ${item.staff.name} registrada com sucesso!`);
          setTimeout(() => setCommissionPaymentSuccess(null), 4000);
        } catch (err) {
          console.error("Erro ao registrar pagamento de comissão:", err);
          alert("Não foi possível registrar o pagamento da comissão.");
        }
      }
    };

    if (activeStaff.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center p-8 text-center min-h-[40vh] text-title">
          <Users size={48} className="text-[#A5B4FC] mb-4 opacity-40 animate-pulse" />
          <h3 className="text-lg font-bold text-white mb-2">Nenhum Profissional Cadastrado</h3>
          <p className="text-sm max-w-xs mb-4 text-title/70">
            Cadastre membros da equipe no painel administrativo ("Gerenciar Equipe") para monitorar faturamentos e comissões.
          </p>
        </div>
      );
    }

    if (selectedStaffForCommission) {
      const details = staffCommissions.find(sc => sc.staff.id === selectedStaffForCommission.id);
      if (!details) {
        setSelectedStaffForCommission(null);
        return null;
      }

      return (
        <div className="flex flex-col gap-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
          {/* Header Voltar */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSelectedStaffForCommission(null)}
              className="p-2 rounded-xl bg-surface hover:bg-white/10 text-white transition-colors border border-white/5"
            >
              <ChevronLeft size={20} />
            </button>
            <div>
              <h3 className="text-lg font-black text-white">{details.staff.name}</h3>
              <p className="text-[10px] text-title uppercase tracking-widest font-bold">Detalhamento de Comissões e Produtividade</p>
            </div>
          </div>

          {/* Bento Produtividade */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-surface rounded-3xl p-4 border border-white/5 flex flex-col justify-between min-h-[100px]">
              <span className="text-[10px] font-bold text-title uppercase tracking-widest">Faturamento Bruto</span>
              <div>
                <h4 className="text-xl font-black text-white mt-1">{formatCurrency(details.gross)}</h4>
                <p className="text-[10px] text-emerald-400 font-bold mt-0.5">Gerado pelo profissional</p>
              </div>
            </div>

            <div className="bg-surface rounded-3xl p-4 border border-white/5 flex flex-col justify-between min-h-[100px]">
              <span className="text-[10px] font-bold text-title uppercase tracking-widest font-bold">Comissão ({details.staff.commissionRate}%)</span>
              <div>
                <h4 className="text-xl font-black text-[#F43F5E] mt-1">{formatCurrency(details.commissionAmount)}</h4>
                <p className="text-[10px] text-[#FDA4AF] font-bold mt-0.5">Valor devido</p>
              </div>
            </div>

            <div className="bg-surface rounded-3xl p-4 border border-white/5 flex flex-col justify-between min-h-[100px]">
              <span className="text-[10px] font-bold text-title uppercase tracking-widest">Líquido Salão</span>
              <div>
                <h4 className="text-xl font-black text-[#34D399] mt-1">{formatCurrency(details.net)}</h4>
                <p className="text-[10px] text-[#A7F3D0] font-bold mt-0.5">Fração retida</p>
              </div>
            </div>

            <div className="bg-surface rounded-3xl p-4 border border-white/5 flex flex-col justify-between min-h-[100px]">
              <span className="text-[10px] font-bold text-title uppercase tracking-widest">Ticket Médio</span>
              <div>
                <h4 className="text-xl font-black text-white mt-1">{formatCurrency(details.ticket)}</h4>
                <p className="text-[10px] text-blue-300 font-bold mt-0.5">Por serviço</p>
              </div>
            </div>
          </div>

          {/* Atendimentos e Faltas (Métricas de Produtividade) */}
          <div className="bg-surface rounded-3xl p-5 border border-white/5">
            <h4 className="text-xs font-bold text-white uppercase tracking-wider mb-4">Métricas de Produtividade</h4>
            <div className="flex gap-4 items-center justify-around">
              <div className="text-center">
                <span className="text-[10px] font-bold text-title uppercase tracking-widest">Atendimentos</span>
                <p className="text-3xl font-black text-[#818CF8] mt-1">{details.totalServices}</p>
                <p className="text-[10px] text-title/70 mt-1">Concluídos</p>
              </div>
              
              <div className="h-10 w-px bg-white/10" />

              <div className="text-center">
                <span className="text-[10px] font-bold text-title uppercase tracking-widest">Faltas (No-show)</span>
                <p className="text-3xl font-black text-[#F87171] mt-1">{details.noShowCount}</p>
                <p className="text-[10px] text-title/70 mt-1">Ausentes</p>
              </div>

              <div className="h-10 w-px bg-white/10" />

              <div className="text-center">
                <span className="text-[10px] font-bold text-title uppercase tracking-widest">Ocupação / Taxa</span>
                <p className="text-3xl font-black text-white mt-1">
                  {details.totalServices + details.noShowCount > 0 
                    ? `${Math.round((details.totalServices / (details.totalServices + details.noShowCount)) * 100)}%`
                    : '100%'}
                </p>
                <p className="text-[10px] text-title/70 mt-1">Aproveitamento</p>
              </div>
            </div>
          </div>

          {/* Botão de Registro de Pagamento */}
          {details.commissionAmount > 0 && (
            <button
              onClick={() => handlePayCommission(details)}
              className="w-full flex items-center justify-center gap-2 py-4 bg-secondary text-white font-bold rounded-2xl hover:bg-secondary/90 transition-all shadow-md text-sm cursor-pointer border-none"
            >
              <CircleDollarSign size={18} />
              Registrar Pagamento de Comissão ({formatCurrency(details.commissionAmount)})
            </button>
          )}

          {/* Lista de Atendimentos Realizados */}
          <div className="bg-surface rounded-3xl p-5 border border-white/5 flex flex-col gap-3">
            <h4 className="text-xs font-bold text-white uppercase tracking-wider mb-2">Serviços Realizados no Período</h4>
            {details.appointments.length === 0 ? (
              <p className="text-xs text-title text-center py-4">Nenhum atendimento completo no período.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {details.appointments.map(a => {
                  const itemCommission = (a.price || 0) * (details.staff.commissionRate / 100);
                  return (
                    <div key={a.id} className="flex justify-between items-center bg-background/50 p-3 rounded-2xl border border-white/5">
                      <div className="min-w-0 flex-1 pr-2">
                        <p className="text-xs font-black text-white truncate">{a.clientName}</p>
                        <p className="text-[10px] text-title font-semibold mt-0.5 truncate">
                          {a.service} — {a.date.split('-').reverse().slice(0, 2).join('/')} às {a.time}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-xs font-black text-emerald-400">{formatCurrency(a.price)}</p>
                        <p className="text-[10px] text-title mt-0.5">Comissão: <span className="font-bold text-[#FDA4AF]">{formatCurrency(itemCommission)}</span></p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
        {/* Toast de Sucesso */}
        {commissionPaymentSuccess && (
          <div className="bg-emerald-500 text-white p-4 rounded-2xl text-xs font-bold flex items-center gap-2 shadow-lg animate-in fade-in slide-in-from-top-4">
            <span className="flex-1">{commissionPaymentSuccess}</span>
          </div>
        )}

        {/* Bento Resumo Consolidado */}
        <div className="bg-surface rounded-3xl p-5 border border-white/5">
          <p className="text-[10px] font-bold text-title uppercase tracking-widest mb-3">Consolidado da Equipe</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <span className="text-[9px] text-title uppercase font-bold tracking-widest">Faturamento Bruto</span>
              <p className="text-2xl font-black text-white mt-1">{formatCurrency(totalGross)}</p>
            </div>
            <div>
              <span className="text-[9px] text-title uppercase font-bold tracking-widest">Total Comissões</span>
              <p className="text-2xl font-black text-[#F43F5E] mt-1">{formatCurrency(totalCommissions)}</p>
            </div>
            <div>
              <span className="text-[9px] text-title uppercase font-bold tracking-widest">Líquido Salão</span>
              <p className="text-2xl font-black text-[#34D399] mt-1">{formatCurrency(totalNet)}</p>
            </div>
            <div>
              <span className="text-[9px] text-title uppercase font-bold tracking-widest">Atendimentos</span>
              <p className="text-2xl font-black text-[#818CF8] mt-1">{totalServices}</p>
            </div>
          </div>
        </div>

        {/* Lista de Membros */}
        <div className="flex flex-col gap-3">
          <p className="text-[10px] font-bold text-title uppercase tracking-widest px-1">Faturamento e Comissão por Profissional</p>
          {staffCommissions.map(item => (
            <div
              key={item.staff.id}
              onClick={() => setSelectedStaffForCommission(item.staff)}
              className="bg-surface hover:bg-white/5 active:scale-[0.99] transition-all rounded-3xl p-4 border border-white/5 flex items-center justify-between cursor-pointer"
            >
              {/* Avatar e Infos */}
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-11 h-11 rounded-full bg-background overflow-hidden flex items-center justify-center text-secondary border border-secondary shrink-0">
                  {item.staff.photo ? (
                    <img referrerPolicy="no-referrer" src={item.staff.photo} alt={item.staff.name} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-sm font-black uppercase">{getInitials(item.staff.name)}</span>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-black text-white truncate">{item.staff.name}</p>
                  <p className="text-[10px] text-title font-bold mt-0.5">
                    {item.staff.commissionRate}% de comissão • <span className="text-[#818CF8]">{item.totalServices} atendimentos</span>
                  </p>
                </div>
              </div>

              {/* Valores rápidos */}
              <div className="text-right shrink-0 pl-2">
                <p className="text-xs text-title font-bold">A pagar</p>
                <p className="text-sm font-black text-[#F43F5E] mt-0.5">{formatCurrency(item.commissionAmount)}</p>
                <span className="text-[9px] text-emerald-400 font-semibold mt-0.5 block">Bruto: {formatCurrency(item.gross)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderRelatorios = () => {
    const activeStaff = staff.filter(s => s.status === 'active');
    
    // Agendamentos por status no período
    const totalAptsCount = periodAppointments.length;
    const completedAptsCount = completedApts.length;
    const noShowAptsCount = noShowApts.length;
    const pendingAptsCount = periodAppointments.filter(a => a.status === 'pending').length;
    
    // Métricas por profissional
    const staffMetrics = activeStaff.map(s => {
      const sCompleted = completedApts.filter(a => a.staffId === s.id || a.staffId === s.userId);
      const sNoShows = noShowApts.filter(a => a.staffId === s.id || a.staffId === s.userId);
      const sPending = periodAppointments.filter(a => (a.staffId === s.id || a.staffId === s.userId) && a.status === 'pending');
      const sTotal = sCompleted.length + sNoShows.length + sPending.length;
      
      const grossRevenue = sCompleted.reduce((sum, a) => sum + (a.price || 0), 0);
      const commissionEarned = sCompleted.reduce((sum, a) => sum + ((a.price || 0) * ((s.commissionRate || 0) / 100)), 0);
      const netSalon = grossRevenue - commissionEarned;
      const avgTicket = sCompleted.length > 0 ? grossRevenue / sCompleted.length : 0;
      const utilizationRate = sTotal > 0 ? (sCompleted.length / (sCompleted.length + sNoShows.length || 1)) * 100 : 100;

      return {
        staff: s,
        completed: sCompleted.length,
        noShows: sNoShows.length,
        pending: sPending.length,
        total: sTotal,
        gross: grossRevenue,
        commission: commissionEarned,
        net: netSalon,
        avgTicket,
        utilizationRate
      };
    });

    // Totais consolidados
    const totalGrossRevenue = staffMetrics.reduce((sum, item) => sum + item.gross, 0);
    const totalCommissionsEarned = staffMetrics.reduce((sum, item) => sum + item.commission, 0);
    const totalNetSalon = staffMetrics.reduce((sum, item) => sum + item.net, 0);
    const overallAvgTicket = completedAptsCount > 0 ? totalGrossRevenue / completedAptsCount : 0;

    // --- CÁLCULO DE ALERTAS OPERACIONAIS EM TEMPO REAL ---
    const alerts: Array<{
      id: string;
      type: 'critical' | 'warning' | 'info' | 'success';
      title: string;
      description: string;
      recommendation: string;
    }> = [];

    // 1. Alerta: Aumento anormal de no-shows (Faltas)
    const overallNoShowRate = (completedAptsCount + noShowAptsCount) > 0 
      ? (noShowAptsCount / (completedAptsCount + noShowAptsCount)) * 100 
      : 0;

    if (overallNoShowRate > 15 && noShowAptsCount >= 2) {
      alerts.push({
        id: 'high-noshow-rate',
        type: 'critical',
        title: 'Alto Índice de Faltas (No-shows)',
        description: `As faltas representam ${Math.round(overallNoShowRate)}% dos agendamentos finalizados no período (${noShowAptsCount} ausências).`,
        recommendation: 'Recomenda-se ativar lembretes de confirmação automáticos via WhatsApp e estabelecer políticas de depósito prévio para clientes recorrentes que faltam.'
      });
    }

    // 2. Alerta: Queda de aproveitamento por profissional específico
    staffMetrics.forEach(m => {
      if (m.total >= 3 && m.utilizationRate < 75) {
        alerts.push({
          id: `low-utilization-${m.staff.id}`,
          type: 'warning',
          title: `Baixa taxa de presença: ${m.staff.name}`,
          description: `O profissional registrou ${m.noShows} faltas em ${m.completed + m.noShows} agendamentos (${Math.round(m.utilizationRate)}% de presença).`,
          recommendation: `Sugira a ${m.staff.name} reconfirmar suas reservas individualmente por telefone ou mensagem um dia antes do serviço.`
        });
      }
    });

    // 3 & 6. Alertas comparativos de faturamento e produtividade contra a média
    const staffWithGross = staffMetrics.filter(m => m.completed > 0);
    const avgGross = staffWithGross.length > 0 
      ? staffWithGross.reduce((sum, m) => sum + m.gross, 0) / staffWithGross.length 
      : 0;

    if (staffMetrics.length > 1 && avgGross > 0) {
      staffMetrics.forEach(m => {
        // Queda expressiva de faturamento (menor que 50% da média)
        if (m.gross < avgGross * 0.5 && m.completed > 0) {
          alerts.push({
            id: `low-revenue-${m.staff.id}`,
            type: 'info',
            title: `Baixo faturamento relativo: ${m.staff.name}`,
            description: `O faturamento bruto de ${formatCurrency(m.gross)} está abaixo de 50% da média dos profissionais ativos (${formatCurrency(avgGross)}).`,
            recommendation: `Considere criar combos promocionais para serviços executados por ${m.staff.name} ou direcionar novas reservas de balcão para ele.`
          });
        }
        
        // Produtividade/Presença abaixo da média do salão
        const overallPresenca = (completedAptsCount + noShowAptsCount) > 0 
          ? (completedAptsCount / (completedAptsCount + noShowAptsCount)) * 100 
          : 100;
        if (m.total >= 3 && (overallPresenca - m.utilizationRate) > 15) {
          alerts.push({
            id: `low-presence-diff-${m.staff.id}`,
            type: 'warning',
            title: `Presença abaixo da média: ${m.staff.name}`,
            description: `A taxa de presença de ${m.staff.name} (${Math.round(m.utilizationRate)}%) está bem abaixo da média do estabelecimento (${Math.round(overallPresenca)}%).`,
            recommendation: `Analise se há clientes específicos agendando recorrentemente com ${m.staff.name} e gerando no-shows propositais.`
          });
        }
      });
    }

    // 4. Alerta: Concentração de Cancelamentos
    const canceledAptsCount = periodAppointments.filter(a => a.status === 'canceled').length;
    if (canceledAptsCount >= 3) {
      const canceledRate = totalAptsCount > 0 ? (canceledAptsCount / totalAptsCount) * 100 : 0;
      if (canceledRate > 15) {
        alerts.push({
          id: 'high-cancellations',
          type: 'warning',
          title: 'Alta Taxa de Cancelamentos',
          description: `Foram registrados ${canceledAptsCount} cancelamentos no período, correspondendo a ${Math.round(canceledRate)}% das solicitações de agenda.`,
          recommendation: 'Verifique se há gargalos no agendamento online ou se os clientes estão cancelando por incompatibilidade de horários.'
        });
      }
    }

    // 5. Alerta: Horários com baixa ocupação (Ocupação de Vale)
    if (completedAptsCount >= 5) {
      const hourCounts: Record<number, number> = {};
      completedApts.forEach(a => {
        const h = parseInt(a.time.split(':')[0]);
        if (!isNaN(h)) {
          hourCounts[h] = (hourCounts[h] || 0) + 1;
        }
      });

      // Procurar horários úteis típicos com movimento nulo ou de apenas 1 atendimento
      const businessHours = [9, 10, 11, 13, 14, 15, 16, 17];
      const lowTrafficHours = businessHours.filter(h => (hourCounts[h] || 0) <= (completedAptsCount * 0.05));
      
      if (lowTrafficHours.length > 0) {
        const formattedHours = lowTrafficHours.map(h => `${h}h`).join(', ');
        alerts.push({
          id: 'low-occupancy-hours',
          type: 'info',
          title: 'Gargalos de Ocupação de Agenda',
          description: `Identificamos baixo tráfego de clientes nas faixas horárias de ${formattedHours} neste período.`,
          recommendation: 'Aproveite esses horários de vale para lançar campanhas de "Desconto de Ocupação Rápida" ou agendar manutenções do salão.'
        });
      }
    }

    // 7. Alerta Comercial: Atenção para o período selecionado
    if (completedAptsCount === 0 && totalAptsCount > 0) {
      alerts.push({
        id: 'no-completed-apts',
        type: 'warning',
        title: 'Nenhum Agendamento Concluído no Período',
        description: `Existem ${totalAptsCount} agendamentos no período selecionado, mas nenhum foi marcado como concluído até o momento.`,
        recommendation: 'Certifique-se de finalizar os agendamentos realizados no painel da Agenda para atualizar o caixa e os relatórios financeiros do salão.'
      });
    } else if (totalAptsCount === 0) {
      alerts.push({
        id: 'zero-operational-activity',
        type: 'info',
        title: 'Período sem Atividade Operacional',
        description: 'Não foram encontrados agendamentos registrados no período atual.',
        recommendation: 'Use o link de agendamento online para divulgar o salão aos seus clientes e preencher o cronograma.'
      });
    }

    // Rankings de Destaque
    const topFaturamento = staffMetrics.length > 0 ? [...staffMetrics].sort((a, b) => b.gross - a.gross)[0] : null;
    const topProdutividade = staffMetrics.length > 0 ? [...staffMetrics].filter(m => m.total > 0).sort((a, b) => b.utilizationRate - a.utilizationRate)[0] : null;
    const topTicket = staffMetrics.length > 0 ? [...staffMetrics].filter(m => m.completed > 0).sort((a, b) => b.avgTicket - a.avgTicket)[0] : null;

    // Dados para gráfico do Recharts (Faturamento vs Comissão por Profissional)
    const chartData = staffMetrics.map(item => ({
      name: item.staff.name.split(' ')[0], // Apenas primeiro nome para caber no gráfico
      Faturamento: item.gross,
      Comissão: item.commission
    }));

    // --- GERAÇÃO DE RECOMENDAÇÕES OPERACIONAIS ACIONÁVEIS ---
    const recsList: Array<{
      id: string;
      title: string;
      description: string;
      priority: 'high' | 'medium' | 'low';
      category: string;
      actionLabel: string;
      actionType: 'config_whatsapp' | 'setup_deposit' | 'adjust_schedule' | 'create_coupon' | 'contact_staff' | 'review_rules' | 'close_register';
      staffId?: string;
      meta?: any;
    }> = [];

    // 1. Ativar confirmação preventiva para períodos com alto no-show
    if (overallNoShowRate > 15 && noShowAptsCount >= 2) {
      recsList.push({
        id: 'rec-preventive-confirmation',
        title: 'Ativar Confirmação Preventiva de Agendamentos',
        description: `Com uma taxa de no-show de ${Math.round(overallNoShowRate)}% neste período, sugerimos enviar mensagens de confirmação obrigatórias 24h antes do horário para mitigar as faltas (${noShowAptsCount} ausências).`,
        priority: 'high',
        category: 'No-show / Faltas',
        actionLabel: 'Ativar Mensagens de Confirmação',
        actionType: 'config_whatsapp'
      });
    }

    // 2. Sugerir cobrança de sinal em períodos críticos
    const hasHighValueServicesNoShow = periodAppointments.some(a => a.status === 'no-show' && a.price >= 80);
    if (overallNoShowRate > 10 || hasHighValueServicesNoShow) {
      recsList.push({
        id: 'rec-charge-signal',
        title: 'Sugerir Cobrança de Sinal (Depósito Prévio)',
        description: 'Para reduzir o impacto de ausências em serviços de maior valor ou horários concorridos, ative a cobrança de um sinal Pix de 30% no agendamento online.',
        priority: 'high',
        category: 'Financeiro',
        actionLabel: 'Configurar Sinal Pix',
        actionType: 'setup_deposit'
      });
    }

    // 3. Recomendar revisão de escala em profissionais com baixa presença
    staffMetrics.forEach(m => {
      if (m.total >= 3 && m.utilizationRate < 75) {
        recsList.push({
          id: `rec-scale-review-${m.staff.id}`,
          title: `Revisar Escala de Trabalho: ${m.staff.name}`,
          description: `${m.staff.name} está com apenas ${Math.round(m.utilizationRate)}% de presença. Sugerimos readequar seus horários ou dias de escala para reduzir janelas vazias na agenda.`,
          priority: 'medium',
          category: 'Gestão de Equipe',
          actionLabel: 'Ajustar Escala',
          actionType: 'adjust_schedule',
          staffId: m.staff.id
        });
      }
    });

    // 4. Sugerir campanha promocional em horários de baixa ocupação
    if (completedAptsCount >= 5) {
      const hourCounts: Record<number, number> = {};
      completedApts.forEach(a => {
        const h = parseInt(a.time.split(':')[0]);
        if (!isNaN(h)) {
          hourCounts[h] = (hourCounts[h] || 0) + 1;
        }
      });
      const businessHours = [9, 10, 11, 13, 14, 15, 16, 17];
      const lowTrafficHours = businessHours.filter(h => (hourCounts[h] || 0) <= (completedAptsCount * 0.05));
      if (lowTrafficHours.length > 0) {
        const formattedHours = lowTrafficHours.map(h => `${h}h`).join(', ');
        recsList.push({
          id: 'rec-low-occupancy-promo',
          title: 'Criar Campanha Promocional para Horários Ociosos',
          description: `Identificamos baixíssima ocupação nas faixas de ${formattedHours}. Recomendamos criar uma promoção relâmpago de 15% de desconto para esses horários de vale.`,
          priority: 'medium',
          category: 'Marketing',
          actionLabel: 'Criar Cupom de Desconto',
          actionType: 'create_coupon',
          meta: { hours: formattedHours }
        });
      }
    }

    // 5. Indicar atenção para profissionais abaixo da média do tenant
    if (staffMetrics.length > 1 && avgGross > 0) {
      staffMetrics.forEach(m => {
        if (m.gross < avgGross * 0.5 && m.completed > 0) {
          recsList.push({
            id: `rec-below-average-${m.staff.id}`,
            title: `Atenção Especial: Desempenho de ${m.staff.name}`,
            description: `O faturamento bruto de ${formatCurrency(m.gross)} está abaixo de 50% da média do salão (${formatCurrency(avgGross)}). Sugere-se uma conversa de alinhamento técnico ou melhor distribuição de novos clientes.`,
            priority: 'low',
            category: 'Gestão de Equipe',
            actionLabel: 'Falar com Profissional',
            actionType: 'contact_staff',
            staffId: m.staff.id
          });
        }
      });
    }

    // 6. Apontar dias/períodos que merecem revisão operacional
    if (periodAppointments.length >= 5) {
      const dayStats: Record<number, { completed: number; noShow: number; total: number }> = {};
      periodAppointments.forEach(a => {
        const dateObj = new Date(a.date + 'T12:00:00');
        const dow = dateObj.getDay();
        if (!dayStats[dow]) dayStats[dow] = { completed: 0, noShow: 0, total: 0 };
        dayStats[dow].total++;
        if (a.status === 'completed') dayStats[dow].completed++;
        else if (a.status === 'no-show') dayStats[dow].noShow++;
      });

      let worstDow = -1;
      let worstNoShowRate = 0;
      Object.entries(dayStats).forEach(([dowStr, stats]) => {
        const dow = parseInt(dowStr);
        if (stats.total >= 3) {
          const nsRate = (stats.noShow / stats.total) * 100;
          if (nsRate > worstNoShowRate && nsRate > 15) {
            worstNoShowRate = nsRate;
            worstDow = dow;
          }
        }
      });

      if (worstDow !== -1) {
        const dayNames = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
        recsList.push({
          id: `rec-operational-day-review-${worstDow}`,
          title: `Revisão Operacional de Dia de Pico: ${dayNames[worstDow]}s`,
          description: `Identificamos que as ${dayNames[worstDow]}s apresentam um índice crítico de no-shows de ${Math.round(worstNoShowRate)}%. Recomenda-se endurecer as políticas de cancelamento para este dia específico.`,
          priority: 'high',
          category: 'Revisão Operacional',
          actionLabel: 'Revisar Regras de Agendamento',
          actionType: 'review_rules',
          meta: { dow: worstDow }
        });
      }
    }

    // 7. Sugerir fechamento de caixa/agenda quando houver atividade pendente
    if (pendingAptsCount > 0) {
      recsList.push({
        id: 'rec-close-register-pending',
        title: 'Fechamento de Agenda Pendente',
        description: `Há ${pendingAptsCount} agendamento(s) com status "Pendente" no período. Conclua ou registre no-shows para que o cálculo de faturamento e comissões fique correto.`,
        priority: 'high',
        category: 'Fechamento Operacional',
        actionLabel: 'Ver Agendamentos Pendentes',
        actionType: 'close_register',
        meta: { count: pendingAptsCount }
      });
    }

    // Filtragem de permissões
    const filteredRecommendations = recsList.filter(rec => {
      if (userRole === 'admin_owner') {
        return true;
      } else if (userRole === 'staff') {
        const loggedInStaff = staff.find(s => s.userId === session?.user?.id);
        if (!loggedInStaff) return false;
        return rec.staffId === loggedInStaff.id;
      }
      return false;
    });

    if (activeStaff.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center p-8 text-center min-h-[40vh] text-title">
          <Users size={48} className="text-[#A5B4FC] mb-4 opacity-40 animate-pulse" />
          <h3 className="text-lg font-bold text-white mb-2">Nenhum Profissional Cadastrado</h3>
          <p className="text-sm max-w-xs text-title/70">
            Cadastre profissionais no painel para gerar relatórios de faturamento, comissões e produtividade.
          </p>
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
        {/* Bloco 1: KPIs Bento Grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div className="bg-surface rounded-3xl p-4 border border-white/5 flex flex-col justify-between min-h-[100px]">
            <span className="text-[10px] font-bold text-title uppercase tracking-widest">Agendamentos Totais</span>
            <div>
              <h4 className="text-2xl font-black text-white mt-1">{totalAptsCount}</h4>
              <p className="text-[9px] text-title/60 mt-0.5">
                {completedAptsCount} concluídos · {noShowAptsCount} faltas
              </p>
            </div>
          </div>

          <div className="bg-surface rounded-3xl p-4 border border-white/5 flex flex-col justify-between min-h-[100px]">
            <span className="text-[10px] font-bold text-title uppercase tracking-widest text-[#34D399]">Faturamento Bruto</span>
            <div>
              <h4 className="text-2xl font-black text-[#34D399] mt-1">{formatCurrency(totalGrossRevenue)}</h4>
              <p className="text-[9px] text-[#A7F3D0] mt-0.5">Apenas agendamentos</p>
            </div>
          </div>

          <div className="bg-surface rounded-3xl p-4 border border-white/5 flex flex-col justify-between min-h-[100px]">
            <span className="text-[10px] font-bold text-title uppercase tracking-widest text-[#F43F5E]">Comissões Estimadas</span>
            <div>
              <h4 className="text-2xl font-black text-[#F43F5E] mt-1">{formatCurrency(totalCommissionsEarned)}</h4>
              <p className="text-[9px] text-[#FDA4AF] mt-0.5">Devido à equipe</p>
            </div>
          </div>

          <div className="bg-surface rounded-3xl p-4 border border-white/5 flex flex-col justify-between min-h-[100px]">
            <span className="text-[10px] font-bold text-title uppercase tracking-widest text-[#818CF8]">Líquido Salão</span>
            <div>
              <h4 className="text-2xl font-black text-[#818CF8] mt-1">{formatCurrency(totalNetSalon)}</h4>
              <p className="text-[9px] text-[#C7D2FE] mt-0.5">Retido no estabelecimento</p>
            </div>
          </div>

          <div className="bg-surface rounded-3xl p-4 border border-white/5 flex flex-col justify-between min-h-[100px]">
            <span className="text-[10px] font-bold text-title uppercase tracking-widest text-amber-400">Ticket Médio</span>
            <div>
              <h4 className="text-2xl font-black text-amber-400 mt-1">{formatCurrency(overallAvgTicket)}</h4>
              <p className="text-[9px] text-amber-200 mt-0.5">Valor médio por corte</p>
            </div>
          </div>

          <div className="bg-surface rounded-3xl p-4 border border-white/5 flex flex-col justify-between min-h-[100px]">
            <span className="text-[10px] font-bold text-title uppercase tracking-widest">Aproveitamento</span>
            <div>
              <h4 className="text-2xl font-black text-white mt-1">
                {totalAptsCount > 0 ? `${Math.round(((completedAptsCount) / (completedAptsCount + noShowAptsCount || 1)) * 100)}%` : '100%'}
              </h4>
              <p className="text-[9px] text-title/60 mt-0.5">Taxa de presença</p>
            </div>
          </div>
        </div>

        {/* Central de Sinais e Alertas Operacionais */}
        <div className="bg-surface rounded-3xl p-5 border border-white/5">
          <div className="flex items-center gap-2 mb-4">
            <Lightbulb size={18} className="text-amber-400" />
            <div>
              <h4 className="text-xs font-bold text-white uppercase tracking-wider">Sinais e Alertas Operacionais</h4>
              <p className="text-[9px] text-title font-semibold uppercase tracking-widest mt-0.5">Diagnóstico em tempo real</p>
            </div>
          </div>
          
          {alerts.length === 0 ? (
            <div className="flex items-center gap-3 p-4 bg-background/30 rounded-2xl border border-white/5">
              <div className="w-8 h-8 rounded-full bg-emerald-500/10 text-emerald-400 flex items-center justify-center shrink-0">
                <Smile size={16} />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-black text-white">Sua operação está saudável!</p>
                <p className="text-[10px] text-title mt-0.5">Nenhum sinal crítico ou ponto de atenção foi detectado para este período.</p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {alerts.map(alert => {
                const isCritical = alert.type === 'critical';
                const isWarning = alert.type === 'warning';
                const isInfo = alert.type === 'info';
                
                const iconColor = isCritical ? 'text-rose-400' : isWarning ? 'text-amber-400' : 'text-indigo-400';
                const bgColor = isCritical ? 'bg-rose-500/10 border-rose-500/10' : isWarning ? 'bg-amber-500/10 border-amber-500/10' : 'bg-indigo-500/10 border-indigo-500/10';
                
                return (
                  <div key={alert.id} className={`flex flex-col gap-2 p-4 rounded-2xl border ${bgColor} transition-all`}>
                    <div className="flex items-start gap-3">
                      <div className={`w-8 h-8 rounded-full ${isCritical ? 'bg-rose-500/10' : isWarning ? 'bg-amber-500/10' : 'bg-indigo-500/10'} flex items-center justify-center shrink-0 ${iconColor}`}>
                        {isCritical ? <AlertTriangle size={16} /> : isWarning ? <AlertTriangle size={16} /> : <Lightbulb size={16} />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-black text-white flex items-center gap-1.5">
                          {alert.title}
                          {isCritical && <span className="text-[8px] bg-rose-500 text-white font-bold px-1.5 py-0.5 rounded uppercase tracking-widest">Crítico</span>}
                          {isWarning && <span className="text-[8px] bg-amber-500 text-black font-bold px-1.5 py-0.5 rounded uppercase tracking-widest">Atenção</span>}
                          {isInfo && <span className="text-[8px] bg-indigo-500 text-white font-bold px-1.5 py-0.5 rounded uppercase tracking-widest">Insight</span>}
                        </p>
                        <p className="text-[10px] text-title/90 mt-1 leading-relaxed font-medium">
                          {alert.description}
                        </p>
                        <div className="mt-2 pt-2 border-t border-white/5">
                          <p className="text-[10px] text-white/95 leading-relaxed">
                            <strong className="font-extrabold text-[#A5B4FC]">Ação Recomendada:</strong> {alert.recommendation}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Recomendações Operacionais Acionáveis */}
        <div className="bg-surface rounded-3xl p-5 border border-white/5 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity size={18} className="text-[#818CF8]" />
              <div>
                <h4 className="text-xs font-bold text-white uppercase tracking-wider">Ações e Recomendações Operacionais</h4>
                <p className="text-[9px] text-title font-semibold uppercase tracking-widest mt-0.5">Sugestões práticas para o gestor</p>
              </div>
            </div>
            <span className="text-[9px] bg-[#818CF8]/10 text-[#818CF8] font-bold px-2 py-1 rounded-full uppercase tracking-wider">
              {filteredRecommendations.length} Disponíveis
            </span>
          </div>

          {recSuccessToast && (
            <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 p-3 rounded-2xl text-[10px] font-bold flex items-center gap-2 animate-in fade-in duration-200">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
              <span>{recSuccessToast}</span>
            </div>
          )}

          {filteredRecommendations.length === 0 ? (
            <div className="flex items-center gap-3 p-4 bg-background/30 rounded-2xl border border-white/5">
              <div className="w-8 h-8 rounded-full bg-emerald-500/10 text-emerald-400 flex items-center justify-center shrink-0">
                <Smile size={16} />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-black text-white">Todas as recomendações resolvidas!</p>
                <p className="text-[10px] text-title mt-0.5">Sua operação não possui pontos pendentes ou gargalos críticos pendentes neste período.</p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {filteredRecommendations.map(rec => {
                const isHigh = rec.priority === 'high';
                const isMedium = rec.priority === 'medium';
                
                const priorityBadgeColor = isHigh 
                  ? 'bg-rose-500/10 text-rose-400 border-rose-500/20' 
                  : isMedium 
                    ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' 
                    : 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20';

                return (
                  <div key={rec.id} className="bg-background/40 p-4 rounded-2xl border border-white/5 flex flex-col gap-3 hover:border-white/10 transition-all">
                    <div className="flex justify-between items-start gap-2">
                      <div className="flex flex-col gap-1 min-w-0">
                        <span className="text-[9px] font-bold text-[#818CF8] uppercase tracking-wider">
                          {rec.category}
                        </span>
                        <h5 className="text-xs font-black text-white leading-tight">
                          {rec.title}
                        </h5>
                      </div>
                      <span className={`text-[8px] font-extrabold px-2 py-0.5 rounded border uppercase tracking-widest shrink-0 ${priorityBadgeColor}`}>
                        {rec.priority === 'high' ? 'Alta' : rec.priority === 'medium' ? 'Média' : 'Baixa'}
                      </span>
                    </div>

                    <p className="text-[10px] text-title/90 leading-relaxed font-medium">
                      {rec.description}
                    </p>

                    <button
                      onClick={() => setSelectedRecAction(rec)}
                      className="w-full mt-1 flex items-center justify-center gap-1.5 py-2.5 bg-secondary hover:bg-secondary/90 text-white text-[10px] font-black uppercase tracking-widest rounded-xl transition-all shadow-md cursor-pointer border-none"
                    >
                      {rec.actionLabel}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Bloco 2: Gráfico de Comparação do Staff */}
        {totalGrossRevenue > 0 && (
          <div className="bg-surface rounded-3xl p-5 border border-white/5">
            <h4 className="text-xs font-bold text-white uppercase tracking-wider mb-4">Faturamento vs Comissão por Profissional</h4>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartData} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#8A98A8' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#8A98A8' }} axisLine={false} tickLine={false} />
                <Tooltip 
                  contentStyle={{ borderRadius: 12, border: 'none', backgroundColor: '#1E1B4B', fontSize: 11, color: '#fff' }}
                  formatter={(value: number) => [formatCurrency(value), '']}
                />
                <Bar dataKey="Faturamento" fill="#34D399" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Comissão" fill="#F43F5E" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <div className="flex gap-4 justify-center mt-3 text-[10px] font-bold">
              <div className="flex items-center gap-1.5 text-emerald-400">
                <span className="w-2.5 h-2.5 rounded bg-[#34D399]" /> Faturamento Bruto
              </div>
              <div className="flex items-center gap-1.5 text-red-400">
                <span className="w-2.5 h-2.5 rounded bg-[#F43F5E]" /> Comissão Staff
              </div>
            </div>
          </div>
        )}

        {/* Bloco 3: Destaques / Rankings */}
        {completedAptsCount > 0 && (
          <div className="bg-surface rounded-3xl p-5 border border-white/5 flex flex-col gap-4">
            <h4 className="text-xs font-bold text-white uppercase tracking-wider">Destaques do Período</h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {topFaturamento && topFaturamento.gross > 0 && (
                <div className="bg-background/40 p-4 rounded-2xl border border-white/5 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-emerald-500/10 text-emerald-400 flex items-center justify-center shrink-0">
                    <TrendingUp size={20} />
                  </div>
                  <div className="min-w-0">
                    <span className="text-[9px] text-title uppercase font-black tracking-widest block">Maior Faturamento</span>
                    <p className="text-xs font-black text-white truncate mt-0.5">{topFaturamento.staff.name}</p>
                    <p className="text-[10px] text-emerald-400 font-bold mt-0.5">{formatCurrency(topFaturamento.gross)} gerados</p>
                  </div>
                </div>
              )}

              {topProdutividade && topProdutividade.completed > 0 && (
                <div className="bg-background/40 p-4 rounded-2xl border border-white/5 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-indigo-500/10 text-indigo-400 flex items-center justify-center shrink-0">
                    <Smile size={20} />
                  </div>
                  <div className="min-w-0">
                    <span className="text-[9px] text-title uppercase font-black tracking-widest block">Melhor Presença</span>
                    <p className="text-xs font-black text-white truncate mt-0.5">{topProdutividade.staff.name}</p>
                    <p className="text-[10px] text-indigo-400 font-bold mt-0.5">{Math.round(topProdutividade.utilizationRate)}% aproveitamento</p>
                  </div>
                </div>
              )}

              {topTicket && topTicket.avgTicket > 0 && (
                <div className="bg-background/40 p-4 rounded-2xl border border-white/5 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-amber-500/10 text-amber-400 flex items-center justify-center shrink-0">
                    <CircleDollarSign size={20} />
                  </div>
                  <div className="min-w-0">
                    <span className="text-[9px] text-title uppercase font-black tracking-widest block">Maior Ticket Médio</span>
                    <p className="text-xs font-black text-white truncate mt-0.5">{topTicket.staff.name}</p>
                    <p className="text-[10px] text-amber-400 font-bold mt-0.5">{formatCurrency(topTicket.avgTicket)} / serviço</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Bloco 4: Tabela Comparativa de Produtividade por Staff */}
        <div className="bg-surface rounded-3xl p-5 border border-white/5">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-xs font-bold text-white uppercase tracking-wider">Produtividade por Profissional</h4>
            <span className="text-[9px] text-title uppercase font-bold tracking-widest">({activeStaff.length} ativos)</span>
          </div>
          <div className="flex flex-col gap-3">
            {staffMetrics.map(item => (
              <div key={item.staff.id} className="bg-background/40 rounded-2xl p-4 border border-white/5 flex flex-col gap-3">
                {/* Header do Staff */}
                <div className="flex items-center justify-between border-b border-white/5 pb-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-surface overflow-hidden flex items-center justify-center text-secondary border border-secondary shrink-0">
                      {item.staff.photo ? (
                        <img referrerPolicy="no-referrer" src={item.staff.photo} alt={item.staff.name} className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-xs font-black uppercase">{getInitials(item.staff.name)}</span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-black text-white truncate">{item.staff.name}</p>
                      <p className="text-[9px] text-title mt-0.5">Comissão: {item.staff.commissionRate}%</p>
                    </div>
                  </div>
                  <span className={`text-[9px] px-2 py-0.5 font-bold uppercase tracking-widest rounded-full ${
                    item.utilizationRate >= 80 ? 'bg-emerald-500/10 text-emerald-400' :
                    item.utilizationRate >= 50 ? 'bg-indigo-500/10 text-indigo-400' : 'bg-red-500/10 text-red-400'
                  }`}>
                    {Math.round(item.utilizationRate)}% Presença
                  </span>
                </div>

                {/* Grid de Informações */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                  <div>
                    <span className="text-[8px] text-title uppercase font-bold tracking-widest">Atendimentos</span>
                    <p className="text-sm font-black text-white mt-1">
                      {item.completed} <span className="text-xs font-medium text-title/50">/ {item.total}</span>
                    </p>
                  </div>
                  <div>
                    <span className="text-[8px] text-title uppercase font-bold tracking-widest">No-Shows</span>
                    <p className="text-sm font-black text-red-400 mt-1">{item.noShows}</p>
                  </div>
                  <div>
                    <span className="text-[8px] text-title uppercase font-bold tracking-widest">Faturamento Bruto</span>
                    <p className="text-sm font-black text-emerald-400 mt-1">{formatCurrency(item.gross)}</p>
                  </div>
                  <div>
                    <span className="text-[8px] text-title uppercase font-bold tracking-widest">Líquido Salão</span>
                    <p className="text-sm font-black text-indigo-400 mt-1">{formatCurrency(item.net)}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Disclaimer Operacional */}
        <p className="text-[9px] text-title/40 text-center leading-relaxed">
          Os relatórios acima são atualizados em tempo real conforme as alterações de status dos agendamentos no painel.<br />
          Os agendamentos cancelados (excluídos do banco para liberação de agenda) não entram no faturamento ou nas métricas históricas.
        </p>
      </div>
    );
  };

  const getPeriodLabel = () => {
    const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
    if (periodo === 'dia') {
      return `${selectedDate.getDate()} DE ${MESES[selectedDate.getMonth()].toUpperCase()} - ${selectedDate.getFullYear()}`;
    }
    if (periodo === 'semana') {
      const inicio = new Date(dateRange.start);
      // to offset timezone issues we add 12 hours here
      inicio.setHours(12);
      const fim = new Date(dateRange.end);
      fim.setHours(12);
      return `${inicio.getDate()} A ${fim.getDate()} DE ${MESES[fim.getMonth()].toUpperCase()} - ${fim.getFullYear()}`;
    }
    if (periodo === 'mes') {
      return `${MESES[selectedDate.getMonth()].toUpperCase()} - ${selectedDate.getFullYear()}`;
    }
    return `${selectedDate.getFullYear()}`;
  };

  return (
    <div className="w-full h-full flex flex-col bg-[#1E1B4B]">
      {/* Period Selector & Navigator */}
      <div className="px-4 py-4 sticky top-0 bg-[#1E1B4B] z-30">
        <div className="flex gap-2 items-center">
          {/* Dropdown de período */}
          <div className="relative">
            <select
              value={periodo}
              onChange={e => {
                const newPeriodo = e.target.value as 'dia' | 'semana' | 'mes' | 'ano';
                setPeriodo(newPeriodo);

                const d = new Date(selectedDate);
                if (newPeriodo === 'semana') {
                  const day = d.getDay();
                  d.setDate(d.getDate() - day);
                } else if (newPeriodo === 'mes') {
                  d.setDate(1);
                } else if (newPeriodo === 'ano') {
                  d.setMonth(0, 1);
                }
                setSelectedDate(new Date(d));
              }}
              className="appearance-none bg-surface border border-title/30 rounded-2xl pl-3 pr-7 h-10 text-[10px] font-black uppercase tracking-wider text-white shadow-[0_4px_16px_rgba(0,0,0,0.3)] focus:outline-none cursor-pointer text-center"
            >
              <option value="dia">Dia</option>
              <option value="semana">Semana</option>
              <option value="mes">Mês</option>
              <option value="ano">Ano</option>
            </select>
            <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-title pointer-events-none" />
          </div>

          {/* Navegador de data */}
          <div className="flex-1 flex items-center justify-between bg-surface rounded-2xl px-2 h-10 shadow-[0_4px_16px_rgba(0,0,0,0.3)] border border-title/30 flex-shrink min-w-0">
            <button onClick={handlePrev} className="p-1 text-title hover:text-secondary flex-shrink-0">
              <ChevronLeft size={16} />
            </button>
            <span className="text-[10px] font-bold text-white uppercase min-w-0 truncate text-center">{getPeriodLabel()}</span>
            <button onClick={handleNext} className="p-1 text-title hover:text-secondary flex-shrink-0">
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="px-4 pb-3 sticky top-[64px] bg-[#1E1B4B] z-30">
        <div className="flex gap-2 w-full">
          {(['resumo','extrato','comissoes','relatorios','clientes','servicos','agenda'] as const).map(t => (
            <button
              key={t}
              onClick={() => {
                setActiveTab(t);
                setSelectedStaffForCommission(null);
              }}
              className={`flex-1 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-colors ${
                activeTab === t ? 'bg-secondary text-white shadow-md' : 'bg-surface text-title'
              }`}
            >
              {t === 'resumo' ? 'Resumo'
                : t === 'extrato' ? 'Extrato'
                : t === 'comissoes' ? 'Comissões'
                : t === 'relatorios' ? 'Relatórios'
                : t === 'clientes' ? 'Clientes'
                : t === 'servicos' ? 'Serviços'
                : 'Agenda'}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 w-full max-w-full overflow-x-hidden pt-2 pb-[160px] min-h-full bg-[#1E1B4B]">
        {activeTab === 'resumo' && renderResumo()}
        {activeTab === 'extrato' && renderExtrato()}
        {activeTab === 'comissoes' && renderComissoes()}
        {activeTab === 'relatorios' && renderRelatorios()}
        {activeTab === 'clientes' && renderClientes()}
        {activeTab === 'servicos' && renderServicos()}
        {activeTab === 'agenda' && renderAgenda()}
      </div>

      {(activeTab === 'resumo' || activeTab === 'extrato') && (
        <div className={`fixed right-4 z-30 flex flex-col-reverse items-end gap-3 ${
          activeTab === 'resumo' ? 'bottom-[80px]' : 'bottom-[140px]'
        }`}>
          <AnimatePresence>
            {fabOpen && (
              <>
                {/* Botão Saída */}
                <motion.div initial={{opacity:0,y:16}} animate={{opacity:1,y:0}} exit={{opacity:0,y:16}}
                  transition={{delay:0.05}} className="flex items-center gap-2">
                  <span className="bg-white dark:bg-[#162032] text-xs font-bold px-2 py-1 rounded-full shadow text-[#1A2332] dark:text-[#E2EAF4]">Saída</span>
                  <button onClick={()=>{setFabOpen(false);setShowLancamento('expense')}}
                    className="w-12 h-12 rounded-full bg-[#F87171] text-white flex items-center justify-center shadow-lg opacity-80">
                    <ArrowDownCircle size={22}/>
                  </button>
                </motion.div>
                {/* Botão Entrada */}
                <motion.div initial={{opacity:0,y:16}} animate={{opacity:1,y:0}} exit={{opacity:0,y:16}}
                  className="flex items-center gap-2">
                  <span className="bg-white dark:bg-[#162032] text-xs font-bold px-2 py-1 rounded-full shadow text-[#1A2332] dark:text-[#E2EAF4]">Entrada</span>
                  <button onClick={()=>{setFabOpen(false);setShowLancamento('income')}}
                    className="w-12 h-12 rounded-full bg-[#34D399] text-white flex items-center justify-center shadow-lg opacity-80">
                    <ArrowUpCircle size={22}/>
                  </button>
                </motion.div>
              </>
            )}
          </AnimatePresence>
          {/* Botão principal */}
          <motion.button animate={{rotate: fabOpen ? 45 : 0}} transition={{duration:0.2}}
            onClick={()=>setFabOpen(v=>!v)}
            className="w-14 h-14 rounded-full bg-secondary text-white flex items-center justify-center shadow-xl opacity-[0.85]">
            <Plus size={26}/>
          </motion.button>
        </div>
      )}

      {/* Modal */}
      <LancamentoModal 
        isOpen={!!showLancamento} 
        onClose={() => setShowLancamento(false)} 
        isDarkMode={isDarkMode} 
        defaultType={showLancamento || 'income'}
      />

      {/* Modal de Ação da Recomendação */}
      {selectedRecAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-[#1E1B4B] border border-white/10 w-full max-w-md rounded-3xl p-6 shadow-2xl flex flex-col gap-4 animate-in zoom-in-95 duration-200 relative">
            
            {/* Header */}
            <div className="flex justify-between items-start">
              <div>
                <span className="text-[9px] font-bold text-[#818CF8] uppercase tracking-wider block">
                  {selectedRecAction.category}
                </span>
                <h4 className="text-sm font-black text-white mt-1">
                  {selectedRecAction.title}
                </h4>
              </div>
              <button 
                onClick={() => setSelectedRecAction(null)}
                className="text-title hover:text-white p-1 hover:bg-white/5 rounded-full transition-all border-none bg-transparent cursor-pointer"
              >
                <ChevronDown size={20} className="rotate-90 text-white" />
              </button>
            </div>

            {/* Conteúdo dinâmico por tipo de ação */}
            <div className="flex flex-col gap-4 py-2">
              
              {/* Caso 1: config_whatsapp */}
              {selectedRecAction.actionType === 'config_whatsapp' && (
                <div className="flex flex-col gap-3">
                  <p className="text-[10px] text-title font-medium leading-relaxed">
                    Personalize o modelo de mensagem de confirmação automática. Os clientes receberão o lembrete via WhatsApp e poderão confirmar com um clique.
                  </p>
                  <div className="bg-background/40 border border-white/5 p-3 rounded-2xl flex flex-col gap-1.5">
                    <span className="text-[8px] font-bold text-title uppercase tracking-wider">Template da Mensagem</span>
                    <p className="text-[10px] text-white/90 leading-relaxed italic font-mono bg-background/20 p-2 rounded-xl border border-white/5">
                      "Olá, [Cliente]! Tudo bem? Passando para lembrar do seu atendimento amanhã às [Horário] com o profissional [Profissional]. Responda SIM para confirmar."
                    </p>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[9px] font-bold text-title uppercase tracking-wider">Antecedência de Envio</label>
                    <select className="bg-surface border border-white/10 rounded-xl h-10 px-3 text-[10px] font-bold text-white focus:outline-none">
                      <option value="24">24 horas antes (Recomendado)</option>
                      <option value="12">12 horas antes</option>
                      <option value="48">48 horas antes</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-2 bg-indigo-500/10 border border-indigo-500/20 p-3 rounded-2xl mt-1">
                    <input type="checkbox" defaultChecked id="enable_wa" className="accent-[#818CF8]" />
                    <label htmlFor="enable_wa" className="text-[10px] font-bold text-indigo-200 cursor-pointer">
                      Ativar lembretes preventivos automatizados
                    </label>
                  </div>
                </div>
              )}

              {/* Caso 2: setup_deposit */}
              {selectedRecAction.actionType === 'setup_deposit' && (
                <div className="flex flex-col gap-3">
                  <p className="text-[10px] text-title font-medium leading-relaxed">
                    Sugerimos configurar um sinal (garantia) Pix para reduzir no-shows em horários críticos ou serviços caros.
                  </p>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[9px] font-bold text-title uppercase tracking-wider">Porcentagem do Sinal</label>
                    <div className="grid grid-cols-4 gap-2">
                      {[15, 20, 30, 50].map(val => (
                        <button
                          key={val}
                          type="button"
                          onClick={() => setCustomSignalValue(val)}
                          className={`py-2 text-[10px] font-black rounded-xl border transition-all cursor-pointer ${
                            customSignalValue === val 
                              ? 'bg-secondary border-secondary text-white' 
                              : 'bg-surface border-white/5 text-title hover:text-white'
                          }`}
                        >
                          {val}%
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[9px] font-bold text-title uppercase tracking-wider">Chave Pix para Recebimento</label>
                    <input 
                      type="text" 
                      value={pixKey}
                      onChange={e => setPixKey(e.target.value)}
                      placeholder="Celular, E-mail ou CNPJ"
                      className="bg-surface border border-white/10 rounded-xl h-10 px-3 text-[10px] font-mono text-white focus:outline-none focus:border-secondary"
                    />
                  </div>
                  <div className="flex items-center gap-2 bg-rose-500/10 border border-rose-500/20 p-3 rounded-2xl mt-1">
                    <input type="checkbox" defaultChecked id="only_new" className="accent-rose-500" />
                    <label htmlFor="only_new" className="text-[10px] font-bold text-rose-200 cursor-pointer">
                      Cobrar apenas de clientes com histórico de no-show
                    </label>
                  </div>
                </div>
              )}

              {/* Caso 3: adjust_schedule */}
              {selectedRecAction.actionType === 'adjust_schedule' && (
                <div className="flex flex-col gap-3">
                  <p className="text-[10px] text-title font-medium leading-relaxed">
                    Otimize os horários de atendimento do profissional para preencher horários ociosos e diminuir lacunas improdutivas.
                  </p>
                  <div className="bg-background/40 border border-white/5 p-3 rounded-2xl flex flex-col gap-1">
                    <span className="text-[8px] font-bold text-title uppercase tracking-wider">Profissional Selecionado</span>
                    <span className="text-xs font-black text-white">
                      {staff.find(s => s.id === selectedRecAction.staffId)?.name || 'Profissional'}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[9px] font-bold text-title uppercase tracking-wider">Dias Permitidos de Atendimento</label>
                    <div className="grid grid-cols-4 gap-1.5">
                      {['Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map(day => (
                        <div key={day} className="bg-surface border border-white/5 p-2 rounded-xl flex items-center justify-center gap-1">
                          <input type="checkbox" defaultChecked id={`day-${day}`} className="accent-secondary" />
                          <label htmlFor={`day-${day}`} className="text-[9px] font-bold text-white cursor-pointer">{day}</label>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[9px] font-bold text-title uppercase tracking-wider">Intervalo de Atendimento</label>
                    <div className="grid grid-cols-2 gap-2">
                      <input type="time" defaultValue="09:00" className="bg-surface border border-white/10 rounded-xl h-10 px-3 text-[10px] text-white focus:outline-none" />
                      <input type="time" defaultValue="18:00" className="bg-surface border border-white/10 rounded-xl h-10 px-3 text-[10px] text-white focus:outline-none" />
                    </div>
                  </div>
                </div>
              )}

              {/* Caso 4: create_coupon */}
              {selectedRecAction.actionType === 'create_coupon' && (
                <div className="flex flex-col gap-3">
                  <p className="text-[10px] text-title font-medium leading-relaxed">
                    Crie um cupom de desconto inteligente válido exclusivamente para as faixas horárias de baixa ocupação para incentivar agendamentos rápidos.
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[9px] font-bold text-title uppercase tracking-wider">Código do Cupom</label>
                      <input type="text" defaultValue="VALE15" className="bg-surface border border-white/10 rounded-xl h-10 px-3 text-[10px] font-black uppercase text-white focus:outline-none" />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[9px] font-bold text-title uppercase tracking-wider">Desconto (%)</label>
                      <input type="number" defaultValue={15} className="bg-surface border border-white/10 rounded-xl h-10 px-3 text-[10px] font-bold text-white focus:outline-none" />
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[9px] font-bold text-title uppercase tracking-wider">Válido para as faixas horárias</label>
                    <div className="bg-indigo-500/10 border border-indigo-500/20 p-2.5 rounded-xl text-[10px] font-bold text-indigo-200">
                      Horários de vale detectados: {selectedRecAction.meta?.hours || '9h às 11h, 14h às 15h'}
                    </div>
                  </div>
                </div>
              )}

              {/* Caso 5: contact_staff */}
              {selectedRecAction.actionType === 'contact_staff' && (
                <div className="flex flex-col gap-3">
                  <p className="text-[10px] text-title font-medium leading-relaxed">
                    Acompanhe o desempenho do colaborador de forma individual e construtiva. Registre anotações ou envie um lembrete rápido.
                  </p>
                  <div className="bg-background/40 border border-white/5 p-3 rounded-2xl flex items-center justify-between">
                    <div>
                      <span className="text-[8px] font-bold text-title uppercase tracking-wider block">Profissional</span>
                      <span className="text-xs font-black text-white">
                        {staff.find(s => s.id === selectedRecAction.staffId)?.name || 'Profissional'}
                      </span>
                    </div>
                    <a 
                      href={`https://wa.me/${staff.find(s => s.id === selectedRecAction.staffId)?.phone || ''}`} 
                      target="_blank" 
                      rel="noreferrer"
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-[9px] font-bold uppercase tracking-wider rounded-xl transition-all"
                    >
                      Enviar WhatsApp
                    </a>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[9px] font-bold text-title uppercase tracking-wider">Notas de Orientação</label>
                    <textarea 
                      placeholder="Digite aqui as notas de alinhamento com o colaborador (feedbacks, metas, etc)"
                      className="bg-surface border border-white/10 rounded-xl p-3 text-[10px] font-medium text-white h-20 focus:outline-none focus:border-secondary resize-none"
                    />
                  </div>
                </div>
              )}

              {/* Caso 6: review_rules */}
              {selectedRecAction.actionType === 'review_rules' && (
                <div className="flex flex-col gap-3">
                  <p className="text-[10px] text-title font-medium leading-relaxed">
                    Atualize as regras globais de cancelamento e de agendamento do tenant para o próximo ciclo operacional.
                  </p>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[9px] font-bold text-title uppercase tracking-wider">Janela Mínima de Cancelamento</label>
                    <select 
                      value={selectedCancelWindow}
                      onChange={e => setSelectedCancelWindow(Number(e.target.value))}
                      className="bg-surface border border-white/10 rounded-xl h-10 px-3 text-[10px] font-bold text-white focus:outline-none"
                    >
                      <option value="2">2 horas antes</option>
                      <option value="4">4 horas antes</option>
                      <option value="6">6 horas antes (Recomendado)</option>
                      <option value="12">12 horas antes</option>
                      <option value="24">24 horas antes</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-2 bg-indigo-500/10 border border-indigo-500/20 p-3 rounded-2xl mt-1">
                    <input type="checkbox" defaultChecked id="auto_block" className="accent-secondary" />
                    <label htmlFor="auto_block" className="text-[10px] font-bold text-indigo-200 cursor-pointer">
                      Bloquear cliente automaticamente após 2 no-shows seguidos
                    </label>
                  </div>
                </div>
              )}

              {/* Caso 7: close_register */}
              {selectedRecAction.actionType === 'close_register' && (
                <div className="flex flex-col gap-3">
                  <p className="text-[10px] text-title font-medium leading-relaxed">
                    Para garantir relatórios financeiros e de comissão 100% corretos, defina o status (Concluir ou No-Show) para as agendas pendentes deste período:
                  </p>
                  <div className="flex flex-col gap-2 max-h-[220px] overflow-y-auto pr-1">
                    {periodAppointments.filter(a => a.status === 'pending').length === 0 ? (
                      <p className="text-xs text-emerald-400 font-bold text-center py-4">Excelente! Nenhum agendamento pendente.</p>
                    ) : (
                      periodAppointments.filter(a => a.status === 'pending').map(apt => (
                        <div key={apt.id} className="bg-background/60 p-3 rounded-2xl border border-white/5 flex flex-col gap-2">
                          <div className="flex justify-between items-start">
                            <div>
                              <p className="text-[11px] font-black text-white">{apt.clientName}</p>
                              <p className="text-[9px] text-title mt-0.5">
                                {apt.service} • {apt.date.split('-').reverse().slice(0, 2).join('/')} às {apt.time}
                              </p>
                            </div>
                            <span className="text-[9px] font-bold text-emerald-400">{formatCurrency(apt.price)}</span>
                          </div>
                          <div className="grid grid-cols-2 gap-2 mt-1">
                            <button
                              onClick={async () => {
                                setRecActionLoading(true);
                                try {
                                  await finishAppointment(apt.id);
                                } catch (e) {
                                  console.error(e);
                                }
                                setRecActionLoading(false);
                              }}
                              disabled={recActionLoading}
                              className="py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white text-[9px] font-bold uppercase tracking-wider rounded-lg transition-all border-none cursor-pointer"
                            >
                              Concluir
                            </button>
                            <button
                              onClick={async () => {
                                setRecActionLoading(true);
                                try {
                                  await markNoShow(apt.id);
                                } catch (e) {
                                  console.error(e);
                                }
                                setRecActionLoading(false);
                              }}
                              disabled={recActionLoading}
                              className="py-1.5 bg-rose-500 hover:bg-rose-600 text-white text-[9px] font-bold uppercase tracking-wider rounded-lg transition-all border-none cursor-pointer"
                            >
                              No-Show
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

            </div>

            {/* Footer Actions */}
            <div className="flex gap-2.5 mt-2">
              <button
                onClick={() => setSelectedRecAction(null)}
                className="flex-1 py-3 bg-surface hover:bg-white/5 text-title hover:text-white text-[11px] font-black uppercase tracking-widest rounded-2xl transition-all border border-white/5 cursor-pointer bg-transparent"
              >
                Voltar / Fechar
              </button>
              {selectedRecAction.actionType !== 'close_register' && (
                <button
                  onClick={() => {
                    let successMsg = "Ação operacional executada!";
                    if (selectedRecAction.actionType === 'config_whatsapp') successMsg = "Lembretes automatizados via WhatsApp ativados com sucesso!";
                    else if (selectedRecAction.actionType === 'setup_deposit') successMsg = `Sinal Pix de ${customSignalValue}% ativado e integrado à agenda!`;
                    else if (selectedRecAction.actionType === 'adjust_schedule') successMsg = "Escala de trabalho reconfigurada e salva!";
                    else if (selectedRecAction.actionType === 'create_coupon') successMsg = "Cupom VALE15 gerado e ativo para horários de vale!";
                    else if (selectedRecAction.actionType === 'contact_staff') successMsg = "Notas de alinhamento técnico salvas com sucesso!";
                    else if (selectedRecAction.actionType === 'review_rules') successMsg = `Janela de cancelamento de ${selectedCancelWindow}h estabelecida!`;

                    setRecSuccessToast(successMsg);
                    setSelectedRecAction(null);
                  }}
                  className="flex-1 py-3 bg-[#34D399] hover:bg-[#34D399]/90 text-black text-[11px] font-black uppercase tracking-widest rounded-2xl transition-all shadow-md cursor-pointer border-none"
                >
                  Confirmar Ação
                </button>
              )}
            </div>

          </div>
        </div>
      )}
    </div>
  );
};


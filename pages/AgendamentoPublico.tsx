import React, { useState, useEffect, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { 
  Scissors, 
  ChevronLeft, 
  Check, 
  User, 
  Instagram,
  Loader2,
  CalendarDays,
  Clock,
  AlertTriangle,
  Smartphone,
  MessageSquare,
  MapPin,
  ArrowRight,
  X,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Pencil,
  Users
} from 'lucide-react';
import { formatCurrency, generateTimeSlots } from '../utils/helpers';

interface BarberProfile {
  id: string;
  name: string;
  shop_name: string | null;
  description: string | null;
  photo: string | null;
  logo: string | null;
  instagram: string | null;
  slug: string;
}

interface Service {
  id: string;
  name: string;
  price: number;
  duration: number;
  order_index: number;
  user_id: string;
}

interface WeeklySchedule {
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_open: boolean;
  user_id: string;
}

interface WeeklyBreak {
  id: string;
  day_of_week: number;
  time: string;
  user_id: string;
}

interface BlockedSlot {
  date: string;
  time: string;
  user_id: string;
}

interface ExistingAppointment {
  date: string;
  time: string;
  duration: number;
  status: string;
}

export default function AgendamentoPublico() {
  const { slug } = useParams();
  const [step, setStep] = useState(0); // 0=Loading, 1=Services, 2=Date, 3=Time, 4=Form, 5=Success, 6=Error
  const [profile, setProfile] = useState<BarberProfile | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [schedule, setSchedule] = useState<WeeklySchedule[]>([]);
  
  const [staff, setStaff] = useState<any[]>([]);
  const [selectedStaff, setSelectedStaff] = useState<any | null>(null);
  const [staffAvailabilities, setStaffAvailabilities] = useState<any[]>([]);
  
  const [selectedServices, setSelectedServices] = useState<Service[]>([]);
  const [servicesExpanded, setServicesExpanded] = useState(false);
  const [servicesSheetOpen, setServicesSheetOpen] = useState(false);
  
  useEffect(() => {
    setServicesExpanded(false);
  }, [selectedServices]);

  const [selectedDate, setSelectedDate] = useState<string>(''); // YYYY-MM-DD
  const [availableSlots, setAvailableSlots] = useState<string[]>([]);
  const [selectedTime, setSelectedTime] = useState<string>(''); // HH:MM
  
  const [weekOffset, setWeekOffset] = useState(0);
  const [activeShift, setActiveShift] = useState('manha');
  const [showAllTimes, setShowAllTimes] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [showCalendarModal, setShowCalendarModal] = useState(false);
  const [modalYearMonth, setModalYearMonth] = useState({ year: new Date().getFullYear(), month: new Date().getMonth() });
  const [fullDays, setFullDays] = useState<Set<string>>(new Set());
  const touchStartX = React.useRef<number>(0);
  const MAX_WEEK_OFFSET = 4;
  
  const [clientName, setClientName] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [observation, setObservation] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const [dateLoading, setDateLoading] = useState(false);

  // Masks
  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let value = e.target.value.replace(/\D/g, '');
    if (value.length > 11) value = value.slice(0, 11);
    if (value.length > 2) value = `(${value.slice(0, 2)}) ${value.slice(2)}`;
    if (value.length > 10) value = `${value.slice(0, 10)}-${value.slice(10)}`;
    setClientPhone(value);
  };

  useEffect(() => {
    async function loadData() {
      console.group('[AGENDAMENTO PUBLICO] loadData iniciado');
      console.log('[AGENDAMENTO PUBLICO] slug recebido:', slug);

      if (!slug) {
        console.warn('[AGENDAMENTO PUBLICO] ⚠️ slug está undefined/null');
        setStep(6);
        console.groupEnd();
        return;
      }
      try {
        const { data: prof, error: profErr } = await supabase
          .from('profiles')
          .select('id, name, shop_name, description, photo, logo, instagram, slug')
          .eq('slug', slug)
          .single();
          
        console.log('[AGENDAMENTO PUBLICO] profile encontrado:', prof);
        console.log('[AGENDAMENTO PUBLICO] erro no profile:', profErr);

        if (profErr || !prof) throw new Error('Barbeiro não encontrado');
        setProfile(prof);

        const { data: serv, error: servErr } = await supabase
          .from('services')
          .select('*')
          .eq('user_id', prof.id)
          .order('order_index');
        
        console.log('[AGENDAMENTO PUBLICO] prof.id usado para buscar serviços:', prof.id);
        console.log('[AGENDAMENTO PUBLICO] serviços retornados:', serv);
        console.log('[AGENDAMENTO PUBLICO] quantidade de serviços:', serv?.length ?? 0);
        console.log('[AGENDAMENTO PUBLICO] erro nos serviços:', servErr);

        if (!servErr && serv) {
          if (serv.length === 0) {
            console.warn('[AGENDAMENTO PUBLICO] ⚠️ NENHUM SERVIÇO encontrado para user_id:', prof.id);
            console.warn('[AGENDAMENTO PUBLICO] Verifique se os serviços foram salvos com este user_id no banco');
          }
          setServices(serv);
          if (serv.length === 1) {
            setSelectedServices([serv[0]]);
          }
        }

        const { data: sched, error: schedErr } = await supabase
          .from('weekly_schedule')
          .select('*')
          .eq('user_id', prof.id);
        
        if (!schedErr && sched) {
          console.group('[DEBUG-AGENDA] Momento 2 - Inicialização AgendamentoPublico');
          console.log('[DEBUG-AGENDA] Schedule carregado do DB:', sched);
          console.groupEnd();
          setSchedule(sched);
        }

        // Fetch active staff members for this tenant
        const { data: dbStaff, error: staffErr } = await supabase
          .from('staff')
          .select('*')
          .eq('tenant_id', prof.id)
          .eq('status', 'active');

        if (!staffErr && dbStaff && dbStaff.length > 0) {
          const mappedStaff = dbStaff.map((s: any) => ({
            id: s.id,
            tenantId: s.tenant_id,
            userId: s.user_id,
            name: s.name,
            phone: s.phone,
            photo: s.photo,
            status: s.status,
            commissionRate: s.commission_rate
          }));
          setStaff(mappedStaff);

          // Fetch staff availabilities
          try {
            const { data: dbAvail, error: availErr } = await supabase
              .from('staff_availability')
              .select('*')
              .in('staff_id', mappedStaff.map(s => s.id));
            if (!availErr && dbAvail) {
              setStaffAvailabilities(dbAvail);
            } else {
              setStaffAvailabilities([]);
            }
          } catch (availEx) {
            console.warn('[AGENDAMENTO PUBLICO] Tabela staff_availability pode nao existir ou nao estar acessivel. Usando fallback de agenda global.', availEx);
            setStaffAvailabilities([]);
          }
        } else {
          setStaff([]);
          setStaffAvailabilities([]);
        }

        setStep(1);
      } catch (err) {
        console.error('[AGENDAMENTO PUBLICO] ❌ Erro fatal:', err);
        setStep(6);
      } finally {
        console.groupEnd();
      }
    }
    loadData();
  }, [slug]);

  // Load available times for a selected date
  useEffect(() => {
    if (!selectedDate || !profile || selectedServices.length === 0) return;
    
    async function loadSlots() {
      setDateLoading(true);
      try {
        const dateObj = new Date(selectedDate + 'T00:00:00'); // Force local time visually
        const dayOfWeek = dateObj.getDay();
        
        const dayConfig = schedule.find(s => s.day_of_week === dayOfWeek);
        if (!dayConfig || !dayConfig.is_open) {
          setAvailableSlots([]);
          setDateLoading(false);
          return;
        }

        const { data: existingApts } = await supabase
          .from('appointments')
          .select('time, duration, status, staff_id')
          .eq('date', selectedDate)
          .or(`user_id.eq.${profile.id},tenant_id.eq.${profile.id}`)
          .not('status', 'in', '("cancelled","no-show")');

        const existingInfo = existingApts || [];

        const [breaksRes, blockedRes] = await Promise.all([
          supabase.from('weekly_breaks').select('time').eq('user_id', profile.id).eq('day_of_week', dayOfWeek),
          supabase.from('blocked_slots').select('time').eq('user_id', profile.id).eq('date', selectedDate)
        ]);

        const tenantBreaks = breaksRes.data?.map(b => b.time.substring(0, 5)) || [];
        const tenantBlocked = blockedRes.data?.map(b => b.time.substring(0, 5)) || [];
        const evaluableStaff = staff.length > 0 ? staff : [{
          id: profile.id,
          name: profile.shopName || profile.name || 'Barbeiro'
        }];

        const allSlots = generateTimeSlots(dayConfig.start_time, dayConfig.end_time);
        const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
        const endDayMin = toMin(dayConfig.end_time.substring(0, 5));
        const totalDuration = selectedServices.reduce((sum, s) => sum + s.duration, 0);

        const available = allSlots.filter(slot => {
          const slotMin = toMin(slot);
          const slotEndMin = slotMin + totalDuration;

          if (slotEndMin > endDayMin) return false;
          if (tenantBlocked.includes(slot)) return false;

          if (selectedStaff) {
            return isStaffFree(selectedStaff.id, slot, slotMin, slotEndMin);
          } else {
            return evaluableStaff.some(s => isStaffFree(s.id, slot, slotMin, slotEndMin));
          }
        });

        function isStaffFree(staffId: string, slot: string, slotMin: number, slotEndMin: number): boolean {
          const individualAvail = staffAvailabilities.find(a => a.staff_id === staffId && a.day_of_week === dayOfWeek);

          if (individualAvail) {
            if (!individualAvail.is_open) return false;
            const staffStartMin = toMin(individualAvail.start_time.substring(0, 5));
            const staffEndMin = toMin(individualAvail.end_time.substring(0, 5));
            if (slotMin < staffStartMin || slotEndMin > staffEndMin) return false;

            const staffBreaks = (individualAvail.breaks || []).map((b: string) => b.substring(0, 5));
            if (staffBreaks.includes(slot)) return false;
          } else {
            if (tenantBreaks.includes(slot)) return false;
          }

          const conflict = existingInfo.some(apt => {
            const aptStaffId = apt.staff_id || profile.id;
            const targetStaffId = staffId || profile.id;
            if (aptStaffId !== targetStaffId) return false;

            const aptMin = toMin(apt.time.substring(0, 5));
            const aptEndMin = aptMin + (apt.duration || 30);
            return slotMin < aptEndMin && slotEndMin > aptMin;
          });

          return !conflict;
        }

        const now = new Date();
        const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        const currentMin = now.getHours() * 60 + now.getMinutes();

        const finalAvailable = available.filter(s => {
          if (selectedDate === todayStr) {
            if (toMin(s) <= currentMin) return false;
          }
          return true;
        });

        setAvailableSlots(finalAvailable);

        if (finalAvailable.length === 0) {
          setFullDays(prev => {
            const next = new Set(prev);
            next.add(selectedDate);
            return next;
          });
        } else {
          setFullDays(prev => {
            const next = new Set(prev);
            next.delete(selectedDate);
            return next;
          });
        }
        
        if (finalAvailable.length > 0) {
          const TURNOS_LOCAL: Record<string, {inicio: number, fim: number}> = {
            manha: { inicio: 6, fim: 12 },
            tarde: { inicio: 12, fim: 18 },
            noite: { inicio: 18, fim: 24 }
          };
          const counts: Record<string, number> = { manha: 0, tarde: 0, noite: 0 };
          finalAvailable.forEach(t => {
            const h = parseInt(t.split(':')[0], 10);
            if (h >= TURNOS_LOCAL.manha.inicio && h < TURNOS_LOCAL.manha.fim) counts.manha++;
            if (h >= TURNOS_LOCAL.tarde.inicio && h < TURNOS_LOCAL.tarde.fim) counts.tarde++;
            if (h >= TURNOS_LOCAL.noite.inicio && h < TURNOS_LOCAL.noite.fim) counts.noite++;
          });
          
          let bestShift = 'manha';
          let maxCount = -1;
          Object.entries(counts).forEach(([shift, count]) => {
            if (count > maxCount) {
              maxCount = count;
              bestShift = shift;
            }
          });
          
          if (selectedDate === todayStr && now.getHours() >= 12 && counts.tarde > 0) setActiveShift('tarde');
          else if (selectedDate === todayStr && now.getHours() >= 18 && counts.noite > 0) setActiveShift('noite');
          else if (maxCount > 0) setActiveShift(bestShift);
        }
      } catch (err) {
        console.error('[loadSlots] Erro ao carregar slots de horario:', err);
      } finally {
        setDateLoading(false);
      }
    }
    
    loadSlots();
  }, [selectedDate, schedule, profile, selectedServices, selectedStaff, staff, staffAvailabilities]);


  const submitAppointment = async (e: React.FormEvent) => {
    e.preventDefault();
    const phoneObj = clientPhone.replace(/\D/g, '');
    const cleanName = clientName.trim();
    
    if (cleanName.split(' ').length < 2) {
       setErrorMessage('Por favor, insira nome e sobrenome.');
       return;
    }
    if (phoneObj.length < 10) {
       setErrorMessage('Por favor, insira um WhatsApp válido.');
       return;
    }
    
    setIsSubmitting(true);
    setErrorMessage('');
    
    try {
      const totalDuration = selectedServices.reduce((sum, s) => sum + s.duration, 0);
      const totalPrice = selectedServices.reduce((sum, s) => sum + s.price, 0);
      const serviceNames = selectedServices.map(s => s.name).join(' + ');

      let finalStaffId: string = selectedStaff?.id || profile!.id;

      // Se escolheu "Qualquer um" (!selectedStaff) e há profissionais cadastrados na equipe
      if (!selectedStaff && staff.length > 0) {
        const dateObj = new Date(selectedDate + 'T00:00:00');
        const dayOfWeek = dateObj.getDay();

        // Consultar novamente os agendamentos ocupados no dia e hora para evitar conflito de última hora
        const { data: currentDayApts } = await supabase
          .from('appointments')
          .select('time, duration, staff_id')
          .eq('date', selectedDate)
          .or(`user_id.eq.${profile!.id},tenant_id.eq.${profile!.id}`)
          .not('status', 'in', '("cancelled","no-show")');

        const dayApts = currentDayApts || [];

        // Consultar pausas e bloqueados do tenant
        const [breaksRes, blockedRes] = await Promise.all([
          supabase.from('weekly_breaks').select('time').eq('user_id', profile!.id).eq('day_of_week', dayOfWeek),
          supabase.from('blocked_slots').select('time').eq('user_id', profile!.id).eq('date', selectedDate)
        ]);

        const tenantBreaks = breaksRes.data?.map(b => b.time.substring(0, 5)) || [];
        const tenantBlocked = blockedRes.data?.map(b => b.time.substring(0, 5)) || [];

        const toMin = (t: string) => { 
          const [h, m] = t.split(':').map(Number); 
          return h * 60 + m; 
        };
        const slotMin = toMin(selectedTime);
        const slotEndMin = slotMin + totalDuration;

        const checkStaffFree = (staffId: string): boolean => {
          if (tenantBlocked.includes(selectedTime)) return false;

          const individualAvail = staffAvailabilities.find(a => a.staff_id === staffId && a.day_of_week === dayOfWeek);
          if (individualAvail) {
            if (!individualAvail.is_open) return false;
            const staffStartMin = toMin(individualAvail.start_time.substring(0, 5));
            const staffEndMin = toMin(individualAvail.end_time.substring(0, 5));
            if (slotMin < staffStartMin || slotEndMin > staffEndMin) return false;

            const staffBreaks = (individualAvail.breaks || []).map((b: string) => b.substring(0, 5));
            if (staffBreaks.includes(selectedTime)) return false;
          } else {
            if (tenantBreaks.includes(selectedTime)) return false;
          }

          const conflict = dayApts.some(apt => {
            const aptStaffId = apt.staff_id || profile!.id;
            const targetStaffId = staffId || profile!.id;
            if (aptStaffId !== targetStaffId) return false;

            const aptMin = toMin(apt.time.substring(0, 5));
            const aptEndMin = aptMin + (apt.duration || 30);
            return slotMin < aptEndMin && slotEndMin > aptMin;
          });

          return !conflict;
        };

        const freeStaff = staff.find(s => checkStaffFree(s.id));
        if (freeStaff) {
          finalStaffId = freeStaff.id;
        } else {
          finalStaffId = staff[0].id;
        }
      }

      const { error } = await supabase.from('appointments').insert({
        user_id: profile!.id,
        tenant_id: profile!.id,
        staff_id: finalStaffId,
        client_name: cleanName,
        phone: phoneObj,
        service: serviceNames,
        price: totalPrice,
        duration: totalDuration,
        date: selectedDate,
        time: selectedTime + ':00',
        status: 'pending',
        observation: observation.trim() || null,
        is_exceptional: false,
      });

      if (error) {
        if (error.code === '23505' || error.message.includes('unique') || error.message.includes('overlapping')) {
          setErrorMessage('Este horário acabou de ser ocupado. Escolha outro.');
          setStep(1);
        } else {
          setErrorMessage('Erro ao agendar, tente novamente.');
        }
      } else {
        supabase
          .from('notifications')
          .insert({
            user_id: profile!.id,
            type: 'new_appointment',
            title: '📅 Novo agendamento!',
            body: `${cleanName} agendou ${serviceNames} às ${selectedTime}`,
            data: {
              client_name: cleanName,
              service: serviceNames,
              date: selectedDate,
              time: selectedTime,
            },
            read: false,
          })
          .then(() => {})
          .catch(console.error);
        
        setStep(5);
      }
    } catch (err) {
      console.error(err);
      setErrorMessage('Erro ao agendar, tente novamente.');
    } finally {
      setIsSubmitting(false);
    }
  };


  // Helpers mapping
  if (step === 0) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-secondary" />
      </div>
    );
  }

  if (step === 6 || !profile) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 text-center">
        <div className="w-16 h-16 bg-surface rounded-full flex items-center justify-center mb-4 border border-white/8">
          <AlertTriangle className="w-8 h-8 text-title" />
        </div>
        <h1 className="text-xl font-black text-white mb-2">Link inválido</h1>
        <p className="text-title">Este barbeiro não foi encontrado ou o link expirou.</p>
      </div>
    );
  }

  const renderHeader = (showBackButton = false, compact = false, onBack?: () => void) => (
    <div className={`flex items-center gap-4 ${compact ? 'pb-3 mb-3' : 'pb-6 mb-6'} border-b border-white/[0.08]`}>
      {showBackButton && (
        <button onClick={onBack || (() => setStep(step - 1))} className="w-10 h-10 rounded-full bg-surface shrink-0 flex items-center justify-center hover:bg-white/5 transition-colors shadow-[0_2px_8px_rgba(0,0,0,0.3)] border border-white/8">
          <ChevronLeft className="text-white" />
        </button>
      )}
      <div className="flex items-center gap-3 w-full">
        <div className={`${compact ? 'w-11 h-11' : 'w-[52px] h-[52px]'} rounded-full bg-surface shrink-0 flex items-center justify-center text-secondary border-[1.5px] border-secondary overflow-hidden p-[2px]`}>
          <div className="w-full h-full rounded-full overflow-hidden">
            {profile.logo || profile.photo ? (
              <img src={profile.logo || profile.photo!} alt={profile.name} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-surface"><User size={24} /></div>
            )}
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <h1 className={`${compact ? 'text-lg' : 'text-xl'} font-black text-white truncate`}>{profile.shop_name || profile.name}</h1>
          <p className="text-sm text-secondary font-bold truncate">{profile.description || profile.name}</p>
        </div>
      </div>
    </div>
  );

  return (
    <div className={`bg-background w-full ${step === 1 || step === 4 ? 'h-[100dvh] flex flex-col overflow-hidden' : 'min-h-screen'}`}>
      <div className={`max-w-[480px] mx-auto w-full ${step === 1 || step === 4 ? 'flex-1 flex flex-col h-full overflow-hidden' : 'px-4 py-6 pb-20'}`}>
        
        {step === 1 && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-300 flex flex-col h-full">
            <div className="pt-3 px-4 shrink-0">
              {renderHeader(false, true)}
            </div>
            
            <div className="flex-1 overflow-y-auto pb-4 scrollbar-hide">
              {profile.instagram && (
                <a href={`https://instagram.com/${profile.instagram.replace('@', '')}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-secondary font-bold mb-6 hover:underline px-4">
                  <Instagram size={16} /> {profile.instagram}
                </a>
              )}

              {/* Profissional Picker */}
              {staff.length > 1 && (
                <div className="px-4 mb-6">
                  <label className="text-xs font-bold text-title uppercase tracking-widest block mb-3">
                    Escolha o Profissional
                  </label>
                  <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
                    <button
                      type="button"
                      onClick={() => setSelectedStaff(null)}
                      className={`flex items-center gap-3 p-3 rounded-2xl shrink-0 border transition-all text-left min-w-[140px] ${
                        !selectedStaff
                          ? 'bg-secondary/10 border-secondary text-white'
                          : 'bg-surface border-white/8 text-title hover:border-white/20'
                      }`}
                    >
                      <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-white shrink-0">
                        <Users size={18} />
                      </div>
                      <div>
                        <p className="text-xs font-black">Qualquer um</p>
                        <p className="text-[10px] text-title">Mais rápido</p>
                      </div>
                    </button>

                    {staff.map((s: any) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => setSelectedStaff(s)}
                        className={`flex items-center gap-3 p-3 rounded-2xl shrink-0 border transition-all text-left min-w-[140px] ${
                          selectedStaff?.id === s.id
                            ? 'bg-secondary/10 border-secondary text-white'
                            : 'bg-surface border-white/8 text-title hover:border-white/20'
                        }`}
                      >
                        <div className="w-10 h-10 rounded-full bg-surface shrink-0 flex items-center justify-center text-secondary border border-secondary overflow-hidden">
                          {s.photo ? (
                            <img src={s.photo} alt={s.name} className="w-full h-full object-cover animate-fade-in" />
                          ) : (
                            <User size={16} />
                          )}
                        </div>
                        <div>
                          <p className="text-xs font-black truncate max-w-[80px]">{s.name}</p>
                          <p className="text-[10px] text-secondary font-bold">Disponível</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="px-4 mb-2">
                {/* Estado vazio — nenhum serviço selecionado */}
                {selectedServices.length === 0 && (
                  <button
                    onClick={() => setServicesSheetOpen(true)}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl font-semibold text-sm bg-secondary text-white transition-all hover:bg-secondary/90 active:scale-[0.98]"
                  >
                    <Scissors className="w-4 h-4" />
                    <span>Escolha um ou mais serviços</span>
                  </button>
                )}

                {/* Estado preenchido — serviços selecionados */}
                {selectedServices.length > 0 && (
                  <button
                    onClick={() => setServicesSheetOpen(true)}
                    className="w-full flex items-center justify-between px-4 py-3.5 rounded-xl border border-secondary/40 bg-secondary/10 transition-all hover:bg-secondary/15"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Scissors className="w-4 h-4 text-secondary shrink-0" />
                      <span className="text-sm font-medium text-white truncate">
                        {selectedServices.length === 1
                          ? selectedServices[0].name
                          : selectedServices.map(s => s.name).join(' + ')}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-sm font-semibold text-secondary">
                        {formatCurrency(selectedServices.reduce((sum, s) => sum + s.price, 0))}
                      </span>
                      <Pencil className="w-3.5 h-3.5 text-white/40" />
                    </div>
                  </button>
                )}
              </div>

              <div className={`transition-all duration-300 ease-in-out origin-top ${selectedServices.length > 0 ? 'opacity-100 scale-y-100 h-auto mt-4' : 'opacity-0 scale-y-0 h-0 overflow-hidden'}`}>
                <div className="px-4">
                  <div className="flex items-center gap-2 mb-3">
                    <CalendarDays className="w-3.5 h-3.5 text-white/40" />
                    <span className="text-xs font-semibold tracking-widest text-white/40 uppercase">
                      Escolha uma data
                    </span>
                  </div>
                </div>
                <div className="flex items-center justify-between mb-2 px-4">
                  <button 
                    onClick={() => setWeekOffset(prev => Math.max(0, prev - 1))}
                    disabled={weekOffset === 0}
                    className={`w-10 h-10 flex items-center justify-center rounded-full transition-all ${weekOffset === 0 ? 'opacity-30 pointer-events-none' : 'text-white/60 hover:bg-white/10 active:scale-95'}`}
                  >
                    <ChevronLeft size={20} />
                  </button>
                  <div className="flex flex-col items-center justify-center">
                    {(() => {
                      const today = new Date();
                      today.setHours(0, 0, 0, 0);
                      
                      const start = new Date(today);
                      start.setDate(today.getDate() + weekOffset * 7);
                      
                      const centralDay = new Date(start);
                      centralDay.setDate(start.getDate() + 3); // Middle of the 7-day period
                      
                      const monthStr = centralDay.toLocaleDateString('pt-BR', { month: 'long' });
                      return (
                        <button 
                          onClick={() => setShowCalendarModal(true)}
                          className="flex items-center gap-1 text-white/70 hover:text-white transition-colors active:scale-95"
                        >
                          <span className="font-semibold text-sm">
                            {monthStr.charAt(0).toUpperCase() + monthStr.slice(1)} de {centralDay.getFullYear()}
                          </span>
                          <ChevronLeft className="-rotate-90 opacity-50" size={14} />
                        </button>
                      );
                    })()}
                  </div>
                  <button 
                    onClick={() => setWeekOffset(prev => Math.min(MAX_WEEK_OFFSET, prev + 1))}
                    disabled={weekOffset >= MAX_WEEK_OFFSET}
                    className={`w-10 h-10 flex items-center justify-center rounded-full transition-all ${weekOffset >= MAX_WEEK_OFFSET ? 'opacity-30 pointer-events-none' : 'text-white/60 hover:bg-white/10 active:scale-95'}`}
                  >
                    <ChevronLeft className="rotate-180" size={20} />
                  </button>
                </div>

                <div 
                  className="overflow-hidden px-4 mb-2"
                  onTouchStart={(e) => { touchStartX.current = e.touches[0].clientX; }}
                  onTouchEnd={(e) => {
                    const diff = touchStartX.current - e.changedTouches[0].clientX;
                    if (Math.abs(diff) < 50) return;
                    if (diff > 0 && weekOffset < MAX_WEEK_OFFSET) {
                      setWeekOffset(prev => prev + 1);
                    } else if (diff < 0 && weekOffset > 0) {
                      setWeekOffset(prev => prev - 1);
                    }
                  }}
                >
                  <div key={weekOffset} className="flex gap-1.5 animate-in slide-in-from-right-4 duration-200 ease-in-out">
                    {(() => {
                      const dates = [];
                      const today = new Date();
                      today.setHours(0, 0, 0, 0);
                      
                      const start = new Date(today);
                      start.setDate(today.getDate() + weekOffset * 7);

                      for (let i = 0; i < 7; i++) {
                        const d = new Date(start);
                        d.setDate(start.getDate() + i);
                        
                        const isToday = d.getTime() === today.getTime();
                        
                        const tomorrow = new Date(today);
                        tomorrow.setDate(today.getDate() + 1);
                        const isTomorrow = d.getTime() === tomorrow.getTime();
                        
                        const isPast = d.getTime() < today.getTime();
                        const dow = d.getDay();
                        const dayEntry = schedule.find(sch => sch.day_of_week === dow);
                        const isOpen = dayEntry?.is_open;
                        const isDisabled = isPast || !isOpen;

                        console.log(`[DEBUG-AGENDA] Render Dia ${dow}`);
                        console.log(`  Entrada no schedule? ${!!dayEntry}`);
                        console.log(`  Valor is_open: ${isOpen} (Tipo: ${typeof isOpen})`);
                        console.log(`  is_open é undefined? ${isOpen === undefined}`);
                        console.log(`  Comparações => !isOpen: ${!isOpen} | isOpen !== true: ${isOpen !== true}`);
                        console.log(`  isDisabled final: ${isDisabled}`);
                        
                        dates.push({ d, isToday, isTomorrow, isPast, isOpen, dow, i });
                      }

                      return dates.map(({ d, isToday, isTomorrow, isPast, isOpen, dow, i }) => {
                        const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
                        
                        let w = ["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SÁB"][dow];
                        if (isToday) w = "HOJE";
                        else if (isTomorrow) w = "AMANHÃ";
                        
                        const isDisabled = isPast || !isOpen;
                        const isFull = fullDays.has(dateStr);
                        
                        // Check if month changes in this specific week, or just always show except for today/tomorrow
                        const monthStr = (!isToday && !isTomorrow) 
                          ? d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '').toUpperCase() 
                          : null;

                        return (
                          <button
                            key={i}
                            disabled={isDisabled}
                            onClick={() => { setSelectedDate(dateStr); setSelectedTime(''); setShowTimePicker(false); }}
                            className={`flex-1 h-[68px] rounded-xl flex flex-col items-center justify-center gap-0.5 transition-all shrink-0 relative
                              ${isDisabled ? 'opacity-25 pointer-events-none bg-transparent' : 
                                isFull ? 'opacity-40' :
                                selectedDate === dateStr ? 'bg-secondary shadow-[0_0_12px_rgba(249,148,23,0.4)]' : 
                                'bg-transparent border border-white/10 active:scale-95'}`}
                          >
                            {isFull && !isDisabled && <X size={10} className="absolute top-1 right-1 opacity-40" />}
                            <span className={`${w === 'AMANHÃ' ? 'text-[8px]' : 'text-[9px]'} uppercase font-medium ${selectedDate === dateStr && !isDisabled ? 'text-white' : 'text-white/50'}`}>
                              {w}
                            </span>
                            <span className={`text-lg font-bold ${selectedDate === dateStr && !isDisabled ? 'text-white' : 'text-white'}`}>
                              {d.getDate()}
                            </span>
                            {monthStr && (
                              <span className={`text-[8px] uppercase font-medium ${selectedDate === dateStr && !isDisabled ? 'text-white' : 'text-white/40'}`}>
                                {monthStr}
                              </span>
                            )}
                            {isToday && selectedDate !== dateStr && (
                              <span className="w-1 h-1 rounded-full bg-secondary absolute bottom-1.5" />
                            )}
                          </button>
                        );
                      });
                    })()}
                  </div>
                </div>
              </div>

              {selectedServices.length > 0 && selectedDate && (
                <div className="px-4 mt-4 animate-in fade-in duration-200">
                  {!selectedTime ? (
                    <button
                      onClick={() => setShowTimePicker(true)}
                      className={`w-full h-12 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 transition-all active:scale-95 bg-secondary/15 border border-secondary/30 text-secondary`}
                    >
                      <Clock size={16} />
                      {dateLoading
                        ? 'Carregando horários...'
                        : `Ver horários disponíveis ${availableSlots.length > 0 ? `(${availableSlots.length})` : ''}`
                      }
                      {dateLoading && <Loader2 size={14} className="animate-spin ml-1" />}
                    </button>
                  ) : (
                    <div className="animate-in zoom-in-95 fade-in duration-300">
                      <div className="bg-gradient-to-br from-white/10 to-white/[0.03] rounded-2xl border border-white/20 overflow-hidden shadow-[0_8px_32px_rgba(0,0,0,0.25)]">
                        <div className="flex items-center justify-between px-4 py-3 border-b border-white/12">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full overflow-hidden bg-white/10 shrink-0">
                              {profile?.logo || profile?.photo ? (
                                <img
                                  src={profile.logo || profile.photo!}
                                  alt={profile.name}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center">
                                  <User size={12} className="text-white/50" />
                                </div>
                              )}
                            </div>
                            <span className="text-white/80 text-xs font-semibold truncate">
                              {profile?.shop_name || profile?.name}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 bg-secondary/20 rounded-full px-2.5 py-1">
                            <Check size={11} className="text-secondary" />
                            <span className="text-secondary text-[11px] font-black uppercase tracking-wide">
                              Selecionado
                            </span>
                          </div>
                        </div>

                        <div className="px-4 py-3 space-y-2.5">
                          {selectedServices.length === 1 ? (
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <Scissors className="w-3.5 h-3.5 text-secondary" />
                                <span className="text-sm font-semibold text-white">
                                  {selectedServices[0].name}
                                </span>
                              </div>
                              <span className="text-sm font-semibold text-secondary">
                                {formatCurrency(selectedServices[0].price)}
                              </span>
                            </div>
                          ) : (
                            <>
                              <button
                                onClick={() => setServicesExpanded(prev => !prev)}
                                className="flex items-center justify-between w-full"
                              >
                                <div className="flex items-center gap-2">
                                  <Scissors className="w-3.5 h-3.5 text-secondary" />
                                  <span className="text-sm font-semibold text-white">
                                    {selectedServices.length} serviços
                                  </span>
                                  <ChevronDown
                                    className={`w-3.5 h-3.5 text-white/40 transition-transform duration-200 ${servicesExpanded ? 'rotate-180' : ''}`}
                                  />
                                </div>
                                <span className="text-sm font-semibold text-secondary">
                                  {formatCurrency(selectedServices.reduce((sum, s) => sum + s.price, 0))}
                                </span>
                              </button>
                              
                              {servicesExpanded && (
                                <div className="mt-2 space-y-1.5 pl-5 border-l border-white/10">
                                  {selectedServices.map(service => (
                                    <div key={service.id} className="flex items-center justify-between">
                                      <span className="text-xs text-white/60">{service.name}</span>
                                      <span className="text-xs text-white/60">
                                        {formatCurrency(service.price)}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </>
                          )}

                          <div className="flex items-center gap-2 mt-3 pt-3 border-t border-white/5">
                            <CalendarDays size={14} className="text-white/50 shrink-0" />
                            <span className="text-white/80 text-sm font-medium">
                              {(() => {
                                const [y, m, d] = selectedDate.split('-').map(Number);
                                const date = new Date(y, m - 1, d);
                                const dow = ['Domingo','Segunda','Terça','Quarta',
                                             'Quinta','Sexta','Sábado'][date.getDay()];
                                const month = ['Jan','Fev','Mar','Abr','Mai','Jun',
                                               'Jul','Ago','Set','Out','Nov','Dez'][m - 1];
                                return `${dow}, ${d} de ${month}`;
                              })()}
                              {' · '}
                              <span className="text-white font-bold">{selectedTime}</span>
                            </span>
                          </div>
                        </div>

                        <div className="border-t border-white/12 px-4 py-2.5">
                          <button
                            onClick={() => setShowTimePicker(true)}
                            className="w-full flex items-center justify-center gap-1.5 text-white/50 hover:text-secondary transition-colors active:scale-95 text-xs font-semibold"
                          >
                            <Clock size={12} />
                            Alterar horário
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                  {errorMessage && (
                    <p className="text-red-500 font-bold text-sm mt-3 text-center">
                      {errorMessage}
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="p-4 bg-background border-t border-white/10 shrink-0">
              <button
                disabled={selectedServices.length === 0 || !selectedDate || !selectedTime}
                onClick={() => setStep(4)}
                className={`w-full h-14 rounded-2xl font-black flex items-center justify-center gap-2 transition-all 
                  ${selectedServices.length > 0 && selectedDate && selectedTime ? 'bg-secondary text-white shadow-[0_4px_16px_rgba(249,148,23,0.4)] active:scale-95' : 'bg-white/10 text-white/30 cursor-not-allowed'}`}
              >
                {selectedServices.length === 0 ? 'Escolha um serviço' : (!selectedDate) ? 'Escolha uma data' : (!selectedTime) ? 'Escolha um horário' : 'Próximo →'}
              </button>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="animate-in fade-in slide-in-from-right-4 duration-300 flex flex-col h-full">
            <div className="pt-3 px-4">
              {renderHeader(true, true, () => setStep(1))}
            </div>
            
            <div className="flex-1 flex flex-col justify-between px-4 pb-4 overflow-y-auto">
              <div>
                <div className="bg-surface/80 p-3 rounded-2xl border border-secondary/20 mb-3 shadow-[0_4px_16px_rgba(0,0,0,0.3)]">
                  <div className="flex justify-between items-center mb-2 pb-2 border-b border-white/10">
                    <span className="text-title text-xs font-bold flex items-center gap-1.5"><Scissors size={14} /> Serviço</span>
                    <span className="text-white font-black text-right max-w-[60%] truncate">{selectedServices.map(s => s.name).join(' + ')}</span>
                  </div>
                  <div className="flex justify-between items-center mb-2 pb-2 border-b border-white/10">
                    <span className="text-title text-xs font-bold flex items-center gap-1.5"><CalendarDays size={14} /> Data</span>
                    <span className="text-white font-black text-right">{selectedDate.split('-').reverse().join('/')} às {selectedTime}</span>
                  </div>
                  <div className="flex justify-between items-center mb-2 pb-2 border-b border-white/10">
                    <span className="text-title text-xs font-bold flex items-center gap-1.5"><Clock size={14} /> Duração</span>
                    <span className="text-white font-black text-right">{selectedServices.reduce((sum,s) => sum + s.duration, 0)} min</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-title text-xs font-bold flex items-center gap-1.5">💰 Valor</span>
                    <span className="text-secondary font-black text-lg text-right">{formatCurrency(selectedServices.reduce((sum,s) => sum + s.price, 0))}</span>
                  </div>
                </div>

                <form id="booking-form" onSubmit={submitAppointment} className="space-y-2">
                  <div className="relative">
                    <div className="absolute left-4 top-1/2 -translate-y-1/2 text-title">
                      <User size={18} />
                    </div>
                    <input
                      type="text"
                      placeholder="Nome completo (Ex: João Silva)*"
                      value={clientName}
                      onChange={e => setClientName(e.target.value)}
                      className="w-full bg-surface border-b-2 border-transparent border-b-white/20 rounded-t-xl rounded-b-none h-12 pl-12 pr-4 text-white placeholder:text-title font-medium focus:border-b-secondary outline-none block hover:bg-white/5 transition-colors"
                      required
                    />
                  </div>
                  <div className="relative">
                    <div className="absolute left-4 top-1/2 -translate-y-1/2 text-title">
                      <Smartphone size={18} />
                    </div>
                    <input
                      type="tel"
                      placeholder="WhatsApp* (Ex: 11 99999-9999)"
                      value={clientPhone}
                      onChange={handlePhoneChange}
                      className="w-full bg-surface border-b-2 border-transparent border-b-white/20 rounded-t-xl rounded-b-none h-12 pl-12 pr-4 text-white placeholder:text-title font-medium focus:border-b-secondary outline-none block hover:bg-white/5 transition-colors"
                      required
                    />
                  </div>
                  <div className="relative">
                    <div className="absolute left-4 top-3 text-title">
                      <MessageSquare size={18} />
                    </div>
                    <textarea
                      placeholder="Alguma observação? (Ex: Cabelo na tesoura)"
                      value={observation}
                      onChange={e => setObservation(e.target.value)}
                      maxLength={200}
                      rows={2}
                      className="w-full bg-surface border-b-2 border-transparent border-b-white/20 rounded-t-xl rounded-b-none p-3 pl-12 text-white placeholder:text-title font-medium focus:border-b-secondary outline-none resize-none h-20 block hover:bg-white/5 transition-colors"
                    />
                  </div>
                </form>
              </div>

              <div className="mt-2 pt-2">
                {errorMessage && <p className="text-red-500 font-bold text-sm text-center mb-2">{errorMessage}</p>}

                <button
                  type="submit"
                  form="booking-form"
                  disabled={isSubmitting}
                  className="w-full bg-secondary text-white font-black rounded-2xl h-14 active:scale-95 transition-all shadow-lg shadow-secondary/20 flex justify-center items-center gap-2 hover:bg-secondary/90"
                >
                  {isSubmitting ? (
                    <><Loader2 className="animate-spin" size={20} /> Confirmando...</>
                  ) : (
                    <>Confirmar Agendamento <Check size={20} /></>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {step === 5 && (
          <div className="animate-in zoom-in-95 duration-500 min-h-[60vh] flex flex-col justify-center items-center text-center">
            
            <div className="w-[104px] h-[104px] bg-[#34D399]/20 rounded-full flex items-center justify-center mb-6 animate-[pulse_2s_ease-in-out_infinite]">
              <div className="w-[72px] h-[72px] bg-[#34D399] rounded-full flex items-center justify-center text-background shadow-[0_0_24px_rgba(52,211,153,0.4)]">
                <Check size={40} />
              </div>
            </div>

            <h1 className="text-2xl font-black text-white mb-2">Agendamento confirmado!</h1>
            <p className="text-white/80 font-medium text-lg">
              {selectedDate.split('-').reverse().join('/')} às {selectedTime}
            </p>
            <p className="text-title text-sm mt-1 mb-8">
              Você receberá uma confirmação por WhatsApp
            </p>

            <div className="w-full max-w-sm bg-surface p-5 rounded-2xl border border-white/8 mb-8 shadow-[0_4px_16px_rgba(0,0,0,0.3)]">
               <p className="text-white font-bold text-lg mb-1">{selectedServices.map(s => s.name).join(' + ')}</p>
               <p className="text-title text-sm mb-4">{selectedServices.reduce((sum,s) => sum + s.duration, 0)} min · {formatCurrency(selectedServices.reduce((sum,s) => sum + s.price, 0))}</p>
               
               <div className="flex items-center justify-center gap-2 text-title text-sm bg-background/50 p-2 rounded-xl">
                 <MapPin size={16} /> <span>{profile?.shop_name || profile?.name}</span>
               </div>
            </div>
            
            <div className="space-y-4 w-full">
              {(() => {
                const pad = (n: number) => String(n).padStart(2, '0');
                const [startH, startM] = selectedTime.split(':').map(Number);
                const [yyyy, mm, dd] = selectedDate.split('-').map(Number);
                
                const start = new Date(yyyy, mm - 1, dd, startH, startM);
                const end = new Date(start.getTime() + (selectedServices.reduce((sum,s) => sum + s.duration, 0)) * 60000);
                
                const fmt = (d: Date) =>
                  `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
                  `T${pad(d.getHours())}${pad(d.getMinutes())}00`;

                const startStr = fmt(start);
                const endStr = fmt(end);

                return (
                  <a 
                    href={`https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(`${selectedServices.map(s => s.name).join(' + ')} com ${profile?.shop_name || profile?.name}`)}&dates=${startStr}/${endStr}&ctz=America/Sao_Paulo&details=Agendado+via+Tesourando`}
                    target="_blank" rel="noopener noreferrer"
                    className="w-full flex items-center justify-center h-14 bg-surface border border-white/8 rounded-2xl text-white font-bold shadow-[0_4px_16px_rgba(0,0,0,0.3)] active:scale-95 transition-translate gap-2 hover:bg-white/5"
                  >
                    📅 Adicionar ao Google Agenda
                  </a>
                );
              })()}
              
              <button 
                onClick={() => {
                  setStep(1);
                  setSelectedServices([]);
                  setSelectedDate('');
                  setAvailableSlots([]);
                  setSelectedTime('');
                  setShowTimePicker(false);
                  setClientName('');
                  setClientPhone('');
                  setObservation('');
                }}
                className="w-full flex items-center justify-center h-14 bg-transparent border border-white/30 rounded-2xl text-white font-bold active:scale-95 transition-translate hover:bg-white/5"
              >
                Fazer outro agendamento
              </button>
            </div>
            
          </div>
        )}

      </div>

      {showTimePicker && (
        <div
          className="fixed inset-0 bg-black/60 z-50 flex items-end justify-center"
          onClick={() => setShowTimePicker(false)}
        >
          <div
            className="bg-[#1E1C3A] w-full max-w-[480px] rounded-t-3xl pb-safe animate-in slide-in-from-bottom-4 duration-300"
            onClick={e => e.stopPropagation()}
          >
            {/* Handle bar */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-white/20" />
            </div>

            {/* Header do modal */}
            <div className="px-5 pt-2 pb-4 border-b border-white/10">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-white font-black text-base">
                    Escolha um horário
                  </h3>
                  <p className="text-white/50 text-xs mt-0.5">
                    {selectedServices.map(s => s.name).join(' + ')} · {(() => {
                      const [y, m, d] = selectedDate.split('-').map(Number);
                      const date = new Date(y, m - 1, d);
                      const dow = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'][date.getDay()];
                      const month = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'][m - 1];
                      return `${dow}, ${d} de ${month}`;
                    })()}
                  </p>
                </div>
                <button
                  onClick={() => setShowTimePicker(false)}
                  className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center text-white/60 hover:text-white transition-colors"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Conteúdo dos horários */}
            <div className="px-5 py-4 max-h-[60vh] overflow-y-auto">
              {dateLoading ? (
                <div className="flex justify-center py-10">
                  <Loader2 className="animate-spin text-secondary" size={28} />
                </div>
              ) : availableSlots.length === 0 ? (
                <div className="text-center py-10">
                  <p className="text-white font-bold mb-1">
                    Nenhum horário disponível
                  </p>
                  <p className="text-white/40 text-sm">
                    Tente outro dia
                  </p>
                </div>
              ) : (
                <>
                  {/* Tabs de turno */}
                  {(() => {
                    const TURNOS: Record<string, {label: string, inicio: number, fim: number}> = {
                      manha: { label: 'Manhã', inicio: 6, fim: 12 },
                      tarde: { label: 'Tarde', inicio: 12, fim: 18 },
                      noite: { label: 'Noite', inicio: 18, fim: 24 }
                    };

                    const shiftCounts: Record<string, number> = {
                      manha: 0, tarde: 0, noite: 0
                    };
                    availableSlots.forEach(t => {
                      const h = parseInt(t.split(':')[0], 10);
                      if (h >= 6 && h < 12) shiftCounts.manha++;
                      else if (h >= 12 && h < 18) shiftCounts.tarde++;
                      else if (h >= 18) shiftCounts.noite++;
                    });

                    const activeSlots = availableSlots.filter(t => {
                      const h = parseInt(t.split(':')[0], 10);
                      const s = TURNOS[activeShift];
                      return h >= s.inicio && h < s.fim;
                    });

                    const shiftsWithSlots = Object.entries(TURNOS)
                      .filter(([k]) => shiftCounts[k] > 0);

                    return (
                      <>
                        {/* Total de horários */}
                        <p className="text-xs text-white/40 font-medium mb-3">
                          {availableSlots.length} horário{availableSlots.length !== 1 ? 's' : ''} disponível{availableSlots.length !== 1 ? 'is' : ''} neste dia
                        </p>

                        {/* Tabs só se tiver mais de 1 turno */}
                        {shiftsWithSlots.length > 1 && (
                          <div className="flex gap-2 mb-4">
                            {shiftsWithSlots.map(([key, info]) => {
                              const isActive = activeShift === key;
                              const hasSelection = selectedTime && (() => {
                                const h = parseInt(selectedTime.split(':')[0], 10);
                                return h >= info.inicio && h < info.fim;
                              })();
                              return (
                                <button
                                  key={key}
                                  onClick={() => setActiveShift(key)}
                                  className={`rounded-full px-4 py-1.5 transition-all flex items-center gap-1.5 text-xs font-semibold
                                    ${isActive
                                      ? 'border border-secondary text-secondary bg-secondary/10'
                                      : 'border border-white/15 text-white/50'
                                    }`}
                                >
                                  {info.label}
                                  <span className={`text-[10px] ${isActive ? 'text-secondary/70' : 'text-white/30'}`}>
                                    {shiftCounts[key]}
                                  </span>
                                  {hasSelection && (
                                    <span className="w-1.5 h-1.5 rounded-full bg-secondary" />
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        )}

                        {/* Grid de horários */}
                        <div className="grid grid-cols-4 gap-2">
                          {activeSlots.map(time => (
                            <button
                              key={time}
                              onClick={() => {
                                setSelectedTime(time);
                                setShowTimePicker(false);
                              }}
                              className={`py-3 rounded-2xl text-sm font-semibold transition-all active:scale-95
                                ${selectedTime === time
                                  ? 'bg-secondary text-white shadow-[0_0_12px_rgba(249,148,23,0.4)]'
                                  : 'bg-surface text-white border border-white/10 hover:bg-white/5'
                                }`}
                            >
                              {time}
                            </button>
                          ))}
                        </div>
                      </>
                    );
                  })()}
                </>
              )}
            </div>

            {/* Padding extra para iOS safe area */}
            <div className="h-6" />
          </div>
        </div>
      )}

      {showCalendarModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setShowCalendarModal(false)}>
          <div className="bg-[#2D2B55] w-full max-w-md sm:rounded-2xl rounded-t-2xl p-4 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <button 
                onClick={() => setModalYearMonth(prev => {
                  let m = prev.month - 1;
                  let y = prev.year;
                  if (m < 0) { m = 11; y--; }
                  return { month: m, year: y };
                })}
                className="w-10 h-10 flex items-center justify-center text-white/50 hover:bg-white/10 rounded-full active:scale-95 transition-colors"
              >
                <ChevronLeft size={20} />
              </button>
              
              <span className="font-bold text-white text-base">
                {(() => {
                  const dateStr = new Date(modalYearMonth.year, modalYearMonth.month, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
                  return dateStr.charAt(0).toUpperCase() + dateStr.slice(1);
                })()}
              </span>

              <div className="flex items-center gap-2">
                <button 
                  onClick={() => setModalYearMonth(prev => {
                    let m = prev.month + 1;
                    let y = prev.year;
                    if (m > 11) { m = 0; y++; }
                    return { month: m, year: y };
                  })}
                  className="w-10 h-10 flex items-center justify-center text-white/50 hover:bg-white/10 rounded-full active:scale-95 transition-colors"
                >
                  <ChevronLeft className="rotate-180" size={20} />
                </button>
                <button 
                  onClick={() => setShowCalendarModal(false)}
                  className="w-10 h-10 flex items-center justify-center text-white/50 hover:bg-white/10 hover:text-white rounded-full active:scale-95 transition-colors"
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-7 mb-2">
              {['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'].map(d => (
                <div key={d} className="text-center text-[10px] text-white/40 font-semibold">{d}</div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-y-2">
              {(() => {
                const daysInMonth = new Date(modalYearMonth.year, modalYearMonth.month + 1, 0).getDate();
                const firstDay = new Date(modalYearMonth.year, modalYearMonth.month, 1).getDay();
                
                const cells = [];
                for (let i = 0; i < firstDay; i++) {
                  cells.push(<div key={`empty-${i}`} />);
                }

                for (let i = 1; i <= daysInMonth; i++) {
                  const d = new Date(modalYearMonth.year, modalYearMonth.month, i);
                  const isPast = d.getTime() < new Date().setHours(0,0,0,0);
                  const isToday = d.getTime() === new Date().setHours(0,0,0,0);
                  const dow = d.getDay();
                  const dayEntry = schedule.find(sch => sch.day_of_week === dow);
                  const isOpen = dayEntry?.is_open;
                  const isDisabled = isPast || !isOpen;

                  if (i <= 7) { // Só loga os primeiros dias para não floodar
                    console.log(`[DEBUG-AGENDA-MODAL] Render Dia ${dow} (Data: ${i})`);
                    console.log(`  Entrada no schedule? ${!!dayEntry}`);
                    console.log(`  Valor is_open: ${isOpen} (Tipo: ${typeof isOpen})`);
                    console.log(`  is_open é undefined? ${isOpen === undefined}`);
                    console.log(`  Comparações => !isOpen: ${!isOpen} | isOpen !== true: ${isOpen !== true}`);
                    console.log(`  isDisabled final: ${isDisabled}`);
                  }
                  
                  const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
                  const isSelected = selectedDate === dateStr;
                  const isFull = fullDays.has(dateStr);

                  cells.push(
                    <div key={i} className="flex justify-center relative">
                      <button
                        disabled={isDisabled}
                        onClick={() => {
                          setSelectedDate(dateStr);
                          setSelectedTime('');
                          setShowCalendarModal(false);
                          setShowTimePicker(false);
                          
                          // Calculate week offset
                          const today = new Date();
                          today.setHours(0,0,0,0);
                          const diffTime = d.getTime() - today.getTime();
                          const diffDays = Math.max(0, Math.floor(diffTime / (1000 * 60 * 60 * 24)));
                          const offset = Math.floor(diffDays / 7);
                          setWeekOffset(Math.min(offset, MAX_WEEK_OFFSET));
                        }}
                        className={`
                          w-10 h-10 rounded-full flex flex-col items-center justify-center relative transition-all
                          ${isDisabled ? 'text-white/20 pointer-events-none' : 
                            isFull ? 'opacity-40' :
                            isSelected ? 'bg-secondary text-white font-bold' : 
                            'text-white hover:bg-white/10 active:scale-95'}
                        `}
                      >
                        <span className="text-sm">{i}</span>
                        {isToday && !isSelected && <span className="absolute bottom-1 w-1 h-1 rounded-full bg-secondary" />}
                      </button>
                      {isFull && !isDisabled && <X size={10} className="absolute top-1 right-2 w-full text-center text-white/40 pointer-events-none" />}
                    </div>
                  );
                }
                return cells;
              })()}
            </div>
          </div>
        </div>
      )}

      {servicesSheetOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/60 z-40"
            onClick={() => setServicesSheetOpen(false)}
          />

          {/* Sheet */}
          <div className="fixed inset-x-0 bottom-0 z-50 bg-[#1a1830] rounded-t-2xl shadow-xl max-h-[75vh] flex flex-col">

            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-white/8 shrink-0">
              <div>
                <h3 className="text-base font-semibold text-white">
                  Escolha seus serviços
                </h3>
                <p className="text-xs text-white/40 mt-0.5">
                  Selecione um ou mais
                </p>
              </div>
              <button
                onClick={() => setServicesSheetOpen(false)}
                className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center"
              >
                <X className="w-4 h-4 text-white/60" />
              </button>
            </div>

            {/* Grid dinâmico de serviços — com scroll próprio */}
            <div className="flex-1 overflow-y-auto px-5 py-4">
              <div className={`grid gap-3 ${
                services.length === 1 ? 'grid-cols-1' :
                services.length === 2 ? 'grid-cols-2' :
                services.length === 3 ? 'grid-cols-3' :
                'grid-cols-4'
              }`}>
                {services.map(service => {
                  const selected = selectedServices.some(s => s.id === service.id)
                  return (
                    <button
                      key={service.id}
                      onClick={() => {
                        setSelectedServices(prev =>
                          selected
                            ? prev.filter(s => s.id !== service.id)
                            : [...prev, service]
                        )
                      }}
                      className={`relative flex flex-col items-start justify-start pt-7 pl-3 pb-3 pr-3 gap-1 rounded-xl border transition-all ${selected ? 'border-secondary bg-secondary/15' : 'border-white/10 bg-white/5'}`}
                    >
                      <div className={`absolute top-2 left-2 w-4 h-4 rounded border-2 flex items-center justify-center transition-all ${selected ? 'border-secondary bg-secondary' : 'border-white/30 bg-transparent'}`}>
                        {selected && (
                          <Check className="w-2.5 h-2.5 text-white stroke-[3]" />
                        )}
                      </div>
                      <span className="text-sm font-medium text-white leading-tight w-full text-left">
                        {service.name}
                      </span>
                      <span className="text-xs text-secondary w-full text-left">
                        {formatCurrency(service.price)}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Botão confirmar */}
            <div className="px-5 pb-6 pt-3 shrink-0 border-t border-white/8">
              <button
                onClick={() => setServicesSheetOpen(false)}
                disabled={selectedServices.length === 0}
                className="w-full py-3.5 rounded-xl font-semibold text-sm transition-all disabled:bg-white/10 disabled:text-white/30 enabled:bg-secondary enabled:text-white"
              >
                {selectedServices.length === 0
                  ? 'Selecione ao menos um serviço'
                  : `Confirmar (${selectedServices.length})`}
              </button>
            </div>
          </div>
        </>
      )}

    </div>
  );
}

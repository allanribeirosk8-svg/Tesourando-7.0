import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Store, User, Phone, PhoneCall, MapPin, Instagram, Scissors, List, Trash2, Clock, Coffee, CheckCircle, CheckCircle2, XCircle, Loader2, ChevronLeft, ChevronDown, AlertCircle, Zap } from 'lucide-react';
import { useStore } from '../context/Store';
import { ServiceItem, DaySchedule } from '../types';
import { supabaseService, normalizeRequestedSlug, generateSlug } from '../services/supabaseService';
import { supabase } from '../lib/supabase';

const DAY_LABELS: Record<string, string> = {
  SEG: 'Segunda',
  TER: 'Terça',
  QUA: 'Quarta',
  QUI: 'Quinta',
  SEX: 'Sexta',
  SAB: 'Sábado',
  DOM: 'Domingo',
};

const generateBreakSlots = (breakStart: string, breakEnd: string): string[] => {
  const slots: string[] = [];
  const [startH, startM] = breakStart.split(':').map(Number);
  const [endH, endM] = breakEnd.split(':').map(Number);
  let currentMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;
  while (currentMinutes < endMinutes) {
    const h = Math.floor(currentMinutes / 60).toString().padStart(2, '0');
    const m = (currentMinutes % 60).toString().padStart(2, '0');
    slots.push(`${h}:${m}`);
    currentMinutes += 15;
  }
  return slots;
};

interface SetupWizardProps {
  onComplete: () => void;
  initialStep?: number;
}

const DEFAULT_SCHEDULE: Record<string, DaySchedule> = {
  SEG: { enabled: true,  open: '09:00', close: '18:00', breakStart: '12:00', breakEnd: '14:00' },
  TER: { enabled: true,  open: '09:00', close: '18:00', breakStart: '12:00', breakEnd: '14:00' },
  QUA: { enabled: true,  open: '09:00', close: '18:00', breakStart: '12:00', breakEnd: '14:00' },
  QUI: { enabled: true,  open: '09:00', close: '18:00', breakStart: '12:00', breakEnd: '14:00' },
  SEX: { enabled: true,  open: '09:00', close: '18:00', breakStart: '12:00', breakEnd: '14:00' },
  SAB: { enabled: false, open: '09:00', close: '18:00', breakStart: null,    breakEnd: null    },
  DOM: { enabled: false, open: '09:00', close: '18:00', breakStart: null,    breakEnd: null    },
};

const phoneMask = (value: string) => {
  const digits = value.replace(/\D/g, '');
  if (digits.length === 0) return '';
  if (digits.length <= 2) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7, 11)}`;
};

const validatePhone = (raw: string) => {
  const digits = raw.replace(/\D/g, '');
  return digits.length === 10 || digits.length === 11;
};

const generateDurationOptions = () => {
  const options = [];
  for (let minutes = 15; minutes <= 480; minutes += 15) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    let label = '';
    if (hours > 0 && mins > 0) label = `${hours}h ${mins}min`;
    else if (hours > 0) label = `${hours}h`;
    else label = `${mins}min`;
    options.push({ label, value: minutes });
  }
  return options;
};

export function SetupWizard({ onComplete, initialStep }: SetupWizardProps) {
  const { updateBarberProfile, addService, updateDayConfig, services, removeService, barberProfile, barbershop, onboardingState, checkOnboardingState, reloadData } = useStore();
  const [step, setStep] = useState(initialStep || 1);
  const [isFinishing, setIsFinishing] = useState(false);
  const [isFinished, setIsFinished] = useState(false);

  const [profileData, setProfileData] = useState({
    name: '',
    shopName: '',
    personalPhone: '',
    businessPhone: '',
    address: '',
    instagram: '',
    description: '',
  });

  const [localServices, setLocalServices] = useState<ServiceItem[]>([
    { id: 'setup-1', name: 'Corte de Cabelo', price: 35, duration: 30 },
    { id: 'setup-2', name: 'Barba', price: 25, duration: 30 },
  ]);

  const [schedule, setSchedule] = useState<Record<string, DaySchedule>>(DEFAULT_SCHEDULE);
  const [scheduleTab, setScheduleTab] = useState<'hours' | 'breaks'>('hours');

  const [errors, setErrors] = useState<string[]>([]);

  const [handle, setHandle] = useState('');
  const [handleStatus, setHandleStatus] = useState<
    'idle' | 'checking' | 'available' | 'taken' | 'invalid'
  >('idle');

  // Carregar dados existentes para retomar de onde parou sem perda de progresso
  React.useEffect(() => {
    const loadExistingProgress = async () => {
      try {
        const userId = await supabaseService.getUserId();
        if (!userId) return;

        const currentProf = await supabaseService.getCurrentProfile(userId);
        const ownedShop = await supabaseService.getOwnedBarbershop(userId);

        if (currentProf || ownedShop) {
          setProfileData(prev => ({
            ...prev,
            name: (currentProf?.name && currentProf.name !== 'Barbeiro') ? currentProf.name : (prev.name || ''),
            shopName: ownedShop?.name || currentProf?.shopName || prev.shopName || '',
            personalPhone: currentProf?.personalPhone || prev.personalPhone || '',
            businessPhone: currentProf?.businessPhone || prev.businessPhone || '',
            address: currentProf?.address || prev.address || '',
            instagram: currentProf?.instagram || prev.instagram || '',
            description: currentProf?.description || prev.description || '',
          }));

          const activeSlug = ownedShop?.slug || currentProf?.slug;
          if (activeSlug) {
            setHandle(activeSlug);
            setHandleStatus('available');
          }
        }

        const { data: dbServices } = await supabase
          .from('services')
          .select('*')
          .eq('user_id', userId);

        if (dbServices && dbServices.length > 0) {
          setLocalServices(dbServices.map((s: any) => ({
            id: s.id,
            name: s.name,
            price: Number(s.price),
            duration: Number(s.duration)
          })));
        }
        if (ownedShop) {
          if (initialStep && initialStep >= 1 && initialStep <= 4) {
            setStep(initialStep);
          }
        } else {
          // Sem barbearia cadastrada: SEMPRE iniciar no passo 1 (Nome da conta obrigatório)
          setStep(1);
        }
      } catch (err) {
        console.warn('[SetupWizard] Erro ao carregar dados prévios para retomada:', err);
      }
    };

    loadExistingProgress();

    // Se o usuário não possui barbearia própria ativa, a etapa 1 é estritamente mandatória
    if (!barbershop) {
      setStep(1);
    } else if (initialStep && initialStep >= 1 && initialStep <= 4) {
      setStep(initialStep);
    } else if (onboardingState?.step && onboardingState.step >= 1 && onboardingState.step <= 4) {
      setStep(onboardingState.step);
    } else {
      setStep(1);
    }
  }, [initialStep, onboardingState?.step, barbershop]);
  const checkHandleAvailability = async (value: string) => {
    const normalized = normalizeRequestedSlug(value);
    if (normalized.length < 3) {
      setHandleStatus('invalid');
      return;
    }
    setHandleStatus('checking');
    try {
      const userId = await supabaseService.getUserId();
      const { data: profs } = await supabase
        .from('profiles')
        .select('id')
        .eq('slug', normalized)
        .limit(1);

      if (profs && profs.length > 0 && profs[0].id !== userId) {
        setHandleStatus('taken');
        return;
      }

      const { data: shops } = await supabase
        .from('barbershops')
        .select('owner_id')
        .eq('slug', normalized)
        .limit(1);

      if (shops && shops.length > 0 && shops[0].owner_id !== userId) {
        setHandleStatus('taken');
        return;
      }

      setHandleStatus('available');
    } catch {
      setHandleStatus('idle');
    }
  };

  const handleHandleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.toLowerCase().replace(/\s+/g, '-');
    setHandle(val);
    const normalized = normalizeRequestedSlug(val);
    if (normalized.length < 3) {
      setHandleStatus('invalid');
    } else {
      setHandleStatus('idle');
    }
  };

  const commDigits = profileData.businessPhone.replace(/\D/g, '');
  const isBusinessPhoneValid = commDigits.length === 0 || validatePhone(profileData.businessPhone);
  const isStep1Valid = profileData.name.trim() !== '' && validatePhone(profileData.personalPhone) && isBusinessPhoneValid && handleStatus === 'available';
  const isStep2Valid = profileData.shopName.trim() !== '';
  const isStep3Valid = localServices.length > 0 && localServices.every(s => s.name.trim() !== '' && typeof s.price === 'number' && !isNaN(s.price) && s.price > 0);

  const handleNext = () => {
    if (step === 1) {
      if (!isStep1Valid) {
        const newErrors = [];
        if (profileData.name.trim() === '') newErrors.push('name');
        if (!validatePhone(profileData.personalPhone)) newErrors.push('personalPhone');
        if (commDigits.length > 0 && !validatePhone(profileData.businessPhone)) newErrors.push('businessPhone');
        if (handleStatus !== 'available') newErrors.push('handle');
        setErrors(newErrors);
        return;
      }
      setErrors([]);
      setStep(2);
    } else if (step === 2) {
      if (!isStep2Valid) {
        setErrors(['shopName']);
        return;
      }
      setErrors([]);
      setStep(3);
    } else if (step === 3) {
      if (!isStep3Valid) {
        setErrors(['services']);
        return;
      }
      setErrors([]);
      setStep(4);
    } else if (step === 4) {
      handleComplete();
    }
  };

  const handleComplete = async () => {
    setIsFinishing(true);

    try {
      const userId = await supabaseService.getUserId();
      if (!userId) {
        throw new Error('Não foi possível obter o ID do usuário logado no onboarding.');
      }

      // 2. Montar e salvar payload do perfil
      const profilePayload = await supabaseService.buildProfilePayload(
        {
          ...profileData,
          slug: handle,
          logo: '',
          photo: '',
          website: '',
          working_hours: schedule
        },
        userId
      );

      const { error: profileUpsertErr } = await supabase
        .from('profiles')
        .upsert(profilePayload);

      if (profileUpsertErr) {
        console.error('[ONBOARDING] Erro ao salvar profile:', profileUpsertErr.message);
        throw profileUpsertErr;
      }

      // 3. Garantir barbearia própria de forma idempotente
      const existingShop = await supabaseService.getOwnedBarbershop(userId);
      let barbershopId = '';
      let shopPayload: any = null;

      if (existingShop) {
        barbershopId = existingShop.id;
        shopPayload = existingShop;
        if (profileData.shopName && profileData.shopName !== existingShop.name) {
          await supabase
            .from('barbershops')
            .update({ name: profileData.shopName })
            .eq('id', existingShop.id);
        }
      } else {
        const shopSlug = generateSlug(profileData.shopName || 'barbearia', userId);
        const { data: newShop, error: createShopErr } = await supabase
          .from('barbershops')
          .insert({
            owner_id: userId,
            name: profileData.shopName || 'Minha Barbearia',
            slug: shopSlug
          })
          .select()
          .single();

        if (createShopErr) {
          console.error('[ONBOARDING] Erro crítico ao criar barbearia:', createShopErr.message);
          throw createShopErr;
        }

        barbershopId = newShop.id;
        shopPayload = newShop;
      }

      // 4. Garantir owner membership
      await supabaseService.ensureOwnerMembership(barbershopId, userId);

      // 5. Garantir staff_profile real do owner via RPC SECURITY DEFINER
      await supabaseService.ensureOwnerStaffProfile(barbershopId);

      // 6. Salvar serviços da barbearia (com barbershop_id real)
      await supabase
        .from('services')
        .delete()
        .eq('barbershop_id', barbershopId);

      const isUUID = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
      const servicesPayload = localServices.map((s, index) => ({
        id: isUUID(s.id) ? s.id : crypto.randomUUID(),
        barbershop_id: barbershopId,
        user_id: userId,
        name: s.name,
        price: s.price,
        duration: s.duration,
        order_index: index
      }));

      if (servicesPayload.length > 0) {
        const { error: insertErr } = await supabase.from('services').insert(servicesPayload);
        if (insertErr) {
          console.error('[ONBOARDING] Erro ao salvar serviços:', insertErr.message);
          throw insertErr;
        }
      }

      // 7. Salvar horários do salão com barbershop_id explícito
      const dayMap: Record<number, string> = { 0: 'DOM', 1: 'SEG', 2: 'TER', 3: 'QUA', 4: 'QUI', 5: 'SEX', 6: 'SAB' };
      for (let day = 0; day <= 6; day++) {
        const dayKey = dayMap[day];
        const daySched = schedule[dayKey];
        const breaks: string[] = [];
        if (daySched.breakStart && daySched.breakEnd) {
          breaks.push(...generateBreakSlots(daySched.breakStart, daySched.breakEnd));
        }

        await supabaseService.saveWeeklySchedule(
          day,
          {
            isOpen: daySched.enabled,
            start: daySched.open,
            end: daySched.close,
            breaks: breaks,
          },
          barbershopId
        );
      }

      // 8. Forçar onboarding_seen no banco se necessário
      await supabaseService.completeOwnerSetupIfPossible(userId);

      // 9. Reler o estado real do banco de dados e contextos
      await supabaseService.resolveAuthContexts(userId);
      await supabaseService.resolveOnboardingState(userId);

      // 10. Atualizar Store e sincronizar a nova barbearia ativa com activeTenant antes de finalizar
      await checkOnboardingState();
      try {
        await reloadData();
      } catch (reloadErr) {
        console.warn('[SetupWizard] Aviso ao recarregar dados após setup:', reloadErr);
      }

      setIsFinishing(false);
      setIsFinished(true);

      setTimeout(() => {
        onComplete();
      }, 1200);

    } catch (err: any) {
      console.error('[ONBOARDING] Erro capturado na finalização:', err);
      alert(err?.message || 'Erro ao finalizar a configuração. Por favor, tente novamente.');
      setIsFinishing(false);
    }
  };

  const addLocalService = () => {
    setLocalServices([
      ...localServices,
      { id: Date.now().toString(), name: '', price: 0, duration: 30 }
    ]);
  };

  const removeLocalService = (id: string) => {
    setLocalServices(localServices.filter(s => s.id !== id));
  };

  const updateLocalService = (id: string, field: keyof ServiceItem, value: string | number) => {
    setLocalServices(localServices.map(s => s.id === id ? { ...s, [field]: value } : s));
  };

  const updateScheduleDay = (dayKey: string, field: keyof DaySchedule, value: string | boolean | null) => {
    setSchedule(prev => ({
      ...prev,
      [dayKey]: {
        ...prev[dayKey],
        [field]: value
      }
    }));
  };

  const copyMondayToWeekdays = () => {
    const monday = schedule['SEG'];
    setSchedule(prev => ({
      ...prev,
      TER: { ...prev.TER, open: monday.open, close: monday.close, breakStart: monday.breakStart, breakEnd: monday.breakEnd, enabled: monday.enabled },
      QUA: { ...prev.QUA, open: monday.open, close: monday.close, breakStart: monday.breakStart, breakEnd: monday.breakEnd, enabled: monday.enabled },
      QUI: { ...prev.QUI, open: monday.open, close: monday.close, breakStart: monday.breakStart, breakEnd: monday.breakEnd, enabled: monday.enabled },
      SEX: { ...prev.SEX, open: monday.open, close: monday.close, breakStart: monday.breakStart, breakEnd: monday.breakEnd, enabled: monday.enabled },
    }));
  };

  const togglePauseDay = (dayKey: string) => {
    const currentSched = schedule[dayKey];
    const hasPause = Boolean(currentSched.breakStart && currentSched.breakEnd);
    if (hasPause) {
      updateScheduleDay(dayKey, 'breakStart', null);
      updateScheduleDay(dayKey, 'breakEnd', null);
    } else {
      updateScheduleDay(dayKey, 'breakStart', '12:00');
      updateScheduleDay(dayKey, 'breakEnd', '14:00');
    }
  };

  const openTimePicker = (e: React.MouseEvent<HTMLInputElement>) => {
    try {
      if ('showPicker' in e.currentTarget) {
        (e.currentTarget as any).showPicker();
      }
    } catch {
      // Ignora e deixa o foco nativo do navegador agir
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex flex-col h-[100dvh] w-full bg-[#F5A623] pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      
      <div className={`flex-1 w-full bg-white flex flex-col mx-auto max-w-[480px] relative justify-between overflow-y-auto ${
        step === 4 ? 'px-3 sm:px-6 pt-2 pb-3' : 'px-4 sm:px-6 pt-4 pb-5'
      }`}>
        
        <AnimatePresence mode="wait">
          {isFinished ? (
            <motion.div
              key="success"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex flex-col h-full w-full absolute inset-0 items-center justify-center p-8 bg-white"
            >
                <div className="w-24 h-24 rounded-full bg-green-100 flex items-center justify-center text-green-500 mb-6 relative">
                   <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: [1.1, 1] }}
                      transition={{ duration: 0.5 }}
                   >
                     <CheckCircle size={64} />
                   </motion.div>
                </div>
                <h2 className="text-[24px] font-bold text-[#1E1B4B] mb-2 text-center">Tudo pronto! 🎉</h2>
                <p className="text-[14px] text-[#6B7280] text-center px-4">
                  Sua barbearia está configurada. Bem-vindo ao Tesourando!
                </p>
              </motion.div>
            ) : (
              <motion.div
                key={`step-${step}`}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.3 }}
                className="flex flex-col h-full w-full justify-between"
              >
                {/* ── Topo: barra de progresso das etapas ── */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="w-[32px]">
                      {step > 1 && (
                        <button
                          onClick={() => setStep(step - 1)}
                          disabled={isFinishing}
                          className="w-[32px] h-[32px] flex items-center justify-center text-[#374151] hover:bg-black/5 rounded-full transition-colors disabled:opacity-50"
                        >
                          <ChevronLeft size={20} />
                        </button>
                      )}
                    </div>
                    <span className="text-[12px] text-[#9CA3AF]">Etapa {step} de 4</span>
                    <div className="w-[32px]" />
                  </div>
                  <div className="flex gap-[6px]">
                    {[1, 2, 3, 4].map(i => (
                      <div 
                        key={i}
                        className={`h-[6px] rounded-[4px] flex-1 ${i === step ? 'bg-[#F5A623]' : i < step ? 'bg-[#F5A623] opacity-60' : 'bg-[#E5E7EB]'}`}
                      />
                    ))}
                  </div>
                </div>

                {/* ── Meio: ícone + título + descrição + campos ── */}
                <div className={`flex-1 flex flex-col min-h-0 ${step === 4 ? 'gap-1 py-1 justify-start' : 'justify-center gap-3 py-4'}`}>
                  <div className={`rounded-full bg-[#FFF3E0] text-[#F5A623] flex items-center justify-center mx-auto shrink-0 w-[48px] h-[48px] ${
                    step === 4 ? 'mt-[12px] mb-0' : 'mb-1'
                  }`}>
                    {step === 1 && <User size={24} />}
                    {step === 2 && <Scissors size={24} />}
                    {step === 3 && <List size={24} />}
                    {step === 4 && <Clock size={24} className="w-[24px] h-[24px]" />}
                  </div>

                  <h2 className={`font-bold text-[#1E1B4B] text-center ${
                    step === 4 ? 'text-[21px] leading-[25.75px] mt-[3px]' : 'text-[22px] pt-0 -mt-[13px]'
                  }`}>
                    {step === 1 && "Vamos começar! Como podemos te chamar?"}
                    {step === 2 && "Agora, sobre sua barbearia"}
                    {step === 3 && "Quais serviços você oferece?"}
                    {step === 4 && "Quando você atende?"}
                  </h2>
                  <p className={`text-[#6B7280] text-center text-[11px] ${
                    step === 4 ? 'pt-0 mt-[-1px] max-w-[432px] mx-auto leading-tight' : 'mb-1'
                  }`}>
                    {step === 1 && "Suas informações de contato para seus clientes."}
                    {step === 2 && "Essas informações aparecem para seus clientes na hora de agendar."}
                    {step === 3 && "Você pode editar isso depois. Já deixamos alguns prontos para você!"}
                    {step === 4 && "Configure seus dias e horários de atendimento."}
                  </p>

                  <div className={`flex flex-col flex-1 max-h-full ${step === 4 ? 'mt-0 min-h-0' : '-mt-[9px]'}`}>
                    {step === 1 && (
                      <div className="flex flex-col gap-2.5 mt-2">
                        {/* Name */}
                        <div>
                          <label className="block text-[13px] font-medium text-gray-700 mb-1 ml-1">
                            Seu nome <span className="text-red-500">*</span>
                          </label>
                          <div className="relative">
                            <User className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                            <input
                              type="text"
                              placeholder="Ex: João Silva"
                              value={profileData.name}
                              onChange={(e) => setProfileData({ ...profileData, name: e.target.value })}
                              className={`w-full bg-[#F9FAFB] border-[1.5px] rounded-[12px] py-[12px] pr-[16px] pl-[44px] text-[15px] text-[#1E1B4B] focus:outline-none focus:border-[#F5A623] focus:ring-[3px] focus:ring-[#F5A623]/15 transition-all ${errors.includes('name') ? 'border-red-500' : 'border-[#E5E7EB]'}`}
                            />
                          </div>
                        </div>

                        {/* Personal Phone */}
                        <div>
                          <label className="block text-[13px] font-medium text-gray-700 mb-1 ml-1">
                            WhatsApp pessoal <span className="text-red-500">*</span>
                          </label>
                          <div className="relative">
                            <Phone className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                            <input
                              type="tel"
                              placeholder="(11) 99999-9999"
                              value={profileData.personalPhone}
                              onChange={(e) => {
                                setProfileData({ ...profileData, personalPhone: phoneMask(e.target.value) });
                                if (errors.includes('personalPhone')) setErrors(errors.filter(err => err !== 'personalPhone'));
                              }}
                              className={`w-full bg-[#F9FAFB] border-[1.5px] rounded-[12px] py-[12px] pr-[16px] pl-[44px] text-[15px] text-[#1E1B4B] focus:outline-none focus:border-[#F5A623] focus:ring-[3px] focus:ring-[#F5A623]/15 transition-all ${errors.includes('personalPhone') ? 'border-red-500' : 'border-[#E5E7EB]'}`}
                              maxLength={15}
                            />
                          </div>
                          {errors.includes('personalPhone') && (
                            <p className="text-red-500 text-[12px] mt-1 ml-1">Informe um telefone válido com DDD. Ex: (11) 99999-9999</p>
                          )}
                        </div>

                        {/* Business Phone */}
                        <div>
                          <label className="block text-[13px] font-medium text-gray-700 mb-1 ml-1">
                            WhatsApp comercial
                          </label>
                          <div className="relative">
                            <PhoneCall className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                            <input
                              type="tel"
                              placeholder="(11) 99999-9999"
                              value={profileData.businessPhone}
                              onChange={(e) => {
                                setProfileData({ ...profileData, businessPhone: phoneMask(e.target.value) });
                                if (errors.includes('businessPhone')) setErrors(errors.filter(err => err !== 'businessPhone'));
                              }}
                              className={`w-full bg-[#F9FAFB] border-[1.5px] rounded-[12px] py-[12px] pr-[16px] pl-[44px] text-[15px] text-[#1E1B4B] focus:outline-none focus:border-[#F5A623] focus:ring-[3px] focus:ring-[#F5A623]/15 transition-all ${errors.includes('businessPhone') ? 'border-red-500' : 'border-[#E5E7EB]'}`}
                              maxLength={15}
                            />
                          </div>
                          {errors.includes('businessPhone') && (
                            <p className="text-red-500 text-[12px] mt-1 ml-1">Telefone inválido. Deixe em branco ou informe com DDD.</p>
                          )}
                        </div>
                        
                        {/* Custom Handle */}
                        <div>
                          <label className="block text-[13px] font-medium text-gray-700 mb-1 ml-1">
                            Nome da conta <span className="text-red-500">*</span>
                          </label>
                          <p className="text-[11px] text-[#9CA3AF] mb-1">
                            tesourando.vercel.app/#/agendar/
                            <span className="text-[#F59E0B]">{handle || 'minha-barbearia'}</span>
                          </p>
                          <div className="relative">
                            <input
                              type="text"
                              placeholder="minha-barbearia"
                              value={handle}
                              onChange={handleHandleChange}
                              onBlur={() => checkHandleAvailability(handle)}
                              className={`w-full bg-[#F9FAFB] border-[1.5px] rounded-[12px] py-[12px] pl-[16px] pr-[40px] text-[15px] text-[#1E1B4B] focus:outline-none focus:ring-[3px] transition-all ${
                                handleStatus === 'available' ? 'border-green-400 focus:border-green-400 focus:ring-green-400/20' :
                                handleStatus === 'taken' || handleStatus === 'invalid' ? 'border-red-400 focus:border-red-400 focus:ring-red-400/20' :
                                'border-[#E5E7EB] focus:border-[#F5A623] focus:ring-[#F5A623]/15'
                              }`}
                              required
                            />
                            {handleStatus !== 'idle' && (
                              <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center justify-center shrink-0">
                                {handleStatus === 'checking' && <Loader2 size={18} className="text-[#9CA3AF] animate-spin" />}
                                {handleStatus === 'available' && <CheckCircle2 size={18} className="text-green-500" />}
                                {(handleStatus === 'taken' || handleStatus === 'invalid') && <XCircle size={18} className="text-red-500" />}
                              </div>
                            )}
                          </div>
                          <div className="mt-1 ml-1">
                            {handleStatus === 'available' && (
                              <p className="text-green-500 text-[12px] font-medium">Disponível!</p>
                            )}
                            {handleStatus === 'taken' && (
                              <p className="text-red-500 text-[12px] font-medium">Este endereço já está em uso. Escolha outro.</p>
                            )}
                            {handleStatus === 'invalid' && (
                              <p className="text-red-500 text-[12px] font-medium">Use apenas letras minúsculas, números e hífens.</p>
                            )}
                            {(handleStatus === 'idle' || handleStatus === 'checking') && (
                              <p className="text-[#6B7280] text-[12px]">
                                Use apenas letras minúsculas, números e hífens.
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    {step === 2 && (
                      <div className="flex flex-col gap-2.5 mt-2">
                        {/* Shop Name */}
                        <div>
                          <label className="block text-[13px] font-medium text-gray-700 mb-1 ml-1">
                            Nome da barbearia <span className="text-red-500">*</span>
                          </label>
                          <div className="relative">
                            <Store className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                            <input
                              type="text"
                              placeholder="Ex: Barbearia do João"
                              value={profileData.shopName}
                              onChange={(e) => setProfileData({ ...profileData, shopName: e.target.value })}
                              className={`w-full bg-[#F9FAFB] border-[1.5px] rounded-[12px] py-[12px] pr-[16px] pl-[44px] text-[15px] text-[#1E1B4B] focus:outline-none focus:border-[#F5A623] focus:ring-[3px] focus:ring-[#F5A623]/15 transition-all ${errors.includes('shopName') ? 'border-red-500' : 'border-[#E5E7EB]'}`}
                            />
                          </div>
                        </div>
                        
                        {/* Address */}
                        <div>
                          <label className="block text-[13px] font-medium text-gray-700 mb-1 ml-1">
                            Endereço
                          </label>
                          <div className="relative">
                            <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                            <input
                              type="text"
                              placeholder="Rua, número, bairro"
                              value={profileData.address}
                              onChange={(e) => setProfileData({ ...profileData, address: e.target.value })}
                              className="w-full bg-[#F9FAFB] border-[1.5px] border-[#E5E7EB] rounded-[12px] py-[12px] pr-[16px] pl-[44px] text-[15px] text-[#1E1B4B] focus:outline-none focus:border-[#F5A623] focus:ring-[3px] focus:ring-[#F5A623]/15 transition-all"
                            />
                          </div>
                        </div>

                        {/* Instagram */}
                        <div>
                          <label className="block text-[13px] font-medium text-gray-700 mb-1 ml-1">
                            Instagram
                          </label>
                          <div className="relative">
                            <Instagram className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                            <input
                              type="text"
                              placeholder="@suabarbearia"
                              value={profileData.instagram}
                              onChange={(e) => setProfileData({ ...profileData, instagram: e.target.value })}
                              className="w-full bg-[#F9FAFB] border-[1.5px] border-[#E5E7EB] rounded-[12px] py-[12px] pr-[16px] pl-[44px] text-[15px] text-[#1E1B4B] focus:outline-none focus:border-[#F5A623] focus:ring-[3px] focus:ring-[#F5A623]/15 transition-all"
                            />
                          </div>
                        </div>
                      </div>
                    )}

                    {step === 3 && (
                      <div className="flex flex-col flex-1 min-h-0 mt-2">
                        <div className="flex flex-row items-center px-1.5 sm:px-2 mb-1.5 gap-1.5 sm:gap-2 shrink-0">
                          <div className="w-3.5 sm:w-4 shrink-0"></div>
                          <span className="flex-1 min-w-0 text-[11px] font-semibold text-[#6B7280] text-left pl-2">Serviço</span>
                          <span className="w-[56px] sm:w-[64px] shrink-0 text-[11px] font-semibold text-[#6B7280] text-center">Preço</span>
                          <span className="w-[72px] sm:w-[82px] shrink-0 text-[11px] font-semibold text-[#6B7280] text-center">Duração</span>
                          <div className="w-7 sm:w-8 shrink-0"></div>
                        </div>

                        <div className="flex-1 overflow-y-auto min-h-0 flex flex-col pr-1">
                          {localServices.map((service) => {
                            const hasError = errors.includes('services');
                            const isPriceMissing = hasError && (!service.price || isNaN(service.price) || service.price <= 0);
                            const isNameMissing = hasError && (!service.name || service.name.trim() === '');
                            return (
                              <div key={service.id} className="bg-[#F5F5F8] rounded-[12px] p-1.5 sm:p-2 flex flex-row items-center gap-1.5 sm:gap-2 mb-2 shrink-0">
                                <span className="text-[#D1D5DB] cursor-grab shrink-0 w-3.5 sm:w-4 text-center select-none text-[12px]">⠿</span>
                                <input
                                  type="text"
                                  value={service.name}
                                  onChange={(e) => {
                                    updateLocalService(service.id, 'name', e.target.value);
                                    if (errors.includes('services')) setErrors([]);
                                  }}
                                  className={`flex-1 min-w-0 bg-white border rounded-[8px] px-2.5 py-2 text-[14px] text-[#333] focus:outline-none placeholder-[#BDBDBD] ${
                                    isNameMissing ? 'border-red-400 focus:border-red-500' : 'border-[#E0E0E0] focus:border-[#F5A623]'
                                  }`}
                                  placeholder="Novo Serviço"
                                />
                                <div className="relative w-[56px] sm:w-[64px] shrink-0">
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    value={service.price || ''}
                                    onChange={(e) => {
                                      updateLocalService(service.id, 'price', Number(e.target.value));
                                      if (errors.includes('services')) setErrors([]);
                                    }}
                                    className={`w-full bg-white border rounded-[8px] px-1 py-2 text-[14px] text-[#333] text-center focus:outline-none placeholder-[#BDBDBD] ${
                                      isPriceMissing ? 'border-red-400 focus:border-red-500' : 'border-[#E0E0E0] focus:border-[#F5A623]'
                                    }`}
                                    placeholder="R$"
                                    title="Preço (R$)"
                                  />
                                </div>
                                <div className="relative w-[72px] sm:w-[82px] shrink-0">
                                  <select
                                    value={service.duration || ''}
                                    onChange={(e) => updateLocalService(service.id, 'duration', Number(e.target.value))}
                                    className="w-full bg-white border border-[#E0E0E0] rounded-[8px] pl-1.5 pr-4 py-2 text-[12px] sm:text-[13px] text-[#333] font-medium focus:outline-none focus:border-[#F5A623] text-center appearance-none cursor-pointer"
                                  >
                                    {generateDurationOptions().map(opt => (
                                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                                    ))}
                                  </select>
                                  <ChevronDown size={11} className="absolute right-1 top-1/2 -translate-y-1/2 text-[#9CA3AF] pointer-events-none" />
                                </div>
                                <button onClick={() => removeLocalService(service.id)} className="w-7 sm:w-8 h-8 flex items-center justify-center p-1 text-[#F44336] hover:bg-red-50 rounded shrink-0 transition-colors" title="Remover serviço">
                                  <Trash2 size={16} />
                                </button>
                              </div>
                            );
                          })}
                          
                          <button
                            onClick={addLocalService}
                            className="w-full shrink-0 mt-1 mb-2 border-2 border-dashed border-[#F5A623]/50 text-[#F5A623] hover:bg-[#F5A623]/5 rounded-[12px] p-2 font-medium text-[14px] flex justify-center items-center gap-2"
                          >
                            + Adicionar serviço
                          </button>

                          {errors.includes('services') && localServices.length === 0 && (
                            <div className="bg-red-50 border border-red-200 text-red-700 rounded-[10px] p-2.5 my-1 flex items-center gap-2 text-[12px] shrink-0">
                              <AlertCircle size={16} className="text-red-500 shrink-0" />
                              <span>Adicione pelo menos um serviço para continuar.</span>
                            </div>
                          )}
                          {errors.includes('services') && localServices.length > 0 && localServices.some(s => !s.name.trim()) && (
                            <div className="bg-red-50 border border-red-200 text-red-700 rounded-[10px] p-2.5 my-1 flex items-center gap-2 text-[12px] shrink-0">
                              <AlertCircle size={16} className="text-red-500 shrink-0" />
                              <span>Informe o nome de todos os serviços cadastrados.</span>
                            </div>
                          )}
                          {errors.includes('services') && localServices.length > 0 && !localServices.some(s => !s.name.trim()) && localServices.some(s => !s.price || isNaN(s.price) || s.price <= 0) && (
                            <div className="bg-red-50 border border-red-200 text-red-700 rounded-[10px] p-2.5 my-1 flex items-center gap-2 text-[12px] shrink-0">
                              <AlertCircle size={16} className="text-red-500 shrink-0" />
                              <span>Informe um preço válido (maior que R$ 0) para todos os serviços.</span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {step === 4 && (
                      <div className="flex flex-col flex-1 min-h-0 w-full ml-0 -mt-[14px] pt-0">
                        {/* ── Segmented Control Mobile (Abas compactas) ── */}
                        <div className="bg-[#F3F4F6] p-0.5 rounded-[9px] flex items-center gap-1 shrink-0 mt-[18px] mb-1">
                          <button
                            type="button"
                            onClick={() => setScheduleTab('hours')}
                            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-[7px] text-[11px] sm:text-[12px] font-bold transition-all cursor-pointer ${
                              scheduleTab === 'hours'
                                ? 'bg-white text-[#1F2937] shadow-xs'
                                : 'text-[#6B7280] hover:text-[#374151]'
                            }`}
                          >
                            <Clock size={13} className={scheduleTab === 'hours' ? 'text-[#F5A623]' : 'text-[#9CA3AF]'} />
                            <span>Horários de Atendimento</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setScheduleTab('breaks')}
                            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-[7px] text-[11px] sm:text-[12px] font-bold transition-all cursor-pointer ${
                              scheduleTab === 'breaks'
                                ? 'bg-white text-[#1F2937] shadow-xs'
                                : 'text-[#6B7280] hover:text-[#374151]'
                            }`}
                          >
                            <Coffee size={13} className={scheduleTab === 'breaks' ? 'text-[#F5A623]' : 'text-[#9CA3AF]'} />
                            <span>Pausa / Almoço</span>
                          </button>
                        </div>

                        {/* ── Botão de Ação Rápida Mobile ── */}
                        <div className="flex items-center justify-between mb-1 px-0.5 shrink-0">
                          <button
                            type="button"
                            onClick={copyMondayToWeekdays}
                            className="text-[10px] sm:text-[11px] font-semibold text-[#D97706] hover:text-[#B45309] bg-[#FFFBEB] hover:bg-[#FEF3C7] border border-[#FDE68A] rounded-[6px] px-2 py-0.5 mt-[4px] ml-0 h-[25px] flex items-center gap-1 transition-colors cursor-pointer w-full justify-center shadow-2xs"
                            title="Aplica o horário e pausa da Segunda para Terça a Sexta"
                          >
                            <Zap size={12} className="text-[#F5A623] fill-[#F5A623]" />
                            <span>Replicar Segunda-feira para Ter–Sex</span>
                          </button>
                        </div>

                        {/* ── Lista de Dias Compacta para Caber Sem Scroll ── */}
                        <div className="flex-1 overflow-y-auto min-h-0 flex flex-col gap-1 pr-0.5 pt-0 mt-[8px]">
                          {scheduleTab === 'hours' ? (
                            // ABA 1: HORÁRIO DE ATENDIMENTO
                            ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB', 'DOM'].map((dayKey, idx) => {
                              const sched = schedule[dayKey];
                              const itemStyle: React.CSSProperties = {
                                marginTop: idx === 0 ? '0px' : '2px',
                                paddingTop: idx === 0 ? '2px' : idx === 1 || idx === 2 ? '4px' : undefined
                              };
                              return (
                                <div
                                  key={dayKey}
                                  style={itemStyle}
                                  className={`flex items-center justify-between py-1 px-2 rounded-[8px] border transition-all ${
                                    sched.enabled
                                      ? 'bg-white border-[#E5E7EB] shadow-2xs'
                                      : 'bg-[#F9FAFB] border-[#E5E7EB]/50 opacity-45'
                                  }`}
                                >
                                  {/* Identificação do Dia */}
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    <div className={`w-6 h-6 rounded-[5px] flex items-center justify-center font-bold text-[10px] tracking-tight shrink-0 ${
                                      sched.enabled ? 'bg-[#FFF3E0] text-[#D97706]' : 'bg-[#E5E7EB] text-[#9CA3AF]'
                                    }`}>
                                      {dayKey}
                                    </div>
                                    <span className="text-[12px] font-bold text-[#1F2937] leading-none truncate">
                                      {DAY_LABELS[dayKey]}
                                    </span>
                                  </div>

                                  {/* Inputs táteis amplos e Toggle */}
                                  <div className="flex items-center gap-1.5 shrink-0">
                                    {sched.enabled ? (
                                      <div className="flex items-center gap-1 bg-[#F9FAFB] p-0.5 rounded-[7px] border border-[#E5E7EB] transition-all">
                                        {/* Hora Inicial */}
                                        <div className="relative flex items-center justify-center bg-white border border-[#E5E7EB] hover:border-[#F5A623] rounded-[6px] w-[50px] sm:w-[56px] h-[28px] cursor-pointer shadow-2xs">
                                          <span className="text-[12px] sm:text-[13px] font-bold text-[#111827] select-none pointer-events-none tracking-tight">
                                            {sched.open || '--:--'}
                                          </span>
                                          <input
                                            type="time"
                                            value={sched.open}
                                            onChange={(e) => updateScheduleDay(dayKey, 'open', e.target.value)}
                                            className="absolute inset-0 opacity-0 w-full h-full cursor-pointer z-10"
                                          />
                                        </div>

                                        <span className="text-[#9CA3AF] text-[10px] font-semibold select-none px-0.5">às</span>

                                        {/* Hora Final */}
                                        <div className="relative flex items-center justify-center bg-white border border-[#E5E7EB] hover:border-[#F5A623] rounded-[6px] w-[50px] sm:w-[56px] h-[28px] cursor-pointer shadow-2xs">
                                          <span className="text-[12px] sm:text-[13px] font-bold text-[#111827] select-none pointer-events-none tracking-tight">
                                            {sched.close || '--:--'}
                                          </span>
                                          <input
                                            type="time"
                                            value={sched.close}
                                            onChange={(e) => updateScheduleDay(dayKey, 'close', e.target.value)}
                                            className="absolute inset-0 opacity-0 w-full h-full cursor-pointer z-10"
                                          />
                                        </div>
                                      </div>
                                    ) : (
                                      <span className="text-[11px] font-medium text-[#9CA3AF] px-1 select-none">
                                        Não atende
                                      </span>
                                    )}

                                    {/* Toggle Dia */}
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const newEnabled = !sched.enabled;
                                        updateScheduleDay(dayKey, 'enabled', newEnabled);
                                        if (!newEnabled) {
                                          updateScheduleDay(dayKey, 'breakStart', null);
                                          updateScheduleDay(dayKey, 'breakEnd', null);
                                        }
                                      }}
                                      className="w-[30px] flex justify-center shrink-0 cursor-pointer"
                                      title={sched.enabled ? `Desativar ${DAY_LABELS[dayKey]}` : `Ativar ${DAY_LABELS[dayKey]}`}
                                    >
                                      <div className={`w-[30px] h-[18px] rounded-full p-[2px] transition-colors relative ${sched.enabled ? 'bg-[#F5A623]' : 'bg-[#D1D5DB]'}`}>
                                        <motion.div 
                                          animate={{ x: sched.enabled ? 12 : 0 }}
                                          className="w-[14px] h-[14px] bg-white rounded-full shadow-xs"
                                        />
                                      </div>
                                    </button>
                                  </div>
                                </div>
                              );
                            })
                          ) : (
                            // ABA 2: PAUSA / ALMOÇO
                            ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB', 'DOM'].map((dayKey, idx) => {
                              const sched = schedule[dayKey];
                              const hasPause = Boolean(sched.breakStart && sched.breakEnd);
                              const itemStyle: React.CSSProperties = {
                                marginTop: idx === 0 ? '0px' : '2px',
                                paddingTop: idx === 0 ? '2px' : idx === 1 || idx === 2 ? '4px' : undefined
                              };

                              if (!sched.enabled) {
                                return (
                                  <div
                                    key={dayKey}
                                    style={itemStyle}
                                    className="flex items-center justify-between py-1 px-2 rounded-[8px] border border-[#E5E7EB]/40 bg-[#F9FAFB] opacity-40"
                                  >
                                    <div className="flex items-center gap-1.5">
                                      <div className="w-6 h-6 rounded-[5px] bg-[#E5E7EB] text-[#9CA3AF] flex items-center justify-center font-bold text-[10px]">
                                        {dayKey}
                                      </div>
                                      <span className="text-[12px] font-semibold text-[#6B7280]">{DAY_LABELS[dayKey]}</span>
                                    </div>
                                    <span className="text-[10px] text-[#9CA3AF] pr-1">Fechada</span>
                                  </div>
                                );
                              }

                              return (
                                <div
                                  key={dayKey}
                                  style={itemStyle}
                                  className={`flex items-center justify-between py-1 px-2 rounded-[8px] border transition-all ${
                                    hasPause
                                      ? 'bg-[#F9FAFB] border-[#E5E7EB] shadow-2xs'
                                      : 'bg-white border-[#E5E7EB]/70'
                                  }`}
                                >
                                  {/* Identificação do Dia */}
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    <div className="w-6 h-6 rounded-[5px] bg-[#FEF3C7] text-[#D97706] flex items-center justify-center font-bold text-[10px] shrink-0">
                                      {dayKey}
                                    </div>
                                    <span className="text-[12px] font-bold text-[#1F2937] leading-none truncate">
                                      {DAY_LABELS[dayKey]}
                                    </span>
                                  </div>

                                  {/* Inputs de Pausa ou Botão de Ativação */}
                                  <div className="flex items-center gap-1.5 shrink-0">
                                    {hasPause ? (
                                      <div className="flex items-center gap-1 bg-[#F9FAFB] p-0.5 rounded-[7px] border border-[#E5E7EB] transition-all">
                                        {/* Início Pausa */}
                                        <div className="relative flex items-center justify-center bg-white border border-[#E5E7EB] hover:border-[#F5A623] rounded-[6px] w-[50px] sm:w-[56px] h-[28px] cursor-pointer shadow-2xs">
                                          <span className="text-[12px] sm:text-[13px] font-bold text-[#374151] select-none pointer-events-none tracking-tight">
                                            {sched.breakStart || '--:--'}
                                          </span>
                                          <input
                                            type="time"
                                            value={sched.breakStart || ''}
                                            onChange={(e) => updateScheduleDay(dayKey, 'breakStart', e.target.value || null)}
                                            className="absolute inset-0 opacity-0 w-full h-full cursor-pointer z-10"
                                          />
                                        </div>

                                        <span className="text-[#9CA3AF] text-[10px] font-semibold select-none px-0.5">às</span>

                                        {/* Fim Pausa */}
                                        <div className="relative flex items-center justify-center bg-white border border-[#E5E7EB] hover:border-[#F5A623] rounded-[6px] w-[50px] sm:w-[56px] h-[28px] cursor-pointer shadow-2xs">
                                          <span className="text-[12px] sm:text-[13px] font-bold text-[#374151] select-none pointer-events-none tracking-tight">
                                            {sched.breakEnd || '--:--'}
                                          </span>
                                          <input
                                            type="time"
                                            value={sched.breakEnd || ''}
                                            onChange={(e) => updateScheduleDay(dayKey, 'breakEnd', e.target.value || null)}
                                            className="absolute inset-0 opacity-0 w-full h-full cursor-pointer z-10"
                                          />
                                        </div>
                                      </div>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={() => togglePauseDay(dayKey)}
                                        className="text-[10px] font-semibold text-[#6B7280] hover:text-[#D97706] hover:bg-[#FFFBEB] border border-dashed border-[#D1D5DB] rounded-[6px] px-2 h-[28px] transition-colors cursor-pointer flex items-center"
                                      >
                                        + Pausa
                                      </button>
                                    )}

                                    {/* Toggle Pausa */}
                                    <button
                                      type="button"
                                      onClick={() => togglePauseDay(dayKey)}
                                      className="w-[30px] flex justify-center shrink-0 cursor-pointer"
                                      title={hasPause ? `Remover pausa de ${DAY_LABELS[dayKey]}` : `Adicionar pausa em ${DAY_LABELS[dayKey]}`}
                                    >
                                      <div className={`w-[30px] h-[18px] rounded-full p-[2px] transition-colors relative ${hasPause ? 'bg-[#F5A623]' : 'bg-[#D1D5DB]'}`}>
                                        <motion.div 
                                          animate={{ x: hasPause ? 12 : 0 }}
                                          className="w-[14px] h-[14px] bg-white rounded-full shadow-xs"
                                        />
                                      </div>
                                    </button>
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* ── Baixo: botão principal ── */}
                <div className={`flex flex-col gap-2 ${step === 4 ? 'mt-1.5' : 'mt-auto'}`}>
                  <button
                    onClick={handleNext}
                    disabled={(step === 1 && !isStep1Valid) || (step === 2 && !isStep2Valid) || (step === 3 && !isStep3Valid) || isFinishing}
                    className={`w-full bg-[#F5A623] text-white ${step === 4 ? 'h-[44px]' : 'h-[48px]'} rounded-[12px] font-bold text-[15px] sm:text-[16px] transition-all flex items-center justify-center gap-2 ${((step === 1 && !isStep1Valid) || (step === 2 && !isStep2Valid) || (step === 3 && !isStep3Valid)) || isFinishing ? 'opacity-40 cursor-not-allowed' : 'hover:bg-[#E0901A]'}`}
                  >
                    {isFinishing ? (
                      <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                    ) : (
                      step === 4 ? "Concluir Configuração 🎉" : "Próximo"
                    )}
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

      </div>
    </div>
  );
}

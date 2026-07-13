import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Store, User, Phone, PhoneCall, MapPin, Instagram, Scissors, List, Trash2, Clock, CheckCircle, CheckCircle2, XCircle, Loader2, ChevronLeft } from 'lucide-react';
import { useStore } from '../context/Store';
import { ServiceItem, DaySchedule } from '../types';
import { supabaseService } from '../services/supabaseService';
import { supabase } from '../lib/supabase';

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
}

const DEFAULT_SCHEDULE: Record<string, DaySchedule> = {
  SEG: { enabled: true,  open: '09:00', close: '18:00', breakStart: '12:00', breakEnd: '14:00' },
  TER: { enabled: true,  open: '09:00', close: '18:00', breakStart: '12:00', breakEnd: '14:00' },
  QUA: { enabled: true,  open: '09:00', close: '18:00', breakStart: null,    breakEnd: null    },
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

export function SetupWizard({ onComplete }: SetupWizardProps) {
  const { updateBarberProfile, addService, updateDayConfig, services, removeService } = useStore();
  const [step, setStep] = useState(1);
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

  const [errors, setErrors] = useState<string[]>([]);

  const [handle, setHandle] = useState('');
  const [handleStatus, setHandleStatus] = useState<
    'idle' | 'checking' | 'available' | 'taken' | 'invalid'
  >('idle');

  const checkHandleAvailability = async (value: string) => {
    if (value.length < 3 || /[^a-z0-9-]/.test(value)) return;
    setHandleStatus('checking');
    const { data } = await supabase
      .from('profiles')
      .select('id')
      .eq('slug', value)
      .limit(1);
    setHandleStatus(data && data.length > 0 ? 'taken' : 'available');
  };

  const handleHandleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setHandle(val);
    if (/[^a-z0-9-]/.test(val)) {
      setHandleStatus('invalid');
    } else {
      setHandleStatus('idle');
    }
  };

  const commDigits = profileData.businessPhone.replace(/\D/g, '');
  const isBusinessPhoneValid = commDigits.length === 0 || validatePhone(profileData.businessPhone);
  const isStep1Valid = profileData.name.trim() !== '' && validatePhone(profileData.personalPhone) && isBusinessPhoneValid && handleStatus === 'available';
  const isStep2Valid = profileData.shopName.trim() !== '';

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
      setStep(4);
    } else if (step === 4) {
      handleComplete();
    }
  };

  const handleComplete = async () => {
    setIsFinishing(true);

    try {
      console.group('[ONBOARDING] handleComplete iniciado');
      console.log('[ONBOARDING] localServices a salvar:', JSON.stringify(localServices, null, 2));
      console.log('[ONBOARDING] quantidade de serviços:', localServices.length);

      // 1. Salvar perfil
      await updateBarberProfile({
        ...profileData,
        slug: handle,
        logo: '',
        photo: '',
        website: '',
        working_hours: schedule,
      });

      console.log('[ONBOARDING] ► iniciando limpeza dos serviços antigos...');

      // 2. Substituir serviços
      const userId = await supabaseService.getUserId();
      if (userId) {
        // Deleta todos os serviços existentes do usuário
        await supabase.from('services').delete().eq('user_id', userId);
        console.log('[ONBOARDING] removeService/delete chamado para todos os serviços do user');
        
        // Insere os novos serviços diretamente
        const isUUID = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
        const payload = localServices.map((s, index) => {
          console.log('[ONBOARDING] addService chamado para:', s.name, '| resultado esperado no banco');
          return {
            id: isUUID(s.id) ? s.id : crypto.randomUUID(),
            user_id: userId,
            name: s.name,
            price: s.price,
            duration: s.duration,
            order_index: index
          };
        });
        
        const { data: inserted, error: insertErr } = await supabase.from('services').insert(payload).select();
        console.log('[ONBOARDING] ✅ Serviços inseridos diretamente:', inserted);
        console.log('[ONBOARDING] ❌ Erro ao inserir:', insertErr);

        const { data: checkServ, error: checkErr } = await supabase
          .from('services')
          .select('id, name, user_id')
          .eq('user_id', userId);
        console.log('[ONBOARDING] ✅ Verificação direta no banco após salvar:', checkServ);
        console.log('[ONBOARDING] ❌ Erro na verificação:', checkErr);
      }

      // 3. Salvar horários
      console.group('[DEBUG-AGENDA] SetupWizard - Configuração Inicial');
      const dayMap: Record<number, string> = { 0: 'DOM', 1: 'SEG', 2: 'TER', 3: 'QUA', 4: 'QUI', 5: 'SEX', 6: 'SAB' };
      for (let day = 0; day <= 6; day++) {
        const dayKey = dayMap[day];
        const daySched = schedule[dayKey];
        const breaks: string[] = [];
        if (daySched.breakStart && daySched.breakEnd) {
          breaks.push(...generateBreakSlots(daySched.breakStart, daySched.breakEnd));
        }
        
        console.log(`[DEBUG-AGENDA] Enviando Dia ${day} (${dayKey}):`, {
          isOpen: daySched.enabled,
          tipoIsOpen: typeof daySched.enabled,
          start: daySched.open,
          end: daySched.close
        });

        await updateDayConfig(day, {
          isOpen: daySched.enabled,
          start: daySched.open,
          end: daySched.close,
          breaks: breaks,
        });
      }
      console.groupEnd();

      setIsFinishing(false);
      setIsFinished(true);
      
      await new Promise(resolve => setTimeout(resolve, 500)); // aguarda Supabase processar
      setTimeout(() => {
        onComplete();
      }, 2500);

    } catch (err) {
      console.error(err);
      setIsFinishing(false);
    }
  };

  const addLocalService = () => {
    setLocalServices([
      ...localServices,
      { id: Date.now().toString(), name: 'Novo Serviço', price: 0, duration: 30 }
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

  return (
    <div className="fixed inset-0 z-[9999] flex flex-col h-[100dvh] w-full bg-[#F5A623] pt-[env(safe-area-inset-top)]">
      
      <div className="flex-1 w-full bg-white flex flex-col mx-auto max-w-[480px] relative px-6 pt-4 pb-5 justify-between overflow-hidden">
        
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
                <div className="flex-1 flex flex-col justify-center gap-3 py-4">
                  <div className="w-[48px] h-[48px] rounded-full bg-[#FFF3E0] text-[#F5A623] flex items-center justify-center mx-auto mb-1 shrink-0">
                    {step === 1 && <User size={24} />}
                    {step === 2 && <Scissors size={24} />}
                    {step === 3 && <List size={24} />}
                    {step === 4 && <Clock size={24} />}
                  </div>

                  <h2 className="text-[22px] font-bold text-[#1E1B4B] text-center pt-0 -mt-[13px]">
                    {step === 1 && "Vamos começar! Como podemos te chamar?"}
                    {step === 2 && "Agora, sobre sua barbearia"}
                    {step === 3 && "Quais serviços você oferece?"}
                    {step === 4 && "Quando você atende?"}
                  </h2>
                  <p className="text-[13px] text-[#6B7280] text-center mb-1">
                    {step === 1 && "Suas informações de contato para seus clientes."}
                    {step === 2 && "Essas informações aparecem para seus clientes na hora de agendar."}
                    {step === 3 && "Você pode editar isso depois. Já deixamos alguns prontos para você!"}
                    {step === 4 && "Configure os dias e horários. Você pode ajustar isso nas Configurações a qualquer momento."}
                  </p>

                  <div className="flex flex-col flex-1 max-h-full -mt-[9px]">
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
                        <div className="flex flex-row items-center pl-2 pr-3 mb-1 gap-2 shrink-0">
                          <div className="w-4 shrink-0"></div>
                          <span className="flex-[3] text-[11px] font-medium text-[#888] text-center w-0">Serviço</span>
                          <span className="flex-[1.5] text-[11px] font-medium text-[#888] text-center w-0">Preço</span>
                          <span className="flex-[1.5] text-[11px] font-medium text-[#888] text-center w-0">Duração</span>
                          <div className="w-8 shrink-0"></div>
                        </div>

                        <div className="flex-1 overflow-y-auto min-h-0 flex flex-col pr-1">
                          {localServices.map((service, index) => (
                            <div key={service.id} className="bg-[#F5F5F8] rounded-[12px] p-2 flex flex-row items-center gap-2 mb-2 shrink-0">
                              <span className="text-[#D1D5DB] cursor-grab shrink-0 w-4 text-center">⠿</span>
                              <input
                                type="text"
                                value={service.name}
                                onChange={(e) => updateLocalService(service.id, 'name', e.target.value)}
                                className="flex-[3] w-0 bg-white border border-[#E0E0E0] rounded-[8px] px-2 py-2 text-[14px] text-[#333] focus:outline-none placeholder-[#BDBDBD]"
                                placeholder="Nome do serviço"
                              />
                              <input
                                type="text"
                                inputMode="numeric"
                                value={service.price || ''}
                                onChange={(e) => updateLocalService(service.id, 'price', Number(e.target.value))}
                                className="flex-[1.5] w-0 bg-white border border-[#E0E0E0] rounded-[8px] px-2 py-2 text-[14px] text-[#333] text-center focus:outline-none placeholder-[#BDBDBD]"
                                placeholder="R$"
                              />
                              <select
                                value={service.duration || ''}
                                onChange={(e) => updateLocalService(service.id, 'duration', Number(e.target.value))}
                                className="flex-[1.5] w-0 bg-white border border-[#E0E0E0] rounded-[8px] pl-1 pr-0 py-2 text-[14px] text-[#333] focus:outline-none placeholder-[#BDBDBD] text-center appearance-none"
                              >
                                {generateDurationOptions().map(opt => (
                                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                              </select>
                              <button onClick={() => removeLocalService(service.id)} className="w-8 flex items-center justify-center p-1 text-[#F44336] hover:bg-red-50 rounded shrink-0">
                                <Trash2 size={18} />
                              </button>
                            </div>
                          ))}
                          
                          <button
                            onClick={addLocalService}
                            className="w-full shrink-0 mt-1 mb-2 border-2 border-dashed border-[#F5A623]/50 text-[#F5A623] hover:bg-[#F5A623]/5 rounded-[12px] p-2 font-medium text-[14px] flex justify-center items-center gap-2"
                          >
                            + Adicionar serviço
                          </button>
                        </div>
                      </div>
                    )}

                    {step === 4 && (
                      <div className="flex flex-col gap-2 mt-2 w-full">
                        <div className="flex flex-row px-1 mb-1">
                          <span className="w-9"></span>
                          <span className="flex-[2] text-[11px] font-medium text-[#9CA3AF] text-center">Horário</span>
                          <span className="flex-[2] text-[11px] font-medium text-[#9CA3AF] text-center">Pausa</span>
                          <span className="w-[34px]"></span>
                        </div>
                        {['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB', 'DOM'].map((dayKey) => {
                          const sched = schedule[dayKey];
                          return (
                            <div key={dayKey} className={`flex flex-row items-center gap-1.5 transition-opacity ${sched.enabled ? '' : 'opacity-40'}`}>
                              <span className="w-9 text-[12px] font-bold text-[#555]">{dayKey}</span>
                              <div className="flex-[2] flex flex-row gap-1">
                                <input
                                  type="time"
                                  value={sched.open}
                                  disabled={!sched.enabled}
                                  onChange={(e) => updateScheduleDay(dayKey, 'open', e.target.value)}
                                  className={`flex-1 w-0 border border-[#E0E0E0] rounded-[8px] p-1 text-[13px] text-center focus:outline-none [&::-webkit-calendar-picker-indicator]:hidden ${sched.enabled ? 'bg-white text-[#333]' : 'bg-[#F5F5F5] text-[#BDBDBD]'}`}
                                />
                                <input
                                  type="time"
                                  value={sched.close}
                                  disabled={!sched.enabled}
                                  onChange={(e) => updateScheduleDay(dayKey, 'close', e.target.value)}
                                  className={`flex-1 w-0 border border-[#E0E0E0] rounded-[8px] p-1 text-[13px] text-center focus:outline-none [&::-webkit-calendar-picker-indicator]:hidden ${sched.enabled ? 'bg-white text-[#333]' : 'bg-[#F5F5F5] text-[#BDBDBD]'}`}
                                />
                              </div>
                              <div className="flex-[2] flex flex-row gap-1">
                                <input
                                  type="time"
                                  value={sched.enabled ? (sched.breakStart || '') : ''}
                                  disabled={!sched.enabled}
                                  onChange={(e) => updateScheduleDay(dayKey, 'breakStart', e.target.value || null)}
                                  className={`flex-1 w-0 border border-[#E0E0E0] rounded-[8px] p-1 text-[13px] text-center focus:outline-none [&::-webkit-calendar-picker-indicator]:hidden ${sched.enabled ? 'bg-white text-[#333]' : 'bg-[#F5F5F5] text-[#BDBDBD]'}`}
                                />
                                <input
                                  type="time"
                                  value={sched.enabled ? (sched.breakEnd || '') : ''}
                                  disabled={!sched.enabled}
                                  onChange={(e) => updateScheduleDay(dayKey, 'breakEnd', e.target.value || null)}
                                  className={`flex-1 w-0 border border-[#E0E0E0] rounded-[8px] p-1 text-[13px] text-center focus:outline-none [&::-webkit-calendar-picker-indicator]:hidden ${sched.enabled ? 'bg-white text-[#333]' : 'bg-[#F5F5F5] text-[#BDBDBD]'}`}
                                />
                              </div>
                              <button
                                onClick={() => {
                                  const newEnabled = !sched.enabled;
                                  updateScheduleDay(dayKey, 'enabled', newEnabled);
                                  if (!newEnabled) {
                                    updateScheduleDay(dayKey, 'breakStart', null);
                                    updateScheduleDay(dayKey, 'breakEnd', null);
                                  }
                                }}
                                className="w-[34px] flex justify-center shrink-0"
                              >
                                <div className={`w-[34px] h-[20px] rounded-full p-[2px] transition-colors relative ${sched.enabled ? 'bg-[#F5A623]' : 'bg-[#E0E0E0]'}`}>
                                  <motion.div 
                                      animate={{ x: sched.enabled ? 14 : 0 }}
                                      className="w-[16px] h-[16px] bg-white rounded-full shadow-sm"
                                  />
                                </div>
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                {/* ── Baixo: botão principal ── */}
                <div className="flex flex-col gap-2 mt-auto">
                  <button
                    onClick={handleNext}
                    disabled={(step === 1 && !isStep1Valid) || (step === 2 && !isStep2Valid)}
                    className={`w-full bg-[#F5A623] text-white h-[48px] rounded-[12px] font-bold text-[16px] transition-all flex items-center justify-center gap-2 ${((step === 1 && !isStep1Valid) || (step === 2 && !isStep2Valid)) || isFinishing ? 'opacity-40' : 'hover:bg-[#E0901A]'}`}
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

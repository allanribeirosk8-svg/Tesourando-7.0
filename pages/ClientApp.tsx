import React, { useState, useMemo, useEffect } from 'react';
import { useStore } from '../context/Store';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { generateTimeSlots, getTodayString, formatDate, formatCurrency, formatPhone, getOccupiedSlots, capitalizeName, normalizeTime } from '../utils/helpers';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { CheckCircle2, Clock, X, AlertCircle, Settings2, Edit3, Trash2 } from 'lucide-react';

type Step = 'welcome' | 'booking' | 'confirm' | 'success';

export const ClientApp: React.FC = () => {
  const { appointments, addAppointment, deleteAppointment, blockedSlots, weeklySchedule, services, barberProfile } = useStore();
  const [step, setStep] = useState<Step>('welcome');
  const [lastAptId, setLastAptId] = useState<string | null>(null);
  const [canCancel, setCanCancel] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [cancelMessage, setCancelMessage] = useState<string | null>(null);
  
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    date: getTodayString(),
    time: '',
    serviceIds: [] as string[],
    observation: ''
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  const selectedServices = useMemo(() => {
    return services.filter(s => formData.serviceIds.includes(s.id));
  }, [services, formData.serviceIds]);

  const totalPrice = useMemo(() => {
    return selectedServices.reduce((sum, s) => sum + s.price, 0);
  }, [selectedServices]);

  const totalDuration = useMemo(() => {
    return selectedServices.reduce((sum, s) => sum + (s.duration || 15), 0);
  }, [selectedServices]);

  // Generate slots specifically for the selected date
  const daySlots = useMemo(() => {
    const dateObj = new Date(formData.date + 'T12:00:00');
    const dayOfWeek = dateObj.getDay();
    const config = weeklySchedule[dayOfWeek];

    if (!config || !config.isOpen) return [];

    const slots = generateTimeSlots(config.start, config.end);

    // Filter out past times if the selected date is today
    if (formData.date === getTodayString()) {
        const now = new Date();
        return slots.filter(slot => {
            const [hours, minutes] = slot.split(':').map(Number);
            const slotDate = new Date();
            slotDate.setHours(hours, minutes, 0, 0);
            return slotDate > now;
        });
    }

    return slots;
  }, [weeklySchedule, formData.date]);

  // Memoize slots that are unavailable
  const unavailableSlots = useMemo(() => {
    const dateObj = new Date(formData.date + 'T12:00:00');
    const dayOfWeek = dateObj.getDay();
    const config = weeklySchedule[dayOfWeek];
    
    if (!config || !config.isOpen) return [];

    const booked: string[] = [];
    appointments
      .filter(apt => apt.date === formData.date)
      .forEach(apt => {
        const slots = getOccupiedSlots(apt.time, apt.duration || 15);
        booked.push(...slots);
      });
    
    const blockedManual = blockedSlots[formData.date] || [];
    const weeklyBreaks = config.breaks || [];
    
    const baseUnavailable = daySlots.filter(slot => {
      const isBreak = weeklyBreaks.some(b => normalizeTime(b) === slot);
      const isBlockedToday = blockedManual.some(s => normalizeTime(s) === slot);
      const isBooked = booked.some(s => normalizeTime(s) === slot);
      return isBreak || isBlockedToday || isBooked;
    });

    // If a service is selected, we need to check if there's enough consecutive space
    if (totalDuration > 15) {
      return daySlots.filter(slot => {
        if (baseUnavailable.includes(slot)) return true;
        const requiredSlots = getOccupiedSlots(slot, totalDuration);
        // Check if all required slots are within business hours and not in baseUnavailable
        return !requiredSlots.every(s => daySlots.includes(s) && !baseUnavailable.includes(s));
      });
    }

    return baseUnavailable;
  }, [appointments, blockedSlots, weeklySchedule, formData.date, daySlots, totalDuration]);

  const handleSlotSelect = (time: string) => {
    if (unavailableSlots.includes(time)) return;
    setFormData(prev => ({ ...prev, time }));
    setErrors(prev => ({ ...prev, time: '' }));
  };

  const toggleService = (id: string) => {
    setFormData(prev => {
      const isSelected = prev.serviceIds.includes(id);
      const newIds = isSelected 
        ? prev.serviceIds.filter(sid => sid !== id)
        : [...prev.serviceIds, id];
      return { ...prev, serviceIds: newIds };
    });
    setErrors(prev => ({ ...prev, service: '' }));
  };

  const validateWelcome = () => {
    const newErrors: Record<string, string> = {};
    if (!formData.name.trim()) newErrors.name = "Conte-nos seu nome";
    if (!formData.phone.trim() || formData.phone.length < 14) newErrors.phone = "WhatsApp inválido";
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const validateBooking = () => {
    const newErrors: Record<string, string> = {};
    if (!formData.time) newErrors.time = "Escolha um horário";
    if (formData.serviceIds.length === 0) newErrors.service = "Escolha ao menos um serviço";
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleGoToBooking = () => {
    if (validateWelcome()) {
      setStep('booking');
    }
  };

  const handleGoToConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    if (validateBooking()) {
      setStep('confirm');
    }
  };

  const handleFinalize = () => {
    if (selectedServices.length === 0) return;

    const serviceNames = selectedServices.map(s => s.name).join(', ');
    const id = Date.now().toString();

    addAppointment({
      id,
      clientName: capitalizeName(formData.name),
      phone: formData.phone,
      date: formData.date,
      time: formData.time,
      service: serviceNames,
      price: totalPrice,
      duration: totalDuration,
      observation: formData.observation,
      status: 'pending',
      createdAt: Date.now()
    });

    setLastAptId(id);
    setCanCancel(true);
    setStep('success');
  };

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (canCancel) {
      timer = setTimeout(() => {
        setCanCancel(false);
      }, 5 * 60 * 1000); // 5 minutes
    }
    return () => clearTimeout(timer);
  }, [canCancel]);

  const handleCancelAppointment = () => {
    if (lastAptId) {
      deleteAppointment(lastAptId);
      setLastAptId(null);
      setCanCancel(false);
      setShowCancelConfirm(false);
      setCancelMessage("Tudo bem, imprevistos acontecem! Seu horário foi liberado.");
      setStep('welcome');
      
      // Clear message after 5 seconds
      setTimeout(() => setCancelMessage(null), 5000);
    }
  };

  const handleAlterAppointment = () => {
    if (lastAptId) {
      deleteAppointment(lastAptId);
      setLastAptId(null);
      setCanCancel(false);
      setShowCancelConfirm(false);
      setStep('booking');
    }
  };

  if (step === 'success') {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center p-4 bg-primary">
        <div className="bg-surface p-6 md:p-8 rounded-[2rem] shadow-soft w-full max-w-md text-center border border-title/30 animate-in fade-in zoom-in-95 duration-500">
          <div className="w-16 h-16 bg-green-50 text-green-500 rounded-full flex items-center justify-center mx-auto mb-4 shadow-inner-soft">
            <CheckCircle2 size={32} />
          </div>
          
          <h2 className="text-2xl font-black text-title mb-1 uppercase tracking-tighter">Confirmado!</h2>
          
          <div className="bg-primary rounded-2xl p-4 mb-4 border border-title/30 text-left space-y-1.5">
            <div className="flex justify-between items-center">
              <span className="text-[9px] font-black uppercase tracking-widest text-muted">Data</span>
              <span className="text-xs font-bold text-slate-700">{formatDate(formData.date)}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-[9px] font-black uppercase tracking-widest text-muted">Horário</span>
              <span className="text-xs font-black text-secondary">{formData.time}</span>
            </div>
            <div className="flex justify-between items-start">
              <span className="text-[9px] font-black uppercase tracking-widest text-muted">Serviço</span>
              <span className="text-xs font-bold text-slate-700 text-right max-w-[150px] truncate">{selectedServices.map(s => s.name).join(', ')}</span>
            </div>
            {barberProfile.address && (
              <div className="flex justify-between items-start pt-2 border-t border-title/30/50 mt-1">
                <span className="text-[9px] font-black uppercase tracking-widest text-muted">Endereço</span>
                <span className="text-[10px] font-bold text-title text-right max-w-[180px] leading-tight">{barberProfile.address}</span>
              </div>
            )}
          </div>

          <p className="text-title mb-4 text-xs leading-relaxed">
            Olá <span className="font-bold text-secondary">{formData.name}</span>, sua reserva em <span className="font-bold text-secondary">{barberProfile.shopName}</span> foi realizada com sucesso.
          </p>

          <div className="space-y-3">
            <Button fullWidth onClick={() => {
              console.log("6. Modal fechado");
              setStep('welcome');
              setFormData({
                name: '',
                phone: '',
                date: getTodayString(),
                time: '',
                serviceIds: [],
                observation: ''
              });
              setLastAptId(null);
              setCanCancel(false);
            }} className="h-14 rounded-2xl font-black uppercase tracking-widest shadow-lg shadow-brand-500/20">
              Voltar ao Início
            </Button>

            {canCancel && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="pt-1"
              >
                <button 
                  onClick={() => setShowCancelConfirm(true)}
                  className="flex items-center justify-center gap-2 w-full py-2 text-[10px] font-black uppercase tracking-widest text-muted hover:text-red-500 transition-colors"
                >
                  <Clock size={12} />
                  Ops, quero alterar ou cancelar
                </button>
              </motion.div>
            )}
          </div>
        </div>

        {/* Cancel Confirmation Modal */}
        <AnimatePresence>
          {showCancelConfirm && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
              <motion.div 
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 20 }}
                className="bg-surface w-full max-w-sm rounded-[2rem] p-6 sm:p-8 shadow-2xl border border-title/30 text-center max-h-[90vh] overflow-y-auto"
              >
                <div className="w-16 h-16 bg-blue-50 text-blue-500 rounded-full flex items-center justify-center mx-auto mb-6">
                  <Settings2 size={32} />
                </div>
                <h3 className="text-xl font-black text-title mb-2 uppercase tracking-tight">Alterar ou Cancelar?</h3>
                <p className="text-title text-sm mb-8 leading-relaxed">
                  O que você deseja fazer com seu agendamento?
                </p>
                <div className="flex flex-col gap-3">
                  <button 
                    onClick={handleAlterAppointment}
                    className="h-14 rounded-2xl bg-secondary text-white text-white font-black uppercase tracking-widest text-[11px] shadow-lg shadow-brand-500/20 hover:bg-secondary text-white transition-colors flex items-center justify-center gap-2"
                  >
                    <Edit3 size={16} />
                    Alterar Agendamento
                  </button>
                  <button 
                    onClick={handleCancelAppointment}
                    className="h-14 rounded-2xl bg-red-50 text-red-500 font-black uppercase tracking-widest text-[11px] hover:bg-red-100 transition-colors flex items-center justify-center gap-2"
                  >
                    <Trash2 size={16} />
                    Cancelar Agendamento
                  </button>
                  <button 
                    onClick={() => setShowCancelConfirm(false)}
                    className="w-full py-3 text-[10px] font-black uppercase tracking-widest text-muted hover:text-title transition-colors"
                  >
                    Manter como está
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </main>
    );
  }

  if (step === 'confirm') {
    return (
      <main className="min-h-screen bg-soft-background p-3 sm:p-6 flex flex-col items-center justify-center">
        <div className="w-full max-w-md space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="bg-surface rounded-[2rem] shadow-2xl overflow-hidden border border-title/30 relative">
            <div className="bg-secondary text-white p-6 text-center text-white">
              {barberProfile.logo ? (
                  <img src={barberProfile.logo} className="w-12 h-12 rounded-xl mx-auto mb-3 object-cover border-2 border-white/20" alt="Logo" />
              ) : (
                  <h2 className="text-xl font-black uppercase tracking-widest">{barberProfile.shopName}</h2>
              )}
              <h2 className="text-base font-black uppercase tracking-widest opacity-90">Resumo do Corte</h2>
              <p className="text-brand-100 text-[9px] font-bold uppercase tracking-[0.3em] mt-1">Confirme seu agendamento</p>
            </div>
            
            <div className="p-6 space-y-4 relative">
              <div className="space-y-3">
                <div className="flex justify-between items-start border-b border-title/30 pb-3">
                  <div className="space-y-0.5">
                    <p className="text-[9px] text-muted font-black uppercase tracking-widest">Cliente</p>
                    <p className="text-sm font-bold text-title">{formData.name}</p>
                  </div>
                  <div className="text-right space-y-0.5">
                    <p className="text-[9px] text-muted font-black uppercase tracking-widest">WhatsApp</p>
                    <p className="text-sm font-bold text-title">{formData.phone}</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-[9px] text-muted font-black uppercase tracking-widest">Serviços Selecionados</p>
                  <div className="space-y-1.5">
                    {selectedServices.map(s => (
                      <div key={s.id} className="flex justify-between items-center bg-primary px-3 py-2 rounded-xl border border-title/30">
                        <span className="text-xs font-bold text-slate-700">{s.name}</span>
                        <span className="text-xs font-black text-secondary">{formatCurrency(s.price)}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex justify-between items-center border-t border-b border-title/30 py-3 border-dashed">
                  <div className="space-y-0.5">
                    <p className="text-[9px] text-muted font-black uppercase tracking-widest">Data</p>
                    <p className="text-sm font-bold text-title">{formatDate(formData.date)}</p>
                  </div>
                  <div className="text-right space-y-0.5">
                    <p className="text-[9px] text-muted font-black uppercase tracking-widest">Horário</p>
                    <p className="text-lg font-black text-secondary">{formData.time}</p>
                  </div>
                </div>

                {barberProfile.address && (
                    <div className="space-y-0.5 border-b border-title/30 pb-3">
                        <p className="text-[9px] text-muted font-black uppercase tracking-widest">Localização</p>
                        <p className="text-[11px] text-slate-700 font-medium leading-tight">
                          {barberProfile.address}
                        </p>
                    </div>
                )}

                {formData.observation && (
                  <div className="space-y-0.5">
                    <p className="text-[9px] text-muted font-black uppercase tracking-widest">Sua Observação</p>
                    <p className="text-[11px] text-title italic leading-relaxed">"{formData.observation}"</p>
                  </div>
                )}
              </div>

              <div className="bg-slate-900 text-white p-4 rounded-2xl flex justify-between items-center shadow-lg">
                <span className="text-[10px] font-black uppercase tracking-widest text-muted">Total a pagar:</span>
                <span className="text-xl font-black">{formatCurrency(totalPrice)}</span>
              </div>
            </div>

            <div className="absolute bottom-0 left-0 right-0 flex justify-between px-1 translate-y-1/2">
              {[...Array(12)].map((_, i) => (
                <div key={i} className="w-3 h-3 rounded-full bg-soft-background"></div>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Button fullWidth onClick={handleFinalize} className="h-14 text-sm font-black uppercase tracking-widest shadow-xl shadow-brand-500/30">
              Confirmar Agendamento
            </Button>
            <button 
              onClick={() => setStep('booking')}
              className="w-full py-2 text-[9px] font-black uppercase tracking-[0.2em] text-muted hover:text-title transition-colors"
            >
              Corrigir dados
            </button>
          </div>
        </div>
      </main>
    );
  }

  if (step === 'welcome') {
    return (
      <main className="min-h-screen bg-soft-background flex flex-col items-center justify-center p-6">
        <AnimatePresence>
          {cancelMessage && (
            <motion.div 
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="fixed top-8 left-1/2 -translate-x-1/2 z-[60] bg-slate-900 text-white px-6 py-3 rounded-2xl shadow-2xl flex items-center gap-3 border border-slate-700 w-[90%] max-w-sm"
            >
              <div className="w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center shrink-0">
                <CheckCircle2 size={14} strokeWidth={4} />
              </div>
              <span className="text-[10px] font-black uppercase tracking-widest leading-tight">{cancelMessage}</span>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="w-full max-w-md space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700 py-4">
          <header className="text-center space-y-3">
             {barberProfile.logo ? (
                 <div className="relative inline-block">
                    <img 
                        src={barberProfile.logo} 
                        className="w-20 h-20 object-cover rounded-[2rem] shadow-2xl border-4 border-white mx-auto mb-2" 
                        alt="Logo Negócio" 
                    />
                    <div className="absolute -bottom-1 -right-1 bg-secondary text-white text-white p-1 rounded-lg shadow-lg border-2 border-white">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                    </div>
                 </div>
             ) : (
                 <div className="inline-block bg-secondary text-white text-white p-4 rounded-[1.2rem] shadow-xl shadow-brand-500/20 mb-1">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.121 14.121L19 19m-7-7l7-7m-7 7l-2.879 2.879M12 12L9.121 9.121m0 5.758L6 18m3.121-9.121L6 6" />
                    </svg>
                 </div>
             )}
             <div className="space-y-1">
                <h1 className="text-3xl font-black text-title tracking-tight uppercase leading-none">{barberProfile.shopName}</h1>
                <p className="text-muted text-[8px] font-bold uppercase tracking-[0.3em]">
                    {barberProfile.description || 'Sua barbearia na palma da mão'}
                </p>
             </div>
          </header>

          <section className="bg-surface p-6 sm:p-8 rounded-[2rem] shadow-soft border border-title/30 space-y-6">
            <div className="space-y-2">
              <h2 className="text-xl font-bold text-title tracking-tight">Agende agora!</h2>
              <p className="text-muted text-xs leading-relaxed">
                Olá! Para iniciarmos seu agendamento, por favor informe seus dados de contato abaixo.
              </p>
            </div>

            <div className="space-y-4">
              <Input 
                label="Seu nome"
                placeholder="Como quer ser chamado?"
                value={formData.name}
                onChange={e => setFormData({...formData, name: e.target.value})}
                error={errors.name}
              />
              <Input 
                label="Seu WhatsApp"
                type="tel"
                placeholder="(00) 00000-0000"
                value={formData.phone}
                onChange={e => setFormData({...formData, phone: formatPhone(e.target.value)})}
                error={errors.phone}
                maxLength={15}
              />
            </div>

            <Button fullWidth onClick={handleGoToBooking} className="h-14 rounded-2xl text-sm font-black uppercase tracking-widest shadow-xl shadow-brand-500/30 active:scale-95">
              Escolher Horário
            </Button>
          </section>

          <footer className="text-center flex flex-col gap-2">
            <Link to="/admin" className="text-[10px] text-muted font-black uppercase tracking-[0.2em] hover:text-secondary transition-colors">
              Sou Barbeiro
            </Link>
          </footer>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-soft-background p-3 sm:p-6 flex justify-center items-center">
      <section className="w-full max-w-md space-y-4 animate-in fade-in slide-in-from-right-4 duration-500">
        <header className="flex justify-between items-center px-2">
          <button 
            onClick={() => setStep('welcome')}
            className="flex items-center gap-2 text-muted hover:text-secondary transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            <span className="text-[9px] font-black uppercase tracking-widest">Voltar</span>
          </button>
          <div className="text-right">
             <p className="text-[9px] text-muted font-black uppercase tracking-widest">Olá, {formData.name.split(' ')[0]}</p>
          </div>
        </header>

        <form onSubmit={handleGoToConfirm} className="bg-surface p-6 rounded-[2rem] shadow-soft space-y-4 border border-title/30">
          <div className="space-y-0.5">
             <h2 className="text-lg font-bold text-title">Escolha os detalhes</h2>
             <p className="text-muted text-[9px] font-bold uppercase tracking-widest">O que faremos hoje?</p>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black text-muted ml-1 uppercase tracking-widest">Serviços</label>
            <div className="grid grid-cols-2 gap-2">
              {services.map(service => {
                const isSelected = formData.serviceIds.includes(service.id);
                return (
                  <button
                    key={service.id}
                    type="button"
                    onClick={() => toggleService(service.id)}
                    className={`
                      relative flex flex-col justify-between p-3 rounded-xl border transition-all text-left h-full
                      ${isSelected 
                        ? 'bg-primary border-brand-500 ring-1 ring-brand-500' 
                        : 'bg-surface border-title/30 hover:border-slate-300'}
                    `}
                  >
                    <div className="pr-4">
                      <p className={`font-bold text-[11px] leading-tight mb-0.5 ${isSelected ? 'text-secondary' : 'text-title'}`}>
                        {service.name}
                      </p>
                      <p className="text-[9px] text-secondary font-black">{formatCurrency(service.price)}</p>
                    </div>
                    
                    <div className={`absolute top-2 right-2 w-3.5 h-3.5 rounded-full border flex items-center justify-center transition-colors
                      ${isSelected ? 'bg-secondary text-white border-brand-500 text-white' : 'border-title/30 bg-surface'}`}>
                      {isSelected && <svg xmlns="http://www.w3.org/2000/svg" className="h-2 w-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={4}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                    </div>
                  </button>
                );
              })}
            </div>
            {errors.service && <span className="text-[10px] text-red-500 ml-1 font-bold">{errors.service}</span>}
            
            {selectedServices.length > 0 && (
              <div className="bg-primary p-2 rounded-lg flex justify-between items-center mt-1 border border-title/30 border-dashed">
                <span className="text-[9px] font-black text-muted uppercase tracking-widest">Total:</span>
                <span className="text-xs font-black text-secondary">{formatCurrency(totalPrice)}</span>
              </div>
            )}
          </div>

          <Input 
            label="Data"
            type="date"
            min={getTodayString()}
            value={formData.date}
            onChange={e => setFormData({...formData, date: e.target.value, time: ''})}
          />

          <div className="space-y-2">
            <label className="text-[10px] font-black text-muted ml-1 uppercase tracking-widest">Horários</label>
            {daySlots.length === 0 ? (
               <div className="p-4 bg-primary rounded-xl text-center border border-title/30 border-dashed">
                  <p className="text-[9px] text-muted font-bold uppercase tracking-widest">Barbearia Fechada</p>
               </div>
            ) : (
              <div className="grid grid-cols-4 gap-1.5">
                {daySlots.map(slot => {
                  const isUnavailable = unavailableSlots.includes(slot);
                  const isSelected = formData.time === slot;
                  
                  return (
                    <button
                      key={slot}
                      type="button"
                      disabled={isUnavailable}
                      onClick={() => handleSlotSelect(slot)}
                      className={`
                        py-2.5 rounded-xl text-[11px] font-bold transition-all flex flex-col items-center justify-center
                        ${isSelected 
                          ? 'bg-secondary text-white text-white shadow-lg shadow-brand-500/30 scale-105 z-10' 
                          : isUnavailable 
                            ? 'bg-primary text-muted cursor-not-allowed border border-transparent opacity-60' 
                            : 'bg-surface text-title border-title/30 hover:border-brand-500 hover:text-secondary'}
                      `}
                    >
                      <span>{slot}</span>
                    </button>
                  );
                })}
              </div>
            )}
            {errors.time && <p className="text-[9px] text-red-500 ml-1 font-bold uppercase tracking-widest">{errors.time}</p>}
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-black text-muted ml-1 uppercase tracking-widest">
              Recado para o Barbeiro
            </label>
            <textarea 
              className="w-full px-4 py-2.5 rounded-xl border border-title/30 bg-primary text-title placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-100 min-h-[60px] text-xs transition-all"
              placeholder="Opcional..."
              value={formData.observation}
              onChange={e => setFormData({...formData, observation: e.target.value})}
            />
          </div>

          <div className="pt-2">
            <Button type="submit" fullWidth disabled={!formData.time || formData.serviceIds.length === 0} className="h-14 text-sm font-black uppercase tracking-widest rounded-2xl shadow-xl shadow-brand-500/20">
              Revisar Agendamento
            </Button>
          </div>
        </form>
      </section>
    </main>
  );
};
import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Plus, Trash2, Edit2, Save, Clock, Phone, User, Percent, ChevronLeft, Calendar, Coffee, ArrowLeft } from 'lucide-react';
import { useStore } from '../context/Store';
import { Staff, StaffAvailability } from '../types';

interface StaffConfigModalProps {
  onClose: () => void;
}

const DIAS_SEMANA = [
  { value: 0, label: 'Domingo' },
  { value: 1, label: 'Segunda' },
  { value: 2, label: 'Terça' },
  { value: 3, label: 'Quarta' },
  { value: 4, label: 'Quinta' },
  { value: 5, label: 'Sexta' },
  { value: 6, label: 'Sábado' },
];

export const StaffConfigModal: React.FC<StaffConfigModalProps> = ({ onClose }) => {
  const { staff, addStaff, updateStaff, deleteStaff, getStaffAvailability, saveStaffAvailability, weeklySchedule, userRole, session } = useStore();
  
  // Telas internas: 'list' | 'edit_form' | 'availability_form'
  const [view, setView] = useState<'list' | 'edit_form' | 'availability_form'>('list');
  
  // Profissional em edição ou configuração
  const [selectedStaffMember, setSelectedStaffMember] = useState<Staff | null>(null);
  
  // Campos de edição do profissional
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [commission, setCommission] = useState('30');
  const [status, setStatus] = useState<'active' | 'inactive'>('active');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Estados da configuração de disponibilidade do profissional
  // Record do dia da semana (0-6) -> configurações de horário
  const [availabilities, setAvailabilities] = useState<Record<number, {
    isOpen: boolean;
    startTime: string;
    endTime: string;
    breaks: string[];
  }>>({});
  
  const [loadingAvail, setLoadingAvail] = useState(false);
  const [savingAvail, setSavingAvail] = useState(false);

  // Inicializar formulário de cadastro/edição
  const openEditForm = (member: Staff | null) => {
    setSelectedStaffMember(member);
    if (member) {
      setName(member.name);
      setPhone(member.phone);
      setCommission(String(member.commissionRate || 0));
      setStatus(member.status || 'active');
    } else {
      setName('');
      setPhone('');
      setCommission('30');
      setStatus('active');
    }
    setView('edit_form');
  };

  const handleSaveStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setIsSubmitting(true);
    try {
      const commRate = parseFloat(commission) || 0;
      if (selectedStaffMember) {
        await updateStaff(selectedStaffMember.id, {
          name: name.trim(),
          phone: phone.trim(),
          commissionRate: commRate,
          status: status
        });
      } else {
        await addStaff({
          name: name.trim(),
          phone: phone.trim(),
          commissionRate: commRate,
          status: 'active'
        });
      }
      setView('list');
    } catch (err) {
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteStaff = async (id: string) => {
    if (confirm('Tem certeza de que deseja remover este profissional? Todos os seus dados de comissão serão mantidos, mas ele não aparecerá na agenda.')) {
      try {
        await deleteStaff(id);
      } catch (err) {
        console.error(err);
      }
    }
  };

  // Abrir a tela de horários de trabalho
  const openAvailabilityForm = async (member: Staff) => {
    setSelectedStaffMember(member);
    setLoadingAvail(true);
    setView('availability_form');
    
    try {
      const dbAvails = await getStaffAvailability(member.id);
      
      // Criar mapa com base nos dados do banco ou herdar do padrão da barbearia (fallback)
      const map: Record<number, { isOpen: boolean; startTime: string; endTime: string; breaks: string[] }> = {};
      
      DIAS_SEMANA.forEach(day => {
        const found = dbAvails.find(a => a.dayOfWeek === day.value);
        if (found) {
          map[day.value] = {
            isOpen: found.isOpen,
            startTime: found.startTime.substring(0, 5),
            endTime: found.endTime.substring(0, 5),
            breaks: found.breaks || []
          };
        } else {
          // Herda do padrão da barbearia (weeklySchedule da store)
          const tenantDay = weeklySchedule[day.value];
          map[day.value] = {
            isOpen: tenantDay ? tenantDay.isOpen : false,
            startTime: tenantDay ? tenantDay.start : '09:00',
            endTime: tenantDay ? tenantDay.end : '19:00',
            breaks: tenantDay ? tenantDay.breaks : []
          };
        }
      });
      
      setAvailabilities(map);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingAvail(false);
    }
  };

  useEffect(() => {
    if (userRole === 'staff' && session?.user?.id) {
      const selfMember = staff.find(s => s.userId === session.user.id);
      if (selfMember) {
        openAvailabilityForm(selfMember);
      }
    }
  }, [userRole, session, staff]);

  const handleSaveAvailability = async () => {
    if (!selectedStaffMember) return;
    setSavingAvail(true);
    try {
      const payload: Omit<StaffAvailability, 'id'>[] = Object.keys(availabilities).map(dayKey => {
        const dayOfWeek = parseInt(dayKey, 10);
        const config = availabilities[dayOfWeek];
        return {
          staffId: selectedStaffMember.id,
          dayOfWeek,
          startTime: config.startTime,
          endTime: config.endTime,
          breaks: config.breaks,
          isOpen: config.isOpen
        };
      });
      
      await saveStaffAvailability(payload);
      alert('Horários de trabalho salvos com sucesso!');
      setView('list');
    } catch (err) {
      console.error(err);
      alert('Erro ao salvar horários de trabalho.');
    } finally {
      setSavingAvail(false);
    }
  };

  const toggleDayOpen = (day: number) => {
    setAvailabilities(prev => ({
      ...prev,
      [day]: {
        ...prev[day],
        isOpen: !prev[day].isOpen
      }
    }));
  };

  const updateDayTimes = (day: number, field: 'startTime' | 'endTime', value: string) => {
    setAvailabilities(prev => ({
      ...prev,
      [day]: {
        ...prev[day],
        [field]: value
      }
    }));
  };

  const toggleBreakTime = (day: number, timeStr: string) => {
    setAvailabilities(prev => {
      const currentBreaks = prev[day].breaks || [];
      const updatedBreaks = currentBreaks.includes(timeStr)
        ? currentBreaks.filter(b => b !== timeStr)
        : [...currentBreaks, timeStr].sort();
        
      return {
        ...prev,
        [day]: {
          ...prev[day],
          breaks: updatedBreaks
        }
      };
    });
  };

  // Gerar horários sugeridos de pausa (de 1h em 1h ou de 30 em 30 min) entre o horário de expediente
  const getSuggestedBreaks = (startTime: string, endTime: string) => {
    const breaks = [];
    const [startH] = startTime.split(':').map(Number);
    const [endH] = endTime.split(':').map(Number);
    
    for (let h = startH; h < endH; h++) {
      const hStr = String(h).padStart(2, '0');
      breaks.push(`${hStr}:00`);
      breaks.push(`${hStr}:30`);
    }
    return breaks;
  };

  return (
    <div className="fixed inset-0 z-[250] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bg-surface w-full max-w-lg rounded-[2rem] shadow-2xl border border-white/10 flex flex-col h-[85vh] overflow-hidden"
      >
        {/* Cabeçalho */}
        <div className="p-6 border-b border-white/5 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            {view !== 'list' && userRole !== 'staff' && (
              <button 
                onClick={() => setView('list')}
                className="w-10 h-10 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center text-white"
              >
                <ArrowLeft size={18} />
              </button>
            )}
            <div>
              <h3 className="text-lg font-black text-white uppercase tracking-tight">
                {view === 'list' && 'Equipe da Barbearia'}
                {view === 'edit_form' && (selectedStaffMember ? 'Editar Profissional' : 'Novo Profissional')}
                {view === 'availability_form' && 'Horários de Trabalho'}
              </h3>
              <p className="text-xs text-title mt-0.5">
                {view === 'list' && 'Gerencie profissionais, comissões e horários'}
                {view === 'edit_form' && 'Preencha os dados do colaborador'}
                {view === 'availability_form' && selectedStaffMember?.name}
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="w-10 h-10 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center text-white transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Conteúdo com Scroll */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          
          {/* VISÃO 1: Listagem de Profissionais */}
          {view === 'list' && (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold text-title uppercase tracking-wider">{staff.length} profissionais ativos</span>
                <button
                  onClick={() => openEditForm(null)}
                  className="flex items-center gap-1.5 py-2 px-4 rounded-xl bg-primary hover:bg-primary/95 text-xs font-bold text-white transition-all active:scale-95"
                >
                  <Plus size={14} />
                  <span>Novo Profissional</span>
                </button>
              </div>

              {staff.length === 0 ? (
                <div className="bg-white/5 rounded-2xl p-8 text-center space-y-2">
                  <User size={36} className="text-title/40 mx-auto" />
                  <p className="text-sm font-medium text-white">Nenhum profissional cadastrado</p>
                  <p className="text-xs text-title/60">Sua barbearia está utilizando o cadastro global do dono como padrão.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {staff.map((member) => (
                    <div 
                      key={member.id}
                      className="bg-white/5 border border-white/5 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-11 h-11 rounded-full bg-primary/20 flex items-center justify-center font-bold text-primary text-base">
                          {member.name.substring(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <h4 className="text-sm font-bold text-white flex items-center gap-2">
                            {member.name}
                            {member.status === 'inactive' && (
                              <span className="bg-red-500/10 text-red-400 text-[10px] font-black uppercase px-2 py-0.5 rounded-full">Inativo</span>
                            )}
                          </h4>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-title">
                            <span className="flex items-center gap-1">
                              <Percent size={12} className="text-secondary" />
                              {member.commissionRate}% de comissão
                            </span>
                            {member.phone && (
                              <span className="flex items-center gap-1">
                                <Phone size={12} />
                                {member.phone}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 self-end sm:self-center">
                        <button
                          onClick={() => openAvailabilityForm(member)}
                          className="flex items-center gap-1 py-1.5 px-3 rounded-lg bg-secondary/10 hover:bg-secondary/20 active:scale-95 text-[11px] font-bold text-secondary border border-secondary/15 transition-all"
                        >
                          <Clock size={12} />
                          <span>Horários</span>
                        </button>
                        <button
                          onClick={() => openEditForm(member)}
                          className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-white"
                        >
                          <Edit2 size={12} />
                        </button>
                        <button
                          onClick={() => handleDeleteStaff(member.id)}
                          className="w-8 h-8 rounded-lg bg-red-500/10 hover:bg-red-500/20 flex items-center justify-center text-red-500"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* VISÃO 2: Formulário de Adicionar/Editar Profissional */}
          {view === 'edit_form' && (
            <form onSubmit={handleSaveStaff} className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-bold text-title uppercase tracking-wider">Nome Completo</label>
                <div className="relative">
                  <User size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-title" />
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Ex: Carlos Silva"
                    className="w-full bg-black/20 text-white rounded-xl py-3 pl-11 pr-4 border border-white/10 focus:border-primary focus:outline-none text-sm transition-colors"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-title uppercase tracking-wider">Telefone (WhatsApp)</label>
                <div className="relative">
                  <Phone size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-title" />
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="Ex: (11) 99999-9999"
                    className="w-full bg-black/20 text-white rounded-xl py-3 pl-11 pr-4 border border-white/10 focus:border-primary focus:outline-none text-sm transition-colors"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-title uppercase tracking-wider">Taxa de Comissão (%)</label>
                <div className="relative">
                  <Percent size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-title" />
                  <input
                    type="number"
                    min="0"
                    max="100"
                    required
                    value={commission}
                    onChange={(e) => setCommission(e.target.value)}
                    placeholder="Ex: 30"
                    className="w-full bg-black/20 text-white rounded-xl py-3 pl-11 pr-4 border border-white/10 focus:border-primary focus:outline-none text-sm transition-colors"
                  />
                </div>
              </div>

              {selectedStaffMember && (
                <div className="space-y-2">
                  <label className="text-xs font-bold text-title uppercase tracking-wider">Status do Profissional</label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setStatus('active')}
                      className={`py-3 rounded-xl font-bold text-xs border transition-all ${
                        status === 'active' 
                          ? 'bg-primary/20 border-primary text-white' 
                          : 'bg-black/10 border-white/5 text-title hover:bg-black/20'
                      }`}
                    >
                      Ativo
                    </button>
                    <button
                      type="button"
                      onClick={() => setStatus('inactive')}
                      className={`py-3 rounded-xl font-bold text-xs border transition-all ${
                        status === 'inactive' 
                          ? 'bg-red-500/20 border-red-500 text-white' 
                          : 'bg-black/10 border-white/5 text-title hover:bg-black/20'
                      }`}
                    >
                      Inativo (Bloqueia Agenda)
                    </button>
                  </div>
                </div>
              )}

              <div className="pt-4 flex gap-3">
                <button
                  type="button"
                  onClick={() => setView('list')}
                  className="flex-1 py-3.5 rounded-xl text-white font-bold text-sm bg-white/5 hover:bg-white/10 active:scale-95 transition-all border border-white/5"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 py-3.5 rounded-xl text-white font-bold text-sm bg-primary hover:bg-primary/95 active:scale-95 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
                >
                  <Save size={16} />
                  <span>{isSubmitting ? 'Salvando...' : 'Salvar Dados'}</span>
                </button>
              </div>
            </form>
          )}

          {/* VISÃO 3: Disponibilidade Semanal Individual por Profissional */}
          {view === 'availability_form' && (
            <div className="space-y-6">
              {loadingAvail ? (
                <div className="text-center py-12 text-title text-sm">Carregando horários de trabalho...</div>
              ) : (
                <div className="space-y-4">
                  <p className="text-xs text-title">Dica: Se um dia estiver ativado, o profissional atenderá nesse período. Você também pode marcar os horários que correspondem a pausas individuais.</p>
                  
                  <div className="space-y-3">
                    {DIAS_SEMANA.map((day) => {
                      const dayConfig = availabilities[day.value];
                      if (!dayConfig) return null;

                      const suggestedBreaks = getSuggestedBreaks(dayConfig.startTime, dayConfig.endTime);

                      return (
                        <div key={day.value} className="bg-black/20 border border-white/5 rounded-2xl p-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-bold text-white">{day.label}</span>
                            <button
                              onClick={() => toggleDayOpen(day.value)}
                              className={`py-1 px-3.5 rounded-full text-[10px] font-black uppercase transition-all ${
                                dayConfig.isOpen
                                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                  : 'bg-white/5 text-title border border-white/5'
                              }`}
                            >
                              {dayConfig.isOpen ? 'Ativo' : 'Fechado'}
                            </button>
                          </div>

                          {dayConfig.isOpen && (
                            <div className="space-y-3 pt-2">
                              {/* Horários de início e fim */}
                              <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1">
                                  <label className="text-[10px] text-title uppercase font-bold tracking-wide">Início do Turno</label>
                                  <input
                                    type="time"
                                    value={dayConfig.startTime}
                                    onChange={(e) => updateDayTimes(day.value, 'startTime', e.target.value)}
                                    className="w-full bg-black/40 text-white rounded-xl py-2 px-3 border border-white/10 focus:outline-none focus:border-primary text-sm font-semibold"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <label className="text-[10px] text-title uppercase font-bold tracking-wide">Fim do Turno</label>
                                  <input
                                    type="time"
                                    value={dayConfig.endTime}
                                    onChange={(e) => updateDayTimes(day.value, 'endTime', e.target.value)}
                                    className="w-full bg-black/40 text-white rounded-xl py-2 px-3 border border-white/10 focus:outline-none focus:border-primary text-sm font-semibold"
                                  />
                                </div>
                              </div>

                              {/* Horários de Pausa */}
                              <div className="space-y-1.5">
                                <label className="text-[10px] text-title uppercase font-bold tracking-wide flex items-center gap-1">
                                  <Coffee size={11} className="text-secondary" />
                                  Pausas e Intervalos Individuais
                                </label>
                                <div className="flex flex-wrap gap-1.5 max-h-[120px] overflow-y-auto p-1 bg-black/10 rounded-xl">
                                  {suggestedBreaks.map(time => {
                                    const isBreak = dayConfig.breaks.includes(time);
                                    return (
                                      <button
                                        key={time}
                                        type="button"
                                        onClick={() => toggleBreakTime(day.value, time)}
                                        className={`py-1 px-2.5 rounded-lg text-xs font-semibold border transition-all ${
                                          isBreak
                                            ? 'bg-secondary/15 border-secondary text-secondary'
                                            : 'bg-black/20 border-white/5 text-title hover:bg-black/30'
                                        }`}
                                      >
                                        {time}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div className="pt-4 flex gap-3">
                    <button
                      type="button"
                      onClick={() => setView('list')}
                      className="flex-1 py-3.5 rounded-xl text-white font-bold text-sm bg-white/5 hover:bg-white/10 active:scale-95 transition-all border border-white/5"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveAvailability}
                      disabled={savingAvail}
                      className="flex-1 py-3.5 rounded-xl text-white font-bold text-sm bg-primary hover:bg-primary/95 active:scale-95 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
                    >
                      <Save size={16} />
                      <span>{savingAvail ? 'Salvando...' : 'Salvar Horários'}</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

        </div>
      </motion.div>
    </div>
  );
};

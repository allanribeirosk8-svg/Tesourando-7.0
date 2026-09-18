import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Plus, Trash2, Edit2, Save, Clock, Phone, User, Percent, ChevronLeft, Calendar, Coffee, ArrowLeft, Mail, Lock, Shield, Camera, AlertTriangle, AlertCircle } from 'lucide-react';
import { useStore } from '../context/Store';
import { Staff, StaffAvailability } from '../types';
import { compressImage, formatPhone } from '../utils/helpers';
import { WorkScheduleModal } from './WorkScheduleModal';

interface StaffConfigModalProps {
  onClose: () => void;
}

export const StaffConfigModal: React.FC<StaffConfigModalProps> = ({ onClose }) => {
  const { staff, addStaff, createStaffDirectly, updateStaff, deleteStaff, removeStaffFromBarbershop, userRole, session, barberProfile, activeTenant, updateBarberProfile } = useStore();
  
  // Telas internas: 'list' | 'edit_form'
  const [view, setView] = useState<'list' | 'edit_form'>('list');

  // Modal unificado de horários de trabalho
  const [scheduleModalStaff, setScheduleModalStaff] = useState<Staff | null>(null);

  // Identificar se um membro é o dono da barbearia
  const isOwnerMember = React.useCallback((member: Staff) => {
    const tenantOwnerId = activeTenant?.id || barberProfile?.id;
    return (
      member.id === tenantOwnerId || 
      member.userId === tenantOwnerId || 
      member.role === 'owner' ||
      member.role === 'admin' ||
      (userRole === 'admin_owner' && (member.userId === session?.user?.id || member.id === session?.user?.id))
    );
  }, [activeTenant?.id, barberProfile?.id, session?.user?.id, userRole]);

  // Identificar se é o usuário atualmente logado
  const isCurrentUser = React.useCallback((member: Staff) => {
    if (session?.user?.id && (member.userId === session.user.id || member.id === session.user.id)) {
      return true;
    }
    if (userRole === 'admin_owner' && isOwnerMember(member)) {
      return true;
    }
    return false;
  }, [session?.user?.id, userRole, isOwnerMember]);

  // Lista de profissionais reais ordenados com o Administrador no topo
  const staffListToRender = React.useMemo(() => {
    const tenantOwnerId = activeTenant?.id || barberProfile?.id || session?.user?.id;
    return [...staff].sort((a, b) => {
      const aIsAdmin = (a.role === 'admin' || a.role === 'admin_owner' || a.userId === tenantOwnerId || a.id === tenantOwnerId) ? 1 : 0;
      const bIsAdmin = (b.role === 'admin' || b.role === 'admin_owner' || b.userId === tenantOwnerId || b.id === tenantOwnerId) ? 1 : 0;
      if (aIsAdmin !== bIsAdmin) {
        return bIsAdmin - aIsAdmin;
      }
      return (a.name || '').localeCompare(b.name || '');
    });
  }, [staff, activeTenant?.id, barberProfile?.id, session?.user?.id]);
  
  // Profissional em edição ou configuração
  const [selectedStaffMember, setSelectedStaffMember] = useState<Staff | null>(null);
  
  // Campos de edição do profissional
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [commission, setCommission] = useState('30');
  const [status, setStatus] = useState<'active' | 'inactive'>('active');
  const [photo, setPhoto] = useState('');
  const photoInputRef = useRef<HTMLInputElement>(null);
  const emailContainerRef = useRef<HTMLDivElement>(null);
  const emailInputRef = useRef<HTMLInputElement>(null);
  
  // Campos para login obrigatório do profissional
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'staff' | 'admin'>('staff');
  
  // Mensagem de erro visual do formulário (exibida exclusivamente na caixa do e-mail)
  const [formError, setFormError] = useState<string | null>(null);

  // Rolar suavemente e posicionar a visão diretamente na caixa de e-mail ao ocorrer erro
  const scrollToEmail = () => {
    setTimeout(() => {
      if (emailContainerRef.current) {
        emailContainerRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else if (emailInputRef.current) {
        emailInputRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      emailInputRef.current?.focus({ preventScroll: true });
    }, 50);
  };

  // Estado para modal de confirmação de remoção
  const [staffToRemove, setStaffToRemove] = useState<Staff | null>(null);
  const [isRemoving, setIsRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const [isSubmitting, setIsSubmitting] = useState(false);

  // Upload e compressão da foto de perfil
  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      try {
        const base64 = await compressImage(e.target.files[0]);
        setPhoto(base64);
      } catch (err) {
        console.error('Erro ao processar imagem do profissional:', err);
      }
    }
  };

  // Inicializar formulário de cadastro/edição
  const openEditForm = (member: Staff | null) => {
    setSelectedStaffMember(member);
    setFormError(null);
    if (member) {
      const isOwner = isOwnerMember(member);
      const currentRole = isOwner ? 'admin' : (member.role === 'admin' || member.role === 'owner' ? 'admin' : 'staff');

      setName(member.name);
      setPhone(formatPhone(member.phone || ''));
      setCommission(String(member.commissionRate || 0));
      setStatus(member.status || 'active');
      setPhoto(member.photo || (isOwner ? (barberProfile?.photo || '') : ''));
      setEmail('');
      setPassword('');
      setRole(currentRole);
    } else {
      setName('');
      setPhone('');
      setCommission('30');
      setStatus('active');
      setPhoto('');
      setEmail('');
      setPassword('');
      setRole('staff');
    }
    setView('edit_form');
  };

  const handleSaveStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!name.trim()) {
      setFormError('Por favor, informe o nome do profissional.');
      return;
    }

    const trimmedEmail = email.trim().toLowerCase();
    const trimmedPass = password.trim();

    // Validações exclusivas para novos colaboradores com login obrigatório
    if (!selectedStaffMember) {
      if (!trimmedEmail || !trimmedEmail.includes('@')) {
        setFormError('Por favor, informe um e-mail válido para criar o login do profissional.');
        scrollToEmail();
        return;
      }

      // Validação de e-mail do proprietário
      if (session?.user?.email && session.user.email.toLowerCase() === trimmedEmail) {
        setFormError('Este e-mail pertence à sua conta de proprietário. Digite um e-mail exclusivo para o profissional.');
        scrollToEmail();
        return;
      }

      // Validação local imediata caso o e-mail já esteja registrado em outro profissional da lista
      const emailAlreadyInStaffList = staff.some(s => 
        (s.email && s.email.toLowerCase() === trimmedEmail) ||
        (s.userId && s.userId === session?.user?.id && session?.user?.email?.toLowerCase() === trimmedEmail)
      );
      if (emailAlreadyInStaffList) {
        setFormError('Este e-mail já está sendo utilizado por outro profissional nesta barbearia.');
        scrollToEmail();
        return;
      }

      if (!trimmedPass || trimmedPass.length < 6) {
        setFormError('A senha provisória do profissional deve ter no mínimo 6 caracteres.');
        return;
      }
    }

    setIsSubmitting(true);

    try {
      const commRate = parseFloat(commission) || 0;
      if (selectedStaffMember) {
        const isOwner = isOwnerMember(selectedStaffMember);
        const finalRole = isOwner ? 'admin' : role;

        await updateStaff(selectedStaffMember.id, {
          name: name.trim(),
          phone: phone.trim(),
          commissionRate: commRate,
          status: status,
          photo: photo || undefined,
          role: finalRole
        });

        // Se for o proprietário, atualizar também o barberProfile
        if (isOwner && barberProfile && updateBarberProfile) {
          await updateBarberProfile({
            ...barberProfile,
            name: name.trim(),
            personalPhone: phone.trim(),
            photo: photo || barberProfile.photo
          });
        }
      } else {
        await createStaffDirectly({
          email: trimmedEmail,
          password: trimmedPass,
          role: role,
          name: name.trim(),
          phone: phone.trim(),
          photo: photo || undefined,
          commissionRate: commRate
        });
      }
      setView('list');
    } catch (err: any) {
      if (err?.isValidationError) {
        console.warn('[CREATE_STAFF_UI] Validação impediu o cadastro:', err.message);
      } else {
        console.error('[CREATE_STAFF_UI] Erro inesperado ao salvar profissional:', err);
      }
      const errorMsg = err?.message || 'Erro ao salvar profissional. Verifique os dados e tente novamente.';
      setFormError(errorMsg);
      scrollToEmail();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmRemoveStaff = async () => {
    if (!staffToRemove) return;
    setIsRemoving(true);
    setRemoveError(null);
    try {
      await removeStaffFromBarbershop({
        staffProfileId: staffToRemove.id,
        staffUserId: staffToRemove.userId,
        barbershopId: activeTenant?.id || ''
      });
      setStaffToRemove(null);
    } catch (err: any) {
      console.error('[REMOVE_STAFF] Erro ao remover profissional:', err);
      setRemoveError(err?.message || 'Erro ao remover profissional. Tente novamente.');
    } finally {
      setIsRemoving(false);
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

  // Abrir o modal unificado de horários de trabalho
  const openAvailabilityForm = (member: Staff) => {
    setScheduleModalStaff(member);
  };

  const isOwnerOrAdmin = userRole === 'admin_owner' || userRole === 'admin';

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
              <div className="flex justify-between items-center gap-2">
                <span className="text-[8px] font-bold text-title uppercase tracking-wider">
                  {staffListToRender.length} profissionais na equipe
                </span>
                <button
                  onClick={() => openEditForm(null)}
                  style={{ width: '152.953px', height: '31px' }}
                  className="w-[153px] h-[31px] flex items-center justify-center gap-1.5 rounded-xl bg-primary hover:bg-primary/95 text-xs font-bold text-white transition-all active:scale-95 shrink-0"
                >
                  <Plus size={14} />
                  <span>Novo Profissional</span>
                </button>
              </div>

              {staffListToRender.length === 0 ? (
                <div className="bg-white/5 rounded-2xl p-8 text-center space-y-2">
                  <User size={36} className="text-title/40 mx-auto" />
                  <p className="text-sm font-medium text-white">Nenhum profissional cadastrado</p>
                  <p className="text-xs text-title/60">Sua barbearia está utilizando o cadastro do dono como padrão.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {staffListToRender.map((member) => {
                    const isOwner = isOwnerMember(member);
                    const showYou = isCurrentUser(member);
                    const memberPhoto = member.photo || (isOwner ? barberProfile?.photo : undefined);
                    
                    return (
                      <div 
                        key={member.id}
                        className={`bg-white/5 border ${isOwner ? 'border-[#F99417]/30 bg-[#F99417]/5' : 'border-white/5'} rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4`}
                      >
                        <div className="flex items-center gap-3">
                          <div className={`w-11 h-11 rounded-full ${isOwner ? 'bg-[#F99417]/20 text-[#F99417]' : 'bg-primary/20 text-primary'} flex items-center justify-center font-bold text-base shrink-0 overflow-hidden border border-white/10`}>
                            {memberPhoto ? (
                              <img src={memberPhoto} alt={member.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                            ) : (
                              member.name.substring(0, 2).toUpperCase()
                            )}
                          </div>
                          <div>
                            <h4 className="text-sm font-bold text-white flex flex-wrap items-center gap-2">
                              <span>{member.name}</span>
                              {showYou && (
                                <span className="text-[#F99417] text-xs font-black tracking-tight">(Você)</span>
                              )}
                              {isOwner || member.role === 'admin' || member.role === 'admin_owner' ? (
                                <span className="bg-amber-500/15 text-amber-400 border border-amber-500/30 text-[10px] font-black uppercase px-2 py-0.5 rounded-full flex items-center gap-1">
                                  <Shield size={10} />
                                  Administrador
                                </span>
                              ) : (
                                <span className="bg-blue-500/15 text-blue-400 border border-blue-500/30 text-[10px] font-black uppercase px-2 py-0.5 rounded-full flex items-center gap-1">
                                  <User size={10} />
                                  Profissional
                                </span>
                              )}
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
                                  {formatPhone(member.phone)}
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
                          {!isOwner && (
                            <button
                              onClick={() => {
                                setStaffToRemove(member);
                                setRemoveError(null);
                              }}
                              title="Remover profissional"
                              className="w-8 h-8 rounded-lg bg-red-500/10 hover:bg-red-500/20 active:scale-95 flex items-center justify-center text-red-500 transition-all"
                            >
                              <Trash2 size={12} />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* VISÃO 2: Formulário de Adicionar/Editar Profissional */}
          {view === 'edit_form' && (
            <form onSubmit={handleSaveStaff} className="space-y-4">
              {/* Foto de Perfil */}
              <div className="flex flex-col items-center gap-2 pb-2 border-b border-white/5">
                <div 
                  onClick={() => photoInputRef.current?.click()} 
                  className="relative w-20 h-20 rounded-full bg-black/40 border-2 border-dashed border-white/20 flex items-center justify-center overflow-hidden cursor-pointer hover:border-primary transition-colors group shrink-0"
                >
                  {photo ? (
                    <img src={photo} className="w-full h-full object-cover" alt="Foto do profissional" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="flex flex-col items-center justify-center text-title/60 group-hover:text-primary transition-colors">
                      <Camera size={26} />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity text-white text-[10px] font-bold uppercase tracking-wider">
                    Alterar
                  </div>
                </div>
                <input 
                  type="file" 
                  ref={photoInputRef} 
                  className="hidden" 
                  accept="image/*" 
                  onChange={handlePhotoUpload} 
                />
                <span className="text-[11px] font-medium text-title/70">
                  {photo ? 'Clique para alterar a foto' : 'Adicionar foto de perfil'}
                </span>
              </div>

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
                    onChange={(e) => setPhone(formatPhone(e.target.value))}
                    maxLength={15}
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

              {!selectedStaffMember && (
                <div className="pt-3 mt-3 border-t border-white/5 space-y-3">
                  <div className="flex items-center gap-2">
                    <Shield size={15} className="text-primary shrink-0" />
                    <div>
                      <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                        Acesso ao Sistema (Login Obrigatório)
                      </h4>
                      <p className="text-[11px] text-title/70">
                        Defina o e-mail e a senha que o profissional usará para acessar a agenda no aplicativo.
                      </p>
                    </div>
                  </div>

                  <div className="space-y-1.5 pt-1" ref={emailContainerRef}>
                    <label className="text-xs font-bold text-title uppercase tracking-wider flex items-center justify-between">
                      <span>E-mail do Profissional</span>
                      <span className="text-[10px] font-bold text-amber-400">obrigatório</span>
                    </label>
                    <div className="relative">
                      <Mail size={16} className={`absolute left-4 top-1/2 -translate-y-1/2 transition-colors ${
                        formError ? 'text-red-400' : 'text-title'
                      }`} />
                      <input
                        id="staff-email-input"
                        ref={emailInputRef}
                        type="email"
                        required
                        value={email}
                        onChange={(e) => {
                          setEmail(e.target.value);
                          if (formError) setFormError(null);
                        }}
                        placeholder="profissional@email.com"
                        className={`w-full bg-black/20 text-white rounded-xl py-3 pl-11 pr-4 border text-sm transition-all focus:outline-none ${
                          formError
                            ? 'border-red-500 ring-2 ring-red-500/20 focus:border-red-400'
                            : 'border-white/10 focus:border-primary'
                        }`}
                      />
                    </div>
                    {formError && (
                      <p 
                        id="staff-email-error-message"
                        role="alert"
                        className="text-xs font-medium text-red-400 flex items-center gap-1.5 pt-1 animate-in fade-in"
                      >
                        <AlertCircle size={13} className="shrink-0 text-red-400" />
                        <span>{formError}</span>
                      </p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-title uppercase tracking-wider flex items-center justify-between">
                      <span>Senha Provisória</span>
                      <span className="text-[10px] font-bold text-amber-400">mín. 6 dígitos</span>
                    </label>
                    <div className="relative">
                      <Lock size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-title" />
                      <input
                        id="staff-password-input"
                        type="password"
                        required
                        value={password}
                        onChange={(e) => {
                          setPassword(e.target.value);
                          if (formError) setFormError(null);
                        }}
                        placeholder="Min. 6 caracteres (Ex: Mudar@123)"
                        className="w-full bg-black/20 text-white rounded-xl py-3 pl-11 pr-4 border border-white/10 focus:border-primary focus:outline-none text-sm transition-colors"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Cargo / Nível de Acesso (Sempre visível para definir o papel no sistema) */}
              <div className="pt-3 mt-3 border-t border-white/5 space-y-3">
                <label className="text-xs font-bold text-title uppercase tracking-wider flex items-center gap-1.5">
                  <Shield size={14} className="text-[#F99417]" />
                  <span>Nível de Acesso (Cargo)</span>
                </label>

                {selectedStaffMember && isOwnerMember(selectedStaffMember) ? (
                  <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs space-y-1">
                    <p className="font-bold flex items-center gap-1.5 text-amber-300 uppercase tracking-wider">
                      <Shield size={14} />
                      Proprietário do Estabelecimento
                    </p>
                    <p className="text-[11px] leading-relaxed text-title/80">
                      Administrador principal da barbearia. O cargo do proprietário é fixo e não pode ser alterado.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          if (role !== 'staff') {
                            setRole('staff');
                          }
                        }}
                        className={`p-3.5 rounded-2xl font-bold text-xs border flex flex-col items-center gap-1.5 transition-all active:scale-95 ${
                          role === 'staff'
                            ? 'bg-blue-500/20 border-blue-500 text-white shadow-lg shadow-blue-500/10 ring-1 ring-blue-500/50'
                            : 'bg-black/20 border-white/10 text-title/70 hover:bg-black/30 hover:border-white/20'
                        }`}
                      >
                        <div className={`p-2 rounded-xl ${role === 'staff' ? 'bg-blue-500/30 text-blue-400' : 'bg-white/5 text-title/50'}`}>
                          <User size={18} />
                        </div>
                        <span>Profissional</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (role !== 'admin') {
                            setRole('admin');
                          }
                        }}
                        className={`p-3.5 rounded-2xl font-bold text-xs border flex flex-col items-center gap-1.5 transition-all active:scale-95 ${
                          role === 'admin'
                            ? 'bg-amber-500/20 border-amber-500 text-white shadow-lg shadow-amber-500/10 ring-1 ring-amber-500/50'
                            : 'bg-black/20 border-white/10 text-title/70 hover:bg-black/30 hover:border-white/20'
                        }`}
                      >
                        <div className={`p-2 rounded-xl ${role === 'admin' ? 'bg-amber-500/30 text-amber-400' : 'bg-white/5 text-title/50'}`}>
                          <Shield size={18} />
                        </div>
                        <span>Administrador</span>
                      </button>
                    </div>

                    {/* Legendas separadas por cores com linguagem clara */}
                    <div className="space-y-2 pt-1">
                      <div className={`p-3 rounded-xl border text-xs transition-all flex items-start gap-2.5 ${
                        role === 'staff'
                          ? 'bg-blue-500/15 border-blue-500/30 text-blue-200'
                          : 'bg-black/10 border-white/5 text-title/50'
                      }`}>
                        <User size={16} className={`shrink-0 mt-0.5 ${role === 'staff' ? 'text-blue-400' : 'text-title/40'}`} />
                        <div>
                          <p className={`font-bold text-[11px] uppercase tracking-wider mb-0.5 ${role === 'staff' ? 'text-blue-300' : 'text-title/70'}`}>
                            Profissional
                          </p>
                          <p className="text-[11px] leading-relaxed">
                            Atende clientes e gerencia sua própria agenda.
                          </p>
                        </div>
                      </div>

                      <div className={`p-3 rounded-xl border text-xs transition-all flex items-start gap-2.5 ${
                        role === 'admin'
                          ? 'bg-amber-500/15 border-amber-500/30 text-amber-200'
                          : 'bg-black/10 border-white/5 text-title/50'
                      }`}>
                        <Shield size={16} className={`shrink-0 mt-0.5 ${role === 'admin' ? 'text-amber-400' : 'text-title/40'}`} />
                        <div>
                          <p className={`font-bold text-[11px] uppercase tracking-wider mb-0.5 ${role === 'admin' ? 'text-amber-300' : 'text-title/70'}`}>
                            Administrador
                          </p>
                          <p className="text-[11px] leading-relaxed">
                            Gerencia equipe, agenda, caixa, serviços e relatórios.
                          </p>
                        </div>
                      </div>
                    </div>
                  </>
                )}
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
                  onClick={() => {
                    setFormError(null);
                    setView('list');
                  }}
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

        </div>
      </motion.div>

      {/* MODAL DE CONFIRMAÇÃO DE REMOÇÃO DE PROFISSIONAL */}
      <AnimatePresence>
        {staffToRemove && (
          <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/70 backdrop-blur-md p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-[#1E1B4B] w-full max-w-md rounded-[2rem] p-6 shadow-2xl border border-white/15 text-left space-y-4"
            >
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-red-500/20 text-red-400 flex items-center justify-center shrink-0 border border-red-500/30">
                  <AlertTriangle size={24} />
                </div>
                <div>
                  <h3 className="text-base font-black text-white uppercase tracking-tight">Remover Profissional</h3>
                  <p className="text-xs text-white/60 font-medium">Revogar acesso à barbearia</p>
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-white/5 border border-white/10 flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-secondary/20 flex items-center justify-center font-bold text-secondary text-sm overflow-hidden shrink-0">
                  {staffToRemove.photo ? (
                    <img src={staffToRemove.photo} alt={staffToRemove.name} className="w-full h-full object-cover" />
                  ) : (
                    staffToRemove.name.substring(0, 2).toUpperCase()
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-white truncate">{staffToRemove.name}</p>
                  <p className="text-xs text-title/70">{staffToRemove.phone || 'Sem telefone'}</p>
                </div>
              </div>

              <p className="text-sm text-gray-300 leading-relaxed">
                Este profissional perderá o acesso a esta barbearia. O histórico, atendimentos e comissões serão mantidos. Agendamentos futuros precisarão ser tratados separadamente.
              </p>

              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-200 text-xs space-y-1">
                <p className="font-bold flex items-center gap-1.5 text-amber-300">
                  <AlertTriangle size={14} />
                  O que acontece com os dados:
                </p>
                <ul className="list-disc list-inside text-[11px] text-white/80 space-y-0.5">
                  <li>O profissional não aparecerá mais para novos agendamentos</li>
                  <li>Atendimentos anteriores continuam no histórico e no caixa</li>
                  <li>A conta de usuário do profissional permanece preservada</li>
                </ul>
              </div>

              {removeError && (
                <div className="p-3 rounded-xl bg-red-500/20 border border-red-500/40 text-red-200 text-xs font-medium">
                  {removeError}
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  disabled={isRemoving}
                  onClick={() => {
                    setStaffToRemove(null);
                    setRemoveError(null);
                  }}
                  className="flex-1 py-3.5 rounded-xl text-white font-bold text-sm bg-white/5 hover:bg-white/10 active:scale-95 transition-all border border-white/10 disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={isRemoving}
                  onClick={handleConfirmRemoveStaff}
                  className="flex-1 py-3.5 rounded-xl text-white font-bold text-sm bg-red-500 hover:bg-red-600 active:scale-95 transition-all flex items-center justify-center gap-2 shadow-lg shadow-red-500/20 disabled:opacity-50"
                >
                  {isRemoving ? (
                    <span>Removendo...</span>
                  ) : (
                    <>
                      <Trash2 size={16} />
                      <span>Confirmar Remoção</span>
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* UNIFIED WORK SCHEDULE MODAL */}
      {scheduleModalStaff && (
        <WorkScheduleModal
          isOpen={!!scheduleModalStaff}
          onClose={() => setScheduleModalStaff(null)}
          targetStaffId={scheduleModalStaff.id}
          targetStaffName={scheduleModalStaff.name}
          canChooseStaff={isOwnerOrAdmin}
          staffOptions={staffListToRender}
          onTargetStaffChange={(newId) => {
            const nextStaff = staffListToRender.find(s => s.id === newId);
            if (nextStaff) {
              setScheduleModalStaff(nextStaff);
            }
          }}
        />
      )}
    </div>
  );
};

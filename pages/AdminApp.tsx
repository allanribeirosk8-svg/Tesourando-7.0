import React, { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import { useStore, DEFAULT_DAY_CONFIG } from '../context/Store';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { supabaseService } from '../services/supabaseService';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { compressImage, formatDate, getTodayString, generateTimeSlots, formatCurrency, formatPhone, getOccupiedSlots, normalizePhone, normalizeTime, formatDateLong, capitalizeName, getInitials, getAvatarColor , calcOccupancySlots } from '../utils/helpers';
import { useSwipe } from '../hooks/useSwipe';
import { Onboarding } from '../components/Onboarding';
import { SetupWizard } from '../components/SetupWizard';
import { LoadingScreen } from '../components/LoadingScreen';
import { StaffConfigModal } from '../components/StaffConfigModal';
import { Customer, ServiceItem, Appointment, BarberProfile } from '../types';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence, Reorder } from 'motion/react';
import confetti from 'canvas-confetti';
import { 
  Calendar, 
  Ban, 
  X, 
  Plus, 
  User, 
  LogOut, 
  Settings2, 
  Settings,
  Moon,
  Sun,
  Users, 
  Scissors, 
  BarChart3, 
  Clock, 
  Check, 
  RotateCcw, 
  Trash2, 
  Edit3, 
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  ChevronsRight,
  ChevronsLeft,
  Search,
  UserPlus,
  Camera,
  AlertTriangle,
  Instagram,
  MapPin,
  Phone,
  Save,
  Lock,
  Unlock,
  ThumbsDown,
  Repeat,
  ArrowLeft,
  GripVertical,
  TrendingUp,
  TrendingDown,
  Zap,
  CheckCircle2,
  XCircle,
  Minus,
  DollarSign,
  Users2,
  Bell,
  Activity,
  Award,
  UserX,
  PieChart as PieChartIcon,
  LayoutDashboard,
  Pencil,
  Mail,
  Eye,
  EyeOff,
  Filter,
  Info,
  Wallet,
  Link2,
  Copy,
  Share2,
  ExternalLink
} from 'lucide-react';
import { FaWhatsapp } from 'react-icons/fa';
import { CaixaView } from './CaixaView';
import NotificacoesPanel from '../components/NotificacoesPanel';
import { 
  ClientPhotosPreview, 
  ClientPhotosGallery, 
  ClientHistoryPreview, 
  ClientHistoryFull 
} from '../components/CustomerDetailModules';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Cell,
  PieChart,
  Pie
} from 'recharts';

const useLockBodyScroll = (locked: boolean = true) => {
  useEffect(() => {
    if (!locked) return;
    const originalStyle = window.getComputedStyle(document.body).overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = originalStyle;
    };
  }, [locked]);
};

const WEEKDAYS = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];

interface SectionHeaderProps {
  title: string;
  count?: number;
  accent?: 'blue' | 'green' | 'gray';
}

const SectionHeader = ({ title, count, accent = 'blue' }: SectionHeaderProps) => {
  const isGreen = accent === 'green';
  const barColor = isGreen ? 'bg-[#48C78E]' : 'bg-[#F5A623]';
  const badgeColor = isGreen ? 'bg-[#48C78E] text-[#FFFFFF]' : 'bg-[#F5A623] text-[#FFFFFF]';

  return (
    <div className="flex flex-row items-center">
      {/* Barra lateral */}
      <div className={`w-1 h-[18px] rounded-sm ${barColor} mr-2`} />

      {/* Título */}
      <span className={`text-[13px] font-bold tracking-[0.8px] uppercase ${isGreen ? 'text-[#48C78E]' : 'text-[#1E1B4B]'}`}>
        {title}
      </span>

      {/* Badge de contagem */}
      {count !== undefined && (
        <span className={`${badgeColor} text-[11px] font-bold rounded-[10px] px-[7px] py-[2px] ml-2 leading-none`}>
          {count}
        </span>
      )}
    </div>
  );
};

const PhotoActionSheet: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  onSelect: (source: 'camera' | 'gallery') => void;
}> = ({ isOpen, onClose, onSelect }) => {
  useLockBodyScroll();
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[200] flex items-end justify-center bg-black/50 backdrop-blur-sm px-4 pb-8" onClick={onClose}>
      <motion.div 
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        className="w-full max-w-md bg-surface  rounded-3xl overflow-hidden shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-6 space-y-3">
          <h3 className="text-center text-xs font-black uppercase tracking-widest text-title mb-4">Adicionar Foto</h3>
          <button 
            onClick={() => onSelect('camera')}
            className="w-full h-14 bg-primary/40  rounded-2xl flex items-center justify-center gap-3 text-white  font-bold hover:bg-surface/80 transition-colors"
          >
            <Camera size={20} className="text-secondary" />
            Tirar foto agora
          </button>
          <button 
            onClick={() => onSelect('gallery')}
            className="w-full h-14 bg-primary/40  rounded-2xl flex items-center justify-center gap-3 text-white  font-bold hover:bg-surface/80 transition-colors"
          >
            <Plus size={20} className="text-secondary" />
            Escolher da galeria
          </button>
          <button 
            onClick={onClose}
            className="w-full h-14 bg-surface  text-title font-bold uppercase tracking-widest text-xs"
          >
            Cancelar
          </button>
        </div>
      </motion.div>
    </div>
  );
};

const PhotoDescriptionModal: React.FC<{
  isOpen: boolean;
  photo: string;
  onClose: () => void;
  onConfirm: (description: string) => void;
}> = ({ isOpen, photo, onClose, onConfirm }) => {
  useLockBodyScroll();
  const [description, setDescription] = useState('');
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[300] flex items-end justify-center bg-black/50 backdrop-blur-sm px-4 pb-8" onClick={onClose}>
      <motion.div 
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        className="w-full max-w-md bg-surface  rounded-3xl overflow-hidden shadow-2xl flex flex-col max-h-[40vh]"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-6 space-y-4">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-xl overflow-hidden border-2 border-title/30  shrink-0">
              <img src={photo} className="w-full h-full object-cover" alt="Preview" />
            </div>
            <div className="flex-1">
              <h3 className="text-xs font-black uppercase tracking-widest text-title">Descrição da Foto</h3>
              <p className="text-[10px] text-title ">Adicione um detalhe sobre este atendimento</p>
            </div>
          </div>
          
          <div className="space-y-2">
            <textarea 
              autoFocus
              placeholder="Ex: Degradê com franja"
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="w-full bg-primary/40  border-none rounded-2xl p-4 text-sm text-white  focus:ring-2 ring-secondary h-20 resize-none"
            />
          </div>
          
          <div className="flex gap-3">
            <button onClick={onClose} className="flex-1 h-12 rounded-2xl text-title font-bold uppercase tracking-widest text-[10px] bg-primary/40 ">Cancelar</button>
            <button 
              onClick={() => onConfirm(description)}
              className="flex-1 h-12 bg-secondary text-white rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-lg shadow-secondary/20"
            >
              Confirmar
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
};


const ConfiguracoesScreen: React.FC<{
  onOpenProfile: () => void;
  onOpenWeekly: () => void;
  onOpenStaff: () => void;
  onLogout: () => void;
}> = ({ onOpenProfile, onOpenWeekly, onOpenStaff, onLogout }) => {
  const { barberProfile, permissions, userRole } = useStore();
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  const shareUrl = barberProfile?.slug ? `${window.location.origin}/#/agendar/${barberProfile.slug}` : '';

  const handleCopy = () => {
    if (shareUrl) {
      navigator.clipboard.writeText(shareUrl);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    }
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Agende comigo!',
          text: `Agende seu horário com ${barberProfile?.shop_name || barberProfile?.name || 'barbeiro'}`,
          url: shareUrl
        });
      } catch (e) {
        console.log('Share canceled or failed', e);
      }
    } else {
      handleCopy();
    }
  };

  return (
    <>
      <div className="px-4 pt-4 pb-24 relative space-y-6">
        {/* Bloco de Perfil */}
        <button 
          onClick={onOpenProfile}
          className="w-full bg-white/5 rounded-2xl p-4 flex items-center gap-4 text-left"
        >
          <div className="w-16 h-16 rounded-full flex items-center justify-center text-white font-bold text-xl shrink-0 overflow-hidden shadow-sm bg-primary">
            {barberProfile?.avatar ? (
              <img src={barberProfile.avatar} alt={barberProfile.name || 'Barbeiro'} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
            ) : (
              getInitials(barberProfile?.name || 'Barbeiro')
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-bold text-white truncate">{barberProfile?.name || 'Barbearia'}</h2>
            <p className="text-sm text-title truncate">{barberProfile?.phone ? formatPhone(barberProfile.phone) : 'Barbeiro'}</p>
          </div>
          <ChevronRight size={20} className="text-title shrink-0" />
        </button>

        {/* Card "Meu Link de Agendamento" — versão refinada */}
        {barberProfile?.slug && (
          <div className="relative overflow-hidden bg-gradient-to-br from-[#2A2760] to-[#1E1B4B] border border-white/10 rounded-2xl p-4 space-y-4 shadow-xl">
            {/* Decoração de fundo */}
            <div className="absolute -right-8 -top-8 w-36 h-36 rounded-full bg-secondary/10 blur-2xl pointer-events-none" />
            
            <div className="flex items-center gap-3 relative z-10">
              <div className="w-9 h-9 rounded-xl bg-secondary/20 flex items-center justify-center">
                <Link2 size={16} className="text-secondary" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white tracking-wide">Meu Link de Agendamento</h3>
                <p className="text-[11px] text-white/40">Compartilhe com seus clientes</p>
              </div>
            </div>

            <div className="bg-black/20 border border-white/5 rounded-xl px-3 py-2.5 relative z-10">
              <span className="text-[11px] text-white/50 truncate select-all font-mono block">
                {shareUrl}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2 relative z-10">
              <button
                onClick={handleCopy}
                className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-white/5 hover:bg-white/10 active:scale-95 text-xs font-semibold text-white transition-all border border-white/5"
              >
                <Copy size={14} className={linkCopied ? "text-green-400" : "text-white/70"} />
                <span>{linkCopied ? 'Copiado!' : 'Copiar'}</span>
              </button>

              <button
                onClick={handleShare}
                className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-white/5 hover:bg-white/10 active:scale-95 text-xs font-semibold text-white transition-all border border-white/5"
              >
                <Share2 size={14} className="text-white/70" />
                <span>Compartilhar</span>
              </button>

              <button
                onClick={() => window.open(shareUrl, '_blank')}
                className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-secondary/10 hover:bg-secondary/20 active:scale-95 text-xs font-semibold text-secondary transition-all border border-secondary/10"
              >
                <ExternalLink size={14} />
                <span>Abrir</span>
              </button>
            </div>
          </div>
        )}

        {/* Seção CONTA */}
        <div className="space-y-4">
          <h3 className="text-xs font-semibold tracking-[0.08em] text-title px-4">CONTA</h3>
          <div className="bg-surface rounded-2xl overflow-hidden flex flex-col">
            <button 
              onClick={onOpenProfile}
              className="flex items-center gap-3 p-4 min-h-[60px] active:bg-white/5 transition-colors border-b border-white/5"
            >
              <div className="w-9 h-9 rounded-full bg-secondary/10 flex items-center justify-center shrink-0">
                <User size={18} className="text-secondary" />
              </div>
              <div className="flex-1 text-left">
                <p className="text-base font-medium text-white">Meu Perfil</p>
                <p className="text-xs text-title mt-0.5">Nome, foto, telefone</p>
              </div>
              <ChevronRight size={18} className="text-title shrink-0" />
            </button>
            {permissions?.canManageWeeklySchedule && (
              <button 
                onClick={onOpenWeekly}
                className="flex items-center gap-3 p-4 min-h-[60px] active:bg-white/5 transition-colors border-b border-white/5"
              >
                <div className="w-9 h-9 rounded-full bg-secondary/10 flex items-center justify-center shrink-0">
                  <Calendar size={18} className="text-secondary" />
                </div>
                <div className="flex-1 text-left">
                  <p className="text-base font-medium text-white">Padrão Semanal</p>
                  <p className="text-xs text-title mt-0.5">Horários e dias de trabalho</p>
                </div>
                <ChevronRight size={18} className="text-title shrink-0" />
              </button>
            )}
            
            {permissions?.canManageStaff && (
              <button 
                onClick={onOpenStaff}
                className="flex items-center gap-3 p-4 min-h-[60px] active:bg-white/5 transition-colors"
              >
                <div className="w-9 h-9 rounded-full bg-secondary/10 flex items-center justify-center shrink-0">
                  <Users size={18} className="text-secondary" />
                </div>
                <div className="flex-1 text-left">
                  <p className="text-base font-medium text-white">Gerenciar Equipe</p>
                  <p className="text-xs text-title mt-0.5">Profissionais, comissões e disponibilidade</p>
                </div>
                <ChevronRight size={18} className="text-title shrink-0" />
              </button>
            )}

            {userRole === 'staff' && (
              <button 
                onClick={onOpenStaff}
                className="flex items-center gap-3 p-4 min-h-[60px] active:bg-white/5 transition-colors"
              >
                <div className="w-9 h-9 rounded-full bg-secondary/10 flex items-center justify-center shrink-0">
                  <Clock size={18} className="text-secondary" />
                </div>
                <div className="flex-1 text-left">
                  <p className="text-base font-medium text-white">Minha Disponibilidade</p>
                  <p className="text-xs text-title mt-0.5">Configurar meus dias e horários de trabalho</p>
                </div>
                <ChevronRight size={18} className="text-title shrink-0" />
              </button>
            )}
          </div>
        </div>

        {/* Seção SESSÃO */}
        <div className="space-y-4 mt-8">
          <h3 className="text-xs font-semibold tracking-[0.08em] text-title px-4">SESSÃO</h3>
          <button 
            onClick={() => setShowLogoutConfirm(true)}
            className="w-full bg-surface rounded-2xl p-4 min-h-[60px] flex items-center gap-3 active:bg-red-500/10 transition-colors"
          >
            <div className="w-9 h-9 rounded-full bg-red-500/10 flex items-center justify-center shrink-0">
              <LogOut size={18} className="text-red-500" />
            </div>
            <p className="text-base font-medium text-red-500">Sair da conta</p>
          </button>
        </div>

        {/* Rodapé */}
        <div className="pt-4 pb-8">
          <p className="text-xs text-title/50 text-center">Meu Corte v1.0.0</p>
        </div>
      </div>

      <AnimatePresence>
        {showLogoutConfirm && (
          <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-surface w-full max-w-sm rounded-[2rem] p-6 shadow-2xl border border-white/10"
            >
              <h3 className="text-lg font-black text-white text-center uppercase tracking-tight mb-2">Sair da conta?</h3>
              <p className="text-sm text-title text-center mb-8">Você precisará fazer login novamente.</p>
              <div className="flex gap-3">
                <button 
                  onClick={() => setShowLogoutConfirm(false)}
                  className="flex-1 h-12 rounded-xl text-white font-bold text-sm bg-white/5 hover:bg-white/10 transition-colors"
                >
                  Cancelar
                </button>
                <button 
                  onClick={() => {
                    setShowLogoutConfirm(false);
                    onLogout();
                  }}
                  className="flex-1 h-12 rounded-xl text-white font-bold text-sm bg-red-500 hover:bg-red-600 transition-colors"
                >
                  Sair
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
};


const useScrollDirection = () => {
  const [isVisible, setIsVisible] = useState(true);
  const lastScrollY = useRef(0);
  const inactivityTimer = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      
      // Detectar fim da página
      const isAtBottom = 
        window.innerHeight + window.scrollY >= 
        document.body.offsetHeight - 10;

      if (isAtBottom) {
        setIsVisible(true);
        lastScrollY.current = currentScrollY;
        return;
      }

      // Detectar inatividade
      if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
      inactivityTimer.current = setTimeout(() => {
        setIsVisible(true);
      }, 2000);

      // Show if scrolling up or at the top
      if (currentScrollY < lastScrollY.current || currentScrollY < 10) {
        setIsVisible(true);
      } 
      // Hide if scrolling down and not at the top
      else if (currentScrollY > lastScrollY.current && currentScrollY > 50) {
        setIsVisible(false);
      }
      
      lastScrollY.current = currentScrollY;
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
      if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
    };
  }, []);

  return isVisible;
};

const AuthScreen: React.FC<{ onAuthenticated: () => void, initialView?: 'login' | 'register' }> = ({ onAuthenticated, initialView = 'login' }) => {
  const [view, setView] = useState<'login' | 'register'>(initialView);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const mapError = (err: any) => {
    const message = err.message || '';
    if (message === 'Preencha todos os campos' || message === 'As senhas não coincidem') return message;
    if (message.includes('Invalid login credentials')) return 'E-mail ou senha incorretos';
    if (message.includes('User already registered')) return 'Este e-mail já possui uma conta';
    if (message.includes('Password should be at least 6 characters')) return 'A senha deve ter pelo menos 6 caracteres';
    return 'Ocorreu um erro. Tente novamente.';
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    setSuccessMsg('');

    try {
      if (!isSupabaseConfigured()) {
        throw new Error('Supabase não configurado');
      }

      if (view === 'login') {
        if (!email || !password) throw new Error('Preencha todos os campos');
        const { error: loginErr } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (loginErr) throw loginErr;
        onAuthenticated();
      } else {
        if (!email || !password || !confirmPassword) throw new Error('Preencha todos os campos');
        if (password.length < 6) throw new Error('Password should be at least 6 characters');
        if (password !== confirmPassword) throw new Error('As senhas não coincidem');
        
        const { error: signUpErr } = await supabase.auth.signUp({ email, password });
        if (signUpErr) throw signUpErr;
        
        localStorage.setItem('tesourando_new_user', 'true');
        setSuccessMsg('Conta criada! Verifique seu e-mail para confirmar.');
        setTimeout(() => {
          setView('login');
          setSuccessMsg('');
          setPassword('');
          setConfirmPassword('');
        }, 2000);
      }
    } catch (err: any) {
      setError(mapError(err));
    } finally {
      setIsLoading(false);
    }
  };

  const toggleView = () => {
    setView(prev => prev === 'login' ? 'register' : 'login');
    setError('');
    setSuccessMsg('');
    setEmail('');
    setPassword('');
    setConfirmPassword('');
  };

  return (
    <div className="h-[100dvh] w-full flex flex-col relative overflow-hidden bg-secondary font-sans">
      
      {/* Parte laranja */}
      <div className="flex-[3] w-full flex items-center justify-center relative z-0">
        <div className="absolute inset-0 bg-gradient-to-b from-black/10 to-transparent pointer-events-none" />
        
        {/* Logo */}
        <div className="relative z-10 flex flex-col items-center justify-center">
          <img 
            src="/logo512.svg" 
            alt="Logo" 
            className="w-32 h-32 object-contain drop-shadow-[0_4px_8px_rgba(0,0,0,0.3)]" 
          />
        </div>
      </div>

      {/* Card branco */}
      <div className="flex-[5] w-full bg-white rounded-t-[2rem] relative z-10 px-6 pt-7 pb-4 flex flex-col justify-between shadow-[0_-10px_40px_rgba(0,0,0,0.15)] overflow-hidden">
        
        <AnimatePresence mode="wait">
          <motion.div
            key={view}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3 }}
            className="flex-1 flex flex-col"
          >
            {/* Header / Titulo */}
            <div className="mb-4">
              <h2 className="text-[26px] leading-tight font-black text-[#1E1B4B] mb-1 tracking-tight">
                {view === 'login' ? 'Bem-vindo, Barbeiro 👋' : 'Criar nova conta 👋'}
              </h2>
              <p className="text-[#1E1B4B] opacity-70 text-sm font-medium">
                {view === 'login' ? 'Preencha seus dados para entrar na plataforma.' : 'Preencha os dados abaixo para se registrar.'}
              </p>
            </div>

            {/* Form */}
            <form onSubmit={handleAuth} className="flex-1 flex flex-col justify-between">
              <div className="flex flex-col gap-3">
                
                {/* Email Field */}
                <div className="relative group">
                  <div className="absolute left-4 top-1/2 -translate-y-1/2 text-[#1E1B4B] transition-colors">
                    <Mail size={20} />
                  </div>
                  <input 
                    type="email"
                    placeholder="E-mail"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    className="w-full bg-[#F5F5F8] border border-[rgba(30,27,75,0.2)] text-[#1E1B4B] placeholder:text-[#1E1B4B] placeholder:opacity-50 rounded-2xl h-14 pl-12 pr-4 focus:ring-2 focus:ring-secondary/50 focus:border-secondary/50 outline-none transition-all font-medium"
                    required
                  />
                </div>

                {/* Password Field */}
                <div className="relative group">
                  <div className="absolute left-4 top-1/2 -translate-y-1/2 text-[#1E1B4B] transition-colors">
                    <Lock size={20} />
                  </div>
                  <input 
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Senha"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    className="w-full bg-[#F5F5F8] border border-[rgba(30,27,75,0.2)] text-[#1E1B4B] placeholder:text-[#1E1B4B] placeholder:opacity-50 rounded-2xl h-14 pl-12 pr-12 focus:ring-2 focus:ring-secondary/50 focus:border-secondary/50 outline-none transition-all font-medium"
                    required
                  />
                  <button 
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-[#1E1B4B] hover:opacity-70 transition-colors p-1"
                  >
                    {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                  </button>
                </div>

                {/* Confirm Password (Register View) */}
                {view === 'register' && (
                  <motion.div 
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    className="relative group overflow-hidden mt-1"
                  >
                    <div className="absolute left-4 top-1/2 -translate-y-1/2 text-[#1E1B4B] transition-colors">
                      <Lock size={20} />
                    </div>
                    <input 
                      type={showPassword ? 'text' : 'password'}
                      placeholder="Confirmar Senha"
                      value={confirmPassword}
                      onChange={e => setConfirmPassword(e.target.value)}
                      className="w-full bg-[#F5F5F8] border border-[rgba(30,27,75,0.2)] text-[#1E1B4B] placeholder:text-[#1E1B4B] placeholder:opacity-50 rounded-2xl h-14 pl-12 pr-4 focus:ring-2 focus:ring-secondary/50 focus:border-secondary/50 outline-none transition-all font-medium"
                      required
                    />
                  </motion.div>
                )}
                
                {/* Esqueci minha senha link */}
                <div className="flex justify-end pt-1">
                  {view === 'login' && (
                    <button type="button" className="text-sm font-semibold text-[#1E1B4B] hover:opacity-80 transition-opacity">
                      Esqueci minha senha
                    </button>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-3">
                {/* Warnings/Success */}
                <AnimatePresence>
                  {error && (
                    <motion.div 
                      initial={{ opacity: 0, y: -5 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -5 }}
                      className="bg-red-50 border border-red-200 text-red-600 rounded-2xl p-3 text-sm text-center font-semibold"
                    >
                      {error}
                    </motion.div>
                  )}
                  {successMsg && (
                    <motion.div 
                      initial={{ opacity: 0, y: -5 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -5 }}
                      className="bg-green-50 border border-green-200 text-green-600 rounded-2xl p-3 text-sm text-center font-semibold"
                    >
                      {successMsg}
                    </motion.div>
                  )}
                </AnimatePresence>
                <button 
                  type="submit" 
                  disabled={isLoading}
                  className="bg-[#1E1B4B] text-white hover:bg-[#1E1B4B]/90 disabled:opacity-70 disabled:cursor-not-allowed h-[56px] rounded-2xl font-bold w-full transition-all active:scale-[0.98] shadow-lg shadow-[#1E1B4B]/20 flex items-center justify-center text-[15px] mt-2"
                >
                  {isLoading ? (
                    <div className="flex items-center justify-center gap-2">
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span>{view === 'login' ? 'Entrando...' : 'Criando conta...'}</span>
                    </div>
                  ) : (
                    <span>{view === 'login' ? 'Entrar' : 'Registrar'}</span>
                  )}
                </button>

                <div className="text-center mt-1">
                  <p className="text-[#1E1B4B] text-sm font-medium">
                    {view === 'login' ? 'Não tem uma conta?' : 'Já possui uma conta?'}{' '}
                    <button 
                      type="button"
                      onClick={toggleView}
                      className="font-bold text-[#1E1B4B] hover:opacity-80 transition-opacity ml-1"
                    >
                      {view === 'login' ? 'Registrar' : 'Entrar'}
                    </button>
                  </p>
                </div>
              </div>
            </form>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
};

export const AdminApp: React.FC = () => {
  const { 
    barberProfile, 
    appointments, 
    session, 
    isLoading, 
    updateBarberProfile, 
    reloadData, 
    resetStore, 
    permissions, 
    userRole,
    notifications,
    markNotificationAsRead,
    markAllNotificationsAsRead,
    deleteNotification
  } = useStore();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [activeTab, setActiveTab] = useState<'agenda' | 'clientes' | 'servicos' | 'caixa' | 'configuracoes'>('agenda');
  const [selectedDate, setSelectedDate] = useState(getTodayString());
  const [showAddModal, setShowAddModal] = useState(false);
  const [showAddCustomerModal, setShowAddCustomerModal] = useState(false);
  const [showWeeklyModal, setShowWeeklyModal] = useState(false);
  const [showStaffModal, setShowStaffModal] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
    const [showCalendarModal, setShowCalendarModal] = useState(false);
  const [reschedulingApt, setReschedulingApt] = useState<Appointment | null>(null);
  const [targetCustomerPhone, setTargetCustomerPhone] = useState<string | null>(null);
  
  const [prefilledSlot, setPrefilledSlot] = useState<{ date: string, time: string } | null>(null);
  const [isExceptionalMode, setIsExceptionalMode] = useState(false);
  const [prefilledCustomer, setPrefilledCustomer] = useState<Customer | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(() => !localStorage.getItem('tesourando_onboarding_shown'));

  // NOVO: Notificações gerenciadas de forma global pela Store
  const [panelOpen, setPanelOpen] = useState(false);

  useEffect(() => {
    if (isAuthenticated && !isLoading) {
      const isNewUserFlag = localStorage.getItem('tesourando_new_user');
      if (isNewUserFlag === 'true') {
        setShowSetup(true);
        localStorage.removeItem('tesourando_new_user');
      }
    }
  }, [isAuthenticated, isLoading]);

  const handleCompleteSetup = async () => {
    setShowSetup(false);
    await new Promise(r => setTimeout(r, 1000)); // aguarda banco processar
    await reloadData(); // força rebusca dos serviços recém-salvos
    console.log('[ADMIN] reloadData após onboarding concluído');
  };

  useEffect(() => {
    if (isAuthenticated) {
      window.scrollTo(0, 0);
      setActiveTab('agenda');
      setSelectedDate(getTodayString());
    }
  }, [isAuthenticated, isLoading]);

  useEffect(() => {
    if (activeTab === 'agenda') {
      window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    }
  }, [activeTab]);

  const [authInitialView, setAuthInitialView] = useState<'login' | 'register'>('login');

  const handleOnboardingComplete = async (action?: 'login' | 'register') => {
    localStorage.setItem('tesourando_onboarding_shown', 'true');
    setShowOnboarding(false);
    if (action === 'register') {
      setAuthInitialView('register');
    } else {
      setAuthInitialView('login');
    }
  };

  const [photoTargetPhone, setPhotoTargetPhone] = useState<string | null>(null);
  const [showPhotoActionSheet, setShowPhotoActionSheet] = useState(false);
  const [showPhotoDescription, setShowPhotoDescription] = useState(false);

  const isVisible = useScrollDirection();
  const isAnyModalOpen = showAddModal || showAddCustomerModal || showWeeklyModal || 
                         showProfileModal || showCalendarModal || 
                         !!reschedulingApt || showPhotoActionSheet || showPhotoDescription;
  
  const footerVisible = isVisible && !isAnyModalOpen;
  const [tempPhoto, setTempPhoto] = useState<string | null>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  const { updateCustomerPhoto } = useStore();

  const handleCameraClick = (phone: string) => {
    setPhotoTargetPhone(phone);
    setShowPhotoActionSheet(true);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0] && photoTargetPhone) {
      try {
        const base64 = await compressImage(e.target.files[0]);
        setTempPhoto(base64);
        setShowPhotoDescription(true);
      } catch (err) {
        console.error("Erro ao processar foto:", err);
      } finally {
        if (cameraInputRef.current) cameraInputRef.current.value = '';
        if (galleryInputRef.current) galleryInputRef.current.value = '';
      }
    }
  };

  const handleConfirmPhoto = (description: string) => {
    if (tempPhoto && photoTargetPhone) {
      updateCustomerPhoto(photoTargetPhone, tempPhoto, description);
      setSuccessMessage('Foto adicionada ao histórico!');
      setTimeout(() => setSuccessMessage(null), 3000);
      setTempPhoto(null);
      setShowPhotoDescription(false);
      setPhotoTargetPhone(null);
    }
  };

  const pendingTodayCount = useMemo(() => {
    const today = getTodayString();
    return appointments.filter(a => a.date === today && a.status === 'pending').length;
  }, [appointments]);

  useEffect(() => {
    const checkSession = async () => {
      if (isSupabaseConfigured()) {
        const result = await supabase.auth.getSession();
        if (result?.data?.session) {
          setIsAuthenticated(true);
        }
      }
    };
    checkSession();

    if (isSupabaseConfigured()) {
      const authResult = supabase.auth.onAuthStateChange((_event, session) => {
        setIsAuthenticated(!!session);
      });

      return () => {
        if (authResult?.data?.subscription) {
          authResult.data.subscription.unsubscribe();
        }
      };
    }
  }, []);

  const handleLogout = async () => {
    resetStore();
    if (isSupabaseConfigured()) {
      await supabase.auth.signOut();
    }
    setIsAuthenticated(false);
    
  };

  const handleNavigateToCustomer = (phone: string) => {
    setTargetCustomerPhone(phone);
    setActiveTab('clientes');
  };

  const openAddWithSlot = (date: string, time: string, isExceptional: boolean = false) => {
    setPrefilledSlot({ date, time });
    setIsExceptionalMode(isExceptional);
    setShowAddModal(true);
  };

  const openAddForCustomer = (customer: Customer) => {
    setPrefilledCustomer(customer);
    setShowAddModal(true);
  };

  const getGreetingOnly = () => {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) return 'Bom dia,';
    if (hour >= 12 && hour < 18) return 'Boa tarde,';
    return 'Boa noite,';
  };

  const getGreetingEmoji = () => {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) return '☀️';
    if (hour >= 12 && hour < 18) return '👋';
    return '🌙';
  };

  const getGreeting = () => {
    const hour = new Date().getHours();
    const name = barberProfile?.name || 'Barbeiro';
    if (hour >= 5 && hour < 12) return `Bom dia, ${name}! ☀️`;
    if (hour >= 12 && hour < 18) return `Boa tarde, ${name}! 👋`;
    return `Boa noite, ${name}! 🌙`;
  };

  if (showOnboarding) {
    return <Onboarding onComplete={handleOnboardingComplete} />;
  }

  if (!isAuthenticated) {
    return <AuthScreen onAuthenticated={() => setIsAuthenticated(true)} initialView={authInitialView} />;
  }

  if (isLoading) {
    return <div className="fixed inset-0 bg-[#363062]" />;
  }

  return (
    <div className="h-[100dvh] flex flex-col bg-[#1E1B4B] relative overflow-hidden">
      <motion.header 
        className="sticky top-0 z-[100] h-20 bg-[#1E1B4B] px-6 flex items-center justify-between"
        initial={false}
        animate={{ 
          y: footerVisible ? 0 : -100,
          opacity: footerVisible ? 1 : 0
        }}
        transition={{ duration: 0.3, ease: "easeInOut" }}
      >
        {/* Left: Identity & Profile */}
        <div className="flex items-center gap-3">
          {activeTab === 'agenda' ? (
            <div className="flex items-center gap-3">
              {/* Foto de perfil — maior e com ring colorido */}
              <button
                onClick={() => setShowProfileModal(true)}
                className="relative flex-shrink-0"
              >
                <div className="w-12 h-12 rounded-full overflow-hidden border-2 border-secondary/30 shadow-md shadow-secondary/20 bg-surface/80 ">
                  {barberProfile.photo ? (
                    <img src={barberProfile.photo} alt={barberProfile.name}
                      className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <User size={22} className="text-secondary" />
                    </div>
                  )}
                </div>
                {/* Dot de status online */}
                <span className="absolute bottom-0.5 right-0.5 w-3 h-3 bg-[#3CB878] rounded-full border-2 border-white " />
              </button>
              {/* Texto em 2 linhas */}
              <div className="flex flex-col leading-tight">
                <span className="text-[12px] font-normal text-white/65 uppercase tracking-[1.2px]">
                  {getGreetingOnly()}
                </span>
                <span className="text-[20px] font-bold text-white leading-snug">
                  {barberProfile.name || 'Barbeiro'} {getGreetingEmoji()}
                </span>
              </div>
            </div>
          ) : (
            <button 
              onClick={() => setActiveTab('agenda')}
              className="w-10 h-10 rounded-full bg-surface  text-white  flex items-center justify-center hover:bg-primary/40  transition-colors shadow-sm"
              title="Voltar para Agenda"
            >
              <ArrowLeft size={20} />
            </button>
          )}
        </div>

        {/* Center: Title (Only for other tabs) */}
        {activeTab !== 'agenda' && (
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-center pointer-events-none">
            <h2 className="text-lg font-bold uppercase tracking-tight text-white ">
              {activeTab === 'clientes' ? 'Clientes' : activeTab === 'servicos' ? 'Serviços' : activeTab === 'configuracoes' ? 'Gestão' : activeTab === 'caixa' ? 'Financeiro' : 'Financeiro'}
            </h2>
          </div>
        )}

        {/* Right: Notifications */}
        <div className="flex items-center shrink-0">
          <button
            onClick={() => setPanelOpen(true)}
            className="relative p-2"
          >
            <Bell size={22} className="text-white" />
            {notifications.filter(n => !n.read).length > 0 && (
              <span className="absolute top-1 right-1 min-w-[18px] h-[18px] bg-[#F97316] rounded-full text-[10px] font-black text-white flex items-center justify-center px-1">
                {notifications.filter(n => !n.read).length > 99 ? '99+' : notifications.filter(n => !n.read).length}
              </span>
            )}
          </button>
        </div>
        
      </motion.header>

      <main className={`relative flex-1 flex flex-col min-h-0 bg-[#1E1B4B] ${activeTab === 'agenda' ? 'overflow-hidden z-0' : 'overflow-y-auto pb-[92px]'}`}>
        {activeTab === 'agenda' && (
            <AgendaView 
                selectedDate={selectedDate}
                setSelectedDate={setSelectedDate}
                onOpenCustomer={handleNavigateToCustomer} 
                showWeeklyModal={showWeeklyModal}
                setShowWeeklyModal={setShowWeeklyModal}
                onReschedule={setReschedulingApt}
                onAddInSlot={openAddWithSlot}
                handleCameraClick={handleCameraClick}
                onSuccess={(msg) => {
                  setSuccessMessage(msg);
                  setTimeout(() => setSuccessMessage(null), 3000);
                }}
                onNavigateToCaixa={() => setActiveTab('caixa')}
            />
        )}
        {activeTab === 'clientes' && (
          <CustomersView 
            initialPhone={targetCustomerPhone} 
            clearInitial={() => setTargetCustomerPhone(null)} 
            onNewAppointment={openAddForCustomer}
            onAddCustomer={() => setShowAddCustomerModal(true)}
            onSuccess={(msg) => {
              setSuccessMessage(msg);
              setTimeout(() => setSuccessMessage(null), 3000);
            }}
          />
        )}
        {activeTab === 'caixa' && <CaixaView />}
        {activeTab === 'configuracoes' && (
          <ConfiguracoesScreen 
            onOpenProfile={() => setShowProfileModal(true)} 
            onOpenWeekly={() => setShowWeeklyModal(true)} 
            onOpenStaff={() => setShowStaffModal(true)} 
            onLogout={handleLogout} 
          />
        )}
        {activeTab === 'servicos' && (
          <ServicesView 
            onSuccess={(msg) => {
              setSuccessMessage(msg);
              setTimeout(() => setSuccessMessage(null), 3000);
            }}
          />
        )}
      </main>

      {/* Success Toast */}
      <AnimatePresence>
        {successMessage && (
          <motion.div 
            initial={{ opacity: 0, y: 50, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: 50, x: '-50%' }}
            className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[300] bg-green-600 text-white px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-3 font-black uppercase tracking-widest text-[10px]"
          >
            <div className="w-6 h-6 bg-surface/20 rounded-full flex items-center justify-center">
              <Check size={14} />
            </div>
            {successMessage}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modais Globais */}
      <AnimatePresence>
        {showSetup && (
          <SetupWizard onComplete={handleCompleteSetup} />
        )}

        {showWeeklyModal && (
          <WeeklyConfigModal onClose={() => setShowWeeklyModal(false)} />
        )}

        {showStaffModal && (
          <StaffConfigModal onClose={() => setShowStaffModal(false)} />
        )}
      </AnimatePresence>

      {showAddModal && (
        <AddAppointmentModal 
          selectedDate={prefilledSlot?.date || getTodayString()} 
          selectedTime={prefilledSlot?.time || ''}
          prefilledCustomer={prefilledCustomer}
          isExceptional={isExceptionalMode}
          onClose={() => { 
            setShowAddModal(false); 
            setPrefilledSlot(null); 
            setPrefilledCustomer(null);
            setIsExceptionalMode(false);
          }} 
          onSuccess={() => {
            setSuccessMessage('Agendamento realizado com sucesso!');
            setTimeout(() => setSuccessMessage(null), 3000);
            confetti({
              particleCount: 100,
              spread: 70,
              origin: { y: 0.6 },
              colors: ['#F99417', '#ffffff', '#3CB878']
            });
          }}
        />
      )}
      {showAddCustomerModal && (
        <AddCustomerModal 
          onClose={() => setShowAddCustomerModal(false)}
          onSuccess={(msg) => {
            setSuccessMessage(msg);
            setTimeout(() => setSuccessMessage(null), 3000);
          }}
        />
      )}
      {showProfileModal && (
        <ProfileModal 
          onClose={() => setShowProfileModal(false)} 
          onSuccess={(msg) => {
            setSuccessMessage(msg);
            setTimeout(() => setSuccessMessage(null), 3000);
          }}
        />
      )}
      {reschedulingApt && (
        <RescheduleModal 
          appointment={reschedulingApt} 
          onClose={() => setReschedulingApt(null)} 
          onSuccess={(msg) => {
            setSuccessMessage(msg);
            setTimeout(() => setSuccessMessage(null), 3000);
          }}
        />
      )}

      <motion.div 
        className="fixed bottom-0 left-0 w-full z-40 pointer-events-none"
        initial={false}
        animate={{ 
          y: footerVisible ? 0 : 100,
          opacity: footerVisible ? 1 : 0
        }}
        transition={{ duration: 0.3, ease: "easeInOut" }}
      >
          <nav className="bg-[#1E1B4B]/95 backdrop-blur-xl border-t border-white/10 pt-[8px] pb-[max(10px,env(safe-area-inset-bottom))] flex justify-between items-center h-[64px] pointer-events-auto px-2 relative z-50">
            {[
              { id: 'clientes', label: 'Clientes', icon: Users, ariaLabel: 'Ir para Clientes' },
              { id: 'servicos', label: 'Serviços', icon: Scissors, ariaLabel: 'Ir para Serviços' },
              { id: 'agenda', label: 'Agenda', icon: Calendar, ariaLabel: 'Ir para Agenda', isCenter: true },
              { id: 'caixa', label: 'Financeiro', icon: Wallet, ariaLabel: 'Ir para Financeiro' },
              { id: 'configuracoes', label: 'Gestão', icon: Settings, ariaLabel: 'Ir para Gestão' },
            ].filter(item => {
              if (item.id === 'caixa') {
                return permissions?.canViewCaixa;
              }
              return true;
            }).map((item) => {
              const isActive = activeTab === item.id;
              
              if (item.isCenter) {
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      setActiveTab('agenda');
                                          }}
                    className="flex flex-col items-center justify-start flex-1 h-[64px] transition-all duration-[180ms] ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-[0.92]"
                    aria-label={item.ariaLabel}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    <div className="bg-secondary rounded-full flex items-center justify-center -translate-y-2.5 shadow-[0_4px_16px_rgba(249,148,23,0.45)] relative transition-all duration-[180ms]" style={{ padding: '10px 12px' }}>
                      <item.icon size={26} className="text-white" />
                      {pendingTodayCount > 0 && (
                        <div className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full flex items-center justify-center text-[8px] font-bold border-2 border-white ">
                          {pendingTodayCount}
                        </div>
                      )}
                    </div>
                    <span className="text-white font-semibold text-[12px] -mt-1 transition-all duration-[180ms]">
                      {item.label}
                    </span>
                  </button>
                );
              }
              
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    setActiveTab(item.id as any);
                    if(item.id !== 'clientes') setTargetCustomerPhone(null);
                  }}
                  className="flex flex-col items-center justify-center flex-1 h-full min-h-[44px] transition-all duration-[180ms] ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-[0.88] active:opacity-75 relative"
                  aria-label={item.ariaLabel}
                  aria-current={isActive ? 'page' : undefined}
                >
                  <div className="relative mb-0.5 flex flex-col items-center justify-center pt-1">
                    <div className={`w-1 h-1 rounded-full bg-secondary transition-opacity duration-[180ms] ease-in-out absolute -top-1.5 ${isActive ? 'opacity-100' : 'opacity-0'}`} />
                    <item.icon size={22} className={`transition-colors duration-[180ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${isActive ? 'text-secondary' : 'text-white/40'}`} />
                  </div>
                  <span className={`text-[12px] font-medium transition-colors duration-[180ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${isActive ? 'text-secondary' : 'text-white/40'}`}>
                    {item.label}
                  </span>
                </button>
              );
            })}
          </nav>
      </motion.div>

      <input type="file" accept="image/*" capture="environment" ref={cameraInputRef} className="hidden" onChange={handleFileChange} />
      <input type="file" accept="image/*" ref={galleryInputRef} className="hidden" onChange={handleFileChange} />

      <NotificacoesPanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        notifications={notifications}
        onMarkRead={markNotificationAsRead}
        onMarkAllRead={markAllNotificationsAsRead}
        onDelete={deleteNotification}
      />

      <AnimatePresence>
        {showPhotoActionSheet && (
          <PhotoActionSheet 
            isOpen={showPhotoActionSheet}
            onClose={() => setShowPhotoActionSheet(false)}
            onSelect={(source) => {
              setShowPhotoActionSheet(false);
              if (source === 'camera') cameraInputRef.current?.click();
              else galleryInputRef.current?.click();
            }}
          />
        )}
        {showPhotoDescription && tempPhoto && (
          <PhotoDescriptionModal 
            isOpen={showPhotoDescription}
            photo={tempPhoto}
            onClose={() => {
              setShowPhotoDescription(false);
              setTempPhoto(null);
              setPhotoTargetPhone(null);
            }}
            onConfirm={handleConfirmPhoto}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

const AgendaView: React.FC<{ 
    selectedDate: string;
    setSelectedDate: (date: string) => void;
    onOpenCustomer: (phone: string) => void; 
    showWeeklyModal: boolean; 
    setShowWeeklyModal: (show: boolean) => void; 
    onReschedule: (apt: Appointment) => void;
    onAddInSlot: (date: string, time: string, isExceptional?: boolean) => void;
    handleCameraClick: (phone: string) => void;
    onSuccess?: (msg: string) => void;
    onNavigateToCaixa?: () => void;
}> = ({ selectedDate, setSelectedDate, onOpenCustomer, showWeeklyModal, setShowWeeklyModal, onReschedule, onAddInSlot, handleCameraClick, onSuccess, onNavigateToCaixa }) => {
  const { appointments, finishAppointment, revertAppointment, deleteAppointment, blockedSlots, unblockedSlots, toggleSlotAvailability, toggleSlotUnblock, weeklySchedule, markNoShow, toggleWeeklyBreak, fetchAppointmentsByDate, staff, selectedStaffId, setSelectedStaffId } = useStore();
  
  useEffect(() => {
    fetchAppointmentsByDate(selectedDate);
    setViewDate(new Date(selectedDate + 'T12:00:00'));
  }, [selectedDate]);

  const [activeSlotMenu, setActiveSlotMenu] = useState<string | null>(null);
  const [activeCancelMenu, setActiveCancelMenu] = useState<string | null>(null);
  const [activeNoShowMenu, setActiveNoShowMenu] = useState<string | null>(null);
  const [activeFinishMenu, setActiveFinishMenu] = useState<string | null>(null);
  const [activeRevertMenu, setActiveRevertMenu] = useState<string | null>(null);
  const [activeUnlockMenu, setActiveUnlockMenu] = useState<string | null>(null);
  const [expandedCompletedId, setExpandedCompletedId] = useState<string | null>(null);
  const [finishingId, setFinishingId] = useState<string | null>(null);
  const [weeklyUnlockSlot, setWeeklyUnlockSlot] = useState<string | null>(null);

  // Inline Calendar States
  const [isCalendarExpanded, setIsCalendarExpanded] = useState(false);
  const [viewDate, setViewDate] = useState(new Date(selectedDate + 'T12:00:00'));
  const [viewMode, setViewMode] = useState<'days' | 'years'>('days');
  const [slideDirection, setSlideDirection] = useState(0);
  const [activeFilter, setActiveFilter] = useState<'todos' | 'agendados' | 'livres' | 'concluidos'>('todos');
  const [showFilterMenu, setShowFilterMenu] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [parallaxOffset, setParallaxOffset] = useState(0);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    
    const handleScroll = () => {
      const offset = Math.min(el.scrollTop, 100);
      setParallaxOffset(offset);
    };
    
    el.addEventListener('scroll', handleScroll);
    return () => el.removeEventListener('scroll', handleScroll);
  }, []);

  const getAppointmentsCount = (dateStr: string) => {
    return appointments.filter(a => a.date === dateStr && a.status === 'pending').length;
  };

  const formatMonthYear = (date: Date) => {
    const formatted = date.toLocaleString('pt-BR', { month: 'long', year: 'numeric' });
    return formatted.charAt(0).toUpperCase() + formatted.slice(1);
  };

  const weekDays = useMemo(() => {
    const current = new Date(selectedDate + 'T12:00:00');
    const day = current.getDay();
    // Monday is 1, Sunday is 0. Let's start week on Monday.
    const diff = current.getDate() - day + (day === 0 ? -6 : 1); 
    const monday = new Date(current.setDate(diff));
    
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const dateStr = d.toISOString().split('T')[0];
      const dayOfWeek = d.getDay();
      const dayLabel = ["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SAB"][dayOfWeek];
      const dayNum = d.getDate().toString().padStart(2, '0');
      const hasAppointments = appointments.some(a => a.date === dateStr);
      const isOpen = weeklySchedule[dayOfWeek]?.isOpen;
      return { dateStr, dayLabel, dayNum, hasAppointments, isOpen };
    });
  }, [selectedDate, appointments, weeklySchedule]);

  const stats = useMemo(() => {
    const today = getTodayString();
    
    // Day stats for selectedDate
    const dayApts = appointments.filter(a => a.date === selectedDate && a.status === 'completed');
    const dayRevenue = dayApts.reduce((sum, a) => sum + (a.price || 0), 0);
    
    // Week stats based on selectedDate's week
    const current = new Date(selectedDate + 'T12:00:00');
    const day = current.getDay();
    const diff = current.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(current.setDate(diff));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    
    const mondayStr = monday.toISOString().split('T')[0];
    const sundayStr = sunday.toISOString().split('T')[0];
    
    const weekApts = appointments.filter(a => a.date >= mondayStr && a.date <= sundayStr && a.status === 'completed');
    const weekRevenue = weekApts.reduce((sum, a) => sum + (a.price || 0), 0);

    // Labels
    const isToday = selectedDate === today;
    const dayLabel = isToday ? "HOJE" : new Date(selectedDate + 'T12:00:00').toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' }).replace('.', '');
    
    // Check if selectedDate is in current week
    const now = new Date();
    const nowDay = now.getDay();
    const nowDiff = now.getDate() - nowDay + (nowDay === 0 ? -6 : 1);
    const currentMonday = new Date(now.setDate(nowDiff));
    const currentMondayStr = currentMonday.toISOString().split('T')[0];
    
    const isCurrentWeek = mondayStr === currentMondayStr;
    const weekLabel = isCurrentWeek ? "Semana atual" : `${monday.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' }).replace('.', '')} - ${sunday.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' }).replace('.', '')}`;
    
    return {
      dayCount: dayApts.length,
      dayRevenue,
      weekCount: weekApts.length,
      weekRevenue,
      dayLabel,
      weekLabel
    };
  }, [appointments, selectedDate]);

  const navigateWeek = (direction: 'prev' | 'next') => {
    setSlideDirection(direction === 'next' ? 1 : -1);
    const d = new Date(selectedDate + 'T12:00:00');
    d.setDate(d.getDate() + (direction === 'next' ? 7 : -7));
    setSelectedDate(d.toISOString().split('T')[0]);
  };

  const handleAgendaSwipeLeft = () => {
    if (isCalendarExpanded) {
      if (viewMode !== 'days') return;
      setSlideDirection(1);
      setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1));
    } else {
      navigateWeek('next');
    }
  };

  const handleAgendaSwipeRight = () => {
    if (isCalendarExpanded) {
      if (viewMode !== 'days') return;
      const newDate = new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1);
      if (newDate.getFullYear() >= 2026) {
        setSlideDirection(-1);
        setViewDate(newDate);
      }
    } else {
      navigateWeek('prev');
    }
  };

  const agendaSwipeHandlers = useSwipe(handleAgendaSwipeLeft, handleAgendaSwipeRight);

  // Outside click detection
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('.menu-container') && !target.closest('.slot-trigger')) {
        setActiveSlotMenu(null);
        setActiveCancelMenu(null);
        setActiveNoShowMenu(null);
        setActiveFinishMenu(null);
        setActiveRevertMenu(null);
        setActiveUnlockMenu(null);
      }
    };

    if (activeSlotMenu || activeCancelMenu || activeNoShowMenu || activeFinishMenu || activeRevertMenu || activeUnlockMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [activeSlotMenu, activeCancelMenu, activeNoShowMenu, activeFinishMenu, activeRevertMenu, activeUnlockMenu]);

  const handleFinish = (id: string) => {
    setFinishingId(id);
    
    // Trigger confetti
    confetti({
      particleCount: 100,
      spread: 70,
      origin: { y: 0.7 },
      colors: ['#F99417', '#3CB878', '#ffffff'],
      zIndex: 100
    });

    // Delay the actual state update to allow animation to play in place
    setTimeout(() => {
      finishAppointment(id);
      setFinishingId(null);
    }, 1000);
  };

  useLockBodyScroll(!!weeklyUnlockSlot);

  const dayOfWeek = new Date(selectedDate + 'T12:00:00').getDay();
  const dateBlockedSlots = blockedSlots[selectedDate] || [];
  const dayConfig = weeklySchedule[dayOfWeek];
  const currentDayAppointments = useMemo(() => {
    return appointments.filter(a => {
      const isDateMatch = a.date === selectedDate;
      if (!isDateMatch) return false;
      if (selectedStaffId === 'all') return true;
      return a.staffId === selectedStaffId;
    });
  }, [appointments, selectedDate, selectedStaffId]);

  const generatedSlots = useMemo(() => {
    if (!dayConfig) return [];
    
    // 1. Base slots from weekly schedule - only if open
    const baseSlots = dayConfig.isOpen ? generateTimeSlots(dayConfig.start, dayConfig.end) : [];
    
    // 2. Map appointment times for the current day
    const appointmentTimes = currentDayAppointments.map(a => a.time);
    
    // 3. Merge, remove duplicates, and sort
    const allSlots = Array.from(new Set([...baseSlots, ...appointmentTimes]));
    return allSlots.sort((a, b) => a.localeCompare(b));
  }, [dayConfig, appointments, selectedDate, currentDayAppointments]);

  const isPast = (time: string) => {
    const today = getTodayString();
    if (selectedDate < today) return true;
    if (selectedDate > today) return false;
    const [h, m] = time.split(':').map(Number);
    const now = new Date();
    const slotDate = new Date();
    slotDate.setHours(h, m, 0, 0);
    return slotDate < now;
  };

  const activeSlots = useMemo(() => {
    const items = generatedSlots.map(slot => {
        const apt = currentDayAppointments.find(a => {
          const occupied = getOccupiedSlots(a.time, a.duration || 30);
          return occupied.includes(slot);
        });
        
        const isStartSlot = apt?.time === slot;
        return { slot, apt, isStartSlot };
    });

    return items.filter(({ slot, apt, isStartSlot }) => {
        const isCompleted = apt?.status === 'completed' || apt?.status === 'no-show';
        if (isCompleted) return false;
        
        if (isPast(slot)) return !!apt && isStartSlot;
        return true;
    });
  }, [generatedSlots, currentDayAppointments, selectedDate]);

  const completedAppointments = useMemo(() => {
    return currentDayAppointments
      .filter(a => a.status === 'completed' || a.status === 'no-show')
      .sort((a, b) => b.time.localeCompare(a.time));
  }, [currentDayAppointments]);

  return (
    <div className="flex-1 flex flex-col relative z-0 bg-[#363062] min-h-0">
      <div className="bg-[#1E1B4B] pt-2 pb-5 px-4 relative z-10 w-full shrink-0">
        <div {...agendaSwipeHandlers} className="overflow-hidden">
        {/* Integrated Calendar Header */}
        <div className="flex flex-col items-center relative">
          <div className="flex items-center justify-center w-full relative h-8">
            {/* Left aligned previous month button (when expanded) */}
            <div className="absolute left-4">
              {isCalendarExpanded && (
                <button 
                  onClick={() => {
                    const newDate = new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1);
                    if (newDate.getFullYear() >= 2026) {
                      setSlideDirection(-1);
                      setViewDate(newDate);
                    }
                  }}
                  className="p-1.5 text-secondary hover:bg-surface/80 rounded-full transition-colors"
                >
                  <ChevronLeft size={18} />
                </button>
              )}
            </div>

            {/* Centered Month/Year button */}
            <button 
              onClick={() => {
                if (isCalendarExpanded) {
                  if (viewMode === 'years') setViewMode('days');
                  else setIsCalendarExpanded(false);
                } else {
                  setIsCalendarExpanded(true);
                  setViewDate(new Date(selectedDate + 'T12:00:00'));
                  setViewMode('days');
                }
              }}
              className="flex items-center gap-1.5 px-3 py-1 hover:bg-primary/40 :bg-surface rounded-xl transition-colors z-10"
            >
              <span className="text-[14px] font-bold text-white ">
                {formatMonthYear(viewDate)}
              </span>
              <motion.div
                animate={{ rotate: isCalendarExpanded ? 180 : 0 }}
                transition={{ duration: 0.3 }}
              >
                <ChevronRight size={14} className="text-secondary rotate-90" />
              </motion.div>
            </button>

            {/* Right aligned next month button OR Hoje button */}
            <div className="absolute right-4 flex items-center gap-2">
              <AnimatePresence>
                {!isCalendarExpanded && selectedDate !== getTodayString() && (
                  <motion.button 
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    transition={{ duration: 0.2 }}
                    onClick={() => {
                      setSelectedDate(getTodayString());
                      setViewDate(new Date(getTodayString() + 'T12:00:00'));
                    }}
                    className="px-3 h-6 rounded-full bg-secondary text-white text-[10px] font-bold uppercase tracking-widest hover:bg-amber-600 transition-colors flex items-center gap-1.5"
                  >
                    <RotateCcw size={10} strokeWidth={3} />
                    Hoje
                  </motion.button>
                )}
              </AnimatePresence>
              {isCalendarExpanded && (
                <button 
                  onClick={() => {
                    setSlideDirection(1);
                    setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1));
                  }}
                  className="p-1.5 text-secondary hover:bg-surface/80 rounded-full transition-colors"
                >
                  <ChevronRight size={18} />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Inline Calendar Content */}
        <AnimatePresence mode="wait">
          {isCalendarExpanded && (
            <motion.div
              key={viewMode === 'days' ? `days-${viewDate.getMonth()}-${viewDate.getFullYear()}` : 'years'}
              initial={{ height: 0, opacity: 0, x: slideDirection * 20 }}
              animate={{ height: 'auto', opacity: 1, x: 0 }}
              exit={{ height: 0, opacity: 0, x: -slideDirection * 20 }}
              transition={{ duration: 0.3, ease: "easeInOut" }}
              className="overflow-hidden bg-surface  px-4"
            >
              {viewMode === 'days' ? (
                <div className="pb-3">
                  <div className="grid grid-cols-7 gap-1 mb-1">
                    {['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab', 'Dom'].map((d) => (
                      <div key={d} className="h-6 flex items-center justify-center text-[9px] font-black text-title uppercase">{d}</div>
                    ))}
                  </div>
                  <div className="grid grid-cols-7 gap-1">
                    {(() => {
                      const daysInMonth = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0).getDate();
                      const firstDayOfMonth = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1).getDay();
                      const offset = firstDayOfMonth === 0 ? 6 : firstDayOfMonth - 1;
                      
                      const days = [];
                      // Previous month days
                      const prevMonthLastDay = new Date(viewDate.getFullYear(), viewDate.getMonth(), 0).getDate();
                      for (let i = offset - 1; i >= 0; i--) {
                        const d = prevMonthLastDay - i;
                        const date = new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, d);
                        const dateStr = date.toISOString().split('T')[0];
                        const count = getAppointmentsCount(dateStr);
                        days.push(
                          <div key={`prev-${d}`} className="h-9 flex items-center justify-center relative opacity-20">
                            <span className="text-[11px] font-bold text-title">{d}</span>
                            {count > 0 && (
                              <div className="absolute top-0.5 right-0.5 w-3 h-3 bg-[#8A98A8] text-white rounded-full flex items-center justify-center text-[6px] font-bold">
                                {count > 9 ? '9+' : count}
                              </div>
                            )}
                          </div>
                        );
                      }
                      
                      // Current month days
                      for (let d = 1; d <= daysInMonth; d++) {
                        const date = new Date(viewDate.getFullYear(), viewDate.getMonth(), d);
                        const dateStr = date.toISOString().split('T')[0];
                        const isSelected = dateStr === selectedDate;
                        const isToday = dateStr === getTodayString();
                        const dayOfWeek = date.getDay();
                        const isClosed = !weeklySchedule[dayOfWeek]?.isOpen;
                        const count = getAppointmentsCount(dateStr);
                        
                        days.push(
                          <button
                            key={d}
                            onClick={() => {
                              setSelectedDate(dateStr);
                              setIsCalendarExpanded(false);
                            }}
                            className={`h-9 w-full flex-col rounded-xl flex items-center justify-center text-[12px] font-bold transition-all relative
                              ${isSelected ? 'bg-secondary text-white shadow-[0_0_0_2px_#1E1B4B,0_0_0_4px_#F99417]' : isToday ? 'bg-secondary/25 text-white ring-1 ring-secondary/50' : isClosed ? 'text-muted line-through ' : 'hover:bg-primary/40 bg-surface text-white '}`}
                          >
                            <span>{d}</span>
                            {isToday && <div className={`w-1 h-1 rounded-full mt-0.5 ${isSelected ? 'bg-white' : 'bg-secondary'}`}></div>}
                            {count > 0 && (
                              <div className="absolute top-0.5 right-0.5 w-3.5 h-3.5 rounded-full flex items-center justify-center text-[7px] font-bold border bg-secondary text-white border-white ">
                                {count > 9 ? '9+' : count}
                              </div>
                            )}
                          </button>
                        );
                      }

                      // Next month days
                      const remaining = 42 - days.length;
                      for (let d = 1; d <= remaining; d++) {
                        const date = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, d);
                        const dateStr = date.toISOString().split('T')[0];
                        const count = getAppointmentsCount(dateStr);
                        days.push(
                          <div key={`next-${d}`} className="h-9 flex items-center justify-center relative opacity-20">
                            <span className="text-[11px] font-bold text-title">{d}</span>
                            {count > 0 && (
                              <div className="absolute top-0.5 right-0.5 w-3 h-3 bg-[#8A98A8] text-white rounded-full flex items-center justify-center text-[6px] font-bold">
                                {count > 9 ? '9+' : count}
                              </div>
                            )}
                          </div>
                        );
                      }
                      
                      return days;
                    })()}
                  </div>
                </div>
              ) : (
                <div className="pb-4 grid grid-cols-3 gap-2">
                  {Array.from({ length: 9 }, (_, i) => 2026 + i).map(year => (
                    <button
                      key={year}
                      onClick={() => {
                        setViewDate(new Date(year, viewDate.getMonth(), 1));
                        setViewMode('days');
                      }}
                      className={`h-11 rounded-xl flex items-center justify-center font-bold text-sm transition-all
                        ${viewDate.getFullYear() === year ? 'bg-secondary text-white shadow-sm' : 'bg-primary/40  text-white  hover:bg-[#E2E8F0]'}`}
                    >
                      {year}
                    </button>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Weekly Selector */}
        {!isCalendarExpanded && (
          <div className="flex items-center mx-0 mt-2 py-[10px] px-2 rounded-2xl bg-white/[0.08]">
            <button 
              onClick={() => navigateWeek('prev')}
              className="w-8 h-10 flex items-center justify-center text-white/50 hover:text-white transition-colors"
            >
              <ChevronLeft size={20} />
            </button>
            
            <AnimatePresence mode="wait">
              <motion.div
                key={weekDays[0]?.dateStr}
                initial={{ opacity: 0, x: slideDirection * 15 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -slideDirection * 15 }}
                transition={{ duration: 0.2 }}
                className="flex-1 flex justify-between gap-1"
              >
                {weekDays.map((day) => {
                  const isSelected = day.dateStr === selectedDate;
                  const isToday = day.dateStr === getTodayString();
                  const isClosed = !day.isOpen;
                  const count = getAppointmentsCount(day.dateStr);
                  
                  return (
                    <button
                      key={day.dateStr}
                      onClick={() => setSelectedDate(day.dateStr)}
                      className={`flex-1 flex flex-col items-center justify-center rounded-xl transition-all py-1.5 relative
                        ${isSelected 
                          ? 'bg-secondary text-white shadow-[0_0_0_2px_#1E1B4B,0_0_0_4px_#F99417]' 
                          : isToday 
                            ? 'bg-secondary/25 text-white ring-1 ring-secondary/50' 
                            : isClosed
                              ? 'text-white/30 line-through '
                              : 'hover:bg-white/5 text-white/80'}`}
                    >
                      <span className={`text-[9px] font-bold uppercase tracking-tighter 
                        ${isSelected ? 'text-white/80' : isToday ? 'text-white/90' : isClosed ? 'line-through' : 'text-white/60'}`}>
                        {day.dayLabel}
                      </span>
                      <span className={`text-sm font-black flex flex-col items-center
                        ${isSelected ? 'text-white' : isToday ? 'text-white' : isClosed ? 'text-white/30 ' : 'text-white '}`}>
                        <span>{day.dayNum}</span>
                        {isToday && <div className={`w-1 h-1 rounded-full mt-0.5 ${isSelected ? 'bg-white' : 'bg-secondary'}`}></div>}
                      </span>
                      {count > 0 && (
                        <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold border-2 bg-secondary text-white border-transparent ">
                          {count > 9 ? '9+' : count}
                        </div>
                      )}
                    </button>
                  );
                })}
              </motion.div>
            </AnimatePresence>

            <button 
              onClick={() => navigateWeek('next')}
              className="w-8 h-10 flex items-center justify-center text-white/50 hover:text-white transition-colors"
            >
              <ChevronRight size={20} />
            </button>
          </div>
        )}
      </div>

      {/* Summary Cards */}
      <div className="w-full px-4 mt-3 mb-0">
        <div 
          className="grid grid-cols-2 gap-3 items-stretch max-w-lg mx-auto"
          style={{
            opacity: Math.max(0, 1 - (parallaxOffset / 100)),
            pointerEvents: parallaxOffset > 50 ? 'none' : 'auto',
            transition: 'opacity 0.15s ease-out'
          }}
        >
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0, duration: 0.35, ease: 'easeOut' }}
            className="h-full flex flex-col"
          >
            <button 
              onClick={onNavigateToCaixa}
              className="w-full h-full rounded-[14px] py-[12px] px-[14px] flex flex-col justify-between bg-[#F99417] shadow-[0_4px_12px_rgba(0,0,0,0.18)] relative overflow-hidden group text-left active:scale-[0.97] transition-all min-h-[82px]"
            >
              {/* Decoração — círculo grande translúcido */}
              <div className="absolute -right-6 -top-6 w-32 h-32 rounded-full pointer-events-none"
                 style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.12) 0%, transparent 70%)' }}
              />
              <div className="absolute -right-2 -bottom-8 w-24 h-24 rounded-full pointer-events-none"
                 style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.08) 0%, transparent 70%)' }}
              />
              
              <span className="text-[10px] font-semibold text-white/70 uppercase tracking-[1.4px] leading-none mb-1.5 relative z-10">{stats.dayLabel}</span>
              <div className="flex flex-col relative z-10">
                <span className="text-[22px] font-extrabold text-white leading-tight">{formatCurrency(stats.dayRevenue)}</span>
                <span className="text-[11px] text-white/75 leading-none mt-0.5">{stats.dayCount} {stats.dayCount === 1 ? 'atendimento' : 'atendimentos'}</span>
              </div>
              <DollarSign size={48} className="text-white/10 absolute right-4 bottom-2 pointer-events-none transition-transform group-hover:scale-110 duration-500" />
            </button>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08, duration: 0.35, ease: 'easeOut' }}
            className="h-full flex flex-col"
          >
            <button 
              onClick={onNavigateToCaixa}
              className="w-full h-full bg-white/[0.08] rounded-[14px] py-[12px] px-[14px] flex flex-col justify-between shadow-[0_4px_12px_rgba(0,0,0,0.18)] border border-white/5 relative overflow-hidden group text-left active:scale-[0.97] transition-all min-h-[82px]"
            >
              <span className="text-[10px] font-semibold text-white/70 uppercase tracking-[1.4px] leading-none mb-1.5 relative z-10">{stats.weekLabel}</span>
              <div className="flex flex-col relative z-10">
                <span className="text-[22px] font-extrabold text-[#FFFFFF] leading-tight">{formatCurrency(stats.weekRevenue)}</span>
                <span className="text-[11px] font-normal text-white/75 leading-none mt-0.5">{stats.weekCount} {stats.weekCount === 1 ? 'atendimento' : 'atendimentos'}</span>
              </div>
              <DollarSign size={48} className="text-secondary/5 absolute right-4 bottom-2 pointer-events-none transition-transform group-hover:scale-110 duration-500" />
            </button>
          </motion.div>
        </div>
      </div>
      </div>

      <div 
        ref={scrollRef}
        style={{
          transform: `translateY(-${parallaxOffset}px)`,
          marginBottom: `-${parallaxOffset}px`,
          transition: 'transform 0.15s ease-out, margin-bottom 0.15s ease-out'
        }}
        className="flex-1 bg-[#F5F5F8] rounded-t-[28px] -mt-[10px] pt-0 px-4 shadow-[0_-4px_16px_rgba(0,0,0,0.1)] pb-28 relative z-10 min-h-0 overflow-y-auto"
      >
        <div className="space-y-4 animate-in fade-in slide-in-from-top-4 duration-500">
        <div className={`sticky top-0 z-20 bg-[#F5F5F8] pt-5 pb-2 -mx-4 px-4 flex items-center relative justify-between gap-2`}>
          {activeFilter !== 'concluidos' && (
            <SectionHeader title="Grade do Dia" count={currentDayAppointments.filter(a => a.status === 'pending').length} accent="blue" />
          )}
          
          <div className="flex items-center gap-2 ml-auto">
            {/* Professional Dropdown */}
            {staff.length > 1 && (
              <div className="relative">
                <select
                  value={selectedStaffId}
                  onChange={(e) => setSelectedStaffId(e.target.value)}
                  className="appearance-none bg-white border border-[#1E1B4B]/10 rounded-full px-3 pr-8 h-7 text-[10px] font-bold uppercase tracking-widest text-[#1E1B4B] focus:outline-none focus:ring-1 focus:ring-[#F99417] shadow-sm cursor-pointer"
                >
                  <option value="all">Todos Profissionais</option>
                  {staff.map((s: any) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
                <ChevronDown size={11} className="absolute right-2.5 top-2 pointer-events-none text-[#1E1B4B]/60" />
              </div>
            )}

            <button
              onClick={() => setShowFilterMenu(!showFilterMenu)}
              className={`flex items-center gap-1.5 px-3 h-7 rounded-full text-[11px] font-bold uppercase tracking-widest transition-all ${
                activeFilter === 'agendados' ? 'bg-[#1E1B4B] text-white shadow-md' :
                activeFilter === 'livres' ? 'bg-white text-[#1E1B4B] border border-[#1E1B4B] shadow-md' :
                activeFilter === 'concluidos' ? 'bg-[#48C78E] text-white shadow-md' :
                'bg-[#1E1B4B]/10 text-[#1E1B4B]/50'
              }`}
            >
              <Filter size={12} />
              {activeFilter === 'todos' ? 'Filtrar' : activeFilter === 'agendados' ? 'Agendados' : activeFilter === 'livres' ? 'Horários Livres' : 'Concluídos'}
              {activeFilter !== 'todos' && <X size={11} onClick={(e) => { e.stopPropagation(); setActiveFilter('todos'); }} />}
            </button>
          </div>
          
          {showFilterMenu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowFilterMenu(false)} />
              <div className="absolute right-4 top-14 z-20 bg-white rounded-2xl shadow-xl overflow-hidden border border-[#1E1B4B]/10 w-44">
                {[
                  { value: 'todos', label: 'Todos' },
                  { value: 'agendados', label: 'Agendados' },
                  { value: 'livres', label: 'Horários Livres' },
                  { value: 'concluidos', label: 'Concluídos' }
                ].map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => { setActiveFilter(opt.value as any); setShowFilterMenu(false); }}
                    className="w-full px-4 py-3 text-left text-[13px] font-semibold text-[#1E1B4B] hover:bg-[#F5F5F8] flex items-center justify-between"
                  >
                    {opt.label}
                    {activeFilter === opt.value && <Check size={14} className="text-[#F99417]" />}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {activeFilter !== 'todos' && (
          <div className="flex items-center justify-between bg-[#F99417]/10 rounded-xl px-3 py-2 mb-2">
            <span className="text-[11px] font-bold text-[#B7620A] uppercase tracking-widest">
              ⚠ Exibindo apenas: {activeFilter === 'agendados' ? 'Agendados' : activeFilter === 'livres' ? 'Horários Livres' : 'Concluídos'}
            </span>
            <button onClick={() => setActiveFilter('todos')} className="text-[11px] font-black text-[#F99417] underline">
              Limpar
            </button>
          </div>
        )}

        {(!dayConfig?.isOpen && currentDayAppointments.length === 0) ? (
            <div className="bg-surface  p-12 rounded-[2rem] border-2 border-dashed border-title/30  text-center space-y-3 ">
                <div className="w-12 h-12 bg-primary/40  rounded-full flex items-center justify-center mx-auto text-title">
                    <Lock size={24} />
                </div>
                <p className="text-title  font-bold text-sm uppercase tracking-widest">Fechado hoje</p>
            </div>
        ) : (
            <div className="grid grid-cols-1 gap-3">
                {activeSlots.length === 0 && dayConfig?.isOpen && currentDayAppointments.filter(a => a.status === 'pending').length === 0 && (
                  <div className="py-10 flex flex-col items-center gap-3 text-center">
                    <div className="w-12 h-12 rounded-full bg-[#1E1B4B]/10 flex items-center justify-center">
                      <Check size={24} className="text-[#48C78E]" />
                    </div>
                    <p className="text-[13px] font-bold text-[#1E1B4B]/50 uppercase tracking-widest">
                      Expediente encerrado
                    </p>
                    <p className="text-[11px] text-[#1E1B4B]/35">
                      Todos os horários passaram ou foram concluídos
                    </p>
                  </div>
                )}
                {activeFilter !== 'concluidos' && activeSlots.map(({ slot, apt, isStartSlot }) => {
                    const isManualBlocked = dateBlockedSlots.some(s => normalizeTime(s) === slot);
                    const isManualUnblocked = (unblockedSlots[selectedDate] || []).some(s => normalizeTime(s) === slot);
                    const isWeeklyBreak = dayConfig.breaks.some(b => normalizeTime(b) === slot);
                    const isBlocked = (isWeeklyBreak && !isManualUnblocked) || isManualBlocked;
                    
                    if (activeFilter === 'agendados' && !apt) return null;
                    if (activeFilter === 'livres' && (apt || isBlocked)) return null;
                    
                    // If it's occupied by a duration but not the start slot
                    if (apt && !isStartSlot) {
                        return (
                            <div key={slot} className="bg-primary/40  p-3 rounded-2xl flex items-center gap-4 opacity-50 pointer-events-none min-h-[44px]">
                                <div className="text-lg font-black text-title  w-14 shrink-0">{slot}</div>
                                <div className="flex-1 min-w-0 flex items-center gap-1.5 text-xs text-title  truncate">
                                    <span className="font-semibold flex items-center gap-1 shrink-0">
                                        <Lock size={14} />
                                        Ocupado
                                    </span>
                                    <span className="text-title ">|</span>
                                    <span className="font-normal truncate">
                                        {apt.service} de {capitalizeName(apt.clientName)}
                                    </span>
                                </div>
                            </div>
                        );
                    }

                    const isActuallyCompleted = apt?.status === 'completed';
                    const isNoShow = apt?.status === 'no-show';
                    const isFinishing = finishingId === apt?.id;
                    const isCompleted = isActuallyCompleted || isFinishing || isNoShow;
                    const past = isPast(slot);
                    
                    const isQuickActionOpen = activeSlotMenu === slot;
                    const isCancelOpen = apt && activeCancelMenu === apt.id;
                    const isNoShowOpen = apt && activeNoShowMenu === apt.id;
                    const isFinishOpen = apt && activeFinishMenu === apt.id;
                    const isRevertOpen = apt && activeRevertMenu === apt.id;
                    const isUnlockOpen = activeUnlockMenu === slot;

                    if (isBlocked && !apt) {
                         return (
                            <div key={slot} className="relative">
                                <div 
                                    onClick={() => {
                                        if (isManualBlocked) {
                                            setActiveUnlockMenu(isUnlockOpen ? null : slot);
                                        } else {
                                            setWeeklyUnlockSlot(slot);
                                        }
                                    }}
                                    className="bg-red-50/20  border border-red-100/50  p-3 rounded-2xl flex items-center justify-between opacity-70  cursor-pointer min-h-[44px]"
                                >
                                    <div className="text-lg font-black text-title  w-14">{slot}</div>
                                    <div className="flex flex-col items-end flex-1 pr-4">
                                        <div className="flex items-center gap-1.5 text-red-400 ">
                                            {!isManualBlocked && isWeeklyBreak && <Repeat size={12} className="animate-pulse" />}
                                            <span className="text-[9px] font-black uppercase tracking-widest">
                                                {!isManualBlocked && isWeeklyBreak ? 'BLOQUEADO PELO PADRÃO SEMANAL' : 'BLOQUEADO'}
                                            </span>
                                        </div>
                                        {!isManualBlocked && isWeeklyBreak && (
                                            <span className="text-[8px] text-title  font-bold uppercase tracking-tighter">Regra Recorrente</span>
                                        )}
                                    </div>
                                    <div className="w-10 h-10 flex items-center justify-center text-red-200 ">
                                        <Lock size={20} />
                                    </div>
                                </div>
                                <AnimatePresence>
                                    {isUnlockOpen && (
                                        <motion.div 
                                            initial={{ opacity: 0, scale: 0.95 }}
                                            animate={{ opacity: 1, scale: 1 }}
                                            exit={{ opacity: 0, scale: 0.95 }}
                                            className="menu-container absolute inset-0 bg-surface rounded-2xl flex items-center justify-center gap-3 z-10 px-3"
                                        >
                                            <p className="text-white text-[9px] font-black uppercase tracking-widest flex-1">Deseja desbloquear?</p>
                                            <div className="flex gap-2">
                                                <button 
                                                    onClick={() => { toggleSlotAvailability(selectedDate, slot); setActiveUnlockMenu(null); onSuccess?.('Horário liberado para hoje!'); }}
                                                    className="h-8 px-4 bg-green-500 text-white rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg"
                                                >
                                                    Sim
                                                </button>
                                                <button 
                                                    onClick={() => setActiveUnlockMenu(null)}
                                                    className="h-8 px-4 bg-primary text-white rounded-xl text-[10px] font-black uppercase tracking-widest"
                                                >
                                                    Não
                                                </button>
                                            </div>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>
                         );
                    }

                    if (!apt) {
                        return (
                            <div key={slot} className={`relative mb-2 h-[56px] rounded-xl overflow-hidden shadow-[0_2px_6px_rgba(30,27,75,0.06)] flex flex-row items-stretch ${past ? 'opacity-40 grayscale pointer-events-none' : 'cursor-pointer group'}`}>
                                <div 
                                    onClick={() => setActiveSlotMenu(isQuickActionOpen ? null : slot)} 
                                    className="slot-trigger flex-1 flex flex-row items-center px-4 bg-white hover:bg-gray-50 transition-colors outline-none focus:outline-none active:outline-none"
                                >
                                    <div className="text-[16px] font-bold text-[#1E1B4B] w-14 shrink-0">{slot}</div>
                                    <div className="flex items-center gap-2 text-[#1E1B4B]/35 font-normal text-[13px] ml-2.5 transition-colors group-hover:text-[#1E1B4B]/50">
                                        <div className="w-5 h-5 rounded-full border border-dashed border-[#1E1B4B]/35 flex items-center justify-center">
                                            <Plus size={12} strokeWidth={2} />
                                        </div>
                                        Livre
                                    </div>
                                </div>
                                
                                <AnimatePresence>
                                    {isQuickActionOpen && (
                                        <motion.div 
                                            initial={{ x: 10, opacity: 0 }}
                                            animate={{ x: 0, opacity: 1 }}
                                            exit={{ x: 10, opacity: 0 }}
                                            className="menu-container absolute top-0 bottom-0 right-0 left-[calc(3.5rem+1rem)] bg-surface/90 backdrop-blur-md shadow-lg rounded-r-2xl flex items-stretch z-50 overflow-hidden border-y-2 border-r-2 border-title/30"
                                        >
                                            <button 
                                                onClick={(e) => { e.stopPropagation(); toggleSlotAvailability(selectedDate, slot); setActiveSlotMenu(null); }}
                                                className="flex-[0.75] flex flex-col items-center justify-center gap-1 bg-[#E53935] hover:bg-[#D32F2F] text-white transition-colors"
                                            >
                                                <Ban size={16} />
                                                <span className="text-[10px] font-bold uppercase">Bloquear</span>
                                            </button>
                                            <button 
                                                onClick={(e) => { e.stopPropagation(); onAddInSlot(selectedDate, slot); setActiveSlotMenu(null); }}
                                                className="flex-[1.25] flex flex-col items-center justify-center gap-1 bg-[#F5A623] hover:bg-[#E89B20] text-white transition-colors"
                                            >
                                                <Calendar size={16} />
                                                <span className="text-[10px] font-bold uppercase">Agendar</span>
                                            </button>
                                            <button 
                                                onClick={(e) => { e.stopPropagation(); setActiveSlotMenu(null); }}
                                                className="w-10 flex items-center justify-center text-white bg-[#1E1B4B] hover:bg-[#2A265E] transition-colors"
                                            >
                                                <X size={20} />
                                            </button>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>
                        );
                    }

                    return (
                        <motion.div 
                            key={apt.id} 
                            layout
                            initial={false}
                            animate={isFinishing ? { scale: [1, 1.05, 1] } : { scale: 1 }}
                            transition={{ duration: 0.4 }}
                            className={`relative rounded-2xl shadow-[0_3px_12px_rgba(0,0,0,0.35)] min-h-[44px] overflow-hidden transition-all duration-500 flex
                                ${isActuallyCompleted ? 'bg-green-500/10 border-l-4 border-l-green-500 opacity-75' : isNoShow ? 'bg-amber-500/10 border-l-4 border-l-amber-400 opacity-65' : isFinishing ? 'bg-green-500/10 border-l-4 border-l-green-400' : 'bg-surface border-l-4 border-l-secondary'}`}
                        >
                            <div className="flex-1 min-w-0">
                                {/* Header do Card */}
                                <div className="px-4 py-3 flex items-start justify-between border-b border-white/5">
                                    <div className="flex gap-4 min-w-0">
                                        <div className={`text-base font-bold shrink-0 mt-1 ${isActuallyCompleted ? 'text-green-300' : isNoShow ? 'text-amber-300' : 'text-white'}`}>
                                            {apt.time}
                                        </div>
                                        <div className="flex flex-col gap-1.5 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span className={`text-base font-bold truncate tracking-tight ${isActuallyCompleted ? 'text-green-300 opacity-70' : isNoShow ? 'text-amber-300 opacity-70' : 'text-white'}`}>
                                                    {capitalizeName(apt.clientName)}
                                                </span>
                                                {isNoShow && (
                                                    <span className="bg-amber-500/20 text-amber-300 text-[8px] font-black px-1.5 py-0.5 rounded-full uppercase tracking-widest shrink-0">FALTA</span>
                                                )}
                                            </div>
                                            <div className="flex flex-col gap-1.5">
                                                <span className={`text-xs font-bold uppercase tracking-wide flex items-center gap-1.5 flex-wrap ${isActuallyCompleted ? 'text-green-400/70' : isNoShow ? 'text-amber-400/70' : 'text-secondary'}`}>
                                                    {isActuallyCompleted ? 'Atendimento Finalizado ✨' : isNoShow ? 'Falta Registrada' : (() => {
                                                        const numServices = apt.service.split(',').length;
                                                        const serviceLabel = numServices > 1 ? `${numServices} serviços` : apt.service;
                                                        return (
                                                            <>
                                                                <span>{serviceLabel}</span>
                                                                <span className="text-[11px] font-medium text-emerald-500 normal-case tracking-normal">
                                                                    · {formatCurrency(apt.price || 0)}
                                                                </span>
                                                            </>
                                                        );
                                                    })()}
                                                </span>
                                                {apt.observation?.includes('[EXCEPCIONAL]') && (
                                                    <div className="inline-flex items-center gap-1 bg-amber-100 text-amber-700 text-[10px] font-black px-2 py-0.5 rounded-full w-fit shrink-0">
                                                        <Zap size={10} className="fill-amber-700" />
                                                        <span>EXCEPCIONAL</span>
                                                    </div>
                                                )}
                                                {apt.observation && (() => {
                                                    const cleanObs = apt.observation.replace('[EXCEPCIONAL]', '').trim();
                                                    if (!cleanObs) return null;
                                                    return (
                                                        <p className={`text-[10px] italic leading-tight ${isActuallyCompleted ? 'text-green-300/40 line-through' : isNoShow ? 'text-amber-300/40 line-through' : 'text-title'}`}>
                                                            Obs: {cleanObs}
                                                        </p>
                                                    );
                                                })()}
                                            </div>
                                        </div>
                                    </div>
                                </div>

                            {/* Rodapé - Barra de Ferramentas */}
                            <div className="px-4 pt-0.5 pb-2 mt-0 flex items-center justify-between bg-transparent">
                                <div className="flex items-center gap-4">
                                    <div className="flex flex-col items-center gap-1 w-[40px] h-[47px]">
                                        <button 
                                            disabled={isNoShow}
                                            onClick={() => handleCameraClick(apt.phone)}
                                            className={`w-10 h-10 flex items-center justify-center transition-colors rounded-xl ${isNoShow ? 'text-muted opacity-30 cursor-not-allowed' : 'text-violet-400 hover:bg-violet-400/15'}`}
                                        >
                                            <Camera size={18} />
                                        </button>
                                        <span className="text-[10px] text-title">Foto</span>
                                    </div>

                                    <div className="flex flex-col items-center gap-1 w-[40px] h-[47px]">
                                        <button 
                                            onClick={() => onOpenCustomer(apt.phone)}
                                            className="w-10 h-10 flex items-center justify-center rounded-xl transition-colors text-sky-400 hover:bg-sky-400/15"
                                        >
                                            <User size={18} />
                                        </button>
                                        <span className="text-[10px] text-title">Cliente</span>
                                    </div>

                                    <div className="flex flex-col items-center gap-1 w-[40px] h-[47px]">
                                        <button 
                                            disabled={isActuallyCompleted || isNoShow}
                                            onClick={() => onReschedule(apt)}
                                            className={`w-10 h-10 flex items-center justify-center transition-colors rounded-xl ${isActuallyCompleted || isNoShow ? 'text-muted opacity-30 cursor-not-allowed' : 'text-emerald-400 hover:bg-emerald-400/15'}`}
                                        >
                                            <Edit3 size={18} />
                                        </button>
                                        <span className="text-[10px] text-title">Editar</span>
                                    </div>

                                    <div className="flex flex-col items-center gap-1 w-[40px] h-[47px]">
                                        <button 
                                            disabled={isActuallyCompleted || isNoShow}
                                            onClick={() => setActiveNoShowMenu(apt.id)}
                                            className={`w-10 h-10 flex items-center justify-center transition-colors rounded-xl ${isActuallyCompleted || isNoShow ? 'text-muted opacity-30 cursor-not-allowed' : 'text-red-400 hover:bg-red-400/15'}`}
                                        >
                                            <ThumbsDown size={18} />
                                        </button>
                                        <span className="text-[10px] text-title">Falta</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Botões de Ação Laterais */}
                            <div className="w-14 flex flex-col items-center justify-center gap-4 border-l border-white/5 bg-white/5 shrink-0">
                                <button 
                                    disabled={isActuallyCompleted || isNoShow}
                                    onClick={() => setActiveCancelMenu(apt.id)}
                                    className={`w-8 h-8 rounded-full flex items-center justify-center transition-all shrink-0 ${isActuallyCompleted || isNoShow ? 'text-muted opacity-20 cursor-not-allowed' : 'text-red-400 hover:bg-red-400/15 transition-all'}`}
                                    title="Cancelar"
                                >
                                    <Trash2 size={16} />
                                </button>
                                <button 
                                    disabled={isFinishing}
                                    onClick={() => (isActuallyCompleted || isNoShow) ? setActiveRevertMenu(apt.id) : setActiveFinishMenu(apt.id)}
                                    className={`w-8 h-8 rounded-full flex items-center justify-center transition-all shrink-0 ${isActuallyCompleted ? 'bg-green-400/15 text-green-300 border border-green-400/25 hover:bg-green-400/25' : isNoShow ? 'bg-amber-400/15 text-amber-300 border border-amber-400/25 hover:bg-amber-400/25' : 'bg-secondary text-white shadow-md shadow-secondary/30 active:scale-90'}`}
                                    title={(isActuallyCompleted || isNoShow) ? "Retornar atendimento" : "Confirmar"}
                                >
                                    {(isActuallyCompleted || isNoShow) ? <RotateCcw size={16} /> : <Check size={16} />}
                                </button>
                            </div>

                            {/* Menu de Cancelamento */}
                            <AnimatePresence>
                                {isCancelOpen && (
                                    <motion.div 
                                        initial={{ opacity: 0, scale: 0.95 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        exit={{ opacity: 0, scale: 0.95 }}
                                        className="menu-container absolute inset-0 bg-surface rounded-2xl flex items-center justify-center gap-3 z-10 px-3"
                                    >
                                        <p className="text-white text-[9px] font-black uppercase tracking-widest flex-1">Deseja cancelar?</p>
                                        <div className="flex gap-2">
                                            <button 
                                                onClick={() => { 
                                                    deleteAppointment(apt.id); 
                                                    setActiveCancelMenu(null); 
                                                    onSuccess?.('Agendamento excluído com sucesso!');
                                                }}
                                                className="h-8 px-4 bg-red-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg"
                                            >
                                                Sim
                                            </button>
                                            <button 
                                                onClick={() => setActiveCancelMenu(null)}
                                                className="h-8 px-4 bg-primary text-white rounded-xl text-[10px] font-black uppercase tracking-widest"
                                            >
                                                Não
                                            </button>
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>

                            {/* Menu de Não Compareceu */}
                            <AnimatePresence>
                                {isNoShowOpen && (
                                    <motion.div 
                                        initial={{ opacity: 0, scale: 0.95 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        exit={{ opacity: 0, scale: 0.95 }}
                                        className="menu-container absolute inset-0 bg-surface rounded-2xl flex items-center justify-center gap-3 z-10 px-3"
                                    >
                                        <p className="text-white text-[9px] font-black uppercase tracking-widest flex-1">Confirmar falta?</p>
                                        <div className="flex gap-2">
                                            <button 
                                                onClick={() => { 
                                                    markNoShow(apt.id); 
                                                    setActiveNoShowMenu(null); 
                                                    onSuccess?.('Falta registrada com sucesso!');
                                                }}
                                                className="h-8 px-4 bg-amber-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg"
                                            >
                                                Sim
                                            </button>
                                            <button 
                                                onClick={() => setActiveNoShowMenu(null)}
                                                className="h-8 px-4 bg-primary text-white rounded-xl text-[10px] font-black uppercase tracking-widest"
                                            >
                                                Não
                                            </button>
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>

                            {/* Menu de Conclusão */}
                            <AnimatePresence>
                                {isFinishOpen && (
                                    <motion.div 
                                        initial={{ opacity: 0, scale: 0.95 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        exit={{ opacity: 0, scale: 0.95 }}
                                        className="menu-container absolute inset-0 bg-surface rounded-2xl flex items-center justify-center gap-3 z-10 px-3"
                                    >
                                        <p className="text-white text-[9px] font-black uppercase tracking-widest flex-1">Finalizar atendimento?</p>
                                        <div className="flex gap-2">
                                            <button 
                                                onClick={() => { handleFinish(apt.id); setActiveFinishMenu(null); }}
                                                className="h-8 px-4 bg-green-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg"
                                            >
                                                Sim
                                            </button>
                                            <button 
                                                onClick={() => setActiveFinishMenu(null)}
                                                className="h-8 px-4 bg-primary text-white rounded-xl text-[10px] font-black uppercase tracking-widest"
                                            >
                                                Não
                                            </button>
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>

                            {/* Menu de Retorno */}
                            <AnimatePresence>
                                {isRevertOpen && (
                                    <motion.div 
                                        initial={{ opacity: 0, scale: 0.95 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        exit={{ opacity: 0, scale: 0.95 }}
                                        className="menu-container absolute inset-0 bg-surface rounded-2xl flex items-center justify-center gap-3 z-10 px-3"
                                    >
                                        <p className="text-white text-[9px] font-black uppercase tracking-widest flex-1">Retornar atendimento?</p>
                                        <div className="flex gap-2">
                                            <button 
                                                onClick={() => { 
                                                    revertAppointment(apt.id); 
                                                    setActiveRevertMenu(null); 
                                                    onSuccess?.('Atendimento retornado com sucesso!');
                                                }}
                                                className="h-8 px-4 bg-secondary text-white rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg"
                                            >
                                                Sim
                                            </button>
                                            <button 
                                                onClick={() => setActiveRevertMenu(null)}
                                                className="h-8 px-4 bg-primary text-white rounded-xl text-[10px] font-black uppercase tracking-widest"
                                            >
                                                Não
                                            </button>
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </motion.div>
                    );
                })}
            </div>
        )}

        {/* Exceptional Slot - Compact Style */}
        {activeFilter !== 'concluidos' && (
          <div className="my-3">
              <div 
                  onClick={() => onAddInSlot(selectedDate, '', true)}
                  className="border-[1.5px] border-dashed border-[#F5A623] rounded-xl bg-[#F5A623]/[0.08] py-[14px] px-4 flex flex-row items-center cursor-pointer hover:opacity-80 transition-opacity"
              >
                  <Zap size={18} className="text-[#F5A623] fill-[#F5A623] mr-2.5 shrink-0" />
                  <div className="text-[13px] font-semibold text-[#B7620A] tracking-[0.5px]">
                      Agendar Fora do Expediente
                  </div>
                  <ChevronRight size={16} className="text-[#B7620A] ml-auto shrink-0" />
              </div>
          </div>
        )}

        {/* Completed Section */}
        {(activeFilter === 'todos' || activeFilter === 'concluidos') && completedAppointments.length > 0 && (
            <div className="mt-8 space-y-4">
                <SectionHeader title="Concluídos" count={completedAppointments.length} accent="green" />

                <div className="space-y-1.5">
                    {completedAppointments.map((apt) => {
                        const isExpanded = expandedCompletedId === apt.id;
                        const isNoShow = apt.status === 'no-show';
                        const isRevertOpen = activeRevertMenu === apt.id;

                        return (
                            <div 
                                key={apt.id}
                                className={`rounded-[12px] shadow-[0_2px_6px_rgba(0,0,0,0.06)] overflow-hidden transition-all duration-300 border-l-[4px] ${
                                    isNoShow
                                        ? 'bg-[#F5A623]/[0.06] border-[#F5A623]'
                                        : 'bg-[#48C78E]/[0.06] border-[#48C78E]'
                                }`}
                            >
                                {/* Accordion Header */}
                                <div 
                                    onClick={() => setExpandedCompletedId(isExpanded ? null : apt.id)}
                                    className="p-[14px] flex items-center justify-between cursor-pointer hover:bg-black/5 transition-colors"
                                >
                                    <div className="flex items-center gap-2.5 min-w-0">
                                        <span className={`text-[14px] font-bold shrink-0 ${isNoShow ? 'text-[#B7620A]' : 'text-[#1E1B4B]'}`}>
                                            {apt.time}
                                        </span>
                                        <div className="flex items-center gap-1.5 min-w-0">
                                            <span className={`text-[14px] font-semibold truncate ${isNoShow ? 'text-[#B7620A]' : 'text-[#1E1B4B]'}`}>
                                                {capitalizeName(apt.clientName)}
                                                <span className={`text-[12px] font-normal ml-1 ${isNoShow ? 'text-[#B7620A]/70' : 'text-[#1E1B4B]/70'}`}>
                                                    ({apt.service})
                                                </span>
                                            </span>
                                            {!isNoShow && <Check size={16} className="text-[#48C78E] shrink-0" />}
                                        </div>
                                        {isNoShow && (
                                            <span className="text-[10px] font-black px-1.5 py-0.5 rounded-full bg-[#F5A623]/20 text-[#B7620A] uppercase tracking-widest shrink-0">
                                                FALTA
                                            </span>
                                        )}
                                    </div>
                                    <ChevronRight 
                                        size={18} 
                                        className={`text-[#1E1B4B]/30 transition-transform duration-300 ${isExpanded ? 'rotate-90' : ''}`} 
                                    />
                                </div>

                                {/* Accordion Content */}
                                <AnimatePresence>
                                    {isExpanded && (
                                        <motion.div
                                            initial={{ height: 0, opacity: 0 }}
                                            animate={{ height: 'auto', opacity: 1 }}
                                            exit={{ height: 0, opacity: 0 }}
                                            transition={{ duration: 0.3, ease: 'easeInOut' }}
                                        >
                                            <div className="px-4 pb-3 pt-1.5 border-t border-title/10 relative">
                                                <div className="flex items-center justify-between bg-transparent py-2 w-full">
                                                    <div className="flex gap-3">
                                                        <button 
                                                            disabled={isNoShow}
                                                            onClick={(e) => { e.stopPropagation(); handleCameraClick(apt.phone); }}
                                                            className={`w-10 h-10 flex items-center justify-center transition-colors rounded-full ${isNoShow ? 'bg-[#1E1B4B]/[0.04] text-[#1E1B4B]/20 grayscale' : 'bg-[#1E1B4B]/[0.08] text-[#1E1B4B]/50 hover:bg-[#1E1B4B]/[0.12]'}`}
                                                            title="Foto"
                                                        >
                                                            <Camera size={18} />
                                                        </button>

                                                        <button 
                                                            onClick={(e) => { e.stopPropagation(); onOpenCustomer(apt.phone); }}
                                                            className="w-10 h-10 flex items-center justify-center rounded-full transition-colors bg-[#1E1B4B]/[0.08] text-[#1E1B4B]/50 hover:bg-[#1E1B4B]/[0.12]"
                                                            title="Cliente"
                                                        >
                                                            <User size={18} />
                                                        </button>
                                                    </div>

                                                    <div className="flex-1 flex justify-end">
                                                        <button 
                                                            onClick={(e) => { e.stopPropagation(); setActiveRevertMenu(apt.id); }}
                                                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-colors bg-[#1E1B4B] text-[#FFFFFF] hover:bg-[#1E1B4B]/90"
                                                        >
                                                            <RotateCcw size={14} />
                                                            <span>Retornar</span>
                                                        </button>
                                                    </div>
                                                </div>

                                                {/* Revert Menu Overlay */}
                                                <AnimatePresence>
                                                    {isRevertOpen && (
                                                        <motion.div 
                                                            initial={{ opacity: 0 }}
                                                            animate={{ opacity: 1 }}
                                                            exit={{ opacity: 0 }}
                                                            className="absolute inset-0 bg-surface flex items-center justify-center gap-3 z-20 px-4"
                                                        >
                                                            <p className="text-white text-[9px] font-black uppercase tracking-widest flex-1">Retornar atendimento?</p>
                                                            <div className="flex gap-2">
                                                                <button 
                                                                    onClick={() => { 
                                                                        revertAppointment(apt.id); 
                                                                        setActiveRevertMenu(null); 
                                                                        onSuccess?.('Atendimento retornado com sucesso!');
                                                                    }}
                                                                    className="h-8 px-4 bg-secondary text-white rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg"
                                                                >
                                                                    Sim
                                                                </button>
                                                                <button 
                                                                    onClick={() => setActiveRevertMenu(null)}
                                                                    className="h-8 px-4 bg-primary text-white rounded-xl text-[10px] font-black uppercase tracking-widest"
                                                                >
                                                                    Não
                                                                </button>
                                                            </div>
                                                        </motion.div>
                                                    )}
                                                </AnimatePresence>
                                            </div>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>
                        );
                    })}
                </div>
            </div>
        )}
      </div>
      </div>

      {/* Decision Modal for Weekly Unlock */}
      <AnimatePresence>
        {weeklyUnlockSlot && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setWeeklyUnlockSlot(null)}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[190]"
            />
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-surface w-[90%] max-w-sm rounded-[32px] shadow-2xl p-8 relative z-[200] border border-white/20 text-center space-y-6"
            >
              <div className="w-16 h-16 bg-surface/80 rounded-full flex items-center justify-center mx-auto text-secondary">
                <Repeat size={32} />
              </div>
              <div className="space-y-2">
                <h3 className="text-lg font-black text-white uppercase tracking-tighter">Liberar Horário</h3>
                <p className="text-sm text-white font-medium">Como deseja liberar este horário das <span className="font-bold text-white">{weeklyUnlockSlot}</span>?</p>
              </div>
              
              <div className="space-y-3">
                <button 
                  onClick={() => {
                    toggleSlotUnblock(selectedDate, weeklyUnlockSlot);
                    setWeeklyUnlockSlot(null);
                    onSuccess?.('Liberado apenas para hoje!');
                  }}
                  className="w-full h-14 bg-surface/80 text-white rounded-2xl font-black uppercase tracking-widest text-[10px] hover:bg-surface transition-all"
                >
                  Liberar apenas para hoje
                </button>
                <button 
                  onClick={() => {
                    toggleWeeklyBreak(dayOfWeek, weeklyUnlockSlot);
                    setWeeklyUnlockSlot(null);
                    onSuccess?.('Removido do padrão semanal!');
                  }}
                  className="w-full h-14 bg-secondary text-white rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-lg shadow-secondary/20 hover:bg-secondary transition-all"
                >
                  Remover do padrão semanal
                </button>
                <button 
                  onClick={() => setWeeklyUnlockSlot(null)}
                  className="w-full py-2 text-title font-black uppercase tracking-widest text-[9px] hover:text-white transition-colors"
                >
                  Cancelar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

const AddCustomerModal: React.FC<{ onClose: () => void, onSuccess: (msg: string) => void }> = ({ onClose, onSuccess }) => {
  useLockBodyScroll();
  const { addCustomer } = useStore();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [errors, setErrors] = useState<{name?: boolean, phone?: boolean}>({});
  const [showErrorMsg, setShowErrorMsg] = useState(false);
  const [duplicateError, setDuplicateError] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const validatingPromiseRef = useRef<Promise<void> | null>(null);

  const checkDuplicate = async (phoneToCheck: string) => {
    const normalized = normalizePhone(phoneToCheck);
    if (!normalized || !isSupabaseConfigured()) return;
    
    setIsValidating(true);
    const promise = (async () => {
      try {
        const existing = await supabaseService.checkDuplicateCustomer(normalized) as { name: string } | null;
        if (existing) {
          setDuplicateError(`Este número já está cadastrado para o cliente ${existing.name}.`);
        } else {
          setDuplicateError(null);
        }
      } catch (error) {
        console.error('Error checking duplicate:', error);
      } finally {
        setIsValidating(false);
        validatingPromiseRef.current = null;
      }
    })();
    validatingPromiseRef.current = promise;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors = {
      name: !name.trim(),
      phone: !phone.trim()
    };
    setErrors(newErrors);
    
    // Aguarda validação em andamento antes de prosseguir
    if (validatingPromiseRef.current) {
      await validatingPromiseRef.current;
    }

    if (newErrors.name || newErrors.phone || duplicateError) {
      setShowErrorMsg(true);
      return;
    }

    try {
      await addCustomer({
        name: capitalizeName(name),
        phone,
        cutCount: 0,
        history: [],
        photos: []
      });
      onSuccess('Cliente cadastrado com sucesso!');
      onClose();
    } catch (error: any) {
      if (error?.code === '23505' || error?.message?.includes('duplicate key value')) {
        const normalized = normalizePhone(phone);
        const existing = await supabaseService.checkDuplicateCustomer(normalized) as { name: string } | null;
        setDuplicateError(`Este número já está cadastrado para o cliente ${existing?.name || 'outro cliente'}.`);
      } else {
        console.error('Error adding customer:', error);
      }
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-surface/40 backdrop-blur-md animate-in fade-in">
      <div className="bg-surface  w-full max-w-[95%] sm:max-w-sm rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] relative border border-white/20 ">
        <header className="p-6 border-b border-title/20  flex justify-between items-center shrink-0 bg-surface  sticky top-0 z-10">
            <h2 className="text-lg font-bold text-white  uppercase tracking-tight">Novo Cliente</h2>
            <button onClick={onClose} className="w-10 h-10 rounded-full bg-surface/80  text-title flex items-center justify-center hover:bg-surface :bg-primary transition-colors">
              <X size={20} />
            </button>
        </header>
        
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
          <div className="p-6 space-y-4 overflow-y-auto flex-1 min-h-0">
            <Input 
              label="Nome Completo" 
              value={name} 
              onChange={e => { setName(e.target.value); setErrors(prev => ({...prev, name: false})); setShowErrorMsg(false); }} 
              placeholder="Ex: Allan Ribeiro" 
              requiredField
              error={errors.name}
            />
            <div className="space-y-1">
              <Input 
                label="Telefone / WhatsApp" 
                value={phone} 
                onChange={e => { 
                  setPhone(formatPhone(e.target.value)); 
                  setErrors(prev => ({...prev, phone: false})); 
                  setShowErrorMsg(false); 
                  setDuplicateError(null);
                }} 
                onBlur={() => checkDuplicate(phone)}
                placeholder="(00) 00000-0000" 
                maxLength={15} 
                requiredField
                error={errors.phone || !!duplicateError}
                className={duplicateError ? 'border-red-500 ring-red-500' : ''}
              />
              {duplicateError && (
                <p className="text-red-500 text-[11px] font-bold ml-1 animate-in slide-in-from-top-1">
                  {duplicateError}
                </p>
              )}
            </div>
          </div>
          
          <footer className="p-6 border-t border-title/20  shrink-0 bg-surface  sticky bottom-0 z-10 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
            {showErrorMsg && !duplicateError && <p className="text-red-500 text-[13px] font-bold text-center mb-4">Preencha todos os campos obrigatórios</p>}
            <Button 
              type="submit" 
              fullWidth 
              disabled={!!duplicateError}
              className="h-14 font-black uppercase tracking-widest shadow-xl shadow-secondary/20 disabled:opacity-50 disabled:shadow-none"
            >
              {isValidating ? 'Validando...' : 'Cadastrar Cliente'}
            </Button>
          </footer>
        </form>
      </div>
    </div>
  );
};

const AddAppointmentModal: React.FC<{ 
  selectedDate: string; 
  selectedTime?: string; 
  prefilledCustomer?: Customer | null;
  isExceptional?: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}> = ({ selectedDate: initialDate, selectedTime: initialTime, prefilledCustomer, isExceptional = false, onClose, onSuccess }) => {
  useLockBodyScroll();
  const { addAppointment, appointments, weeklySchedule, services, customers, addCustomer, staff, selectedStaffId, activeTenant } = useStore();

  const getRoundedCurrentTime = () => {
    const now = new Date();
    const minutes = now.getMinutes();
    const roundedMinutes = Math.round(minutes / 15) * 15;
    const d = new Date(now.getTime());
    d.setMinutes(roundedMinutes);
    d.setSeconds(0);
    return d.toTimeString().substring(0, 5);
  };

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(prefilledCustomer || null);
  const [isNewCustomer, setIsNewCustomer] = useState(false);
  const [saveToContacts, setSaveToContacts] = useState(true);
  const [showDropdown, setShowDropdown] = useState(false);

  const [formData, setFormData] = useState({
    name: prefilledCustomer?.name || '',
    phone: prefilledCustomer?.phone || '',
    date: initialDate,
    time: isExceptional ? getRoundedCurrentTime() : (initialTime || ''),
    serviceIds: [] as string[],
    observation: '',
    staffId: selectedStaffId !== 'all' ? selectedStaffId : (staff[0]?.id || '')
  });

  const [duplicateCustomer, setDuplicateCustomer] = useState<Customer | null>(null);
  const [isDuplicateDetected, setIsDuplicateDetected] = useState(false);
  const [isButtonFlashing, setIsButtonFlashing] = useState(false);
  const warningRef = useRef<HTMLDivElement>(null);

  // Filter customers based on search term
  const filteredCustomers = useMemo(() => {
    if (searchTerm.length < 2) return [];
    
    const searchDigits = searchTerm.replace(/\D/g, '');
    const termLower = searchTerm.toLowerCase();
    
    return (Object.values(customers) as Customer[]).filter(c => {
      const normalizedName = c.name.toLowerCase();
      const customerDigits = c.phone.replace(/\D/g, '');
      
      // Flexible search logic (ignoring 9th digit if necessary)
      // Brazilian numbers: (XX) 9 XXXX-XXXX (11 digits)
      const customerWithoutNinth = customerDigits.replace(/^(\d{2})(\d{1})(\d{8})$/, '$1$3');
      
      const nameMatch = normalizedName.includes(termLower);
      const phoneMatch = searchDigits.length > 0 && (
        customerDigits.includes(searchDigits) || 
        customerWithoutNinth.includes(searchDigits)
      );

      return nameMatch || phoneMatch;
    }).slice(0, 5); // Limit to 5 results for better UI
  }, [customers, searchTerm]);

  const isSearchPhone = /^\d+$/.test(searchTerm.replace(/\D/g, '')) && searchTerm.replace(/\D/g, '').length >= 8;
  const searchNormalized = searchTerm.replace(/\D/g, '');
  const phoneAlreadyExists = isSearchPhone && (Object.values(customers) as Customer[]).some(c => c.phone.replace(/\D/g, '') === searchNormalized);

  const handleSelectCustomer = (customer: Customer) => {
    setSelectedCustomer(customer);
    setFormData(prev => ({
      ...prev,
      name: capitalizeName(customer.name),
      phone: customer.phone
    }));
    setSearchTerm('');
    setShowDropdown(false);
    setIsNewCustomer(false);
    setDuplicateCustomer(null);
  };

  const handleCreateNew = () => {
    setIsNewCustomer(true);
    const digitsOnly = searchTerm.replace(/\D/g, '');
    const hasLetters = /[a-zA-Z]/.test(searchTerm);

    if (!hasLetters && digitsOnly.length > 0) {
      setFormData(prev => ({
        ...prev,
        name: '',
        phone: formatPhone(digitsOnly)
      }));
    } else {
      setFormData(prev => ({
        ...prev,
        name: capitalizeName(searchTerm),
        phone: ''
      }));
    }
    setSelectedCustomer(null);
    setSearchTerm('');
    setShowDropdown(false);
    setDuplicateCustomer(null);
  };

  const clearSelectedCustomer = () => {
    setSelectedCustomer(null);
    setIsNewCustomer(false);
    setDuplicateCustomer(null);
    setFormData(prev => ({
      ...prev,
      name: '',
      phone: ''
    }));
  };
  const [errors, setErrors] = useState<{name?: boolean, phone?: boolean, time?: boolean, services?: boolean}>({});
  const [showErrorMsg, setShowErrorMsg] = useState(false);

  const dayOfWeek = new Date(formData.date + 'T12:00:00').getDay();
  const dayConfig = weeklySchedule[dayOfWeek];
  const generatedSlots = useMemo(() => dayConfig?.isOpen ? generateTimeSlots(dayConfig.start, dayConfig.end) : [], [dayConfig]);

  const isWithinRegularHours = useMemo(() => {
    if (!formData.time || !dayConfig?.isOpen) return false;
    const normalized = normalizeTime(formData.time);
    return generatedSlots.includes(normalized);
  }, [formData.time, generatedSlots, dayConfig]);

  const isSlotPast = (slot: string) => {
    const today = getTodayString();
    if (formData.date < today) return true;
    if (formData.date > today) return false;
    const [h, m] = slot.split(':').map(Number);
    const now = new Date();
    const slotDate = new Date();
    slotDate.setHours(h, m, 0, 0);
    return slotDate < now;
  };

  const toggleService = (id: string) => {
    setFormData(prev => ({
      ...prev,
      serviceIds: prev.serviceIds.includes(id) 
        ? prev.serviceIds.filter(sid => sid !== id)
        : [...prev.serviceIds, id]
    }));
    setErrors(prev => ({...prev, services: false}));
    setShowErrorMsg(false);
  };

  const selectedServices = services.filter(s => formData.serviceIds.includes(s.id));
  const totalPrice = selectedServices.reduce((sum, s) => sum + s.price, 0);
  const totalDuration = selectedServices.reduce((sum, s) => sum + (s.duration || 15), 0);

  const bookedSlots = useMemo(() => {
    const booked: string[] = [];
    appointments.filter(a => a.date === formData.date).forEach(a => {
      const slots = getOccupiedSlots(a.time, a.duration || 15);
      booked.push(...slots);
    });
    return booked;
  }, [appointments, formData.date]);

  const isSlotAvailable = (slot: string) => {
    if (bookedSlots.includes(slot)) return false;
    const requiredSlots = getOccupiedSlots(slot, totalDuration);
    return requiredSlots.every(s => generatedSlots.includes(s) && !bookedSlots.includes(s));
  };

  const executeFinalSave = async (data: typeof formData, isNew: boolean, save: boolean) => {
    // If new customer and "save to contacts" is checked
    if (isNew && save) {
      try {
        await addCustomer({
          phone: normalizePhone(data.phone),
          name: capitalizeName(data.name),
          cutCount: 0,
          history: [],
          photos: []
        });
      } catch (err) {
        console.error("Error saving customer:", err);
      }
    }

    addAppointment({
      id: Date.now().toString(),
      tenantId: activeTenant?.id || undefined,
      staffId: data.staffId || undefined,
      clientName: capitalizeName(data.name),
      phone: normalizePhone(data.phone),
      date: data.date,
      time: data.time,
      service: selectedServices.map(s => s.name).join(', '),
      price: totalPrice,
      duration: totalDuration,
      observation: data.observation,
      status: 'pending',
      createdAt: Date.now()
    }, isExceptional);
    onSuccess?.();
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors = {
      name: !formData.name.trim(),
      phone: !formData.phone.trim(),
      time: !formData.time,
      services: formData.serviceIds.length === 0
    };
    setErrors(newErrors);
    if (newErrors.name || newErrors.phone || newErrors.time || newErrors.services) {
      setShowErrorMsg(true);
      return;
    }

    if (isNewCustomer && !duplicateCustomer) {
      const normalizedInputPhone = formData.phone.replace(/\D/g, '');
      const existing = (Object.values(customers) as Customer[]).find(c => c.phone.replace(/\D/g, '') === normalizedInputPhone);
      
      if (existing) {
        setDuplicateCustomer(existing);
        setIsDuplicateDetected(true);
        setIsButtonFlashing(true);
        
        // Trigger button flash reset
        setTimeout(() => setIsButtonFlashing(false), 300);

        // Scroll to warning
        setTimeout(() => {
          warningRef.current?.scrollIntoView({
            behavior: 'smooth',
            block: 'center'
          });
        }, 100);

        // Reset shake after animation
        setTimeout(() => {
          setIsDuplicateDetected(false);
        }, 400);

        return;
      }
    }

    await executeFinalSave(formData, isNewCustomer, saveToContacts);
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      {/* Overlay */}
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[190]"
      />
      
      {/* Modal Container */}
      <motion.div 
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="bg-surface  w-[90%] max-w-md rounded-[32px] shadow-2xl flex flex-col max-h-[85vh] relative z-[200] border border-title/30  overflow-hidden"
      >
        <header className="px-6 pt-6 pb-4 flex justify-between items-center shrink-0 bg-surface  sticky top-0 z-10 mb-6">
          <div className="flex items-center gap-2">
            {isExceptional && <Zap size={20} className="text-amber-500 fill-amber-500" />}
            <h2 className="text-lg font-bold text-white  uppercase tracking-tight">
              {isExceptional ? 'Agendamento Excepcional' : 'Novo Agendamento'}
            </h2>
          </div>
          <button onClick={onClose} className="w-10 h-10 rounded-full bg-primary/40  flex items-center justify-center text-title hover:bg-primary/40 :bg-surface transition-colors">
            <X size={20} />
          </button>
        </header>
        
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
          <div className="px-6 pb-6 space-y-6 overflow-y-auto flex-1 min-h-0 pr-4">
            {isExceptional && (
              <div className="space-y-4">
                <div className="bg-amber-50  border border-amber-100  p-4 rounded-2xl flex items-start gap-3">
                  <AlertTriangle size={18} className="text-amber-500 shrink-0 mt-0.5" />
                  <p className="text-[11px] font-medium text-amber-800  leading-relaxed">
                    Atenção: Este agendamento está fora do horário padrão. O horário deve ser inserido manualmente.
                  </p>
                </div>
                
                {isWithinRegularHours && (
                  <div className="bg-red-50  border border-red-100  p-4 rounded-2xl flex items-start gap-3 animate-in fade-in slide-in-from-top-2">
                    <XCircle size={18} className="text-red-500 shrink-0 mt-0.5" />
                    <p className="text-[11px] font-bold text-red-800  leading-relaxed">
                      Este horário está dentro do expediente normal. Por favor, use a grade principal para agendar neste horário.
                    </p>
                  </div>
                )}
              </div>
            )}
            {/* Client Selection Section */}
            <div className="relative space-y-4">
              {!selectedCustomer && !isNewCustomer ? (
                <div className="relative">
                  <Input 
                    label="Buscar ou adicionar cliente..." 
                    value={searchTerm} 
                    onChange={e => {
                      setSearchTerm(e.target.value);
                      setShowDropdown(true);
                      setShowErrorMsg(false);
                    }}
                    onFocus={() => setShowDropdown(true)}
                    placeholder="Digite nome ou WhatsApp..."
                    autoFocus
                    icon={<Search size={18} className="text-title" />}
                  />
                  
                  {showDropdown && searchTerm.length >= 2 && (
                    <div className="absolute top-full left-0 right-0 mt-2 bg-surface  rounded-2xl shadow-2xl border border-title/30  overflow-hidden z-[300] animate-in fade-in slide-in-from-top-2">
                      {filteredCustomers.length > 0 ? (
                        <div className="max-h-[200px] overflow-y-auto">
                          {filteredCustomers.map(customer => (
                            <button
                              key={customer.phone}
                              type="button"
                              onClick={() => handleSelectCustomer(customer)}
                              className="w-full flex items-center gap-3 py-2 px-3 hover:bg-primary/40  transition-colors border-b border-title/30  last:border-0"
                            >
                              <div className="w-10 h-10 rounded-full bg-surface/80  flex items-center justify-center overflow-hidden shrink-0 shadow-sm">
                                {customer.avatar ? (
                                  <img src={customer.avatar} alt={customer.name} className="w-full h-full object-cover" />
                                ) : (
                                  <User size={20} className="text-secondary " />
                                )}
                              </div>
                              <div className="flex-1 text-left min-w-0">
                                <p className="text-sm font-semibold text-white  truncate">{capitalizeName(customer.name)}</p>
                                <p className="text-xs text-title ">{customer.phone}</p>
                              </div>
                            </button>
                          ))}
                        </div>
                      ) : null}
                      
                      {!phoneAlreadyExists && (
                        <button
                          type="button"
                          onClick={handleCreateNew}
                          className="w-full flex items-center gap-3 p-4 bg-surface/80  hover:bg-surface/80 :bg-surface/80/20 transition-colors text-secondary "
                        >
                          <div className="w-10 h-10 rounded-full bg-surface/80  flex items-center justify-center shrink-0">
                            <UserPlus size={20} />
                          </div>
                          <div className="text-left">
                            <p className="text-sm font-bold uppercase tracking-tight">Criar novo cliente</p>
                            <p className="text-xs opacity-80">"{capitalizeName(searchTerm)}"</p>
                          </div>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className={`p-4 rounded-2xl border transition-all flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4 relative group bg-secondary/[0.12] border-secondary/25`}>
                  <div className="flex items-center gap-3 w-full sm:w-auto">
                    <div className="w-12 h-12 rounded-full bg-surface  flex items-center justify-center overflow-hidden shrink-0 shadow-sm">
                      {selectedCustomer?.avatar ? (
                        <img src={selectedCustomer.avatar} alt={selectedCustomer.name} className="w-full h-full object-cover" />
                      ) : (
                        <User size={24} className="text-secondary " />
                      )}
                    </div>
                    <div className="sm:hidden flex-1 min-w-0">
                      <p className="text-[10px] font-bold text-secondary  uppercase tracking-widest mb-0.5">
                        {selectedCustomer ? 'Cliente Selecionado' : 'Novo Cliente'}
                      </p>
                      {selectedCustomer && (
                        <p className="text-xs text-title  font-medium truncate">
                          {selectedCustomer.phone}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex-1 w-full min-w-0 flex flex-col">
                    <p className="hidden sm:block text-[10px] font-bold text-secondary  uppercase tracking-widest mb-1 ml-1">
                      {selectedCustomer ? 'Cliente Selecionado' : 'Novo Cliente'}
                    </p>
                    <div className="relative flex w-full">
                      <input 
                        value={formData.name}
                        onChange={e => setFormData({...formData, name: e.target.value})}
                        className="bg-primary/60 border border-white/10 px-3 h-10 rounded-xl text-base font-semibold text-white tracking-tight focus:ring-2 focus:ring-secondary outline-none flex-1 w-full min-w-0 shadow-sm transition-all"
                        placeholder="Nome do Cliente"
                      />
                    </div>
                    <div className="hidden sm:block mt-1 ml-1">
                      {selectedCustomer && (
                        <p className="text-xs text-title  font-medium">
                          {selectedCustomer.phone}
                        </p>
                      )}
                    </div>
                  </div>
                  
                  <button 
                    type="button" 
                    onClick={clearSelectedCustomer}
                    className="absolute top-3 right-3 sm:relative sm:top-0 sm:right-0 w-8 h-8 rounded-full bg-surface  text-title hover:text-red-500 shadow-sm flex items-center justify-center transition-all hover:scale-110"
                  >
                    <X size={16} />
                  </button>
                </div>
              )}

              {isNewCustomer && (
                <motion.div 
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-4 pt-2"
                >
                  <div className="relative">
                    <Input 
                      label="WhatsApp do Novo Cliente" 
                      value={formData.phone} 
                      onChange={e => { 
                        setFormData({...formData, phone: formatPhone(e.target.value)}); 
                        setErrors(prev => ({...prev, phone: false})); 
                        setShowErrorMsg(false); 
                        setDuplicateCustomer(null);
                      }} 
                      maxLength={15} 
                      requiredField
                      error={errors.phone}
                      warning={!!duplicateCustomer}
                      className={isDuplicateDetected ? 'animate-shake' : ''}
                      placeholder="(00) 00000-0000"
                    />
                  </div>

                  {duplicateCustomer && (
                    <div 
                      ref={warningRef}
                      className="bg-amber-50  border border-amber-200  p-4 rounded-2xl space-y-3 animate-in fade-in slide-in-from-top-2"
                    >
                      <div className="flex items-start gap-2">
                        <AlertTriangle size={16} className="text-amber-500 shrink-0 mt-0.5" />
                        <p className="text-[11px] text-amber-800  leading-tight">
                          ⚠️ Este número já está cadastrado como <strong>{capitalizeName(duplicateCustomer.name)}</strong>. O que deseja fazer?
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button 
                          type="button"
                          onClick={() => handleSelectCustomer(duplicateCustomer)}
                          className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-bold py-2 rounded-xl transition-colors"
                        >
                          Usar {capitalizeName(duplicateCustomer.name.split(' ')[0])}
                        </button>
                        <button 
                          type="button"
                          onClick={() => {
                            setSaveToContacts(false);
                            executeFinalSave(formData, isNewCustomer, false);
                          }}
                          className="flex-1 text-title  text-[10px] font-bold py-2 rounded-xl hover:bg-primary/40  transition-colors"
                        >
                          Continuar assim mesmo
                        </button>
                      </div>
                    </div>
                  )}
                  
                  <label className="flex items-center gap-3 p-4 rounded-2xl bg-primary/40  cursor-pointer group transition-colors hover:bg-primary/40 :bg-surface">
                    <div className="relative flex items-center">
                      <input 
                        type="checkbox" 
                        checked={saveToContacts}
                        onChange={e => setSaveToContacts(e.target.checked)}
                        className="peer sr-only"
                      />
                      <div className="w-5 h-5 border-2 border-title/30  rounded-md peer-checked:bg-secondary peer-checked:border-secondary transition-all" />
                      <Check size={14} className="absolute left-0.5 text-white opacity-0 peer-checked:opacity-100 transition-opacity" />
                    </div>
                    <span className="text-xs font-bold text-white  uppercase tracking-tight">Salvar nos contatos</span>
                  </label>
                </motion.div>
              )}
            </div>
            <div className="space-y-3">
              <label className={`text-[10px] font-bold uppercase tracking-widest ml-1 flex items-center gap-1 ${errors.services ? 'text-red-500' : 'text-title '}`}>
                Serviços
                <span className="text-red-500">*</span>
              </label>
              <div className={`flex flex-wrap gap-2 p-1 rounded-2xl transition-all ${errors.services ? 'ring-2 ring-red-500 bg-red-50/50' : ''}`}>
                {services.map(s => (
                  <button key={s.id} type="button" onClick={() => toggleService(s.id)} className={`px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase transition-all ${formData.serviceIds.includes(s.id) ? 'bg-secondary/20 border border-secondary/50 text-secondary' : 'bg-white/[0.08] border border-white/[0.12] text-white/70'}`}>{s.name}</button>
                ))}
              </div>
              {errors.services && (
                <div className="flex items-center gap-1 text-red-500 text-[10px] font-bold ml-1">
                  <AlertTriangle size={12} />
                  <span>Selecione pelo menos um serviço</span>
                </div>
              )}
            </div>
            
            <div className="border-t border-white/[0.06] my-1" />

            <div className="space-y-3">
              <label className="text-[10px] font-bold uppercase tracking-widest ml-1 flex items-center gap-1 text-title ">
                Data
                <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <input
                  type="date"
                  value={formData.date}
                  min={getTodayString()}
                  onChange={e => { setFormData({...formData, date: e.target.value, time: ''}); setShowErrorMsg(false); }} 
                  className="w-full bg-white/[0.08] border border-white/[0.12] text-white rounded-2xl h-12 px-4 pr-10 text-sm font-medium [&::-webkit-calendar-picker-indicator]:opacity-0 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:w-full [&::-webkit-calendar-picker-indicator]:cursor-pointer"
                />
                <Calendar 
                  size={16} 
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none" 
                />
              </div>
            </div>

            <div className="border-t border-white/[0.06] my-1" />

            {isExceptional ? (
              <Input 
                label="Horário (Manual)" 
                type="time" 
                value={formData.time} 
                onChange={e => { setFormData({...formData, time: e.target.value}); setErrors(prev => ({...prev, time: false})); setShowErrorMsg(false); }} 
                requiredField
                error={errors.time}
              />
            ) : (
              <div className="space-y-3">
                <label className={`text-[10px] font-bold uppercase tracking-widest ml-1 flex items-center gap-1 ${errors.time ? 'text-red-500' : 'text-title '}`}>
                  Horário
                  <span className="text-red-500">*</span>
                </label>
                <div className={`overflow-x-auto flex gap-2 p-1 rounded-2xl transition-all ${errors.time ? 'ring-2 ring-red-500 bg-red-50/50' : ''}`}>
                    {generatedSlots.map(slot => {
                      const available = isSlotAvailable(slot);
                      if (isSlotPast(slot)) return null;
                      return (
                        <button key={slot} type="button" disabled={!available} onClick={() => { setFormData({...formData, time: slot}); setErrors(prev => ({...prev, time: false})); setShowErrorMsg(false); }} className={`py-2 px-4 shrink-0 rounded-xl text-xs font-bold transition-all ${formData.time === slot ? 'bg-secondary text-white shadow-[0_0_0_2px_#1E1B4B,0_0_0_4px_#F99417]' : !available ? 'bg-primary/40 text-title border border-title/30' : 'bg-white/[0.08] border border-white/[0.12] text-white/70 active:bg-white/[0.14]'}`}>{slot}</button>
                      );
                    })}
                </div>
                {errors.time && (
                  <div className="flex items-center gap-1 text-red-500 text-[10px] font-bold ml-1">
                    <AlertTriangle size={12} />
                    <span>Selecione um horário disponível</span>
                  </div>
                )}
              </div>
            )}
            {staff.length > 1 && (
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-title uppercase tracking-widest ml-1 flex items-center gap-1">
                  Profissional
                  <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <select
                    value={formData.staffId}
                    onChange={e => setFormData({ ...formData, staffId: e.target.value })}
                    className="w-full px-4 py-3 rounded-2xl bg-primary/40 border-none text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#F99417]"
                  >
                    {staff.map((s: any) => (
                      <option key={s.id} value={s.id} className="bg-[#1E1B4B] text-white">{s.name}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-title  uppercase tracking-widest ml-1 flex items-center gap-1">
                Observação
                <span className="text-title  lowercase font-normal ml-1">(opcional)</span>
              </label>
              <textarea value={formData.observation} onChange={e => setFormData({...formData, observation: e.target.value})} className="w-full px-4 py-3 rounded-2xl bg-primary/40  border-none text-sm min-h-[80px] " />
            </div>
          </div>
          
          <footer className="px-6 pt-4 pb-2 shrink-0 bg-surface  sticky bottom-0 z-10">
            {showErrorMsg && <p className="text-red-500 text-[13px] font-bold text-center mb-4">Preencha todos os campos obrigatórios</p>}
            <Button 
              type="submit" 
              fullWidth 
              disabled={isExceptional && isWithinRegularHours}
              className={`w-full h-14 bg-secondary rounded-2xl text-white font-black shadow-lg shadow-secondary/30 active:scale-[0.98] transition-transform uppercase tracking-widest text-sm px-4 disabled:opacity-50 duration-300 ${isButtonFlashing ? '!bg-amber-500 !shadow-amber-500/40' : ''}`}
            >
              Agendar Atendimento
            </Button>
          </footer>
        </form>
      </motion.div>
    </div>
  );
};

const RescheduleModal: React.FC<{ 
  appointment: Appointment; 
  onClose: () => void;
  onSuccess?: (msg: string) => void;
}> = ({ appointment, onClose, onSuccess }) => {
  useLockBodyScroll();
  const { updateAppointment, appointments, weeklySchedule, services } = useStore();
  const [newDate, setNewDate] = useState(appointment.date);
  const [newTime, setNewTime] = useState(appointment.time);
  const [observation, setObservation] = useState(appointment.observation || '');
  const [errors, setErrors] = useState<{time?: boolean, services?: boolean}>({});
  const [showErrorMsg, setShowErrorMsg] = useState(false);
  
  const initialServiceIds = useMemo(() => {
    const aptServices = appointment.service.split(', ').map(s => s.trim());
    return services.filter(s => aptServices.includes(s.name)).map(s => s.id);
  }, [appointment.service, services]);

  const [serviceIds, setServiceIds] = useState<string[]>(initialServiceIds);

  const dayOfWeek = new Date(newDate + 'T12:00:00').getDay();
  const dayConfig = weeklySchedule[dayOfWeek];
  const generatedSlots = useMemo(() => dayConfig?.isOpen ? generateTimeSlots(dayConfig.start, dayConfig.end) : [], [dayConfig]);

  const isSlotPast = (slot: string) => {
    const today = getTodayString();
    if (newDate < today) return true;
    if (newDate > today) return false;
    const [h, m] = slot.split(':').map(Number);
    const now = new Date();
    const slotDate = new Date();
    slotDate.setHours(h, m, 0, 0);
    return slotDate < now;
  };

  const toggleService = (id: string) => {
    setServiceIds(prev => prev.includes(id) ? prev.filter(sid => sid !== id) : [...prev, id]);
    setErrors(prev => ({...prev, services: false}));
    setShowErrorMsg(false);
  };

  const selectedServices = services.filter(s => serviceIds.includes(s.id));
  const totalPrice = selectedServices.reduce((sum, s) => sum + s.price, 0);
  const totalDuration = selectedServices.reduce((sum, s) => sum + (s.duration || 15), 0);

  const bookedSlots = useMemo(() => {
    const booked: string[] = [];
    appointments.filter(a => a.date === newDate && a.id !== appointment.id).forEach(a => {
      const slots = getOccupiedSlots(a.time, a.duration || 15);
      booked.push(...slots);
    });
    return booked;
  }, [appointments, newDate, appointment.id]);

  const isSlotAvailable = (slot: string) => {
    if (bookedSlots.includes(slot)) return false;
    const requiredSlots = getOccupiedSlots(slot, totalDuration);
    return requiredSlots.every(s => generatedSlots.includes(s) && !bookedSlots.includes(s));
  };

  const handleConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors = {
      time: !newTime,
      services: serviceIds.length === 0
    };
    setErrors(newErrors);
    if (newErrors.time || newErrors.services) {
      setShowErrorMsg(true);
      return;
    }
    updateAppointment(appointment.id, { 
      date: newDate, 
      time: newTime,
      service: selectedServices.map(s => s.name).join(', '),
      price: totalPrice,
      duration: totalDuration,
      observation: observation
    });
    onSuccess?.('Agendamento atualizado com sucesso!');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-surface/40 backdrop-blur-md animate-in fade-in">
      <div className="bg-surface  w-full max-w-[95%] sm:max-w-sm rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] relative border border-title/30 ">
        <header className="p-6 border-b border-title/30  flex justify-between items-center shrink-0 bg-surface  sticky top-0 z-10">
            <h2 className="text-lg font-bold text-white  uppercase tracking-tight">Editar Agendamento</h2>
            <button onClick={onClose} className="w-10 h-10 rounded-full bg-primary/40  text-title flex items-center justify-center hover:bg-primary/40 :bg-surface transition-colors">
              <X size={20} />
            </button>
        </header>
        
        <form onSubmit={handleConfirm} className="flex flex-col flex-1 overflow-hidden">
          <div className="p-6 space-y-6 overflow-y-auto flex-1 min-h-0">
            <div className="space-y-2">
              <label className={`text-[10px] font-bold uppercase tracking-widest ml-1 flex items-center gap-1 ${errors.services ? 'text-red-500' : 'text-title '}`}>
                Serviços
                <span className="text-red-500">*</span>
              </label>
              <div className={`flex flex-wrap gap-2 p-1 rounded-2xl transition-all ${errors.services ? 'ring-2 ring-red-500 bg-red-50/50' : ''}`}>
                {services.map(s => (
                  <button key={s.id} type="button" onClick={() => toggleService(s.id)} className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase border transition-all ${serviceIds.includes(s.id) ? 'bg-secondary text-white border-secondary' : 'bg-surface  text-title border-title/30 '}`}>{s.name}</button>
                ))}
              </div>
              {errors.services && (
                <div className="flex items-center gap-1 text-red-500 text-[10px] font-bold ml-1">
                  <AlertTriangle size={12} />
                  <span>Selecione pelo menos um serviço</span>
                </div>
              )}
            </div>
            <Input 
              label="Nova Data" 
              type="date" 
              value={newDate} 
              min={getTodayString()} 
              onChange={e => { setNewDate(e.target.value); setNewTime(''); setShowErrorMsg(false); }} 
              requiredField
            />
            <div className="space-y-2">
              <label className={`text-[10px] font-bold uppercase tracking-widest ml-1 flex items-center gap-1 ${errors.time ? 'text-red-500' : 'text-title '}`}>
                Novo Horário
                <span className="text-red-500">*</span>
              </label>
              <div className={`grid grid-cols-4 gap-2 p-1 rounded-2xl transition-all ${errors.time ? 'ring-2 ring-red-500 bg-red-50/50' : ''}`}>
                  {generatedSlots.map(slot => {
                    const available = isSlotAvailable(slot);
                    if (isSlotPast(slot)) return null;
                    return (
                      <button key={slot} type="button" disabled={!available} onClick={() => { setNewTime(slot); setErrors(prev => ({...prev, time: false})); setShowErrorMsg(false); }} className={`py-2 rounded-xl text-xs font-bold transition-all border ${newTime === slot ? 'bg-secondary text-white border-secondary' : !available ? 'bg-primary/40  text-title  border-title/30 ' : 'bg-surface  text-white  border-title/30 '}`}>{slot}</button>
                    );
                  })}
              </div>
              {errors.time && (
                <div className="flex items-center gap-1 text-red-500 text-[10px] font-bold ml-1">
                  <AlertTriangle size={12} />
                  <span>Selecione um horário disponível</span>
                </div>
              )}
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-title  uppercase tracking-widest ml-1 flex items-center gap-1">
                Observação
                <span className="text-title  lowercase font-normal ml-1">(opcional)</span>
              </label>
              <textarea value={observation} onChange={e => setObservation(e.target.value)} className="w-full px-4 py-3 rounded-2xl bg-primary/40  border-none text-sm min-h-[80px] " />
            </div>
          </div>
          
          <footer className="p-6 border-t border-title/30  shrink-0 bg-surface  sticky bottom-0 z-10 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
            {showErrorMsg && <p className="text-red-500 text-[13px] font-bold text-center mb-4">Preencha todos os campos obrigatórios</p>}
            <Button type="submit" fullWidth className="h-14 font-black uppercase tracking-widest shadow-xl shadow-secondary/20">
              Salvar Alterações
            </Button>
          </footer>
        </form>
      </div>
    </div>
  );
};

const MyBookingLink: React.FC<{ slug: string; shopName?: string }> = ({ slug, shopName }) => {
  const [copied, setCopied] = React.useState(false);
  const link = `${window.location.origin}${window.location.pathname}#/agendar/${slug}`;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShare = async () => {
    if (navigator.share) {
      await navigator.share({
        title: 'Agende comigo!',
        text: `Agende seu horário com ${shopName || 'meu salão'}`,
        url: link,
      });
    } else {
      handleCopy();
    }
  };

  return (
    <div className="bg-surface rounded-2xl border border-white/8 p-4 mb-4">
      <div className="flex items-center gap-2 mb-3">
        <Link2 className="w-4 h-4 text-secondary" />
        <span className="text-sm font-bold text-white">Meu Link de Agendamento</span>
      </div>
      <div className="bg-background rounded-xl px-3 py-2.5 mb-3 border border-white/10">
        <p className="text-xs text-white/50 truncate">{link}</p>
      </div>
      <div className="flex gap-2">
        <button onClick={handleCopy}
          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-semibold border border-white/10 text-white hover:bg-white/5 transition-all active:scale-95">
          {copied ? <><Check className="w-3.5 h-3.5 text-secondary" /> Copiado!</> : <><Copy className="w-3.5 h-3.5" /> Copiar</>}
        </button>
        <button onClick={handleShare}
          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-semibold bg-secondary/15 border border-secondary/30 text-secondary hover:bg-secondary/20 transition-all active:scale-95">
          <Share2 className="w-3.5 h-3.5" /> Compartilhar
        </button>
        <button onClick={() => window.open(link, '_blank')}
          className="w-10 flex items-center justify-center py-2.5 rounded-xl text-xs font-semibold border border-white/10 text-white/50 hover:bg-white/5 transition-all active:scale-95">
          <ExternalLink className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};

const ProfileModal: React.FC<{ 
    onClose: () => void;
    onSuccess?: (msg: string) => void;
}> = ({ onClose, onSuccess }) => {
    useLockBodyScroll();
    const { barberProfile, updateBarberProfile } = useStore();
    const [formData, setFormData] = useState<BarberProfile>(barberProfile);
    const [modalTab, setModalTab] = useState<'personal' | 'business'>('personal');
    const logoInputRef = useRef<HTMLInputElement>(null);
    const photoInputRef = useRef<HTMLInputElement>(null);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        updateBarberProfile(formData);
        onSuccess?.('Perfil atualizado com sucesso!');
        onClose();
    };

    const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files?.[0]) {
            const base64 = await compressImage(e.target.files[0]);
            setFormData(prev => ({ ...prev, logo: base64 }));
        }
    };

    const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files?.[0]) {
            const base64 = await compressImage(e.target.files[0]);
            setFormData(prev => ({ ...prev, photo: base64 }));
        }
    };

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-surface/40 backdrop-blur-md animate-in fade-in">
            <div className="bg-surface  w-full max-w-[95%] sm:max-w-sm rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] relative border border-title/30 ">
                <header className="p-6 border-b border-title/30  flex justify-between items-center shrink-0 bg-surface  sticky top-0 z-10">
                    <div>
                        <h2 className="text-lg font-bold text-white  uppercase tracking-tight">Meu Perfil</h2>
                        <p className="text-[10px] text-title font-medium uppercase tracking-widest">Personalize seu Aplicativo</p>
                    </div>
                    <button onClick={onClose} className="w-10 h-10 rounded-full bg-primary/40  flex items-center justify-center text-title hover:bg-primary/40 :bg-surface transition-colors">
                      <X size={20} />
                    </button>
                </header>
                
                <div className="flex border-b border-title/30  shrink-0 bg-surface  sticky top-[88px] z-10">
                   <button onClick={() => setModalTab('personal')} className={`flex-1 py-3 text-[10px] font-black uppercase tracking-widest transition-colors ${modalTab === 'personal' ? 'text-secondary border-b-2 border-secondary' : 'text-title'}`}>Pessoal</button>
                   <button onClick={() => setModalTab('business')} className={`flex-1 py-3 text-[10px] font-black uppercase tracking-widest transition-colors ${modalTab === 'business' ? 'text-secondary border-b-2 border-secondary' : 'text-title'}`}>Negócio</button>
                </div>
                
                <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
                  <div className="p-6 overflow-y-auto space-y-6 flex-1 min-h-0">
                      {modalTab === 'personal' ? (
                        <div className="space-y-4">
                          <div className="flex flex-col items-center gap-3">
                              <div onClick={() => photoInputRef.current?.click()} className="w-20 h-20 rounded-full bg-primary/40  border-2 border-dashed border-title/30  flex items-center justify-center overflow-hidden cursor-pointer">
                                  {formData.photo ? <img src={formData.photo} className="w-full h-full object-cover" alt="Foto" /> : <User size={32} className="text-title" />}
                              </div>
                              <input type="file" ref={photoInputRef} className="hidden" accept="image/*" onChange={handlePhotoUpload} />
                              <p className="text-[10px] font-bold text-title uppercase tracking-widest">Sua Foto de Perfil</p>
                          </div>
                          <Input label="Seu Nome" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
                          <Input label="Telefone Pessoal" value={formData.personalPhone} onChange={e => setFormData({...formData, personalPhone: formatPhone(e.target.value)})} maxLength={15} />
                        </div>
                      ) : (
                        <div className="space-y-4">
                          <div className="flex flex-col items-center gap-3">
                              <div onClick={() => logoInputRef.current?.click()} className="w-20 h-20 rounded-2xl bg-primary/40  border-2 border-dashed border-title/30  flex items-center justify-center overflow-hidden cursor-pointer">
                                  {formData.logo ? <img src={formData.logo} className="w-full h-full object-cover" alt="Logo" /> : <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-title" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>}
                              </div>
                              <input type="file" ref={logoInputRef} className="hidden" accept="image/*" onChange={handleLogoUpload} />
                          </div>
                          
                          {/* Meu Link de Agendamento */}
                          {barberProfile.slug && (
                            <MyBookingLink slug={barberProfile.slug} shopName={barberProfile.shopName} />
                          )}

                          <Input label="Nome da Barbearia" value={formData.shopName} onChange={e => setFormData({...formData, shopName: e.target.value})} />
                          <Input label="Endereço" value={formData.address || ''} onChange={e => setFormData({...formData, address: e.target.value})} />
                          <Input label="Instagram (@)" value={formData.instagram || ''} onChange={e => setFormData({...formData, instagram: e.target.value})} />
                        </div>
                      )}
                  </div>
                  
                  <footer className="p-6 border-t border-title/30  shrink-0 bg-surface  sticky bottom-0 z-10 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
                    <Button type="submit" fullWidth className="h-14 font-black uppercase tracking-widest shadow-xl shadow-secondary/20">
                      Salvar Perfil
                    </Button>
                  </footer>
                </form>
            </div>
        </div>
    );
};

const ServicesView: React.FC<{ onSuccess?: (msg: string) => void }> = ({ onSuccess }) => {
  const { services, addService, removeService, updateService, reorderServices, permissions } = useStore();
  const [formData, setFormData] = useState({ name: '', price: '', duration: '30' });
  const [errors, setErrors] = useState({ name: '', price: '' });
  const [editingService, setEditingService] = useState<ServiceItem | null>(null);
  
  // States for the bottom sheet form
  const [editFormData, setEditFormData] = useState({ name: '', price: '', duration: '30' });
  const [editErrors, setEditErrors] = useState({ name: '', price: '' });

  const durationOptions = useMemo(() => {
    const options = [];
    for (let i = 15; i <= 480; i += 15) {
      const hours = Math.floor(i / 60);
      const mins = i % 60;
      let label = `${i} min`;
      if (hours > 0) {
        label = `${hours}h${mins > 0 ? ` ${mins}min` : ''}`;
      }
      options.push({ value: i.toString(), label });
    }
    return options;
  }, []);

  const formatCurrencyInput = (value: string) => {
    const digits = value.replace(/\D/g, '');
    if (!digits) return '';
    const number = parseInt(digits) / 100;
    return number.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  };

  const handlePriceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatCurrencyInput(e.target.value);
    setFormData({ ...formData, price: formatted });
    if (errors.price) setErrors(prev => ({ ...prev, price: '' }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    const newErrors = { name: '', price: '' };
    let hasError = false;

    if (!formData.name.trim()) {
      newErrors.name = 'Informe o nome do serviço';
      hasError = true;
    }

    const numericPrice = parseInt(formData.price.replace(/\D/g, '')) / 100;
    if (!formData.price || numericPrice <= 0) {
      newErrors.price = 'Informe um preço válido';
      hasError = true;
    }

    if (hasError) {
      setErrors(newErrors);
      return;
    }
    
    const duration = parseInt(formData.duration);
    
    if (duration % 15 !== 0) {
      alert("A duração deve ser múltipla de 15 minutos.");
      return;
    }
    
    const serviceData = { 
      id: crypto.randomUUID(), 
      name: formData.name, 
      price: numericPrice,
      duration: duration
    };
    
    addService(serviceData);
    onSuccess?.('Serviço adicionado com sucesso!');

    setFormData({ name: '', price: '', duration: '30' });
    setErrors({ name: '', price: '' });
  };

  const startEditing = (s: ServiceItem) => {
    setEditFormData({ 
      name: s.name, 
      price: s.price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }), 
      duration: s.duration.toString() 
    });
    setEditErrors({ name: '', price: '' });
    setEditingService(s);
  };

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingService) return;
    
    const newErrors = { name: '', price: '' };
    let hasError = false;

    if (!editFormData.name.trim()) {
      newErrors.name = 'Informe o nome do serviço';
      hasError = true;
    }

    const numericPrice = parseInt(editFormData.price.replace(/\D/g, '')) / 100;
    if (!editFormData.price || numericPrice <= 0) {
      newErrors.price = 'Informe um preço válido';
      hasError = true;
    }

    if (hasError) {
      setEditErrors(newErrors);
      return;
    }
    
    const duration = parseInt(editFormData.duration);
    
    if (duration % 15 !== 0) {
      alert("A duração deve ser múltipla de 15 minutos.");
      return;
    }
    
    const serviceData = { 
      id: editingService.id, 
      name: editFormData.name, 
      price: numericPrice,
      duration: duration
    };
    
    updateService(serviceData);
    onSuccess?.('Serviço atualizado com sucesso!');
    setEditingService(null);
  };

  return (
    <div className="min-h-full bg-transparent px-4 pt-5 pb-28 space-y-6">
      {permissions?.canManageServices && (
        <div className="bg-surface p-4 rounded-3xl space-y-3">
          <h2 className="font-semibold text-sm text-white  uppercase tracking-widest">Novo Serviço</h2>
          <form onSubmit={handleSubmit} className="space-y-3">
            <Input 
              inputClassName="bg-primary/60 border-white/10 text-white placeholder:text-muted"
              label="Nome do Serviço" 
              placeholder="Ex: Corte de Cabelo"
              value={formData.name} 
              onChange={e => {
                setFormData({...formData, name: e.target.value});
                if (errors.name) setErrors(prev => ({ ...prev, name: '' }));
              }} 
              errorMessage={errors.name}
            />
            <div className="flex gap-3">
              <div className="flex-1">
                <Input 
                  inputClassName="bg-primary/60 border-white/10 text-white placeholder:text-muted"
                  label="Preço" 
                  placeholder="R$ 0,00"
                  value={formData.price} 
                  onChange={handlePriceChange} 
                  errorMessage={errors.price}
                />
              </div>
              <div className="flex-1 flex flex-col gap-1">
                <label className="text-[10px] font-bold text-title  ml-1 uppercase tracking-widest">Duração</label>
                <select 
                  value={formData.duration} 
                  onChange={e => setFormData({...formData, duration: e.target.value})}
                  className="w-full px-4 py-2.5 rounded-xl border border-title/30  bg-surface  text-white  text-sm focus:outline-none focus:ring-2 focus:ring-secondary/20 transition-colors h-[42px]"
                >
                  {durationOptions.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <Button type="submit" fullWidth className="h-11">Adicionar Serviço</Button>
          </form>
        </div>
      )}

      <div className="pt-2">
        <div className="flex items-center gap-4 mb-4">
          <div className="h-px flex-1 bg-title/30 "></div>
          <h3 className="text-[10px] font-black text-title border-white/10 uppercase tracking-[0.2em]">Serviços Cadastrados</h3>
          <div className="h-px flex-1 bg-title/30 "></div>
        </div>

        {permissions?.canManageServices ? (
          <Reorder.Group axis="y" values={services} onReorder={reorderServices} className="flex flex-col">
            {services.map((s) => (
              <Reorder.Item 
                key={s.id}
                value={s}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-surface p-3 flex items-center gap-3 group border-b border-white/5 last:border-0"
              >
                <div className="cursor-grab active:cursor-grabbing text-title  hover:text-title transition-colors shrink-0">
                  <GripVertical size={20} />
                </div>
                
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-white  text-base truncate">{s.name}</p>
                  <p className="text-secondary  font-medium text-xs">
                    {formatCurrency(s.price)} | {s.duration} min
                  </p>
                </div>
                
                <div className="flex gap-1">
                  <button 
                    onClick={() => startEditing(s)} 
                    className="p-2 text-title hover:text-secondary transition-colors"
                  >
                    <Edit3 size={18} />
                  </button>
                  <button 
                    onClick={() => removeService(s.id)} 
                    className="p-2 text-red-300 hover:text-red-500 transition-colors"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </Reorder.Item>
            ))}
          </Reorder.Group>
        ) : (
          <div className="flex flex-col">
            {services.map((s) => (
              <div 
                key={s.id}
                className="bg-surface p-4 flex items-center justify-between border-b border-white/5 last:border-0 rounded-2xl mb-2"
              >
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-white text-base truncate">{s.name}</p>
                  <p className="text-secondary font-medium text-xs mt-0.5">
                    {formatCurrency(s.price)} | {s.duration} min
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <AnimatePresence>
        {editingService && (
          <div className="fixed inset-0 z-[300] flex items-end sm:items-center justify-center sm:p-4">
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }} 
              onClick={() => setEditingService(null)}
              className="absolute inset-0 bg-surface/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ y: '100%', opacity: 1 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: '100%', opacity: 0 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              drag="y"
              dragConstraints={{ top: 0 }}
              dragElastic={0.2}
              onDragEnd={(e, info) => {
                if (info.offset.y > 100) setEditingService(null);
              }}
              className="w-full max-w-lg bg-surface  rounded-t-3xl sm:rounded-3xl shadow-2xl relative flex flex-col max-h-[90vh]"
            >
              <div className="w-12 h-1.5 bg-title/30  rounded-full mx-auto my-3 shrink-0" />
              <div className="px-6 flex justify-between items-center pb-2 shrink-0">
                <h2 className="text-lg font-bold text-white ">Editar Serviço</h2>
                <button 
                  onClick={() => setEditingService(null)}
                  className="w-8 h-8 flex items-center justify-center rounded-full bg-primary/40  text-title hover:bg-primary/40 :bg-surface transition-colors"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="p-6 overflow-y-auto">
                <form id="edit-service-form" onSubmit={handleEditSubmit} className="space-y-4">
                  <Input 
            inputClassName="bg-primary/60 border-white/10 text-white placeholder:text-muted"
            label="Nome do Serviço" 
                    placeholder="Ex: Corte de Cabelo"
                    value={editFormData.name} 
                    onChange={e => {
                      setEditFormData({...editFormData, name: e.target.value});
                      if (editErrors.name) setEditErrors(prev => ({ ...prev, name: '' }));
                    }} 
                    errorMessage={editErrors.name}
                  />
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <Input 
                inputClassName="bg-primary/60 border-white/10 text-white placeholder:text-muted"
                label="Preço" 
                        placeholder="R$ 0,00"
                        value={editFormData.price} 
                        onChange={(e) => {
                          const formatted = formatCurrencyInput(e.target.value);
                          setEditFormData({ ...editFormData, price: formatted });
                          if (editErrors.price) setEditErrors(prev => ({ ...prev, price: '' }));
                        }} 
                        errorMessage={editErrors.price}
                      />
                    </div>
                    <div className="flex-1 flex flex-col gap-1">
                      <label className="text-[10px] font-bold text-title  ml-1 uppercase tracking-widest">Duração</label>
                      <select 
                        value={editFormData.duration} 
                        onChange={e => setEditFormData({...editFormData, duration: e.target.value})}
                        className="w-full px-4 py-2.5 rounded-xl border border-title/30  bg-surface  text-white  text-sm focus:outline-none focus:ring-2 focus:ring-secondary/20 transition-colors h-[42px]"
                      >
                        {durationOptions.map(opt => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </form>
              </div>
              <div className="p-6 border-t border-title/30  shrink-0">
                <Button fullWidth form="edit-service-form" type="submit" className="h-12 shadow-md">
                  Salvar Alterações
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

const WeeklyConfigModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  useLockBodyScroll();
  const { weeklySchedule, updateDayConfig, toggleWeeklyBreak } = useStore();
  const [selectedDay, setSelectedDay] = useState(new Date().getDay());
  const currentConfig = weeklySchedule[selectedDay] || DEFAULT_DAY_CONFIG;
  const previewSlots = generateTimeSlots(currentConfig.start, currentConfig.end);

  // Calculate summary
  const blockedCount = currentConfig.breaks.length;
  const availableCount = previewSlots.length - blockedCount;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      {/* Overlay */}
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[190]"
      />
      
      {/* Modal Container */}
      <motion.div 
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="bg-surface  w-[90%] max-w-md rounded-[32px] shadow-2xl flex flex-col max-h-[85vh] relative z-[200] overflow-hidden"
      >
        <header className="px-6 pt-6 pb-4 flex justify-between items-center shrink-0 bg-surface  sticky top-0 z-10">
          <h2 className="text-lg font-bold text-white  uppercase tracking-tight">Padrão Semanal</h2>
          <button onClick={onClose} className="w-10 h-10 rounded-full bg-primary/40  text-title flex items-center justify-center hover:bg-primary/40 :bg-surface transition-colors">
            <X size={20} />
          </button>
        </header>
        
        <div className="flex-1 overflow-y-auto px-6 pt-6 pb-2 space-y-6">
            <div className="space-y-3">
              <label className="text-[10px] font-medium text-title  uppercase tracking-widest ml-1">Selecione o Dia</label>
              <div className="grid grid-cols-7 gap-1 shrink-0">
                {WEEKDAYS.map((name, idx) => {
                  const dayConfig = weeklySchedule[idx];
                  const isSelected = selectedDay === idx;
                  return (
                    <button 
                      key={idx} 
                      onClick={() => setSelectedDay(idx)} 
                      className={`flex flex-col items-center py-2.5 rounded-xl transition-all 
                        ${isSelected ? 'bg-secondary text-white shadow-md' : 'bg-primary/40  text-title '}`}
                    >
                      <span className="text-[9px] font-bold uppercase tracking-tighter">{name.substring(0, 3)}</span>
                      {dayConfig && (
                        <div className={`w-1 h-1 rounded-full mt-1 ${dayConfig.isOpen ? 'bg-green-500' : 'bg-red-500'}`}></div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
            
            {/* Day Status Line */}
            <div className="py-4 border-y border-title/30  flex items-center justify-between">
              <span className="text-[13px] font-bold text-white ">Aberto para agendamentos</span>
              <button 
                onClick={() => {
                  const newValue = !currentConfig?.isOpen;
                  console.group(`[DEBUG-AGENDA] AdminApp - Alterando dia ${selectedDay}`);
                  console.log(`[DEBUG-AGENDA] is_open alterado para:`, newValue);
                  console.log(`[DEBUG-AGENDA] Tipo de is_open:`, typeof newValue);
                  console.groupEnd();
                  updateDayConfig(selectedDay, { isOpen: newValue });
                }} 
                className={`w-12 h-7 rounded-full transition-colors relative ${currentConfig?.isOpen ? 'bg-green-500' : 'bg-title/30 '}`}
              >
                <div className={`w-5 h-5 bg-surface rounded-full absolute top-1 transition-all shadow-sm ${currentConfig?.isOpen ? 'left-6' : 'left-1'}`}></div>
              </button>
            </div>
            
            {currentConfig?.isOpen && (
              <div className="space-y-6 animate-in fade-in slide-in-from-top-2 duration-300">
                <div className="grid grid-cols-2 gap-4">
                  <Input label="Abertura" type="time" value={currentConfig.start} onChange={(e) => updateDayConfig(selectedDay, { start: e.target.value })} />
                  <Input label="Fechamento" type="time" value={currentConfig.end} onChange={(e) => updateDayConfig(selectedDay, { end: e.target.value })} />
                </div>

                {/* Summary Line */}
                <div className="text-center">
                  <p className="text-[12px] text-title font-medium">
                    {availableCount} disponíveis · {blockedCount} bloqueados
                  </p>
                </div>
                
                <div className="space-y-3">
                  <div className="flex flex-col gap-1 ml-1">
                    <label className="text-[10px] font-medium text-title  uppercase tracking-widest">Horários Disponíveis</label>
                    <span className="text-[11px] text-title font-medium">Toque para bloquear/desbloquear</span>
                  </div>
                  <div className="grid grid-cols-5 gap-1.5">
                      {previewSlots.map(slot => (
                        <button 
                          key={slot} 
                          onClick={() => toggleWeeklyBreak(selectedDay, slot)} 
                          className={`h-[44px] flex items-center justify-center rounded-xl text-[10px] font-bold transition-all 
                            ${!currentConfig.breaks.includes(slot) 
                              ? 'bg-surface  text-white ' 
                              : 'bg-red-50  text-red-400 opacity-60'}`}
                        >
                          {slot}
                        </button>
                      ))}
                  </div>
                </div>
              </div>
            )}
            {/* Spacer for gradient */}
            <div className="h-4" />
          {/* Bottom Fade Gradient */}
          <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-primary  to-transparent pointer-events-none z-20"></div>
        </div>
        
        <footer className="px-6 pt-4 pb-6 shrink-0 bg-surface  sticky bottom-0 z-10 border-t border-title/30 ">
          <Button fullWidth onClick={onClose} className="h-14 font-black uppercase tracking-widest shadow-xl shadow-secondary/20">
            Salvar e Fechar
          </Button>
        </footer>
      </motion.div>
    </div>
  );
};

const CustomersView: React.FC<{ 
  initialPhone: string | null; 
  clearInitial: () => void;
  onNewAppointment: (customer: Customer) => void;
  onAddCustomer: () => void;
  onSuccess?: (msg: string) => void;
}> = ({ initialPhone, clearInitial, onNewAppointment, onAddCustomer, onSuccess }) => {
  const { customers } = useStore();
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const liveCustomer = selectedPhone ? customers[normalizePhone(selectedPhone)] : null;

  React.useEffect(() => {
    const normalized = initialPhone ? normalizePhone(initialPhone) : null;
    if (normalized && customers[normalized]) {
      setSelectedPhone(normalized);
      clearInitial();
    }
  }, [initialPhone, customers, clearInitial]);

  if (liveCustomer) return (
    <CustomerDetail 
      customer={liveCustomer} 
      onBack={() => setSelectedPhone(null)} 
      onPhoneChange={(newPhone) => setSelectedPhone(normalizePhone(newPhone))}
      onNewAppointment={onNewAppointment}
      onSuccess={onSuccess}
    />
  );
  const customerList = (Object.values(customers) as Customer[]).filter(c => {
    if (!searchTerm) return true;
    
    const searchLower = searchTerm.trim().toLowerCase();
    const searchDigits = searchTerm.replace(/\D/g, '');
    const customerDigits = c.phone.replace(/\D/g, '');
    
    const nameMatch = c.name.toLowerCase().includes(searchLower);
    
    // Only match phone if search term has numbers
    const hasNumbers = /\d/.test(searchTerm);
    const phoneMatch = hasNumbers && (
      customerDigits.includes(searchDigits) || 
      c.phone.includes(searchTerm)
    );
    
    return nameMatch || phoneMatch;
  });

  return (
    <div className="px-4 pt-5 pb-24 space-y-4 relative">
      <div className="space-y-2">
        <Input label="Buscar Cliente" placeholder="Nome ou telefone..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} inputClassName="bg-surface border-white/10 text-white placeholder:text-muted shadow-[0_2px_8px_rgba(0,0,0,0.3)]" />
        <p className="text-[10px] text-title uppercase tracking-widest font-bold px-1 mb-1">
          {searchTerm 
            ? `${customerList.length} ${customerList.length === 1 ? 'resultado' : 'resultados'} para "${searchTerm}"`
            : `${customerList.length} ${customerList.length === 1 ? 'cliente cadastrado' : 'clientes cadastrados'}`
          }
        </p>
      </div>

      {customerList.length === 0 ? (
        <div className="bg-surface  p-12 rounded-[2rem] border-2 border-dashed border-title/30  text-center space-y-3">
          <div className="w-12 h-12 bg-primary/40  rounded-full flex items-center justify-center mx-auto text-title ">
            <UserX size={24} />
          </div>
          <p className="text-title font-bold text-sm uppercase tracking-widest">Nenhum cliente encontrado</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {customerList.map(cust => {
            return (
              <div 
                key={cust.phone} 
                onClick={() => setSelectedPhone(normalizePhone(cust.phone))} 
                className="bg-surface rounded-2xl px-4 py-3 flex items-center gap-3 h-16 cursor-pointer"
              >
                <div className={`w-9 h-9 rounded-full ${getAvatarColor(cust.name)} flex items-center justify-center text-white font-bold text-[13px] shrink-0 shadow-sm overflow-hidden mr-3`}>
                  {cust.avatar ? (
                    <img src={cust.avatar} className="w-full h-full object-cover" alt={cust.name} referrerPolicy="no-referrer" />
                  ) : (
                    getInitials(cust.name)
                  )}
                </div>
                
                <div className="flex-1 min-w-0 flex flex-col justify-center">
                  <h3 className="font-semibold text-white  text-sm truncate leading-tight">
                    {capitalizeName(cust.name)}
                  </h3>
                  <p className="text-xs text-title  leading-tight">
                    {cust.phone}
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0 ml-2">
                  {cust.cutCount === 0 && (
                    <div className="bg-green-50  px-1.5 py-0.5 rounded-md border border-green-100 ">
                      <span className="text-[9px] text-green-600  font-black uppercase tracking-widest">NOVO</span>
                    </div>
                  )}
                  
                  <a 
                    href={`https://wa.me/55${cust.phone.replace(/\D/g, '')}`} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="w-8 h-8 rounded-full bg-[#25D366] flex items-center justify-center text-white hover:scale-110 transition-transform"
                  >
                    <FaWhatsapp size={18} />
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* FAB */}
      <button 
        onClick={onAddCustomer}
        className="fixed bottom-24 right-6 w-14 h-14 bg-secondary text-white rounded-full shadow-2xl flex items-center justify-center hover:bg-secondary active:scale-90 transition-all z-50 pointer-events-auto opacity-[0.85]"
      >
        <Plus size={28} strokeWidth={3} />
      </button>
    </div>
  );
};

const CustomerDetail: React.FC<{ 
  customer: Customer; 
  onBack: () => void;
  onPhoneChange?: (newPhone: string) => void;
  onNewAppointment: (customer: Customer) => void;
  onSuccess?: (msg: string) => void;
}> = ({ customer, onBack, onPhoneChange, onNewAppointment, onSuccess }) => {
  const { updateCustomerPhoto, updateCustomerAvatar, updateCustomer } = useStore();
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(customer.name);
  const [editPhone, setEditPhone] = useState(customer.phone);

  useEffect(() => {
    if (!isEditing) {
      setEditName(customer.name);
      setEditPhone(customer.phone);
    }
  }, [customer.name, customer.phone, isEditing]);
  
  const [showActionSheet, setShowActionSheet] = useState(false);
  const [showDescription, setShowDescription] = useState(false);
  const [tempPhoto, setTempPhoto] = useState<string | null>(null);
  const [photoType, setPhotoType] = useState<'avatar' | 'history'>('history');

  // Local state for history and photos to avoid "disappearing" issue
  const [localHistory, setLocalHistory] = useState(customer.history || []);
  const [localPhotos, setLocalPhotos] = useState(customer.photos || []);
  const [isLoadingData, setIsLoadingData] = useState(false);

  // Estados para abrir as Bottom Sheets de Fotos e Histórico Completos
  const [isGalleryOpen, setIsGalleryOpen] = useState(false);
  const [isHistoryFullOpen, setIsHistoryFullOpen] = useState(false);

  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  const buscarDadosDoCliente = useCallback(async () => {
    if (!isSupabaseConfigured()) return;
    
    setIsLoadingData(true);
    try {
      const result = await supabase.auth.getSession();
      const session = result?.data?.session;
      if (!session) return;

      // Fetch history (completed and no-show appointments)
      const { data: appointmentsData, error: aptError } = await supabase
        .from('appointments')
        .select('*')
        .eq('user_id', session.user.id)
        .eq('phone', customer.phone)
        .in('status', ['completed', 'no-show'])
        .order('date', { ascending: false });

      if (aptError) throw aptError;

      // Recalculate counts to ensure they match history
      const actualCutCount = (appointmentsData || []).filter(a => a.status === 'completed').length;
      const actualNoShowCount = (appointmentsData || []).filter(a => a.status === 'no-show').length;

      if (actualCutCount !== customer.cutCount || actualNoShowCount !== (customer.noShowCount || 0)) {
        console.log(`Sincronizando contadores para ${customer.name}: Cortes ${customer.cutCount} -> ${actualCutCount}, Faltas ${customer.noShowCount || 0} -> ${actualNoShowCount}`);
        updateCustomer(customer.phone, { cutCount: actualCutCount, noShowCount: actualNoShowCount });
      }

      // Fetch photos
      const { data: photosData, error: photoError } = await supabase
        .from('customer_photos')
        .select('*')
        .eq('user_id', session.user.id)
        .eq('customer_phone', customer.phone)
        .order('date', { ascending: false });

      if (photoError) throw photoError;

      // Normalize and set history
      const normalizedHistory = (appointmentsData || []).map(apt => ({
        date: apt.date.substring(0, 10),
        time: apt.time.substring(0, 5),
        service: apt.status === 'no-show' ? 'Falta registrada' : apt.service,
        price: apt.status === 'no-show' ? 0 : Number(apt.price),
        status: apt.status
      }));
      setLocalHistory(normalizedHistory);

      // Normalize and set photos
      const normalizedPhotos = (photosData || []).map(p => ({
        url: p.url,
        description: p.description || '',
        date: p.date.substring(0, 10)
      }));
      setLocalPhotos(normalizedPhotos);
    } catch (error) {
      console.error("Erro ao buscar dados do cliente:", error);
    } finally {
      setIsLoadingData(false);
    }
  }, [customer.phone]);

  useEffect(() => {
    buscarDadosDoCliente();
  }, [customer.phone, buscarDadosDoCliente]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const compressedBase64 = await compressImage(e.target.files[0]);
      setTempPhoto(compressedBase64);
      setShowDescription(true);
    }
  };

  const handleConfirmPhoto = (description: string) => {
    if (tempPhoto) {
      if (photoType === 'avatar') {
        updateCustomerAvatar(customer.phone, tempPhoto);
        onSuccess?.('Avatar atualizado!');
      } else {
        // Update local state immediately for real-time feel
        const newPhoto = {
          url: tempPhoto,
          description: description || '',
          date: new Date().toISOString().substring(0, 10)
        };
        setLocalPhotos(prev => [newPhoto, ...prev]);
        
        updateCustomerPhoto(customer.phone, tempPhoto, description);
        onSuccess?.('Foto adicionada ao histórico!');
      }
      setTempPhoto(null);
      setShowDescription(false);
    }
  };

  const handleSaveEdit = () => {
    const oldPhone = customer.phone;
    updateCustomer(oldPhone, { name: editName, phone: editPhone });
    if (normalizePhone(editPhone) !== normalizePhone(oldPhone)) {
      onPhoneChange?.(editPhone);
    }
    setIsEditing(false);
    onSuccess?.('Dados atualizados!');
  };

  const handleCancelEdit = () => {
    setEditName(customer.name);
    setEditPhone(customer.phone);
    setIsEditing(false);
  };
  const [showNoShows, setShowNoShows] = useState(false);
  
  const appointmentsData = localHistory.filter(h => h.status === 'completed');
  const lastVisit = appointmentsData.length > 0 ? formatDate(appointmentsData[0].date) : null;
  const totalRevenue = appointmentsData.reduce((sum, h) => sum + (h.price || 0), 0);

  return (
    <div className="animate-fade-in pb-28">
      <div className="bg-surface rounded-3xl mx-4 mt-4 mb-6 p-4 relative overflow-hidden">
        <button 
          onClick={() => isEditing ? handleCancelEdit() : setIsEditing(true)}
          className="absolute top-4 right-4 w-8 h-8 bg-primary/40 text-title rounded-full flex items-center justify-center hover:bg-primary/40 transition-colors z-10"
        >
          {isEditing ? <X size={14} /> : <Edit3 size={14} />}
        </button>

        <div className="flex flex-row items-start gap-4 mb-4">
          <div className="relative group shrink-0">
            <div className={`w-16 h-16 rounded-2xl ${getAvatarColor(customer.phone)} flex items-center justify-center text-white font-black text-2xl overflow-hidden`}>
              {customer.avatar ? (
                <img src={customer.avatar} className="w-full h-full object-cover" alt={customer.name} />
              ) : (
                getInitials(customer.name)
              )}
            </div>
            <button 
              onClick={() => { setPhotoType('avatar'); setShowActionSheet(true); }}
              className="absolute bottom-0 right-0 w-6 h-6 bg-secondary text-white rounded-full flex items-center justify-center shadow-md ring-2 ring-surface hover:bg-secondary transition-colors"
            >
              <Camera size={12} />
            </button>
          </div>

          <div className="flex-1 min-w-0 pr-8">
            {isEditing ? (
              <div className="space-y-3">
                <input 
                  type="text" 
                  value={editName} 
                  onChange={e => setEditName(e.target.value)}
                  className="w-full bg-primary/40 border-none rounded-xl p-2 text-sm font-bold text-white"
                  placeholder="Nome do cliente"
                />
                <input 
                  type="tel" 
                  value={editPhone} 
                  onChange={e => setEditPhone(e.target.value)}
                  className="w-full bg-primary/40 border-none rounded-xl p-2 text-sm text-title"
                  placeholder="Telefone"
                />
                <Button fullWidth onClick={handleSaveEdit} className="h-8 rounded-xl bg-green-600 text-xs py-0">Salvar</Button>
              </div>
            ) : (
              <>
                <h2 className="text-[18px] font-black text-white leading-tight truncate">{capitalizeName(customer.name)}</h2>
                <div className="flex items-center gap-1 mt-0.5">
                  <CheckCircle2 size={11} className="text-secondary" />
                  <span className="text-[11px] font-bold text-secondary uppercase tracking-wide">
                    Cliente desde {localHistory.length > 0 ? localHistory[localHistory.length - 1].date.substring(0, 4) : new Date().getFullYear()}
                  </span>
                </div>

                <div className="border-t border-white/10 my-2.5" />

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Phone size={13} className="text-white/40" />
                    <span className="text-[13px] text-white/70 font-medium">{formatPhone(customer.phone)}</span>
                  </div>
                  <button 
                    onClick={() => window.open(`https://wa.me/55${customer.phone.replace(/\D/g, '')}`)}
                    className="w-8 h-8 rounded-xl bg-[#25D366]/15 flex items-center justify-center shrink-0 text-[#25D366]"
                  >
                    <FaWhatsapp size={16} />
                  </button>
                </div>

                <div className="flex items-center gap-2 mt-1.5">
                  <Calendar size={13} className="text-white/40" />
                  <span className="text-[12px] text-white/50 font-medium truncate">
                    Última visita: {lastVisit || 'Nenhuma visita ainda'}
                  </span>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-col w-full">
          <div className="flex justify-center gap-2 w-full">
            <div className="bg-secondary/20 text-secondary border border-secondary/30 rounded-2xl flex-1 py-2 flex flex-col items-center justify-center min-h-[60px]">
              <span className="font-black text-xl leading-none">{customer.cutCount}</span>
              <span className="text-[8px] uppercase font-black tracking-widest opacity-80 mt-1">Cortes</span>
            </div>
            <div 
              onClick={() => (customer.noShowCount || 0) > 0 && setShowNoShows(!showNoShows)}
              className={`rounded-2xl border flex-1 py-2 flex flex-col items-center justify-center min-h-[60px] transition-all ${(customer.noShowCount || 0) > 0 ? 'bg-amber-500/20 text-amber-300 border-amber-400/20 cursor-pointer' : 'bg-primary/40 text-title border-title/30'}`}
            >
              <span className="font-black text-xl leading-none">{customer.noShowCount || 0}</span>
               <span className="text-[8px] uppercase font-black tracking-widest opacity-80 mt-1">Faltas</span>
            </div>
            <div className="bg-green-500/10 text-green-400 border border-green-500/20 rounded-2xl flex-1 py-2 flex flex-col items-center justify-center min-h-[60px]">
              <span className="font-black text-sm leading-none">{formatCurrency(totalRevenue)}</span>
              <span className="text-[8px] uppercase font-black tracking-widest opacity-80 mt-1">Total</span>
            </div>
          </div>
          <AnimatePresence>
            {showNoShows && localHistory.filter(h => h.status === 'no-show').length > 0 && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="bg-red-500/10 rounded-xl px-3 py-2 mt-2 text-[11px] text-red-300 text-left">
                  {localHistory.filter(h => h.status === 'no-show').map((apt, i) => (
                    <div key={i}>• {formatDate(apt.date)} — {apt.service}</div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Seção Compacta de Fotos e Histórico de Acompanhamento */}
      <div className="space-y-6 mt-4">
        <ClientPhotosPreview 
          localPhotos={localPhotos}
          isLoading={isLoadingData}
          onAddPhotoClick={() => { setPhotoType('history'); setShowActionSheet(true); }}
          onViewAllClick={() => setIsGalleryOpen(true)}
        />

        <ClientHistoryPreview 
          localHistory={localHistory}
          isLoading={isLoadingData}
          onViewAllClick={() => setIsHistoryFullOpen(true)}
        />
        
        {/* Inputs de arquivo ocultos para uploader de foto */}
        <input type="file" accept="image/*" capture="environment" ref={cameraInputRef} className="hidden" onChange={handleFileChange} />
        <input type="file" accept="image/*" ref={galleryInputRef} className="hidden" onChange={handleFileChange} />
      </div>

      <div className="fixed bottom-0 left-0 right-0 px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-3 bg-[#1E1B4B] z-50">
        <button 
          onClick={() => onNewAppointment(customer)}
          className="w-full h-14 bg-secondary text-white font-black uppercase tracking-widest rounded-2xl shadow-lg shadow-secondary/30 flex items-center justify-center gap-2 active:scale-95 transition-all"
        >
          <Calendar size={20} />
          Novo Agendamento
        </button>
      </div>

      <AnimatePresence>
        {showActionSheet && (
          <PhotoActionSheet 
            isOpen={showActionSheet}
            onClose={() => setShowActionSheet(false)}
            onSelect={(source) => {
              setShowActionSheet(false);
              if (source === 'camera') cameraInputRef.current?.click();
              else galleryInputRef.current?.click();
            }}
          />
        )}
        {showDescription && tempPhoto && (
          <PhotoDescriptionModal 
            isOpen={showDescription}
            photo={tempPhoto}
            onClose={() => {
              setShowDescription(false);
              setTempPhoto(null);
            }}
            onConfirm={handleConfirmPhoto}
          />
        )}
        {/* Modal de Galeria Completa de Fotos com Cursor-based pagination */}
        {isGalleryOpen && (
          <ClientPhotosGallery 
            isOpen={isGalleryOpen}
            onClose={() => setIsGalleryOpen(false)}
            customerPhone={customer.phone}
            customerName={customer.name}
            localPhotos={localPhotos}
          />
        )}
        {/* Modal de Histórico Completo de Atendimentos com Offset/Cursor pagination */}
        {isHistoryFullOpen && (
          <ClientHistoryFull 
            isOpen={isHistoryFullOpen}
            onClose={() => setIsHistoryFullOpen(false)}
            customerPhone={customer.phone}
            customerName={customer.name}
            localHistory={localHistory}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

const InfoTooltip = ({ text }: { text: string }) => {
  const [open, setOpen] = useState(false);
  const [side, setSide] = useState<'left' | 'right'>('right');
  const btnRef = useRef<HTMLButtonElement>(null);
  
  const handleOpen = () => {
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setSide(rect.left < window.innerWidth / 2 ? 'right' : 'left');
    }
    setOpen(v => !v);
  };
  
  return (
    <div className="relative inline-flex flex-shrink-0">
      <button ref={btnRef} onClick={handleOpen}
        className="text-title  text-[11px] leading-none p-0.5 outline-none hover:text-secondary transition-colors">
        <Info size={12} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className={`absolute z-50 top-5 ${side === 'right' ? 'left-0' : 'right-0'}
            bg-surface text-white text-[11px] rounded-xl p-3 w-[170px] shadow-xl leading-relaxed`}>
            {text}
          </div>
        </>
      )}
    </div>
  );
};

const TodayScheduleList: React.FC<{ appointments: Appointment[], date: string }> = ({ appointments, date }) => {
  const todayApts = appointments
    .filter(a => a.date === date)
    .sort((a, b) => a.time.localeCompare(b.time));

  return (
    <div className="bg-surface p-5 rounded-[2rem] ">
      <h4 className="text-[10px] font-bold uppercase tracking-widest text-title mb-4 text-center">
        {date === getTodayString() ? 'Sua agenda de hoje' : `Agenda de ${formatDateShort(date)}`}
      </h4>
      <div className="space-y-3">
        {todayApts.length > 0 ? (
          todayApts.map((apt, idx) => {
            const status: 'finished' | 'no-show' | 'scheduled' =
              apt.status === 'completed' ? 'finished'
              : apt.status === 'no-show' ? 'no-show'
              : 'scheduled';
            return (
              <div key={idx} className="flex items-center justify-between gap-2 bg-surface  rounded-2xl px-4 py-3 border border-title/30 ">
                <span className="text-xs font-mono text-title w-10 flex-shrink-0">{apt.time}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-white  truncate">{apt.clientName}</p>
                  <p className="text-[11px] text-title truncate">{apt.service}</p>
                </div>
                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                  <span className={`text-sm font-bold
                    ${status === 'finished' ? 'text-green-500' : ''}
                    ${status === 'scheduled' ? 'text-title' : ''}
                    ${status === 'no-show' ? 'line-through text-title opacity-50' : ''}
                  `}>
                    {formatCurrency(apt.price ?? 0)}
                  </span>
                  {status === 'no-show' && (
                    <span className="text-[10px] font-semibold text-red-400 bg-red-50  px-2 py-0.5 rounded-full">
                      - Falta
                    </span>
                  )}
                  {status === 'scheduled' && (
                    <span className="text-[10px] font-semibold text-title bg-primary/40  px-2 py-0.5 rounded-full">
                      Agendado
                    </span>
                  )}
                  {status === 'finished' && (
                    <span className="text-[10px] font-semibold text-green-500 bg-green-50  px-2 py-0.5 rounded-full">
                      ✓ Concluído
                    </span>
                  )}
                </div>
              </div>
            );
          })
        ) : (
          <div className="flex flex-col items-center justify-center p-6 text-center text-title">
            <Calendar size={24} className="mb-2 opacity-30" strokeWidth={1.5} />
            <p className="text-xs font-medium">Nenhum atendimento neste dia</p>
          </div>
        )}
      </div>
    </div>
  );
};


const formatDateShort = (dateStr: string): string => {
  const [y, m, d] = dateStr.split('-').map(Number);
  const months = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  return `${d} ${months[m - 1]}`;
};

const ReportsView: React.FC = () => {
  const { appointments, customers, weeklySchedule, services } = useStore();
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
      chartTitle = "Sua agenda de hoje";
      for (let h = 8; h <= 20; h++) {
        const hourStr = h.toString().padStart(2, '0');
        const count = current.apts.filter(a => a.status === 'completed' && a.time.startsWith(hourStr)).length;
        chartData.push({ name: `${h}h`, value: count });
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
        chartData.push({ name: `Sem ${week}`, value: count });
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
    if (!services || !weeklySchedule) return 0;
    
    // Buscar a menor duração entre todos os serviços do catálogo
    const minServiceDuration = services.reduce(
      (min, s) => Math.min(min, s.duration ?? 30),
      Infinity
    );
    const minDuration = minServiceDuration === Infinity ? 30 : minServiceDuration;

    let globalTotal = 0;
    let globalOccupied = 0;

    const processDay = (dateStr: string, config: any) => {
      if (!config?.isOpen) return;

      const toMin = (t: string) => {
        const [h, m] = t.split(':').map(Number);
        return h * 60 + m;
      };

      const workStart = toMin(config.start);
      const workEnd = toMin(config.end);
      
      const dayAppointments = appointments
        .filter(a => a.date === dateStr && a.status !== 'canceled' && a.status !== 'no-show')
        .map(a => ({
           time: a.time,
           duration: a.duration ?? (services.find(s => s.name === a.service)?.duration ?? 30),
        }));
        
      const { occupiedSlots, totalSlots } = calcOccupancySlots(
        dayAppointments,
        workStart,
        workEnd,
        15, // SLOT_SIZE
        minDuration
      );

      globalTotal += totalSlots;
      globalOccupied += occupiedSlots;
    };

    if (period === 'dia') {
       const dateStr = currentDate.toISOString().split('T')[0];
       const dayOfWeek = currentDate.getDay();
       processDay(dateStr, weeklySchedule[dayOfWeek]);
    } else {
       const start = new Date(currentRange.start + 'T12:00:00');
       const end = new Date(currentRange.end + 'T12:00:00');
       let curr = new Date(start);
       while (curr <= end) {
         const dateStr = curr.toISOString().split('T')[0];
         const dayOfWeek = curr.getDay();
         processDay(dateStr, weeklySchedule[dayOfWeek]);
         curr.setDate(curr.getDate() + 1);
       }
    }
    
    if (globalTotal === 0) return 0;
    return Math.min(globalOccupied / globalTotal, 1);
  }, [weeklySchedule, currentDate, currentRange, period, appointments, services]);

  const renderComparison = (current: number, previous: number) => {
    if (previous === 0) return <p className="text-[9px] text-[#9CA3AF] mt-0.5">✦ Primeiro registro neste período</p>;
    const diff = ((current - previous) / previous) * 100;
    const isUp = diff > 0;
    
    const absDiff = Math.abs(diff).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 1 });

    if (diff === 0) return <p className="text-[9px] text-title mt-0.5">Mesmo que o período anterior</p>;
    
    return (
      <p className={`flex items-center gap-1 font-bold text-sm ${isUp ? 'text-green-500' : 'text-red-500'}`}>
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
    
    const periodLabelMap = {
      dia: 'do dia anterior',
      semana: 'da semana anterior',
      mes: 'do mês anterior',
      ano: 'do ano anterior'
    };
    const periodLabel = periodLabelMap[period];

    if (noShowRate > 20) {
      alertType = 'red';
      message = "Taxa de faltas alta neste período";
    } else if (returnRate < 30 && period !== 'dia') {
      alertType = 'yellow';
      message = "Poucos clientes retornando";
    } else if (stats.current.revenue > stats.previous.revenue * 1.3 && stats.previous.revenue > 0) {
      alertType = 'green';
      const diff = ((stats.current.revenue - stats.previous.revenue) / stats.previous.revenue) * 100;
      message = `Faturamento ${diff.toFixed(0)}% acima ${periodLabel}`;
    }

    if (!alertType) return null;

    const colors = {
      red: 'bg-red-50 text-red-600 border-red-200   ',
      yellow: 'bg-amber-50 text-amber-600 border-amber-200   ',
      green: 'bg-green-50 text-green-600 border-green-200   ',
    };
    
    const icons = {
      red: <AlertTriangle size={16} />,
      yellow: <AlertTriangle size={16} />,
      green: <TrendingUp size={16} />
    };

    return (
      <div className={`p-4 rounded-[1.25rem] border flex items-center gap-3 ${colors[alertType]}`}>
        <div className="shrink-0">{icons[alertType]}</div>
        <p className="text-xs font-bold leading-tight">{message}</p>
      </div>
    );
  };

  const formatPeriodDisplay = () => {
    const monthsShort = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    const monthsFull = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    
    if (period === 'dia') {
      return `${currentDate.getDate()} de ${monthsShort[currentDate.getMonth()]}. ${currentDate.getFullYear()}`;
    }
    if (period === 'semana') {
      const start = new Date(currentRange.start + 'T12:00:00');
      const end = new Date(currentRange.end + 'T12:00:00');
      return `${start.getDate()}–${end.getDate()} ${monthsShort[start.getMonth()]}. ${start.getFullYear()}`;
    }
    if (period === 'mes') {
      return `${monthsFull[currentDate.getMonth()]} ${currentDate.getFullYear()}`;
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
            <h4 className="text-xs font-bold text-white ">Selecionar Ano</h4>
            <button onClick={() => setViewMode('days')} className="text-[10px] font-bold text-secondary">Voltar</button>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {years.map(year => (
              <button
                key={year}
                onClick={() => {
                  setViewDate(new Date(year, viewDate.getMonth(), 1));
                  setViewMode('days');
                }}
                className={`h-10 rounded-xl flex items-center justify-center text-[11px] font-bold transition-all
                  ${viewDate.getFullYear() === year ? 'bg-secondary text-white shadow-sm' : 'bg-primary/40  text-white  hover:bg-surface/80'}`}
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
      days.push(<div key={`prev-${i}`} className="h-8 flex items-center justify-center opacity-20 text-[10px] font-bold text-title">{prevMonthLastDay - i}</div>);
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
          className={`h-8 w-full rounded-lg flex items-center justify-center text-[11px] font-bold transition-all relative
            ${isSelected || isWeekSelected ? 'bg-secondary text-white shadow-sm' : isToday ? 'bg-surface/80   text-secondary' : 'hover:bg-primary/40 :bg-surface text-white '}
            ${isBefore2026 && (period === 'semana' || period === 'mes') ? 'opacity-20 cursor-not-allowed' : ''}`}
        >
          {d}
        </button>
      );
    }
    
    // Next month
    const remaining = 42 - days.length;
    for (let d = 1; d <= remaining; d++) {
      days.push(<div key={`next-${d}`} className="h-8 flex items-center justify-center opacity-20 text-[10px] font-bold text-title">{d}</div>);
    }

    return (
      <div {...reportsSwipeHandlers} className="p-4 space-y-4 overflow-hidden">
        <div className="flex items-center justify-between">
          <button onClick={handleReportsSwipeRight} className="p-1 text-title hover:text-secondary">
            <ChevronLeft size={16} />
          </button>
          <button 
            onClick={() => setViewMode('years')}
            className="text-xs font-bold text-white hover:text-secondary transition-colors"
          >
            {(() => {
              const str = viewDate.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
              return str.charAt(0).toUpperCase() + str.slice(1);
            })()}
          </button>
          <button onClick={handleReportsSwipeLeft} className="p-1 text-title hover:text-secondary">
            <ChevronRight size={16} />
          </button>
        </div>
        <AnimatePresence mode="wait">
          <motion.div
            key={`month-${viewDate.getTime()}`}
            initial={{ opacity: 0, x: slideDirection * 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -slideDirection * 20 }}
            transition={{ duration: 0.2 }}
          >
            <div className="grid grid-cols-7 gap-1">
              {['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((d, i) => (
                <div key={i} className="h-8 flex items-center justify-center text-[9px] font-black text-title uppercase">{d}</div>
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
          <button onClick={() => setViewDate(new Date(viewDate.getFullYear() - 1, viewDate.getMonth(), 1))} className="p-1 text-title hover:text-secondary">
            <ChevronLeft size={16} />
          </button>
          <span className="text-xs font-bold text-white ">
            {viewDate.getFullYear()}
          </span>
          <button onClick={() => setViewDate(new Date(viewDate.getFullYear() + 1, viewDate.getMonth(), 1))} className="p-1 text-title hover:text-secondary">
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
                className={`h-10 rounded-xl flex items-center justify-center text-[11px] font-bold transition-all
                  ${isSelected ? 'bg-secondary text-white shadow-sm' : 'bg-primary/40  text-white  hover:bg-surface/80'}
                  ${isBefore2026 ? 'opacity-20 cursor-not-allowed' : ''}`}
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
            className={`h-10 rounded-xl flex items-center justify-center text-[11px] font-bold transition-all
              ${currentDate.getFullYear() === year ? 'bg-secondary text-white shadow-sm' : 'bg-primary/40  text-white  hover:bg-surface/80'}`}
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

  const isCurrentDateSelected = getRange(period, currentDate).start === getRange(period, new Date()).start;

  return (
    <div className="px-4 pt-5 pb-24 space-y-4">
      {/* Chips de período — sempre 4, sempre visíveis */}
      <div className="sticky top-0 bg-primary/40  z-10 pt-2 pb-3 relative">
        <div className="grid grid-cols-4 gap-1 w-full relative z-20 bg-surface/50 p-1 rounded-2xl ">
          {/* Chip Hoje/Data — dinâmico */}
          <button
            onClick={() => {
              if (period === 'dia') {
                setShowSelector(v => !v);
              } else {
                setPeriod('dia');
                setShowSelector(true);
              }
            }}
            className={`py-2 px-1 rounded-xl text-xs font-semibold text-center transition-all truncate ${period === 'dia' ? 'bg-surface text-secondary' : 'bg-transparent text-title shadow-none border-none'}`}
          >
            {period === 'dia' && !isCurrentDateSelected
              ? `${formatDateShort(currentDate.toISOString().split('T')[0])} ▾`
              : period === 'dia' ? 'Hoje ▾' : 'Hoje'}
          </button>
          
          {/* Chips fixos */}
          {(['semana', 'mes', 'ano'] as const).map((p, i) => (
            <button key={p}
              onClick={() => {
                if (period === p) {
                  setShowSelector(v => !v);
                } else {
                  setPeriod(p);
                  setShowSelector(true);
                }
              }}
              className={`py-2 px-1 rounded-xl text-xs font-semibold text-center transition-all ${period === p ? 'bg-surface text-secondary' : 'bg-transparent text-title shadow-none border-none'}`}
            >
              {period === p
                ? `${['Semana', 'Mês', 'Ano'][i]} ▾`
                : ['Semana', 'Mês', 'Ano'][i]}
            </button>
          ))}
        </div>
        
        {/* Calendário colapsável — aparece ABAIXO dos chips sem empurrar layout */}
        <AnimatePresence>
          {showSelector && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="absolute left-0 right-0 z-10 w-full overflow-hidden bg-surface  rounded-3xl shadow-[0_10px_25px_rgba(0,0,0,0.1)] mt-2 border border-title/30 "
            >
              {(period === 'dia' || period === 'semana') && renderCalendar()}
              {period === 'mes' && renderMonthGrid()}
              {period === 'ano' && renderYearGrid()}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Hero card faturamento */}
      <div className="bg-surface p-5 rounded-[2rem] flex flex-col items-center justify-center relative">
        <div className="absolute top-4 right-4">
          <InfoTooltip text="Total recebido pelos atendimentos concluídos no período" />
        </div>
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-title  mb-2">Faturamento</h3>
        <p className="text-[32px] font-black text-white  tracking-tighter leading-none mb-3">
          {formatCurrency(stats.current.revenue)}
        </p>
        <div className="flex items-center justify-center">
            {renderComparison(stats.current.revenue, stats.previous.revenue)}
        </div>
        
        <div className="w-full mt-6 space-y-1.5 relative">
          <div className="flex justify-between items-center px-1">
            <div className="flex items-center gap-1">
              <span className="text-[9px] font-bold uppercase tracking-widest text-title">Ocupação</span>
              <InfoTooltip text="Percentual dos seus horários disponíveis que foram agendados no período." />
            </div>
            <span className="text-[10px] font-black text-secondary bg-surface/80   px-2 py-0.5 rounded-full">
               {Math.round(occupancyRatio * 100)}%
            </span>
          </div>
          <div className="h-2 w-full bg-surface/80  rounded-full overflow-hidden">
             <div className="h-full bg-secondary rounded-full transition-all duration-1000 ease-out" style={{ width: `${Math.round(occupancyRatio * 100)}%` }} />
          </div>
        </div>
      </div>

      {/* 3 chips compactos */}
      <div className="grid grid-cols-3 gap-2">
         <div className="bg-surface p-3 py-4 rounded-2xl flex flex-col justify-center relative">
            <div className="flex items-start justify-between w-full mb-1">
               <p className="text-[10px] uppercase tracking-widest font-bold leading-tight text-title">
                 Ticket<br />Médio
               </p>
               <InfoTooltip text="Valor médio cobrado por atendimento no período." />
            </div>
            <p className="text-base font-black text-white  mt-1 text-center">{formatCurrency(stats.current.ticket)}</p>
         </div>
         <div className="bg-surface p-3 py-4 rounded-2xl flex flex-col justify-center relative">
            <div className="flex items-start justify-between w-full mb-1">
               <p className="text-[10px] uppercase tracking-widest font-bold leading-tight text-title">
                 Novos<br />Clientes
               </p>
               <InfoTooltip text="Clientes que vieram pela primeira vez no período" />
            </div>
            <p className="text-base font-black text-white  mt-1 text-center">{stats.newClients}</p>
         </div>
         <div className="bg-surface p-3 py-4 rounded-2xl flex flex-col justify-center relative">
            <div className="flex items-start justify-between w-full mb-1">
               <p className="text-[10px] uppercase tracking-widest font-bold leading-tight text-title">
                 Faltas<br /><span>&nbsp;</span>
               </p>
               <InfoTooltip text="Clientes que agendaram e não compareceram" />
            </div>
            <p className="text-base font-black text-[#EF4444] mt-1 text-center">{stats.current.noShowRate.toFixed(1)}%</p>
         </div>
      </div>

      {renderAlertCard()}

      {/* Gráfico / Agenda de hoje */}
      {period === 'dia' ? (
        <TodayScheduleList appointments={appointments} date={currentDate.toISOString().split('T')[0]} />
      ) : (
        <div className="bg-surface p-5 rounded-[2rem] relative">
          <h4 className="text-[10px] font-bold uppercase tracking-widest text-title  mb-4 text-center">
            {stats.chartTitle}
          </h4>
          <div className="h-[200px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.chartData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#8683A1" />
                <XAxis 
                  dataKey="name" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fontSize: 9, fontWeight: 700, fill: "#8683A1" }}
                  dy={10}
                />
                <Tooltip 
                  cursor={{ fill: "#8683A1" }}
                  contentStyle={{ 
                    borderRadius: '12px', border: 'none', 
                    backgroundColor: "#2D2856", 
                    boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                    color: "#ffffff", fontSize: '11px', fontWeight: 700
                  }}
                  formatter={(value: number) => [`${value} atendimentos`, '']}
                  labelStyle={{ display: 'none' }}
                />
                <Bar dataKey="value" radius={[4, 4, 0, 0]} barSize={24}>
                  {stats.chartData.map((entry, index) => {
                    const max = Math.max(...stats.chartData.map(d => d.value));
                    const isMax = entry.value === max && max > 0;
                    return (
                      <Cell 
                        key={`cell-${index}`} 
                        fill="#F99417"
                        fillOpacity={isMax ? 1 : 0.3}
                      />
                    );
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Top 5 Clientes */}
      {period !== 'dia' && (
        <div className="bg-surface p-5 rounded-[2rem] ">
          <h4 className="text-[10px] font-bold uppercase tracking-widest text-title mb-4 text-center">Top 5 Clientes</h4>
          <div className="space-y-4">
            {stats.topClients.length > 0 ? stats.topClients.map((client, idx) => (
              <div key={idx} className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-xs shrink-0 ${getAvatarColor(client.name)}`}>
                  {getInitials(client.name)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-white  truncate leading-tight">{client.name}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <p className="text-[10px] font-medium text-title">{client.count} visitas</p>
                    <span className="w-1 h-1 bg-title/30  rounded-full"></span>
                    <p className="text-[10px] font-bold text-green-500">{formatCurrency(client.spent)}</p>
                  </div>
                </div>
                {client.noShows > 0 && (
                  <div className="bg-red-50 text-red-500   px-2.5 py-1 rounded-full text-[9px] font-bold shrink-0">
                    {client.noShows} faltas
                  </div>
                )}
              </div>
            )) : (
              <p className="text-center text-title text-xs py-4 font-medium">Nenhum cliente no período</p>
            )}
          </div>
        </div>
      )}

      {/* Ranking de Serviços */}
      <div className="bg-surface p-5 rounded-[2rem] ">
        <h4 className="text-[10px] font-bold uppercase tracking-widest text-title mb-4 text-center">Ranking de Serviços</h4>
        <div className="space-y-5">
          {stats.topServices.length > 0 ? stats.topServices.map((service, idx) => {
            const maxRevenue = Math.max(...stats.topServices.map(s => s.revenue));
            const percentage = maxRevenue > 0 ? (service.revenue / maxRevenue) * 100 : 0;
            return (
              <div key={idx} className="space-y-1.5 relative">
                <div className="flex justify-between items-center text-sm">
                  <span className="font-bold text-white  truncate pr-2">{service.name}</span>
                  <span className="font-black text-secondary shrink-0">{formatCurrency(service.revenue)}</span>
                </div>
                <div className="flex justify-between items-center text-[10px] text-title mb-1 font-medium">
                  <span>{service.count} atendimentos</span>
                </div>
                <div className="w-full h-1.5 bg-surface/80  rounded-full overflow-hidden">
                  <div className="h-full bg-secondary rounded-full transition-all duration-1000" style={{ width: `${percentage}%` }} />
                </div>
              </div>
            );
          }) : (
            <p className="text-center text-title text-xs py-4 font-medium">Nenhum serviço no período</p>
          )}
        </div>
      </div>
    </div>
  );
};

import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback, useRef, useMemo } from 'react';
import { Appointment, AppState, BarberProfile, Customer, DayConfig, ServiceItem, Transaction, Staff, Tenant, StaffAvailability, AppNotification, Barbershop, BarbershopMember, BarbershopInvite, OnboardingState, AppointmentTransactionResult, AuthContextResult, UserBarbershopContext, ActiveContext, MembershipRole, AuthContext, TenantContext, SetupMode } from '../types';
import { normalizePhone, isValidPhone, validateBrazilianPhone, normalizeBrazilianPhoneForComparison, isDuplicateLinkedAppointmentTransactionError } from '../utils/helpers';
import { supabaseService } from '../services/supabaseService';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { Session } from '@supabase/supabase-js';

const AppContext = createContext<AppState | undefined>(undefined);

const STORAGE_KEY_APTS = 'meucorte_appointments_v1';
const STORAGE_KEY_CUSTOMERS = 'meucorte_customers_v1';
const STORAGE_KEY_BLOCKED = 'meucorte_blocked_slots_v1';
const STORAGE_KEY_UNBLOCKED = 'meucorte_unblocked_slots_v1';
const STORAGE_KEY_WEEKLY_V2 = 'meucorte_weekly_schedule_v2';
const STORAGE_KEY_SERVICES = 'meucorte_services_v1';
const STORAGE_KEY_PROFILE = 'meucorte_profile_v2';
const STORAGE_KEY_DARK_MODE = 'meucorte_dark_mode_v1';

export const DEFAULT_DAY_CONFIG: DayConfig = {
  start: "09:00",
  end: "19:00",
  breaks: [],
  isOpen: true
};

const DEFAULT_WEEKLY: Record<number, DayConfig> = {
  0: { ...DEFAULT_DAY_CONFIG, isOpen: false }, // Sun
  1: { ...DEFAULT_DAY_CONFIG }, // Mon
  2: { ...DEFAULT_DAY_CONFIG },
  3: { ...DEFAULT_DAY_CONFIG },
  4: { ...DEFAULT_DAY_CONFIG },
  5: { ...DEFAULT_DAY_CONFIG },
  6: { ...DEFAULT_DAY_CONFIG }  // Sat
};

const DEFAULT_SERVICES: ServiceItem[] = [
  { id: '00000000-0000-0000-0000-000000000001', name: 'Corte de Cabelo', price: 35, duration: 30 },
  { id: '00000000-0000-0000-0000-000000000002', name: 'Barba', price: 25, duration: 30 },
  { id: '00000000-0000-0000-0000-000000000003', name: 'Corte + Barba', price: 50, duration: 60 },
  { id: '00000000-0000-0000-0000-000000000004', name: 'Pezinho / Sobrancelha', price: 10, duration: 30 },
];

const DEFAULT_PROFILE: BarberProfile = {
  name: 'Barbeiro',
  personalPhone: '',
  photo: '',
  shopName: 'Meu Corte',
  businessPhone: '',
  address: '',
  logo: '',
  description: '',
  instagram: '',
  website: '',
  onboarding_seen: false,
  slug: ''
};

export const AppProvider: React.FC<{
  children: ReactNode;
  onReady?: () => void;
  isPublicRoute?: boolean;
}> = ({ children, onReady, isPublicRoute }) => {
  const isFirstLoad = useRef(true);
  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  const finishingRef = useRef<Set<string>>(new Set());
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [customers, setCustomers] = useState<Record<string, Customer>>({});
  const [blockedSlots, setBlockedSlots] = useState<Record<string, string[]>>({});
  const [unblockedSlots, setUnblockedSlots] = useState<Record<string, string[]>>({});
  const [weeklySchedule, setWeeklySchedule] = useState<Record<number, DayConfig>>(DEFAULT_WEEKLY);
  const [services, setServices] = useState<ServiceItem[]>(DEFAULT_SERVICES);
  const [barberProfile, setBarberProfile] = useState<BarberProfile>(DEFAULT_PROFILE);
  const [isLoading, setIsLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [activeContext, setActiveContext] = useState<ActiveContext | null>(null);
  const [activeBarbershopId, setActiveBarbershopId] = useState<string | null>(null);
  const activeBarbershopIdRef = useRef<string | null>(null);
  useEffect(() => {
    activeBarbershopIdRef.current = activeBarbershopId;
  }, [activeBarbershopId]);
  const [activeMembershipRole, setActiveMembershipRole] = useState<MembershipRole | null>(null);
  const [activeStaffProfileId, setActiveStaffProfileId] = useState<string | null>(null);
  const [authenticatedUserId, setAuthenticatedUserId] = useState<string | null>(null);
  const bootRequestIdRef = useRef<number>(0);

  // Multi-tenant & Multi-staff state declarations
  const [activeTenant, setActiveTenant] = useState<any | null>(null);
  const [staff, setStaff] = useState<any[]>([]);
  const [currentStaff, setCurrentStaff] = useState<Staff | null>(null);
  const [userRole, setUserRole] = useState<'admin_owner' | 'staff' | 'client' | null>(null);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  const [barbershop, setBarbershop] = useState<Barbershop | null>(null);
  const [barbershopMembers, setBarbershopMembers] = useState<BarbershopMember[]>([]);
  const [barbershopInvites, setBarbershopInvites] = useState<BarbershopInvite[]>([]);
  const [onboardingState, setOnboardingState] = useState<OnboardingState | null>(null);
  const [authContext, setAuthContext] = useState<AuthContext | null>(null);
  const [authContextResult, setAuthContextResult] = useState<AuthContextResult | null>(null);
  const [userContexts, setUserContexts] = useState<UserBarbershopContext[]>([]);
  const selectedBarbershopIdRef = useRef<string | null>(null);

  const checkOnboardingState = useCallback(async (): Promise<OnboardingState> => {
    if (!isSupabaseConfigured() || !sessionRef.current?.user?.id) {
      const defaultState: OnboardingState = {
        userId: '',
        isAuthenticated: false,
        hasProfile: false,
        profile: null,
        hasBarbershop: false,
        barbershop: null,
        hasOwnerMembership: false,
        isStaffMember: false,
        status: 'no_session',
        isComplete: false,
        step: 1
      };
      setOnboardingState(defaultState);
      return defaultState;
    }

    const state = await supabaseService.resolveOnboardingState(sessionRef.current.user.id);
    setOnboardingState(state);
    return state;
  }, []);

  const permissions = useMemo(() => {
    const isAdmin = userRole === 'admin_owner' || userRole === 'admin';
    const isStaff = userRole === 'staff';
    return {
      canManageStaff: isAdmin,
      canManageServices: isAdmin,
      canManageTenantProfile: isAdmin,
      canViewCaixa: isAdmin || isStaff,
      canManageCaixa: isAdmin,
      canManageWeeklySchedule: isAdmin,
      canManageAppointments: isAdmin || isStaff,
      canManageCustomers: isAdmin || isStaff,
    };
  }, [userRole]);

  const [selectedStaffId, setSelectedStaffId] = useState<string | 'all'>('all');
  const sessionRef = useRef<Session | null>(null);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const appointmentsRef = useRef(appointments);
  appointmentsRef.current = appointments;

  const customersRef = useRef<Record<string, Customer>>({});
  useEffect(() => {
    customersRef.current = customers;
  }, [customers]);

  const skipNextFetchRef = useRef<Record<string, boolean>>({});

  const normalizeTime = (time: string) => {
    if (!time) return '';
    return time.substring(0, 5); // "17:45:00" → "17:45"
  };

  const normalizeDate = (date: string) => {
    if (!date) return '';
    return date.substring(0, 10); // "2026-03-17T00:00:00+00:00" → "2026-03-17"
  };

  const normalizeAppointment = (apt: any): Appointment => ({
    ...apt,
    time: normalizeTime(apt.time),
    date: normalizeDate(apt.date)
  });

  const fetchAppointmentsByDate = useCallback(async (date: string) => {
    try {
      if (skipNextFetchRef.current[date]) {
        skipNextFetchRef.current[date] = false;
        return;
      }

      const currentSession = sessionRef.current;
      const barbershopId = activeTenant?.id;
      if (!isSupabaseConfigured() || !currentSession?.user?.id || !barbershopId) return;

      const dbApts = await supabaseService.getAppointmentsByDate(date);
      
      const normalizedApts = (dbApts || []).map(normalizeAppointment);

      setAppointments(prev => {
        const otherDates = prev.filter(a => a.date !== date);
        
        // Para appointments do dia, preservar clientName
        // local se o appointment já existia no estado
        const merged = normalizedApts.map(newApt => {
          const existing = prev.find(a => a.id === newApt.id);
          if (existing) {
            // Manter clientName local pois pode ter sido
            // atualizado via edição de cliente
            return { ...newApt, clientName: existing.clientName };
          }
          return newApt;
        });
        
        return [...otherDates, ...merged];
      });
    } catch (e) {
      console.error("Error fetching appointments by date", e);
    }
  }, [activeTenant?.id]);

  const resetStore = useCallback(() => {
    setActiveContext(null);
    setActiveBarbershopId(null);
    setActiveMembershipRole(null);
    setActiveStaffProfileId(null);
    setAuthenticatedUserId(null);
    setBarberProfile(DEFAULT_PROFILE);
    setAppointments([]);
    setCustomers({});
    setBlockedSlots({});
    setUnblockedSlots({});
    setWeeklySchedule(DEFAULT_WEEKLY);
    setServices(DEFAULT_SERVICES);
    setTransactions([]);
    setActiveTenant(null);
    setStaff([]);
    setUserRole(null);
    setCurrentStaff(null);
    setSelectedStaffId('all');
    setIsLoading(false);
    setBarbershop(null);
    setBarbershopMembers([]);
    setBarbershopInvites([]);
    setOnboardingState(null);
    setAuthContext(null);
    setUserContexts([]);
    selectedBarbershopIdRef.current = null;
    setSession(null);
    sessionRef.current = null;
  }, []);

  const loadBarbershopData = useCallback(async () => {
    try {
      const currentSession = sessionRef.current;
      const barbershopId = activeBarbershopId || activeTenant?.id;
      if (!isSupabaseConfigured() || !currentSession?.user?.id || !barbershopId) return;

      const [bsResult, membersResult, invitesResult] = await Promise.allSettled([
        supabaseService.getBarbershop(barbershopId),
        supabaseService.getBarbershopMembers(barbershopId),
        supabaseService.getInvites(barbershopId)
      ]);

      if (bsResult.status === 'fulfilled') {
        setBarbershop(bsResult.value);
      } else {
        console.warn('[loadBarbershopData] Aviso ao buscar barbearia:', bsResult.reason);
      }

      if (membersResult.status === 'fulfilled') {
        setBarbershopMembers(membersResult.value);
      } else {
        console.warn('[loadBarbershopData] Aviso ao buscar membros:', membersResult.reason);
      }

      if (invitesResult.status === 'fulfilled') {
        setBarbershopInvites(invitesResult.value);
      } else {
        console.warn('[loadBarbershopData] Aviso ao buscar convites:', invitesResult.reason);
      }
    } catch (err) {
      console.error('[loadBarbershopData] Error loading barbershop data:', err);
    }
  }, [activeBarbershopId, activeTenant?.id]);

  const sanitizeSessionLog = (user: any) => {
    if (!user) return null;
    const meta = user.user_metadata || {};
    return {
      id: user.id,
      email: user.email,
      role: meta.role || 'staff',
      name: meta.name || meta.full_name || '',
      full_name: meta.full_name || '',
      photo_size: meta.photo ? `${meta.photo.length} chars` : 0,
      avatar_url_size: meta.avatar_url ? `${meta.avatar_url.length} chars` : 0
    };
  };

  const sanitizeOnboardingLog = (state: any) => {
    if (!state) return null;
    return {
      userId: state.userId,
      status: state.status,
      isComplete: state.isComplete,
      step: state.step,
      isStaffMember: state.isStaffMember,
      hasOwnerMembership: state.hasOwnerMembership,
      hasBarbershop: state.hasBarbershop,
      barbershop: state.barbershop ? { id: state.barbershop.id, name: state.barbershop.name } : null,
      membership: state.membership,
      staffProfile: state.staffProfile ? {
        id: state.staffProfile.id,
        name: state.staffProfile.name,
        role: state.staffProfile.role,
        photo_size: state.staffProfile.photo ? `${state.staffProfile.photo.length} chars` : 0
      } : null
    };
  };

  const bootstrapSession = useCallback(async (currentSession: Session | null) => {
    const requestId = ++bootRequestIdRef.current;
    console.info('[BOOT] Iniciando bootstrapSession', {
      requestId,
      hasSession: Boolean(currentSession),
      userId: currentSession?.user?.id ?? null
    });

    setIsLoading(true);

    try {
      if (isPublicRoute) {
        console.info('[BOOT] Rota pública detectada, ignorando carga autenticada');
        return;
      }

      if (!isSupabaseConfigured()) {
        console.info('[BOOT] Supabase não configurado, carregando do localStorage');
        loadFromLocalStorage();
        return;
      }

      if (!currentSession?.user?.id) {
        console.info('[AUTH] Nenhuma sessão ativa detectada');
        resetStore();
        return;
      }

      const sessionUserId = currentSession.user.id;
      console.info('[AUTH_CONTEXT] Iniciando resolução para usuário:', sessionUserId, {
        selectedBarbershopId: selectedBarbershopIdRef.current
      });

      // 3. Resolver contexto de autenticação completo:
      // Diferenciação clara entre:
      // 1. Conta de usuário (auth.users / profiles)
      // 2. Barbearia / tenant (barbershops.id)
      // 3. Vínculo do usuário com a barbearia (barbershop_members)
      const [resolvedAuthCtx, resolvedSingleCtx, resolvedAuthContexts] = await Promise.all([
        supabaseService.resolveAuthContext(sessionUserId, selectedBarbershopIdRef.current || undefined),
        supabaseService.resolveSingleActiveContext(sessionUserId),
        supabaseService.resolveAuthContexts(sessionUserId)
      ]);
      if (requestId !== bootRequestIdRef.current) return;

      console.info('[AUTH_CONTEXT] Contexto resolvido:', resolvedAuthCtx.accessKind, {
        activeBarbershopId: resolvedAuthCtx.activeBarbershopId,
        userContextsCount: resolvedAuthCtx.userContexts.length,
        singleContextKind: resolvedSingleCtx.kind
      });

      setAuthContext(resolvedAuthContexts);
      setAuthContextResult(resolvedAuthCtx);
      setUserContexts(resolvedAuthCtx.userContexts);
      setActiveContext(resolvedSingleCtx);
      setAuthenticatedUserId(sessionUserId);

      // Compatibilidade retroativa para onboardingState
      const onbState: OnboardingState = {
        userId: sessionUserId,
        isAuthenticated: true,
        hasProfile: !!resolvedAuthCtx.profile,
        profile: resolvedAuthCtx.profile,
        hasBarbershop: !!resolvedAuthCtx.activeBarbershop,
        barbershop: resolvedAuthCtx.activeBarbershop,
        hasOwnerMembership: resolvedAuthCtx.accessKind === 'owner_ready',
        isStaffMember: resolvedAuthCtx.accessKind === 'staff_ready',
        status: resolvedAuthCtx.accessKind === 'owner_needs_barbershop' 
          ? 'needs_barbershop' 
          : (resolvedAuthCtx.accessKind === 'no_membership' ? 'no_session' : 'complete'),
        isComplete: resolvedAuthCtx.accessKind === 'owner_ready' || resolvedAuthCtx.accessKind === 'admin_ready' || resolvedAuthCtx.accessKind === 'staff_ready',
        step: resolvedAuthCtx.accessKind === 'owner_needs_barbershop' ? 1 : 4,
        membership: resolvedAuthCtx.activeMembership,
        staffProfile: resolvedAuthCtx.staffProfile
      };
      setOnboardingState(onbState);

      // 4. Se o usuário tem múltiplos contextos, verificar se já há um selecionado explicitamente
      let effectiveSingleCtx = resolvedSingleCtx;
      if (resolvedSingleCtx.kind === 'multiple_contexts_not_supported' && selectedBarbershopIdRef.current) {
        const found = resolvedSingleCtx.contexts.find(c => c.barbershopId === selectedBarbershopIdRef.current);
        if (found) {
          effectiveSingleCtx = {
            kind: found.role,
            userId: sessionUserId,
            barbershopId: found.barbershopId,
            barbershopName: found.barbershopName,
            membershipRole: found.role,
            staffProfileId: found.staffProfileId
          };
          console.info('[BOOT] Contexto selecionado explicitamente adotado:', effectiveSingleCtx.barbershopId);
        }
      }

      // Bloqueios estritos: se o usuário precisa de onboarding, tem acesso revogado ou múltiplos contextos sem seleção:
      // NÃO carregar dados operacionais.
      if (effectiveSingleCtx.kind === 'needs_onboarding') {
        console.info('[BOOT] Usuário precisa criar barbearia ou sem memberships ativas');
        setActiveBarbershopId(null);
        setActiveMembershipRole(null);
        setActiveStaffProfileId(null);
        setActiveTenant(null);
        setAppointments([]);
        setStaff([]);
        setCustomers({});
        setServices(DEFAULT_SERVICES);
        setTransactions([]);
        setUserRole(null);
        setCurrentStaff(null);
        setBarbershop(null);
        setBarbershopMembers([]);
        setBarbershopInvites([]);
        if (resolvedAuthCtx.profile) {
          setBarberProfile(prev => ({ ...prev, ...resolvedAuthCtx.profile }));
        }
        return;
      }

      if (effectiveSingleCtx.kind === 'multiple_contexts_not_supported') {
        console.info('[BOOT] Múltiplas barbearias detectadas sem seleção prévia. Bloqueando dados até seleção de contexto.');
        setActiveBarbershopId(null);
        setActiveMembershipRole(null);
        setActiveStaffProfileId(null);
        setActiveTenant(null);
        setAppointments([]);
        setStaff([]);
        setCustomers({});
        setTransactions([]);
        setUserRole(null);
        setCurrentStaff(null);
        setBarbershop(null);
        setBarbershopMembers([]);
        setBarbershopInvites([]);
        if (resolvedAuthCtx.profile) {
          setBarberProfile(prev => ({ ...prev, ...resolvedAuthCtx.profile }));
        }
        return;
      }

      if (effectiveSingleCtx.kind === 'access_revoked') {
        console.warn('[BOOT] Usuário teve o acesso revogado à barbearia.');
        setActiveBarbershopId(null);
        setActiveMembershipRole(null);
        setActiveStaffProfileId(null);
        setActiveTenant(null);
        setAppointments([]);
        setStaff([]);
        setCustomers({});
        setTransactions([]);
        setUserRole(null);
        setCurrentStaff(null);
        setBarbershop(null);
        setBarbershopMembers([]);
        setBarbershopInvites([]);
        return;
      }

      // 5. Contexto ativo único resolvido com sucesso:
      const barbershopId = effectiveSingleCtx.barbershopId;
      if (!barbershopId) {
        console.warn('[BOOT] Contexto pronto mas barbershopId ausente');
        setActiveBarbershopId(null);
        setActiveMembershipRole(null);
        setActiveStaffProfileId(null);
        setActiveTenant(null);
        setAppointments([]);
        setStaff([]);
        setCustomers({});
        setTransactions([]);
        return;
      }

      // GUARDA OBRIGATÓRIA antes de cada carga operacional:
      if (!currentSession?.user?.id || !barbershopId) {
        return;
      }

      setActiveBarbershopId(barbershopId);
      setActiveMembershipRole(effectiveSingleCtx.membershipRole);
      setActiveStaffProfileId(effectiveSingleCtx.staffProfileId);

      const tenantInfo = {
        id: barbershopId,
        name: resolvedAuthCtx.activeBarbershop?.name || resolvedAuthCtx.profile?.shopName || 'Meu Corte',
        slug: resolvedAuthCtx.activeBarbershop?.slug || resolvedAuthCtx.profile?.slug || '',
        logo: resolvedAuthCtx.profile?.logo,
        businessPhone: resolvedAuthCtx.profile?.businessPhone,
        address: resolvedAuthCtx.profile?.address,
        instagram: resolvedAuthCtx.profile?.instagram,
        website: resolvedAuthCtx.profile?.website
      };
      setActiveTenant(tenantInfo);

      console.info('[STORE] Iniciando carregamento de dados principais para barbearia:', barbershopId);

      const [
        dbApts,
        dbCustomers,
        dbServices,
        dbUserProfile,
        dbShop,
        dbWeekly,
        dbBlocked,
        dbUnblocked,
        dbStaff
      ] = await Promise.all([
        supabaseService.getAppointments(barbershopId).catch(err => {
          console.warn('[STORE] Aviso ao buscar agendamentos:', err);
          return [];
        }),
        supabaseService.getCustomers(barbershopId).catch(err => {
          console.warn('[STORE] Aviso ao buscar clientes:', err);
          return [];
        }),
        supabaseService.getServices(barbershopId).catch(err => {
          console.warn('[STORE] Aviso ao buscar serviços:', err);
          return [];
        }),
        supabaseService.getUserProfile(sessionUserId).catch(err => {
          console.warn('[STORE] Aviso ao buscar perfil do usuário:', err);
          return null;
        }),
        supabaseService.getBarbershop(barbershopId).catch(err => {
          console.warn('[STORE] Aviso ao buscar dados da barbearia:', err);
          return null;
        }),
        supabaseService.getWeeklySchedule(barbershopId).catch(err => {
          console.warn('[STORE] Aviso ao buscar horários semanais:', err);
          return null;
        }),
        supabaseService.getBlockedSlots(barbershopId).catch(err => {
          console.warn('[STORE] Aviso ao buscar slots bloqueados:', err);
          return {};
        }),
        supabaseService.getUnblockedSlots(barbershopId).catch(err => {
          console.warn('[STORE] Aviso ao buscar slots desbloqueados:', err);
          return {};
        }),
        supabaseService.getStaff(barbershopId).catch(err => {
          console.warn('[STORE] Aviso ao buscar equipe:', err);
          return [];
        })
      ]);

      if (requestId !== bootRequestIdRef.current) return;

      setAppointments((dbApts || []).map(normalizeAppointment));
      if (dbCustomers) {
        const custMap: Record<string, Customer> = {};
        dbCustomers.forEach((c: any) => {
          const key = c.phoneNormalized || normalizePhone(c.phone);
          custMap[key] = {
            ...c,
            phoneNormalized: key,
            phone_normalized: key,
            photos: c.photos || c.customer_photos || []
          };
        });
        setCustomers(custMap);
      }

      const finalServices = dbServices && dbServices.length > 0 ? dbServices : DEFAULT_SERVICES;
      setServices(finalServices);
      
      const combinedProfile: BarberProfile = {
        name: dbUserProfile?.name || 'Barbeiro',
        personalPhone: dbUserProfile?.personalPhone || '',
        photo: dbUserProfile?.photo || '',
        shopName: dbShop?.name || 'Meu Corte',
        businessPhone: dbShop?.businessPhone || dbShop?.phone || '',
        address: dbShop?.address || '',
        logo: dbShop?.logo || '',
        description: dbShop?.description || '',
        instagram: dbShop?.instagram || '',
        website: dbShop?.website || '',
        slug: dbShop?.slug || ''
      };
      setBarberProfile(combinedProfile);
      if (dbShop) {
        setBarbershop(dbShop);
      }
      const baseWeeklySchedule: Record<number, DayConfig> = { ...DEFAULT_WEEKLY, ...(dbWeekly || {}) };
      setWeeklySchedule(baseWeeklySchedule);
      setBlockedSlots(dbBlocked || {});
      setUnblockedSlots(dbUnblocked || {});
      setStaff(dbStaff || []);

      let resolvedRole: 'admin_owner' | 'staff' | 'client' = 'staff';
      if (resolvedAuthCtx.accessKind === 'owner_ready' || resolvedAuthCtx.accessKind === 'admin_ready') {
        resolvedRole = 'admin_owner';
      } else if (resolvedAuthCtx.accessKind === 'staff_ready') {
        resolvedRole = 'staff';
      }

      setUserRole(resolvedRole);

      let activeStaffUser: Staff | null = null;
      if (dbStaff && dbStaff.length > 0) {
        activeStaffUser = dbStaff.find((s: any) => s.userId === sessionUserId || s.id === sessionUserId) || null;
      }
      if (!activeStaffUser && resolvedAuthCtx.staffProfile) {
        activeStaffUser = resolvedAuthCtx.staffProfile;
      }
      setCurrentStaff(activeStaffUser);
      if (resolvedRole === 'staff' && activeStaffUser?.id) {
        setSelectedStaffId(activeStaffUser.id);
      }

      if (activeStaffUser?.id) {
        try {
          const staffAvail = await supabaseService.getStaffAvailability(activeStaffUser.id);
          if (requestId === bootRequestIdRef.current && staffAvail && staffAvail.length > 0) {
            const mergedSchedule: Record<number, DayConfig> = { ...baseWeeklySchedule };
            staffAvail.forEach(item => {
              if (typeof item.dayOfWeek === 'number' && item.dayOfWeek >= 0 && item.dayOfWeek <= 6) {
                mergedSchedule[item.dayOfWeek] = {
                  start: normalizeTime(item.startTime),
                  end: normalizeTime(item.endTime),
                  isOpen: Boolean(item.isOpen),
                  breaks: Array.from(new Set((item.breaks || []).map(b => normalizeTime(b)).filter(Boolean)))
                };
              }
            });
            setWeeklySchedule(mergedSchedule);
          }
        } catch (availErr) {
          console.warn('[STORE] Aviso ao sincronizar disponibilidade individual no boot:', availErr);
        }
      }

      console.info('[STORE] Carregamento principal concluído');

      // Cargas não essenciais (notificações e barbershop metadata secundária)
      if (resolvedRole) {
        try {
          const dbNotifications = await supabaseService.getNotifications(barbershopId, resolvedRole, sessionUserId);
          if (requestId === bootRequestIdRef.current) setNotifications(dbNotifications);
        } catch (notifErr) {
          console.warn('[STORE] Aviso ao buscar notificações secundárias:', notifErr);
        }
      }

      try {
        const [bsResult, membersResult, invitesResult] = await Promise.allSettled([
          supabaseService.getBarbershop(barbershopId),
          supabaseService.getBarbershopMembers(barbershopId),
          supabaseService.getInvites(barbershopId)
        ]);
        if (requestId === bootRequestIdRef.current) {
          if (bsResult.status === 'fulfilled') setBarbershop(bsResult.value);
          else console.warn('[STORE] Aviso ao buscar barbearia secundária:', bsResult.reason);

          if (membersResult.status === 'fulfilled') setBarbershopMembers(membersResult.value);
          else console.warn('[STORE] Aviso ao buscar membros secundários:', membersResult.reason);

          if (invitesResult.status === 'fulfilled') setBarbershopInvites(invitesResult.value);
          else console.warn('[STORE] Aviso ao buscar convites secundários:', invitesResult.reason);
        }
      } catch (bsErr) {
        console.warn('[STORE] Aviso ao buscar dados secundários da barbearia:', bsErr);
      }
    } catch (error) {
      console.error('[ERROR] Falha na inicialização', error);
    } finally {
      if (requestId === bootRequestIdRef.current) {
        setIsLoading(false);
        if (isFirstLoad.current) {
          isFirstLoad.current = false;
          onReadyRef.current?.();
        }
        console.info('[SPLASH] Boot finalizado', {
          requestId,
          isLoading: false,
          hasSession: Boolean(currentSession)
        });
      }
    }
  }, [isPublicRoute, resetStore]);

  const loadData = useCallback(async () => {
    await bootstrapSession(sessionRef.current);
  }, [bootstrapSession]);

  const createBarbershop = useCallback(async (name: string, requestedSlug?: string, mode?: SetupMode): Promise<Barbershop> => {
    try {
      const bs = await supabaseService.createBarbershop(name, requestedSlug, mode);
      setBarbershop(bs);
      selectedBarbershopIdRef.current = bs.id;
      await bootstrapSession(sessionRef.current);
      return bs;
    } catch (err) {
      console.error('[createBarbershop] Error:', err);
      throw err;
    }
  }, [bootstrapSession]);

  const createInvite = useCallback(async (email: string, role: 'staff' | 'admin' = 'staff') => {
    try {
      await supabaseService.createInvite(email, role);
      await loadBarbershopData();
    } catch (err) {
      console.error('[createInvite] Error:', err);
      throw err;
    }
  }, [loadBarbershopData]);

  const acceptInvite = useCallback(async (token: string) => {
    try {
      await supabaseService.acceptInvite(token);
      await loadBarbershopData();
    } catch (err) {
      console.error('[acceptInvite] Error:', err);
      throw err;
    }
  }, [loadBarbershopData]);

  const loadFromLocalStorage = () => {
    const storedApts = localStorage.getItem(STORAGE_KEY_APTS);
    const storedCustomers = localStorage.getItem(STORAGE_KEY_CUSTOMERS);
    const storedBlocked = localStorage.getItem(STORAGE_KEY_BLOCKED);
    const storedUnblocked = localStorage.getItem(STORAGE_KEY_UNBLOCKED);
    const storedWeekly = localStorage.getItem(STORAGE_KEY_WEEKLY_V2);
    const storedServices = localStorage.getItem(STORAGE_KEY_SERVICES);
    const storedProfile = localStorage.getItem(STORAGE_KEY_PROFILE);
    
    if (storedApts) setAppointments(JSON.parse(storedApts));
    if (storedCustomers) setCustomers(JSON.parse(storedCustomers));
    if (storedBlocked) setBlockedSlots(JSON.parse(storedBlocked));
    if (storedUnblocked) setUnblockedSlots(JSON.parse(storedUnblocked));
    if (storedWeekly) setWeeklySchedule(JSON.parse(storedWeekly));
    if (storedServices) setServices(JSON.parse(storedServices));
    if (storedProfile) setBarberProfile(JSON.parse(storedProfile));
  };

  // Auth state listener & unified session bootstrap
  useEffect(() => {
    if (isPublicRoute) {
      setIsLoading(false);
      if (isFirstLoad.current) {
        isFirstLoad.current = false;
        onReadyRef.current?.();
      }
      return;
    }

    if (!isSupabaseConfigured()) {
      loadFromLocalStorage();
      setIsLoading(false);
      if (isFirstLoad.current) {
        isFirstLoad.current = false;
        onReadyRef.current?.();
      }
      return;
    }

    console.info('[AUTH] Iniciando getSession');

    // 1. Obter sessão inicial
    supabase.auth.getSession().then(({ data: { session: initialSession }, error }) => {
      if (error) {
        console.error('[AUTH] Erro ao buscar sessão inicial:', error);
      }
      console.info('[AUTH] Sessão resolvida', {
        hasSession: Boolean(initialSession),
        userId: initialSession?.user?.id ?? null
      });

      setSession(initialSession);
      sessionRef.current = initialSession;
      void bootstrapSession(initialSession);
    }).catch(err => {
      console.error('[AUTH] Falha inesperada no getSession:', err);
      setIsLoading(false);
      if (isFirstLoad.current) {
        isFirstLoad.current = false;
        onReadyRef.current?.();
      }
    });

    // 2. Listener de mudanças de auth
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, newSession) => {
      console.info('[AUTH] onAuthStateChange disparado:', event, {
        hasSession: Boolean(newSession),
        userId: newSession?.user?.id ?? null
      });

      if (event === 'INITIAL_SESSION') return;

      sessionRef.current = newSession;
      setSession(newSession);

      if (event === 'SIGNED_OUT' || !newSession) {
        resetStore();
        setIsLoading(false);
        if (isFirstLoad.current) {
          isFirstLoad.current = false;
          onReadyRef.current?.();
        }
        return;
      }

      void bootstrapSession(newSession);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [isPublicRoute, bootstrapSession, resetStore]);

  // Supabase Realtime Subscription
  useEffect(() => {
    if (!isSupabaseConfigured() || !session?.user?.id || !activeTenant?.id) return;

    let channel: any;
    let isCancelled = false;

    const barbershopId = activeTenant.id;
    if (!barbershopId) return;

    channel = supabase
      .channel(`appointments_${barbershopId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'appointments',
          filter: `barbershop_id=eq.${barbershopId}`
        },
        (payload) => {
          if (isCancelled) return;
          const { eventType, new: newRecord, old: oldRecord } = payload;

          if (eventType === 'INSERT' || eventType === 'UPDATE') {
            if (!newRecord.barbershop_id) {
              console.error(`[Realtime appointments] Registro recebido sem barbershop_id:`, newRecord.id);
              return;
            }
            const apt = {
              id: newRecord.id,
              tenantId: newRecord.barbershop_id,
              staffId: newRecord.staff_id ?? null,
              userId: newRecord.user_id,
              date: normalizeDate(newRecord.date),
              time: normalizeTime(newRecord.time),
              clientName: newRecord.client_name,
              phone: newRecord.phone,
              service: newRecord.service,
              price: Number(newRecord.price),
              duration: newRecord.duration,
              status: newRecord.status,
              observation: newRecord.observation,
              createdAt: new Date(newRecord.created_at).getTime()
            } as Appointment;
            
            setAppointments(prev => {
              const index = prev.findIndex(a => a.id === apt.id);
              
              if (index !== -1) {
                if (!apt.date || !apt.time || !apt.clientName) {
                  return prev;
                }
                const existing = prev[index];
                if (
                  existing.status === apt.status &&
                  existing.date === apt.date &&
                  existing.time === apt.time &&
                  existing.service === apt.service &&
                  existing.price === apt.price &&
                  existing.duration === apt.duration &&
                  existing.clientName === apt.clientName &&
                  existing.phone === apt.phone &&
                  existing.staffId === apt.staffId &&
                  existing.observation === apt.observation
                ) {
                  return prev;
                }
                const next = [...prev];
                next[index] = apt;
                return next;
              }

              if (eventType === 'INSERT') {
                if (!apt.date || !apt.time || !apt.clientName) {
                  return prev;
                }

                const isUUID = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
                const tempIndex = prev.findIndex(a => 
                  !isUUID(a.id) && 
                  a.date === apt.date && 
                  a.time === apt.time && 
                  a.clientName === apt.clientName
                );

                if (tempIndex !== -1) {
                  const next = [...prev];
                  next[tempIndex] = apt;
                  return next;
                }
                return [...prev, apt];
              }
              
              return prev;
            });
          } else if (eventType === 'DELETE') {
            setAppointments(prev => prev.filter(a => a.id !== oldRecord.id));
          }
        }
      )
      .subscribe();

    return () => {
      isCancelled = true;
      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  }, [session?.user?.id, activeTenant?.id]);

  // Sync to LocalStorage (Cache) - Apenas se NÃO estiver logado como barbeiro
  useEffect(() => {
    const syncLocal = async () => {
      if (isLoading) return;
      
      const currentSession = sessionRef.current;

      // Se o Supabase estiver configurado, não usamos LocalStorage para dados de negócio
      if (!isSupabaseConfigured()) {
        localStorage.setItem(STORAGE_KEY_APTS, JSON.stringify(appointments));
        localStorage.setItem(STORAGE_KEY_CUSTOMERS, JSON.stringify(customers));
        localStorage.setItem(STORAGE_KEY_BLOCKED, JSON.stringify(blockedSlots));
        localStorage.setItem(STORAGE_KEY_UNBLOCKED, JSON.stringify(unblockedSlots));
        localStorage.setItem(STORAGE_KEY_WEEKLY_V2, JSON.stringify(weeklySchedule));
        localStorage.setItem(STORAGE_KEY_SERVICES, JSON.stringify(services));
        localStorage.setItem(STORAGE_KEY_PROFILE, JSON.stringify(barberProfile));
      }
    };
    
    syncLocal();
  }, [appointments, customers, blockedSlots, unblockedSlots, weeklySchedule, services, barberProfile, isLoading]);

  const loadTransactions = async (startDate: string, endDate: string) => {
    const currentSession = sessionRef.current;
    const barbershopId = activeTenant?.id;
    if (!currentSession?.user?.id || !barbershopId) {
      return;
    }
    
    const ctx = await supabaseService.resolveTenantContext(currentSession.user.id);
    if (!ctx.barbershopId) {
      console.warn('[loadTransactions] barbershop_id não encontrado para o usuário:', currentSession.user.id);
      return;
    }

    let query = supabase
      .from('transactions')
      .select('*')
      .eq('barbershop_id', barbershopId)
      .gte('date', `${startDate}T00:00:00`)
      .lte('date', `${endDate}T23:59:59`);

    // Regra de leitura: Staff consulta apenas a própria produção
    if (ctx.role === 'staff') {
      if (ctx.staffProfileId) {
        query = query.eq('staff_id', ctx.staffProfileId);
      } else {
        // Staff sem perfil vinculado não deve acessar transações globais
        setTransactions([]);
        return;
      }
    }

    const { data, error } = await query.order('date', { ascending: false });
    if (error) {
      console.error('[loadTransactions] Erro ao carregar transações:', error);
      throw error;
    }

    if (data) {
      setTransactions(data.map((t: any) => ({
        id: t.id,
        tenantId: t.barbershop_id,
        type: t.type,
        amount: Number(t.amount),
        description: t.description,
        category: t.category,
        date: t.date,
        staffId: t.staff_id || undefined,
        linkedAppointmentId: t.linked_appointment_id,
        paymentMethod: t.payment_method,
        createdAt: new Date(t.created_at).getTime(),
      })));
    }
  };

  const addTransaction = async (t: Omit<Transaction, 'id' | 'createdAt'>): Promise<AppointmentTransactionResult | void> => {
    const currentSession = sessionRef.current;
    if (!currentSession) {
      throw new Error("Usuário não autenticado.");
    }

    if (userRole === 'client') {
      throw new Error("Não autorizado. Apenas administradores e colaboradores podem gerenciar transações.");
    }
    
    const currentUserId = currentSession.user.id;
    const barbershopId = activeTenant?.id;
    if (!currentUserId || !barbershopId) {
      throw new Error("Identificador da barbearia (barbershop_id) não encontrado.");
    }
    const ctx = await supabaseService.resolveTenantContext(currentUserId);
    if (!ctx.barbershopId) {
      throw new Error("Identificador da barbearia (barbershop_id) não encontrado.");
    }

    const tenantOwnerId = ctx.tenantOwnerId || barbershopId;

    // Resolução de staff_id: Se o usuário logado for staff, o staff_id deve ser o seu próprio profile
    let effectiveStaffId: string | null = t.staffId ?? null;
    if (ctx.role === 'staff' && ctx.staffProfileId) {
      effectiveStaffId = ctx.staffProfileId;
    }

    // Se for transação vinculada a agendamento, verificar idempotência no banco antes de inserir
    if (t.linkedAppointmentId) {
      const { data: existingTx, error: checkErr } = await supabase
        .from('transactions')
        .select('*')
        .eq('barbershop_id', barbershopId)
        .eq('linked_appointment_id', t.linkedAppointmentId)
        .maybeSingle();

      if (checkErr) {
        console.error('[ADD_TRANSACTION] Erro ao verificar transação existente:', checkErr);
        throw checkErr;
      }

      if (existingTx) {
        // Já existe transação registrada para este agendamento; sincronizar e retornar
        const formattedTx: Transaction = {
          id: existingTx.id,
          tenantId: existingTx.barbershop_id,
          staffId: existingTx.staff_id || undefined,
          type: existingTx.type,
          amount: Number(existingTx.amount),
          description: existingTx.description,
          category: existingTx.category,
          date: existingTx.date,
          linkedAppointmentId: existingTx.linked_appointment_id,
          paymentMethod: existingTx.payment_method,
          createdAt: new Date(existingTx.created_at).getTime()
        };

        setTransactions(prev => {
          const exists = prev.some(item => item.id === formattedTx.id);
          if (exists) {
            return prev.map(item => item.id === formattedTx.id ? formattedTx : item);
          }
          return [formattedTx, ...prev];
        });

        return { transaction: formattedTx, alreadyExisted: true };
      }
    }

    const insertPayload: any = {
      barbershop_id: barbershopId,
      staff_id: effectiveStaffId,
      user_id: tenantOwnerId,
      created_by: currentUserId,
      type: t.type,
      amount: t.amount,
      description: t.description ?? null,
      category: t.category,
      date: typeof t.date === 'string' ? t.date.substring(0, 10) : t.date,
      linked_appointment_id: t.linkedAppointmentId ?? null,
      payment_method: t.paymentMethod ?? null,
    };

    try {
      const { data, error } = await supabase
        .from('transactions')
        .insert(insertPayload)
        .select()
        .single();

      if (error) {
        if (t.linkedAppointmentId && isDuplicateLinkedAppointmentTransactionError(error)) {
          const { data: existingTx, error: fetchErr } = await supabase
            .from('transactions')
            .select('*')
            .eq('barbershop_id', barbershopId)
            .eq('linked_appointment_id', t.linkedAppointmentId)
            .maybeSingle();

          if (fetchErr) {
            console.error('[ADD_TRANSACTION] Erro ao consultar transação existente após 23505:', fetchErr);
            throw fetchErr;
          }

          if (!existingTx) {
            throw error;
          }

          const formattedTx: Transaction = {
            id: existingTx.id,
            tenantId: existingTx.barbershop_id,
            staffId: existingTx.staff_id || undefined,
            type: existingTx.type,
            amount: Number(existingTx.amount),
            description: existingTx.description,
            category: existingTx.category,
            date: existingTx.date,
            linkedAppointmentId: existingTx.linked_appointment_id,
            paymentMethod: existingTx.payment_method,
            createdAt: new Date(existingTx.created_at).getTime()
          };

          setTransactions(prev => {
            const exists = prev.some(item => item.id === formattedTx.id);
            if (exists) {
              return prev.map(item => item.id === formattedTx.id ? formattedTx : item);
            }
            return [formattedTx, ...prev];
          });

          return { transaction: formattedTx, alreadyExisted: true };
        }

        console.error('[ADD_TRANSACTION] Erro ao salvar no Supabase:', error);
        throw error;
      }

      if (data) {
        const formattedTx: Transaction = {
          id: data.id,
          tenantId: data.barbershop_id,
          staffId: data.staff_id || undefined,
          type: data.type,
          amount: Number(data.amount),
          description: data.description,
          category: data.category,
          date: data.date,
          linkedAppointmentId: data.linked_appointment_id,
          paymentMethod: data.payment_method,
          createdAt: new Date(data.created_at).getTime()
        };

        setTransactions(prev => {
          const exists = prev.some(item => item.id === formattedTx.id);
          if (exists) {
            return prev.map(item => item.id === formattedTx.id ? formattedTx : item);
          }
          return [formattedTx, ...prev];
        });

        return { transaction: formattedTx, alreadyExisted: false };
      }
    } catch (error) {
      if (t.linkedAppointmentId && isDuplicateLinkedAppointmentTransactionError(error)) {
        const { data: existingTx, error: fetchErr } = await supabase
          .from('transactions')
          .select('*')
          .eq('barbershop_id', barbershopId)
          .eq('linked_appointment_id', t.linkedAppointmentId)
          .maybeSingle();

        if (fetchErr) {
          throw fetchErr;
        }

        if (!existingTx) {
          throw error;
        }

        const formattedTx: Transaction = {
          id: existingTx.id,
          tenantId: existingTx.barbershop_id,
          staffId: existingTx.staff_id || undefined,
          type: existingTx.type,
          amount: Number(existingTx.amount),
          description: existingTx.description,
          category: existingTx.category,
          date: existingTx.date,
          linkedAppointmentId: existingTx.linked_appointment_id,
          paymentMethod: existingTx.payment_method,
          createdAt: new Date(existingTx.created_at).getTime()
        };

        setTransactions(prev => {
          const exists = prev.some(item => item.id === formattedTx.id);
          if (exists) {
            return prev.map(item => item.id === formattedTx.id ? formattedTx : item);
          }
          return [formattedTx, ...prev];
        });

        return { transaction: formattedTx, alreadyExisted: true };
      }

      throw error;
    }
  };

  const deleteTransaction = async (id: string) => {
    const currentSession = sessionRef.current;
    if (!currentSession) {
      throw new Error("Usuário não autenticado.");
    }
    
    if (userRole === 'client') {
      throw new Error("Não autorizado. Apenas administradores e colaboradores podem excluir transações.");
    }

    const currentUserId = currentSession.user.id;
    const barbershopId = activeTenant?.id;
    if (!currentUserId || !barbershopId) {
      throw new Error("Identificador da barbearia (barbershop_id) não encontrado.");
    }
    const ctx = await supabaseService.resolveTenantContext(currentUserId);
    if (!ctx.barbershopId) {
      throw new Error("Identificador da barbearia (barbershop_id) não encontrado.");
    }

    let query = supabase
      .from('transactions')
      .delete()
      .eq('id', id)
      .eq('barbershop_id', barbershopId);

    // Se for staff, só pode excluir se for do seu próprio staff_id
    if (ctx.role === 'staff') {
      if (!ctx.staffProfileId) {
        throw new Error("Perfil de colaborador não localizado para realizar a exclusão.");
      }
      query = query.eq('staff_id', ctx.staffProfileId);
    }

    const { error } = await query;
    if (error) {
      console.error('[DELETE_TRANSACTION] Erro ao excluir no Supabase:', error);
      throw error;
    }

    setTransactions(state => state.filter(t => t.id !== id));
  };

  const addNotification = useCallback(async (n: Omit<AppNotification, 'id' | 'createdAt' | 'read'>) => {
    const resolvedTenantId = n.tenantId || activeBarbershopId || activeTenant?.id || '';
    if (!resolvedTenantId) return;

    try {
      if (isSupabaseConfigured()) {
        await supabaseService.addNotification({
          tenantId: resolvedTenantId,
          staffId: n.staffId || null,
          title: n.title,
          message: n.message,
          type: n.type,
          meta: n.meta,
          priority: n.priority,
          expiresAt: n.expiresAt,
          groupKey: n.groupKey,
        });
        
        const currentSession = sessionRef.current;
        const resolvedRole = userRole || 'client';
        if (resolvedRole !== 'client') {
          const dbNotifications = await supabaseService.getNotifications(resolvedTenantId, resolvedRole, currentSession?.user?.id);
          setNotifications(dbNotifications);
        }
      } else {
        const localKey = `meucorte_notifications_${resolvedTenantId}`;
        const stored = localStorage.getItem(localKey) || '[]';
        const all: AppNotification[] = JSON.parse(stored);


        if (n.groupKey) {
          const existingGroup = all.find(x => x.groupKey === n.groupKey && !x.read && (x.staffId === n.staffId || (!x.staffId && !n.staffId)));
          if (existingGroup) {
            existingGroup.groupCount = (existingGroup.groupCount || 1) + 1;
            existingGroup.createdAt = Date.now();
            existingGroup.meta = { ...existingGroup.meta, ...n.meta, lastGroupUpdate: Date.now() };
            localStorage.setItem(localKey, JSON.stringify(all));
            setNotifications([...all]);
            return;
          }
        }

        const newNotif: AppNotification = {
          id: crypto.randomUUID(),
          tenantId: resolvedTenantId,
          staffId: n.staffId || null,
          title: n.title,
          message: n.message,
          type: n.type,
          read: false,
          createdAt: Date.now(),
          priority: n.priority || 'medium',
          expiresAt: n.expiresAt,
          groupKey: n.groupKey,
          groupCount: 1,
          meta: n.meta
        };
        all.unshift(newNotif);
        localStorage.setItem(localKey, JSON.stringify(all));
        
        setNotifications(prev => {
          

          if (n.groupKey) {
            const groupIndex = prev.findIndex(x => x.groupKey === n.groupKey && !x.read && (x.staffId === n.staffId || (!x.staffId && !n.staffId)));
            if (groupIndex !== -1) {
              const newPrev = [...prev];
              newPrev[groupIndex] = {
                ...newPrev[groupIndex],
                groupCount: (newPrev[groupIndex].groupCount || 1) + 1,
                createdAt: Date.now(),
                meta: { ...newPrev[groupIndex].meta, ...n.meta, lastGroupUpdate: Date.now() }
              };
              return newPrev;
            }
          }

          return [newNotif, ...prev];
        });
      }
    } catch (e) {
      console.error('Erro ao adicionar notificação no Store:', e);
    }
  }, [activeTenant, activeBarbershopId, userRole]);

  const markNotificationAsRead = useCallback(async (id: string) => {
    const resolvedTenantId = activeBarbershopId || activeTenant?.id || '';
    if (!resolvedTenantId) return;

    try {
      if (isSupabaseConfigured()) {
        await supabaseService.markNotificationAsRead(id, resolvedTenantId);
        setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
      } else {
        const localKey = `meucorte_notifications_${resolvedTenantId}`;
        const stored = localStorage.getItem(localKey);
        if (stored) {
          const all = JSON.parse(stored);
          const updated = all.map((n: any) => n.id === id ? { ...n, read: true } : n);
          localStorage.setItem(localKey, JSON.stringify(updated));
          setNotifications(updated);
        }
      }
    } catch (e) {
      console.error('Erro ao marcar notificação como lida no Store:', e);
    }
  }, [activeTenant, activeBarbershopId]);

  const markAllNotificationsAsRead = useCallback(async () => {
    const resolvedTenantId = activeBarbershopId || activeTenant?.id || '';
    if (!resolvedTenantId) return;

    try {
      const currentSession = sessionRef.current;
      const resolvedRole = userRole || 'client';
      if (isSupabaseConfigured()) {
        await supabaseService.markAllNotificationsAsRead(resolvedTenantId, resolvedRole, currentSession?.user?.id);
        setNotifications(prev => prev.map(n => ({ ...n, read: true })));
      } else {
        const localKey = `meucorte_notifications_${resolvedTenantId}`;
        const stored = localStorage.getItem(localKey);
        if (stored) {
          const all = JSON.parse(stored);
          const updated = all.map((n: any) => ({ ...n, read: true }));
          localStorage.setItem(localKey, JSON.stringify(updated));
          setNotifications(updated);
        }
      }
    } catch (e) {
      console.error('Erro ao marcar todas notificações como lidas no Store:', e);
    }
  }, [activeTenant, activeBarbershopId, userRole]);

  const deleteNotification = useCallback(async (id: string) => {
    const resolvedTenantId = activeBarbershopId || activeTenant?.id || '';
    if (!resolvedTenantId) return;

    try {
      if (isSupabaseConfigured()) {
        await supabaseService.deleteNotification(id, resolvedTenantId);
        setNotifications(prev => prev.filter(n => n.id !== id));
      } else {
        const localKey = `meucorte_notifications_${resolvedTenantId}`;
        const stored = localStorage.getItem(localKey);
        if (stored) {
          const all = JSON.parse(stored);
          const updated = all.filter((n: any) => n.id !== id);
          localStorage.setItem(localKey, JSON.stringify(updated));
          setNotifications(updated);
        }
      }
    } catch (e) {
      console.error('Erro ao deletar notificação no Store:', e);
    }
  }, [activeTenant, activeBarbershopId]);

  const addAppointment = useCallback(async (apt: Appointment, isExceptional?: boolean, serviceIds?: string[]): Promise<Appointment> => {
    const isUuid = (value: string) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

    // 1. Time normalization
    const normalizedTimeValue = normalizeTime(apt.time);
    if (!normalizedTimeValue) {
      throw new Error("Horário inválido");
    }

    // 2. Exceptional handling
    let finalObservation = apt.observation || '';
    if (isExceptional && !finalObservation.startsWith('[EXCEPCIONAL]')) {
      finalObservation = `[EXCEPCIONAL] ${finalObservation}`.trim();
    }

    const resolvedTenantId = apt.tenantId || activeBarbershopId || activeTenant?.id || '';
    const currentUserId = sessionRef.current?.user?.id;
    
    const isAdmin = userRole === 'admin_owner' || userRole === 'admin';
    const isStaff = userRole === 'staff';
    const effectiveStaffId = isAdmin 
      ? (apt.staffId || currentStaff?.id || staff[0]?.id || '') 
      : (currentStaff?.id || staff.find(s => s.userId === currentUserId || s.id === currentUserId)?.id || '');

    if (!resolvedTenantId || !isUuid(resolvedTenantId)) {
      console.error("[addAppointment] barbershop_id não encontrado ou inválido:", resolvedTenantId);
      throw new Error("Identificador da barbearia inválido ou não encontrado.");
    }

    if (!effectiveStaffId) {
      console.error("[addAppointment] staff_id não encontrado.");
      throw new Error("Profissional não identificado.");
    }

    const targetStaff = staff.find(s => s.id === effectiveStaffId || s.userId === effectiveStaffId);
    if (!targetStaff) {
      console.error("[addAppointment] Profissional não pertence à barbearia ativa:", effectiveStaffId);
      throw new Error("Profissional não pertence a esta barbearia.");
    }
    if (targetStaff.status === 'inactive') {
      console.warn("[addAppointment] Tentativa de agendamento para profissional inativo:", effectiveStaffId);
      throw new Error("Não é possível realizar agendamentos para um profissional inativo.");
    }

    const finalApt: Appointment = {
      ...apt,
      time: normalizedTimeValue,
      observation: finalObservation,
      tenantId: resolvedTenantId,
      staffId: effectiveStaffId,
      userId: currentUserId || '',
      isExceptional: !!isExceptional || !!apt.isExceptional
    };

    // 3. Conflict validation (strictly scoped by staffId)
    const isConflict = appointmentsRef.current.some(a => 
      a.date === finalApt.date && 
      a.time === finalApt.time && 
      a.staffId === finalApt.staffId &&
      a.status !== 'cancelled' &&
      a.status !== 'no-show' &&
      a.id !== finalApt.id
    );

    if (isConflict) {
      throw new Error("Este horário já está ocupado por outro agendamento.");
    }

    let savedApt: Appointment;

    if (isStaff) {
      // Para staff: criação EXCLUSIVA via RPC create_my_appointment no backend
      let targetServiceIds: string[] = (serviceIds || []).filter(isUuid);
      if (targetServiceIds.length === 0) {
        const aptServiceNames = (apt.service || '').split('+').map(s => s.trim().toLowerCase());
        targetServiceIds = services
          .filter(s => aptServiceNames.some(name => s.name.toLowerCase().includes(name) || name.includes(s.name.toLowerCase())))
          .map(s => s.id)
          .filter(isUuid);
      }

      if (targetServiceIds.length === 0) {
        const validServices = services.map(s => s.id).filter(isUuid);
        if (validServices.length > 0) {
          targetServiceIds = [validServices[0]];
        }
      }

      if (targetServiceIds.length === 0 && resolvedTenantId) {
        try {
          const remoteServices = await supabaseService.getServices(resolvedTenantId);
          const validRemote = (remoteServices || []).map(s => s.id).filter(isUuid);
          if (validRemote.length > 0) {
            targetServiceIds = [validRemote[0]];
            setServices(remoteServices);
          }
        } catch (srvErr) {
          console.warn('[addAppointment] Aviso ao carregar serviços remotos:', srvErr);
        }
      }

      if (targetServiceIds.length === 0) {
        throw new Error("Nenhum serviço válido identificado. Cadastre ao menos um serviço para a barbearia.");
      }

      savedApt = await supabaseService.createMyAppointment({
        barbershopId: resolvedTenantId,
        clientName: finalApt.clientName,
        clientPhone: finalApt.phone,
        serviceIds: targetServiceIds,
        date: finalApt.date,
        time: finalApt.time,
        observation: finalObservation
      });
    } else {
      // Para admin / owner
      savedApt = await supabaseService.saveAppointment(finalApt, resolvedTenantId);
    }

    if (!savedApt?.id || !isUuid(savedApt.id)) {
      throw new Error("O servidor retornou um agendamento com identificador inválido.");
    }

    const normalizedSavedApt = normalizeAppointment(savedApt);

    // 4. Atualizar agenda e clientes SOMENTE APÓS persistência confirmada pelo Supabase
    setAppointments(prev => {
      const exists = prev.some(a => a.id === normalizedSavedApt.id);
      if (exists) {
        return prev.map(a => a.id === normalizedSavedApt.id ? normalizedSavedApt : a);
      }
      return [...prev, normalizedSavedApt];
    });

    const normalizedPhone = normalizePhone(normalizedSavedApt.phone);
    setCustomers(prev => {
      const existing = prev[normalizedPhone];
      if (existing) return { ...prev, [normalizedPhone]: { ...existing, name: normalizedSavedApt.clientName, phone: normalizedSavedApt.phone } };
      return {
        ...prev,
        [normalizedPhone]: { phone: normalizedSavedApt.phone, name: normalizedSavedApt.clientName, cutCount: 0, history: [], photos: [] }
      };
    });

    // Mark this date to skip the next fetch to avoid race conditions
    skipNextFetchRef.current[normalizedSavedApt.date] = true;

    // Optional: Add to unblocked_slots for consistency if exceptional
    if (isExceptional) {
      setUnblockedSlots(prev => {
        const dateSlots = prev[normalizedSavedApt.date] || [];
        if (!dateSlots.includes(normalizedSavedApt.time)) {
          const next = { ...prev, [normalizedSavedApt.date]: [...dateSlots, normalizedSavedApt.time] };
          if (isSupabaseConfigured()) {
            supabaseService.saveUnblockedSlot(normalizedSavedApt.date, normalizedSavedApt.time, true).catch(console.error);
          }
          return next;
        }
        return prev;
      });
    }

    // Criar notificações operacionais automáticas com o UUID persistido
    const createAptNotifications = async () => {
      try {
        const staffName = staff.find(s => s.id === normalizedSavedApt.staffId)?.name || 'Profissional';
        const formattedDate = normalizedSavedApt.date.split('-').reverse().join('/');
        
        await addNotification({
          tenantId: resolvedTenantId,
          staffId: normalizedSavedApt.staffId !== resolvedTenantId ? normalizedSavedApt.staffId : null,
          title: 'Agendamento Confirmado',
          message: `O agendamento de ${normalizedSavedApt.clientName} para o serviço de ${normalizedSavedApt.service} no dia ${formattedDate} às ${normalizedSavedApt.time} com ${staffName} foi confirmado.`,
          type: 'appointment_confirmed',
          priority: 'medium',
          groupKey: 'appointment_confirmed',
          expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).getTime(),
          meta: {
            appointmentId: normalizedSavedApt.id,
            clientPhone: normalizedSavedApt.phone,
            price: normalizedSavedApt.price,
            date: normalizedSavedApt.date,
            time: normalizedSavedApt.time
          }
        });

        if (normalizedSavedApt.staffId && normalizedSavedApt.staffId !== resolvedTenantId) {
          await addNotification({
            tenantId: resolvedTenantId,
            staffId: null, // direcional ao admin
            title: 'Novo Agendamento Criado',
            message: `Novo agendamento de ${normalizedSavedApt.clientName} com o profissional ${staffName} para ${normalizedSavedApt.service} no dia ${formattedDate} às ${normalizedSavedApt.time}.`,
            type: 'appointment_created',
            priority: 'medium',
            groupKey: 'appointment_created',
            expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).getTime(),
            meta: {
              appointmentId: normalizedSavedApt.id,
              clientPhone: normalizedSavedApt.phone,
              price: normalizedSavedApt.price,
              date: normalizedSavedApt.date,
              time: normalizedSavedApt.time
            }
          });
        }
      } catch (err) {
        console.error('Erro ao disparar notificações de criação de agendamento:', err);
      }
    };
    createAptNotifications();

    return normalizedSavedApt;
  }, [activeBarbershopId, staff, services, userRole, addNotification, activeTenant]);

  const updateAppointment = useCallback(async (id: string, updates: Partial<Appointment>) => {
    let updatedApt: Appointment | undefined;
    
    setAppointments(prev => {
      const updated = prev.map(apt => {
        if (apt.id === id) {
          updatedApt = { ...apt, ...updates };
          return updatedApt;
        }
        return apt;
      });
      return updated;
    });

    if (updatedApt) {
      try {
        const currentSession = sessionRef.current;
        if (currentSession) {
          const savedApt = await supabaseService.saveAppointment(updatedApt);
          const normalizedSavedApt = normalizeAppointment(savedApt);
          // Ensure local state has the correct ID (though for update it should already match)
          if (normalizedSavedApt.id !== id) {
             setAppointments(prev => prev.map(a => a.id === id ? normalizedSavedApt : a));
          }
        }
      } catch (e) {
        console.error("Supabase sync error", e);
      }
    }
  }, []);

  const finishAppointment = useCallback(async (id: string) => {
    const isUuid = (value: string) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

    if (!id || !isUuid(id)) {
      throw new Error(
        'Este agendamento ainda não foi sincronizado com o servidor. Atualize a agenda e tente novamente.'
      );
    }

    if (finishingRef.current.has(id)) return;
    finishingRef.current.add(id);

    try {
      const apt = appointmentsRef.current.find(a => a.id === id);
      if (!apt) {
        throw new Error('Agendamento não encontrado na agenda.');
      }

      // Se o agendamento já estiver completed no banco/estado, sincronizar transação e retornar
      if (apt.status === 'completed') {
        const barbershopId = activeTenant?.id || activeBarbershopId;
        if (barbershopId) {
          const { data: existingTx } = await supabase
            .from('transactions')
            .select('*')
            .eq('barbershop_id', barbershopId)
            .eq('linked_appointment_id', id)
            .maybeSingle();

          if (existingTx) {
            const formattedTx: Transaction = {
              id: existingTx.id,
              tenantId: existingTx.barbershop_id,
              staffId: existingTx.staff_id || undefined,
              type: existingTx.type,
              amount: Number(existingTx.amount),
              description: existingTx.description,
              category: existingTx.category,
              date: existingTx.date,
              linkedAppointmentId: existingTx.linked_appointment_id,
              paymentMethod: existingTx.payment_method,
              createdAt: new Date(existingTx.created_at).getTime()
            };

            setTransactions(prev => {
              const exists = prev.some(item => item.id === formattedTx.id || item.linkedAppointmentId === id);
              if (exists) {
                return prev.map(item => (item.id === formattedTx.id || item.linkedAppointmentId === id) ? formattedTx : item);
              }
              return [formattedTx, ...prev];
            });
          }
        }
        return;
      }

      const previousStatus = apt.status;

      // 1. Atualização otimista imediata para evitar flicker na UI
      setAppointments(prevApts => 
        prevApts.map(a => a.id === id ? { ...a, status: 'completed' } : a)
      );

      // Chamada à RPC segura e idempotente no Supabase
      let res;
      try {
        res = await supabaseService.completeMyAppointment(id);
      } catch (rpcErr) {
        setAppointments(prevApts => 
          prevApts.map(a => a.id === id ? { ...a, status: previousStatus } : a)
        );
        throw rpcErr;
      }
      const completedApt = res.appointment;

      if (completedApt) {
        setAppointments(prevApts => 
          prevApts.map(a => a.id === id ? { ...a, ...completedApt, status: 'completed' } : a)
        );
      }

      // 2. Atualizar contadores do cliente localmente
      const normalizedPhone = normalizePhone(apt.phone);
      setCustomers(prevCusts => {
        const customer = prevCusts[normalizedPhone] || { phone: apt.phone, name: apt.clientName, cutCount: 0, history: [], photos: [] };
        return {
          ...prevCusts,
          [normalizedPhone]: {
            ...customer,
            cutCount: (customer.cutCount || 0) + 1,
            history: [{ date: apt.date, time: apt.time, service: apt.service, price: apt.price }, ...(customer.history || [])]
          }
        };
      });

      // 3. Atualizar transação financeira retornada pela RPC (ou consultar no banco)
      if (res.transaction) {
        const formattedTx: Transaction = res.transaction;
        setTransactions(prev => {
          const exists = prev.some(item => item.id === formattedTx.id || item.linkedAppointmentId === id);
          if (exists) {
            return prev.map(item => (item.id === formattedTx.id || item.linkedAppointmentId === id) ? formattedTx : item);
          }
          return [formattedTx, ...prev];
        });
      } else {
        const barbershopId = activeTenant?.id || activeBarbershopId;
        if (barbershopId) {
          const { data: existingTx } = await supabase
            .from('transactions')
            .select('*')
            .eq('barbershop_id', barbershopId)
            .eq('linked_appointment_id', id)
            .maybeSingle();

          if (existingTx) {
            const formattedTx: Transaction = {
              id: existingTx.id,
              tenantId: existingTx.barbershop_id,
              staffId: existingTx.staff_id || undefined,
              type: existingTx.type,
              amount: Number(existingTx.amount),
              description: existingTx.description,
              category: existingTx.category,
              date: existingTx.date,
              linkedAppointmentId: existingTx.linked_appointment_id,
              paymentMethod: existingTx.payment_method,
              createdAt: new Date(existingTx.created_at).getTime()
            };

            setTransactions(prev => {
              const exists = prev.some(item => item.id === formattedTx.id || item.linkedAppointmentId === id);
              if (exists) {
                return prev.map(item => (item.id === formattedTx.id || item.linkedAppointmentId === id) ? formattedTx : item);
              }
              return [formattedTx, ...prev];
            });
          }
        }
      }
    } catch (err: any) {
      console.error('[finishAppointment] Erro ao finalizar agendamento:', err);
      // Não muda status local para completed
      // Não cria transaction local
      // Não atualiza financeiro
      throw err;
    } finally {
      finishingRef.current.delete(id);
    }
  }, [activeTenant?.id, activeBarbershopId]);

  const markNoShow = useCallback(async (id: string) => {
    const isUuid = (value: string) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

    if (!id || !isUuid(id)) {
      throw new Error('Este agendamento ainda não foi sincronizado com o servidor. Atualize a agenda e tente novamente.');
    }

    const apt = appointmentsRef.current.find(a => a.id === id);
    if (!apt || apt.status !== 'pending') return;

    const previousStatus = apt.status;

    setAppointments(prevApts => 
      prevApts.map(a => a.id === id ? { ...a, status: 'no-show' } : a)
    );

    try {
      await supabaseService.markAppointmentNoShow(id);

      const normalizedPhone = normalizePhone(apt.phone);
      setCustomers(prevCusts => {
        const customer = prevCusts[normalizedPhone] || { phone: apt.phone, name: apt.clientName, cutCount: 0, noShowCount: 0, history: [], photos: [] };
        return {
          ...prevCusts,
          [normalizedPhone]: {
            ...customer,
            noShowCount: (customer.noShowCount || 0) + 1,
            history: [{ date: apt.date, time: apt.time, service: 'Falta registrada', price: 0 }, ...(customer.history || [])]
          }
        };
      });

      // Disparar notificações automáticas
      const resolvedTenantId = apt.tenantId || activeBarbershopId || activeTenant?.id || '';
      if (resolvedTenantId) {
        const formattedDate = apt.date.split('-').reverse().join('/');
        addNotification({
          tenantId: resolvedTenantId,
          staffId: apt.staffId !== resolvedTenantId ? apt.staffId : null,
          title: 'Falta Registrada (No-Show)',
          message: `O cliente ${apt.clientName} não compareceu ao agendamento de ${apt.service} no dia ${formattedDate} às ${apt.time}.`,
          type: 'no_show_alert',
          priority: 'high',
          groupKey: 'no_show',
          expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).getTime(),
          meta: {
            appointmentId: apt.id,
            clientPhone: apt.phone,
            date: apt.date,
            time: apt.time
          }
        }).catch(console.error);

        if (apt.staffId && apt.staffId !== resolvedTenantId) {
          addNotification({
            tenantId: resolvedTenantId,
            staffId: null,
            title: 'Falta Registrada (No-Show)',
            message: `Falta registrada para o cliente ${apt.clientName} no dia ${formattedDate} às ${apt.time} (Atendimento com colaborador).`,
            type: 'no_show_alert',
            priority: 'high',
            groupKey: 'no_show',
            expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).getTime(),
            meta: {
              appointmentId: apt.id,
              clientPhone: apt.phone,
              date: apt.date,
              time: apt.time
            }
          }).catch(console.error);
        }
      }
    } catch (err) {
      setAppointments(prevApts => 
        prevApts.map(a => a.id === id ? { ...a, status: previousStatus } : a)
      );
      console.error('[markNoShow] Erro ao registrar no-show:', err);
      throw err;
    }
  }, [activeBarbershopId, activeTenant, addNotification]);

  const revertAppointment = useCallback(async (id: string) => {
    const isUuid = (value: string) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

    if (!id || !isUuid(id)) {
      throw new Error('Este agendamento ainda não foi sincronizado com o servidor. Atualize a agenda e tente novamente.');
    }

    const apt = appointmentsRef.current.find(a => a.id === id);
    if (!apt || apt.status === 'pending') return;
    const currentStatus = apt.status;

    setAppointments(prevApts => 
      prevApts.map(a => a.id === id ? { ...a, status: 'pending' } : a)
    );

    try {
      await supabaseService.revertAppointment(id);

      const normalizedPhone = normalizePhone(apt.phone);
      setCustomers(prevCusts => {
        const customer = prevCusts[normalizedPhone];
        if (!customer) return prevCusts;
        
        const historySearchService = currentStatus === 'no-show' 
          ? 'Falta registrada' 
          : apt.service;
          
        const historyIndex = customer.history.findIndex(h => h.date === apt.date && h.service === historySearchService);
        let newHistory = [...customer.history];
        if (historyIndex !== -1) newHistory.splice(historyIndex, 1);
        
        return { 
          ...prevCusts, 
          [normalizedPhone]: {
            ...customer, 
            cutCount: currentStatus === 'completed' ? Math.max(0, (customer.cutCount || 0) - 1) : customer.cutCount,
            noShowCount: currentStatus === 'no-show' ? Math.max(0, (customer.noShowCount || 0) - 1) : customer.noShowCount,
            history: newHistory 
          }
        };
      });

      if (currentStatus === 'completed') {
        const { error: delTxErr } = await supabase
          .from('transactions')
          .delete()
          .eq('linked_appointment_id', id);
        
        if (delTxErr) {
          console.warn('[revertAppointment] Erro ao remover transação vinculada:', delTxErr);
        }
        setTransactions(prev => prev.filter(t => t.linkedAppointmentId !== id));
      }
    } catch (err) {
      setAppointments(prevApts => 
        prevApts.map(a => a.id === id ? { ...a, status: currentStatus } : a)
      );
      console.error('[revertAppointment] Erro ao reverter agendamento:', err);
      throw err;
    }
  }, []);

  const deleteAppointment = useCallback(async (id: string) => {
    let aptToDelete: Appointment | undefined;
    let updatedCust: Customer | undefined;

    setAppointments(prevApts => {
      const apt = prevApts.find(a => a.id === id);
      if (!apt) return prevApts;
      aptToDelete = apt;

      if (apt.status === 'completed') {
        setCustomers(prevCusts => {
          const normalizedPhone = normalizePhone(apt.phone);
          const customer = prevCusts[normalizedPhone];
          if (!customer) return prevCusts;
          const historyIndex = customer.history.findIndex(h => h.date === apt.date && h.service === apt.service);
          let newHistory = [...customer.history];
          if (historyIndex !== -1) newHistory.splice(historyIndex, 1);
          updatedCust = { ...customer, cutCount: Math.max(0, (customer.cutCount || 0) - 1), history: newHistory };
          
          return {
            ...prevCusts,
            [normalizedPhone]: updatedCust
          };
        });
      }
      return prevApts.filter(a => a.id !== id);
    });

    try {
      const currentSession = sessionRef.current;
      if (currentSession) {
        if (aptToDelete) await supabaseService.deleteAppointment(id);
        if (updatedCust) await supabaseService.saveCustomer(updatedCust);
      }
    } catch (e) {
      console.error("Supabase sync error", e);
    }

    if (aptToDelete) {
      const resolvedTenantId = aptToDelete.tenantId || activeBarbershopId || activeTenant?.id || '';
      if (resolvedTenantId) {
        const formattedDate = aptToDelete.date.split('-').reverse().join('/');
        addNotification({
          tenantId: resolvedTenantId,
          staffId: aptToDelete.staffId !== resolvedTenantId ? aptToDelete.staffId : null,
          title: 'Agendamento Cancelado',
          message: `O agendamento do cliente ${aptToDelete.clientName} para o serviço de ${aptToDelete.service} no dia ${formattedDate} às ${aptToDelete.time} foi cancelado.`,
          type: 'appointment_cancelled',
          priority: 'medium',
          groupKey: 'appointment_cancelled',
          expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).getTime(),
          meta: {
            appointmentId: aptToDelete.id,
            clientPhone: aptToDelete.phone,
            date: aptToDelete.date,
            time: aptToDelete.time
          }
        }).catch(console.error);

        if (aptToDelete.staffId && aptToDelete.staffId !== resolvedTenantId) {
          addNotification({
            tenantId: resolvedTenantId,
            staffId: null,
            title: 'Agendamento Cancelado',
            message: `O agendamento de ${aptToDelete.clientName} com o profissional no dia ${formattedDate} às ${aptToDelete.time} foi cancelado.`,
            type: 'appointment_cancelled',
            priority: 'medium',
            groupKey: 'appointment_cancelled',
            expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).getTime(),
            meta: {
              appointmentId: aptToDelete.id,
              clientPhone: aptToDelete.phone,
              date: aptToDelete.date,
              time: aptToDelete.time
            }
          }).catch(console.error);
        }
      }
    }
  }, [activeBarbershopId, activeTenant, addNotification]);

  const updateCustomerPhoto = useCallback(async (phone: string, base64Photo: string, description?: string) => {
    const val = validateBrazilianPhone(phone);
    const normalizedPhone = val.valid ? val.normalized : normalizePhone(phone);
    const newPhoto = {
      url: base64Photo,
      description: description || '',
      date: new Date().toISOString().substring(0, 10)
    };

    setCustomers(prev => {
      const customer = (Object.values(prev) as Customer[]).find(c => (c.phoneNormalized || normalizePhone(c.phone)) === normalizedPhone) || prev[normalizedPhone];
      if (!customer) return prev;
      const key = customer.phoneNormalized || normalizedPhone;
      const updatedCust = { ...customer, photos: [newPhoto, ...customer.photos] };
      return { ...prev, [key]: updatedCust };
    });

    const currentSession = sessionRef.current;
    if (currentSession) {
      supabaseService.addCustomerPhoto(phone, newPhoto).catch(console.error);
    }
  }, []);

  const updateCustomerAvatar = useCallback(async (phone: string, base64Photo: string) => {
    const val = validateBrazilianPhone(phone);
    const normalizedPhone = val.valid ? val.normalized : normalizePhone(phone);
    let updatedCust: Customer | null = null;

    setCustomers(prev => {
      const customer = (Object.values(prev) as Customer[]).find(c => (c.phoneNormalized || normalizePhone(c.phone)) === normalizedPhone) || prev[normalizedPhone];
      if (!customer) return prev;
      const key = customer.phoneNormalized || normalizedPhone;
      updatedCust = { ...customer, avatar: base64Photo };
      return { ...prev, [key]: updatedCust };
    });

    if (updatedCust) {
      const currentSession = sessionRef.current;
      if (currentSession) {
        supabaseService.saveCustomer(updatedCust).catch(console.error);
      }
    }
  }, []);

  const updateCustomer = useCallback(async (
    phone: string,
    updates: Partial<Customer>
  ) => {
    const valCurrent = validateBrazilianPhone(phone);
    const normalizedPhone = valCurrent.valid ? valCurrent.normalized : normalizePhone(phone);

    // Ler o cliente atual FORA do setCustomers usando a ref
    const currentCustomer = (Object.values(customersRef.current) as Customer[]).find(c => {
      const cNorm = c.phoneNormalized || normalizePhone(c.phone);
      return cNorm === normalizedPhone;
    }) || customersRef.current[normalizedPhone];

    if (!currentCustomer) return;

    if (updates.phone) {
      const valUpdate = validateBrazilianPhone(updates.phone);
      if (!valUpdate.valid) {
        throw new Error(valUpdate.message || 'Telefone inválido. Digite o DDD + número (10 ou 11 dígitos).');
      }
    }

    const valNew = updates.phone ? validateBrazilianPhone(updates.phone) : valCurrent;
    const newNormalized = valNew.valid ? valNew.normalized : (updates.phone ? normalizePhone(updates.phone) : normalizedPhone);
    const phoneChanged = newNormalized !== normalizedPhone;

    if (phoneChanged) {
      const existingConflict = (Object.values(customersRef.current) as Customer[]).find(c => {
        const cNorm = c.phoneNormalized || normalizePhone(c.phone);
        return cNorm === newNormalized && c.id !== currentCustomer.id;
      });
      if (existingConflict) {
        throw new Error(`Já existe outro cliente cadastrado (${existingConflict.name}) com o telefone ${updates.phone}.`);
      }
    }

    const updatedCustomer: Customer = {
      ...currentCustomer,
      ...updates,
      phone: updates.phone ?? currentCustomer.phone,
      phoneNormalized: newNormalized,
      phone_normalized: newNormalized
    };

    // Chamar Supabase primeiro
    const currentSession = sessionRef.current;
    if (currentSession) {
      try {
        await supabaseService.updateCustomer(phone, updatedCustomer);
      } catch (err) {
        console.error('Erro ao atualizar cliente no Supabase:', err);
        throw err;
      }
    }

    // Atualizar estado local após sucesso
    setCustomers(prev => {
      const newMap = { ...prev };
      if (phoneChanged) {
        delete newMap[normalizedPhone];
      }
      newMap[newNormalized] = updatedCustomer;
      return newMap;
    });

    // Atualizar appointments
    if (updates.name || updates.phone) {
      setAppointments(prev => prev.map(apt => {
        const aptNorm = normalizePhone(apt.phone);
        if (aptNorm === normalizedPhone) {
          return {
            ...apt,
            clientName: updates.name ?? apt.clientName,
            phone: updates.phone ?? apt.phone
          };
        }
        return apt;
      }));
    }
  }, []);

  const toggleSlotAvailability = useCallback(async (date: string, time: string) => {
    let isNowBlocked = false;
    setBlockedSlots(prev => {
      const dateSlots = prev[date] || [];
      if (dateSlots.includes(time)) {
        isNowBlocked = false;
        return { ...prev, [date]: dateSlots.filter(t => t !== time) };
      }
      isNowBlocked = true;
      return { ...prev, [date]: [...dateSlots, time] };
    });
    
    const sync = async () => {
      const currentSession = sessionRef.current;
      if (currentSession) supabaseService.saveBlockedSlot(date, time, isNowBlocked).catch(console.error);
    };
    sync();

    // When manually blocking/unblocking, we should also clear any "unblock" exception for that slot
    setUnblockedSlots(prev => {
      const dateSlots = prev[date] || [];
      if (dateSlots.includes(time)) {
        const syncUnblock = async () => {
          const currentSession = sessionRef.current;
          if (currentSession) supabaseService.saveUnblockedSlot(date, time, false).catch(console.error);
        };
        syncUnblock();
        return { ...prev, [date]: dateSlots.filter(t => t !== time) };
      }
      return prev;
    });
  }, []);

  const toggleSlotUnblock = useCallback(async (date: string, time: string) => {
    let isNowUnblocked = false;
    setUnblockedSlots(prev => {
      const dateSlots = prev[date] || [];
      if (dateSlots.includes(time)) {
        isNowUnblocked = false;
        return { ...prev, [date]: dateSlots.filter(t => t !== time) };
      }
      isNowUnblocked = true;
      return { ...prev, [date]: [...dateSlots, time] };
    });

    const sync = async () => {
      const currentSession = sessionRef.current;
      if (currentSession) supabaseService.saveUnblockedSlot(date, time, isNowUnblocked).catch(console.error);
    };
    sync();

    // When unblocking, we should also clear any manual block for that slot
    setBlockedSlots(prev => {
      const dateSlots = prev[date] || [];
      if (dateSlots.includes(time)) {
        const syncBlock = async () => {
          const currentSession = sessionRef.current;
          if (currentSession) supabaseService.saveBlockedSlot(date, time, false).catch(console.error);
        };
        syncBlock();
        return { ...prev, [date]: dateSlots.filter(t => t !== time) };
      }
      return prev;
    });
  }, []);

  const updateDayConfig = useCallback(async (day: number, config: Partial<DayConfig>) => {
    setWeeklySchedule(prev => {
      const currentConfig = prev[day] || { start: '08:00', end: '19:00', isOpen: true, breaks: [] };
      const rawBreaks = (config.breaks !== undefined ? config.breaks : (currentConfig.breaks || []))
        .map(t => normalizeTime(t))
        .filter(Boolean);
      const uniqueBreaks = Array.from(new Set(rawBreaks));
      const newConfig = { ...currentConfig, ...config, breaks: uniqueBreaks };
      const sync = async () => {
        const currentSession = sessionRef.current;
        if (currentSession) supabaseService.saveWeeklySchedule(day, newConfig).catch(console.error);
      };
      sync();
      return {
        ...prev,
        [day]: newConfig
      };
    });
  }, []);

  const toggleWeeklyBreak = useCallback(async (day: number, time: string) => {
    const normTime = normalizeTime(time);
    setWeeklySchedule(prev => {
      const currentConfig = prev[day] || { start: '08:00', end: '19:00', isOpen: true, breaks: [] };
      const breaks = (currentConfig.breaks || []).map(t => normalizeTime(t)).filter(Boolean);
      const hasBreak = breaks.includes(normTime);
      const newBreaks = hasBreak ? breaks.filter(t => t !== normTime) : [...breaks, normTime];
      const uniqueBreaks = Array.from(new Set(newBreaks));
      const newConfig = { ...currentConfig, breaks: uniqueBreaks };
      const sync = async () => {
        const currentSession = sessionRef.current;
        if (currentSession) supabaseService.saveWeeklySchedule(day, newConfig).catch(console.error);
      };
      sync();
      return { ...prev, [day]: newConfig };
    });
  }, []);

  const addService = useCallback(async (service: ServiceItem) => {
    let newList: ServiceItem[] = [];
    setServices(prev => {
      newList = [...prev, service];
      return newList;
    });

    try {
      const currentSession = sessionRef.current;
      if (currentSession) {
        const savedServices = await supabaseService.saveServices(newList);
        setServices(savedServices);
      }
    } catch (e) {
      console.error('[UI] ERRO ao salvar:', e);
    }
  }, []);

  const removeService = useCallback(async (id: string) => {
    setServices(prev => {
      const newList = prev.filter(s => s.id !== id);
      const sync = async () => {
        const currentSession = sessionRef.current;
        if (currentSession) supabaseService.deleteService(id).catch(console.error);
      };
      sync();
      return newList;
    });
  }, []);

  const updateService = useCallback(async (service: ServiceItem) => {
    setServices(prev => {
      const newList = prev.map(s => s.id === service.id ? service : s);
      const sync = async () => {
        const currentSession = sessionRef.current;
        if (currentSession) {
          try {
            const savedServices = await supabaseService.saveServices(newList);
            setServices(savedServices);
          } catch (e) {
            console.error('ERRO ao salvar em updateService:', e);
          }
        }
      };
      sync();
      return newList;
    });
  }, []);

  const updateBarberProfile = useCallback(async (profile: BarberProfile) => {
    setBarberProfile(profile);
    const ownerUserId = authenticatedUserId || sessionRef.current?.user?.id;
    if (ownerUserId) {
      setStaff(prev => prev.map(s => {
        if (s.userId === ownerUserId || s.id === ownerUserId) {
          return {
            ...s,
            name: profile.name || s.name,
            phone: profile.personalPhone || profile.businessPhone || s.phone,
            photo: profile.photo !== undefined ? profile.photo : s.photo
          };
        }
        return s;
      }));
    }
    try {
      const currentSession = sessionRef.current;
      if (currentSession) await supabaseService.updateProfile(profile);
    } catch (e) {
      console.error("Supabase sync error in updateBarberProfile", e);
    }
  }, [authenticatedUserId]);

  const addCustomer = useCallback(async (customer: Customer): Promise<Customer> => {
    const validation = validateBrazilianPhone(customer.phone);
    if (!validation.valid) {
      throw new Error(validation.message || 'Telefone inválido. Digite o DDD + número (10 ou 11 dígitos).');
    }

    const normalized = validation.normalized;

    // 1. Verificar se já existe no estado local
    const existingLocal = (Object.values(customersRef.current) as Customer[]).find(c => {
      const cNorm = c.phoneNormalized || normalizePhone(c.phone);
      return cNorm === normalized;
    }) || customersRef.current[normalized];

    if (existingLocal) {
      throw new Error(`Este número já está cadastrado para o cliente ${existingLocal.name || 'outro cliente'}.`);
    }

    // 2. Verificar se já existe no Supabase para esta barbearia
    let savedCustomer: any = null;
    const targetBarbershopId = activeBarbershopId || activeTenant?.id;
    if (targetBarbershopId) {
      const existingDb = await supabaseService.checkDuplicateCustomer(customer.phone, targetBarbershopId);
      if (existingDb) {
        throw new Error(`Este número já está cadastrado para o cliente ${existingDb.name || 'outro cliente'}.`);
      }
      savedCustomer = await supabaseService.saveCustomer(customer, targetBarbershopId);
    }

    const finalCustomer: Customer = {
      ...customer,
      id: savedCustomer?.id || customer.id,
      phone: customer.phone,
      phoneNormalized: normalized,
      phone_normalized: normalized
    };

    setCustomers(prev => ({
      ...prev,
      [normalized]: finalCustomer
    }));

    return finalCustomer;
  }, [activeBarbershopId, activeTenant?.id]);

  const reorderServices = useCallback(async (newServices: ServiceItem[]) => {
    setServices(newServices);
    const sync = async () => {
      const currentSession = sessionRef.current;
      if (currentSession) {
        try {
            const savedServices = await supabaseService.saveServices(newServices);
            setServices(savedServices);
        } catch (e) {
            console.error('ERRO ao salvar em reorderServices:', e);
        }
      }
    };
    sync();
  }, []);

  // Multi-staff helper callbacks
  const addStaff = useCallback(async (s: Omit<Staff, 'id' | 'tenantId'>) => {
    try {
      const currentBarbershopId = activeBarbershopId || activeTenant?.id || barbershop?.id;
      if (!currentBarbershopId) {
        throw new Error('Contexto da barbearia não encontrado ao adicionar profissional.');
      }
      await supabaseService.saveStaff({
        ...s,
        tenantId: currentBarbershopId,
        barbershopId: currentBarbershopId
      });
      const freshStaff = await supabaseService.getStaff(currentBarbershopId);
      setStaff(freshStaff);
    } catch (err) {
      console.error('Error adding staff member:', err);
      throw err;
    }
  }, [activeBarbershopId, activeTenant?.id, barbershop?.id]);

  const switchBarbershopContext = useCallback(async (barbershopId: string) => {
    console.info('[STORE] Alternando contexto de barbearia para:', barbershopId);
    selectedBarbershopIdRef.current = barbershopId;
    setIsLoading(true);
    await bootstrapSession(sessionRef.current);
  }, [bootstrapSession]);

  const createStaffDirectly = useCallback(async (params: {
    email?: string;
    password?: string;
    role?: 'staff' | 'admin';
    name: string;
    phone?: string;
    photo?: string;
    commissionRate?: number;
    barbershopId?: string;
  }) => {
    try {
      const currentBarbershopId = params.barbershopId || activeBarbershopId || activeTenant?.id || barbershop?.id;
      if (!currentBarbershopId) {
        throw new Error('Contexto da barbearia não encontrado.');
      }

      const trimmedEmail = params.email?.trim().toLowerCase();
      const trimmedPassword = params.password?.trim();

      if (!trimmedEmail || !trimmedEmail.includes('@')) {
        throw new Error('E-mail válido é obrigatório para cadastrar ou vincular o profissional.');
      }

      const res = await supabaseService.createStaffDirectly({
        email: trimmedEmail,
        password: trimmedPassword || undefined,
        role: params.role || 'staff',
        name: params.name.trim(),
        phone: params.phone?.trim(),
        commissionRate: params.commissionRate,
        barbershopId: currentBarbershopId
      });

      // Atualizar a lista de profissionais diretamente com os dados autoritativos do banco
      const freshStaff = await supabaseService.getStaff(currentBarbershopId);
      setStaff(freshStaff);

      if (res && res.user_id) {
        setBarbershopMembers(prev => {
          const exists = prev.some(m => m.userId === res.user_id);
          if (exists) return prev;
          return [...prev, {
            barbershopId: currentBarbershopId,
            userId: res.user_id,
            role: params.role || 'staff',
            joinedAt: new Date().toISOString(),
            name: params.name,
            phone: params.phone || ''
          }];
        });
      }
      return res;
    } catch (err: any) {
      if (err?.isValidationError) {
        console.warn('[CREATE_STAFF_STORE] Validação ao criar profissional:', err.message);
      } else {
        console.error('[CREATE_STAFF_STORE] Erro inesperado no callback createStaffDirectly:', err);
      }
      throw err;
    }
  }, [activeBarbershopId, activeTenant?.id, barbershop?.id, barbershop?.ownerId]);

  const updateStaff = useCallback(async (id: string, updates: Partial<Staff>) => {
    try {
      const currentBarbershopId = activeBarbershopId || activeTenant?.id || barbershop?.id;
      if (!currentBarbershopId) {
        throw new Error('Contexto da barbearia não encontrado ao atualizar profissional.');
      }
      const existing = staff.find(s => s.id === id || s.userId === id);
      
      const payload: any = {
        ...(existing || {}),
        ...updates,
        id: id,
        barbershopId: currentBarbershopId,
        tenantId: currentBarbershopId
      };
      
      await supabaseService.saveStaff(payload);

      // Context guard: garantir que o usuário não trocou de contexto durante a chamada assíncrona
      const activeIdNow = activeBarbershopIdRef.current || activeBarbershopId;
      if (activeIdNow === currentBarbershopId) {
        const freshStaff = await supabaseService.getStaff(currentBarbershopId);
        setStaff(freshStaff);
        if (currentStaff && (currentStaff.id === id || currentStaff.userId === (updates.userId || existing?.userId))) {
          const updatedSelf = freshStaff.find(s => s.id === currentStaff.id || (s.userId && s.userId === currentStaff.userId));
          if (updatedSelf) {
            setCurrentStaff(updatedSelf);
          }
        }
      }

      const targetUserId = updates.userId || existing?.userId;
      if (targetUserId) {
        setBarbershopMembers(prev => {
          return prev.map(m => {
            if (m.userId === targetUserId) {
              return {
                ...m,
                role: updates.role === 'admin' ? 'admin' : (updates.role === 'staff' ? 'staff' : m.role),
                name: updates.name || m.name,
                phone: updates.phone || m.phone
              };
            }
            return m;
          });
        });
      }
    } catch (err) {
      console.error('Error updating staff member:', err);
      throw err;
    }
  }, [staff, activeBarbershopId, activeTenant?.id, barbershop?.id]);

  const removeStaffFromBarbershop = useCallback(async (params: {
    staffProfileId: string;
    staffUserId?: string | null;
    barbershopId: string;
  }) => {
    try {
      const currentBarbershopId = params.barbershopId || activeBarbershopId || activeTenant?.id || barbershop?.id;
      if (!currentBarbershopId) {
        throw new Error('Contexto da barbearia não encontrado ao remover profissional.');
      }

      await supabaseService.removeStaffFromBarbershop({
        ...params,
        barbershopId: currentBarbershopId
      });

      const activeIdNow = activeBarbershopIdRef.current || activeBarbershopId;
      if (activeIdNow === currentBarbershopId) {
        const freshStaff = await supabaseService.getStaff(currentBarbershopId);
        setStaff(freshStaff);
        if (selectedStaffId === params.staffProfileId) {
          setSelectedStaffId('all');
        }
      }
    } catch (err) {
      console.error('[removeStaffFromBarbershop] Erro:', err);
      throw err;
    }
  }, [activeBarbershopId, activeTenant?.id, barbershop?.id, selectedStaffId, setSelectedStaffId]);

  const reactivateStaff = useCallback(async (staffProfileId: string, barbershopId?: string) => {
    try {
      const currentBarbershopId = barbershopId || activeBarbershopId || activeTenant?.id || barbershop?.id;
      if (!currentBarbershopId) {
        throw new Error('Contexto da barbearia não encontrado ao reativar profissional.');
      }

      await supabaseService.reactivateStaff({
        staffProfileId,
        barbershopId: currentBarbershopId
      });

      const activeIdNow = activeBarbershopIdRef.current || activeBarbershopId;
      if (activeIdNow === currentBarbershopId) {
        const freshStaff = await supabaseService.getStaff(currentBarbershopId);
        setStaff(freshStaff);
      }
    } catch (err) {
      console.error('[reactivateStaff] Erro:', err);
      throw err;
    }
  }, [activeBarbershopId, activeTenant?.id, barbershop?.id]);

  const deleteStaff = useCallback(async (id: string) => {
    try {
      const currentBarbershopId = activeBarbershopId || activeTenant?.id || barbershop?.id;
      if (!currentBarbershopId) {
        throw new Error('Contexto da barbearia não encontrado ao remover profissional.');
      }
      const target = staff.find(s => s.id === id);
      await removeStaffFromBarbershop({
        staffProfileId: id,
        staffUserId: target?.userId,
        barbershopId: currentBarbershopId
      });
    } catch (err) {
      console.error('Error deleting staff member:', err);
      throw err;
    }
  }, [activeBarbershopId, activeTenant?.id, barbershop?.id, removeStaffFromBarbershop, staff]);

  const getStaffAvailability = useCallback(async (staffId: string) => {
    try {
      return await supabaseService.getStaffAvailability(staffId);
    } catch (err) {
      console.error('Error in getStaffAvailability callback:', err);
      return [];
    }
  }, []);

  useEffect(() => {
    const selfOrOwnerStaff =
      currentStaff ||
      staff.find(
        s =>
          (session?.user?.id && (s.userId === session.user.id || s.id === session.user.id)) ||
          s.membershipRole === 'owner' ||
          s.role === 'owner'
      ) ||
      null;
    const targetStaffId =
      selectedStaffId && selectedStaffId !== 'all' ? selectedStaffId : selfOrOwnerStaff?.id;
    if (!targetStaffId || !activeBarbershopId) return;

    let cancelled = false;
    supabaseService.getStaffAvailability(targetStaffId)
      .then(availList => {
        if (cancelled || !availList || availList.length === 0) return;
        setWeeklySchedule(prev => {
          const next: Record<number, DayConfig> = { ...prev };
          availList.forEach(item => {
            if (typeof item.dayOfWeek === 'number' && item.dayOfWeek >= 0 && item.dayOfWeek <= 6) {
              next[item.dayOfWeek] = {
                start: normalizeTime(item.startTime),
                end: normalizeTime(item.endTime),
                isOpen: Boolean(item.isOpen),
                breaks: Array.from(new Set((item.breaks || []).map(b => normalizeTime(b)).filter(Boolean)))
              };
            }
          });
          return next;
        });
      })
      .catch(err => {
        console.warn('[STORE] Aviso ao sincronizar disponibilidade do profissional selecionado:', err);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedStaffId, currentStaff?.id, staff, session?.user?.id, activeBarbershopId]);

  const saveStaffAvailability = useCallback(async (availabilities: Omit<StaffAvailability, 'id'>[]) => {
    try {
      await supabaseService.saveStaffAvailability(availabilities);
      if (availabilities.length > 0) {
        const savedStaffId = availabilities[0].staffId;
        const selfOrOwnerStaff =
          currentStaff ||
          staff.find(
            s =>
              (session?.user?.id && (s.userId === session.user.id || s.id === session.user.id)) ||
              s.membershipRole === 'owner' ||
              s.role === 'owner'
          ) ||
          null;
        const activeTargetStaffId =
          selectedStaffId && selectedStaffId !== 'all' ? selectedStaffId : selfOrOwnerStaff?.id;
        if ((activeTargetStaffId && savedStaffId === activeTargetStaffId) || userRole === 'staff') {
          setWeeklySchedule(prev => {
            const next: Record<number, DayConfig> = { ...prev };
            availabilities.forEach(item => {
              if (typeof item.dayOfWeek === 'number' && item.dayOfWeek >= 0 && item.dayOfWeek <= 6) {
                next[item.dayOfWeek] = {
                  start: normalizeTime(item.startTime),
                  end: normalizeTime(item.endTime),
                  isOpen: Boolean(item.isOpen),
                  breaks: item.isOpen
                    ? Array.from(new Set((item.breaks || []).map(b => normalizeTime(b)).filter(Boolean)))
                    : []
                };
              }
            });
            return next;
          });
        }
      }
    } catch (err) {
      console.error('Error in saveStaffAvailability callback:', err);
      throw err;
    }
  }, [selectedStaffId, currentStaff, staff, session?.user?.id, userRole]);

  
  return (
    <AppContext.Provider value={{ 
      transactions,
      appointments, 
      customers, 
      blockedSlots, 
      unblockedSlots,
      weeklySchedule, 
      services,
      barberProfile,
      session,
      isLoading,
      
      // Multi-tenant & Multi-staff state exports
      activeContext,
      activeBarbershopId,
      activeMembershipRole,
      activeStaffProfileId,
      authenticatedUserId,
      barberId: activeBarbershopId,
      activeTenant,
      authContext,
      authContextResult,
      userContexts,
      switchBarbershopContext,
      selectActiveContext: switchBarbershopContext,
      openContextSelector: () => {},
      staff,
      currentStaff,
      userRole,
      permissions,
      selectedStaffId,
      setSelectedStaffId,
      addStaff,
      createStaffDirectly,
      updateStaff,
      deleteStaff,
      removeStaffFromBarbershop,
      reactivateStaff,
      getStaffAvailability,
      saveStaffAvailability,

      // Onboarding resolution
      onboardingState,
      checkOnboardingState,

      // Barbershop management
      barbershop,
      barbershopMembers,
      barbershopInvites,
      createBarbershop,
      createInvite,
      acceptInvite,

      // Notifications exports
      notifications,
      addNotification,
      markNotificationAsRead,
      markAllNotificationsAsRead,
      deleteNotification,

      addAppointment, 
      updateAppointment,
      finishAppointment, 
      revertAppointment, 
      markNoShow,
      updateCustomerPhoto, 
      updateCustomerAvatar,
      updateCustomer,
      deleteAppointment, 
      toggleSlotAvailability,
      toggleSlotUnblock,
      updateDayConfig,
      toggleWeeklyBreak,
      addService,
      removeService,
      updateService,
      updateBarberProfile,
      addCustomer,
      reorderServices,
      fetchAppointmentsByDate,
      loadTransactions,
      addTransaction,
      deleteTransaction,
      resetStore,
      reloadData: loadData
    }}>
      {children}
    </AppContext.Provider>
  );
};

export const useStore = () => {
  const context = useContext(AppContext);
  if (!context) throw new Error("useStore must be used within AppProvider");
  return context;
};

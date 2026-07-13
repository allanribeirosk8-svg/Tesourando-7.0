import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback, useRef, useMemo } from 'react';
import { Appointment, AppState, BarberProfile, Customer, DayConfig, ServiceItem, Transaction, Staff, Tenant, StaffAvailability, AppNotification } from '../types';
import { normalizePhone } from '../utils/helpers';
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
  { id: '1', name: 'Corte de Cabelo', price: 35, duration: 30 },
  { id: '2', name: 'Barba', price: 25, duration: 30 },
  { id: '3', name: 'Corte + Barba', price: 50, duration: 60 },
  { id: '4', name: 'Pezinho / Sobrancelha', price: 10, duration: 30 },
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
  const [barberId, setBarberId] = useState<string | null>(null);

  // Multi-tenant & Multi-staff state declarations
  const [activeTenant, setActiveTenant] = useState<any | null>(null);
  const [staff, setStaff] = useState<any[]>([]);
  const [userRole, setUserRole] = useState<'admin_owner' | 'staff' | 'client' | null>(null);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  const permissions = useMemo(() => {
    const isAdmin = userRole === 'admin_owner';
    const isStaff = userRole === 'staff';
    return {
      canManageStaff: isAdmin,
      canManageServices: isAdmin,
      canManageTenantProfile: isAdmin,
      canViewCaixa: isAdmin,
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

      if (!isSupabaseConfigured() || !sessionRef.current) return;

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
  }, []);

  const resetStore = useCallback(() => {
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
    setSelectedStaffId('all');
    setIsLoading(true);
  }, []);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const isConfigured = isSupabaseConfigured();
      
      if (isConfigured) {
        // Use the current session from ref if available, or fetch it once
        let currentSession = sessionRef.current;
        if (!currentSession) {
          const result = await supabase.auth.getSession();
          const fetchedSession = result?.data?.session || null;
          currentSession = fetchedSession;
          setSession(fetchedSession);
        }
        
        // Determine which user's data to fetch
        let targetId: string | null = null;
        if (currentSession?.user?.id) {
          targetId = await supabaseService.getTenantIdForUser(currentSession.user.id); // mapeia colaborador para o ID do tenant
        } else {
          // visitante: busca público
          targetId = await supabaseService.getPublicBarberId();
        }
        console.log('[STORE loadData] targetId resolvido:', targetId, '| fonte:', currentSession?.user?.id ? 'session' : 'getPublicBarberId');

        setBarberId(targetId);
        
        if (targetId) {
          const [
            dbApts,
            dbCustomers,
            dbServices,
            dbProfile,
            dbWeekly,
            dbBlocked,
            dbUnblocked
          ] = await Promise.all([
            supabaseService.getAppointments(targetId),
            supabaseService.getCustomers(targetId),
            supabaseService.getServices(targetId).then(data => {
              console.group('[STORE loadData] serviços');
              console.log('targetId usado na busca:', targetId);
              console.log('session.user.id:', currentSession?.user?.id);
              console.log('targetId === session.user.id?', targetId === currentSession?.user?.id);
              console.log('dados retornados do banco:', data);
              console.log('quantidade:', data?.length ?? 0);
              console.groupEnd();
              return data;
            }),
            supabaseService.getProfile(targetId),
            supabaseService.getWeeklySchedule(targetId),
            supabaseService.getBlockedSlots(targetId),
            supabaseService.getUnblockedSlots(targetId)
          ]);

          setAppointments((dbApts || []).map(normalizeAppointment));
          if (dbCustomers) {
            const custMap: Record<string, Customer> = {};
            dbCustomers.forEach((c: any) => {
              custMap[normalizePhone(c.phone)] = {
                ...c,
                photos: c.customer_photos || []
              };
            });
            setCustomers(custMap);
          }
          
          const finalServices = dbServices && dbServices.length > 0 ? dbServices : DEFAULT_SERVICES;
          console.log('[STORE loadData] setServices com:', finalServices.map(s => s.name));
          console.log('[STORE loadData] motivo:', dbServices?.length > 0 ? 'banco' : '⚠️ DEFAULT (banco vazio ou null)');
          setServices(finalServices);
          
          setBarberProfile(dbProfile || DEFAULT_PROFILE);
          setWeeklySchedule({ ...DEFAULT_WEEKLY, ...(dbWeekly || {}) });
          setBlockedSlots(dbBlocked || {});
          setUnblockedSlots(dbUnblocked || {});

          // Multi-tenant & Multi-staff load
          const tenantInfo = {
            id: targetId,
            name: dbProfile?.shopName || 'Meu Corte',
            slug: dbProfile?.slug || '',
            logo: dbProfile?.logo,
            businessPhone: dbProfile?.businessPhone,
            address: dbProfile?.address,
            instagram: dbProfile?.instagram,
            website: dbProfile?.website
          };
          setActiveTenant(tenantInfo);

          const dbStaff = await supabaseService.getStaff(targetId);
          setStaff(dbStaff);

          let resolvedRole: 'admin_owner' | 'staff' | 'client' | null = null;
          if (currentSession?.user?.id === targetId) {
            resolvedRole = 'admin_owner';
            setUserRole('admin_owner');
          } else if (currentSession?.user?.id) {
            const isStaff = dbStaff.some((s: any) => s.userId === currentSession.user.id);
            resolvedRole = isStaff ? 'staff' : 'client';
            setUserRole(resolvedRole);
          } else {
            setUserRole(null);
          }

          if (resolvedRole && resolvedRole !== 'client') {
            const dbNotifications = await supabaseService.getNotifications(targetId, resolvedRole, currentSession?.user?.id);
            setNotifications(dbNotifications);

            // Verificações operacionais automáticas e proativas
            const runOperationalChecks = async (apts: Appointment[], currentNotifs: any[]) => {
              try {
                const now = new Date();
                const todayStr = now.toISOString().split('T')[0];
                const currentMinutes = now.getHours() * 60 + now.getMinutes();
                const existingNotifMessages = new Set(currentNotifs.map(n => n.message));
                let addedAny = false;

                for (const apt of apts) {
                  if (apt.status !== 'pending') continue;

                  const formattedDate = apt.date.split('-').reverse().join('/');
                  const [aptHour, aptMin] = apt.time.split(':').map(Number);
                  const aptMinutes = aptHour * 60 + aptMin;

                  // 1. Lembrete de consulta próxima (próximas 2 horas de hoje)
                  if (apt.date === todayStr) {
                    const diff = aptMinutes - currentMinutes;
                    if (diff > 0 && diff <= 120) {
                      const msg = `Lembrete: Agendamento de ${apt.clientName} às ${apt.time} está próximo (em ${diff} minutos).`;
                      if (!existingNotifMessages.has(msg)) {
                        await supabaseService.addNotification({
                          tenantId: targetId!,
                          staffId: apt.staffId !== targetId ? apt.staffId : null,
                          title: 'Lembrete de Consulta Próxima',
                          message: msg,
                          type: 'appointment_reminder',
                          priority: 'medium',
                          groupKey: 'appointment_reminder',
                          expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 3).getTime(), // expira em 3 horas
                          meta: {
                            appointmentId: apt.id,
                            date: apt.date,
                            time: apt.time
                          }
                        });
                        addedAny = true;
                      }
                    }
                  }

                  // 2. Alerta de fechamento pendente (agendamentos de datas passadas, ou de hoje que já passaram há mais de 1 hora)
                  const isPastDate = apt.date < todayStr;
                  const isPastHourToday = apt.date === todayStr && (currentMinutes - aptMinutes > 60);

                  if (isPastDate || isPastHourToday) {
                    const msg = `Aviso: O agendamento de ${apt.clientName} no dia ${formattedDate} às ${apt.time} ainda está pendente de fechamento.`;
                    if (!existingNotifMessages.has(msg)) {
                      await supabaseService.addNotification({
                        tenantId: targetId!,
                        staffId: apt.staffId !== targetId ? apt.staffId : null,
                        title: 'Agendamento Pendente de Fechamento',
                        message: msg,
                        type: 'pending_close_alert',
                        priority: 'high',
                        groupKey: 'pending_close',
                        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).getTime(), // expira em 7 dias
                        meta: {
                          appointmentId: apt.id,
                          date: apt.date,
                          time: apt.time
                        }
                      });
                      addedAny = true;
                    }
                  }
                }

                if (addedAny && resolvedRole) {
                  const refreshed = await supabaseService.getNotifications(targetId!, resolvedRole, currentSession?.user?.id);
                  setNotifications(refreshed);
                }
              } catch (err) {
                console.error('Erro nas verificações operacionais automáticas:', err);
              }
            };

            runOperationalChecks((dbApts || []).map(normalizeAppointment), dbNotifications || []);
          } else {
            setNotifications([]);
          }
        } else {
          // If configured but no barber found, we don't fallback to LocalStorage
          // to keep it "totally via Supabase"
          setAppointments([]);
          setCustomers({});
          setServices(DEFAULT_SERVICES);
          setBarberProfile(DEFAULT_PROFILE);
        }
      } else {
        loadFromLocalStorage();
      }


    } catch (e) {
      console.error("Failed to load data", e);
      loadFromLocalStorage();
    } finally {
      setIsLoading(false);
      if (isFirstLoad.current) {
        isFirstLoad.current = false;
        onReadyRef.current?.();
      }
    }
  }, []);

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

  // Load from Supabase (Primary) and LocalStorage (Fallback/Cache)
  useEffect(() => {
    if (isPublicRoute) {
      setIsLoading(false);
      if (isFirstLoad.current) {
        isFirstLoad.current = false;
        onReadyRef.current?.();
      }
      return;
    }

    if (isSupabaseConfigured()) {
      // Fetch initial session
      supabase.auth.getSession().then(({ data: { session } }) => {
        setSession(session);
      });

      const authResult = supabase.auth.onAuthStateChange((event, newSession) => {
        console.log('[AUTH] evento:', event);
        console.log('[AUTH] session recebida:', newSession);
        console.log('[AUTH] session.user?.id:', newSession?.user?.id);
        console.log("Auth event:", event);
        setSession(newSession);
        
        if (event === 'SIGNED_OUT') {
          resetStore();
        }
        
        if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED') {
          loadData();
        }
      });

      return () => {
        if (authResult?.data?.subscription) {
          authResult.data.subscription.unsubscribe();
        }
      };
    } else {
      loadData();
    }
  }, [loadData, resetStore, isPublicRoute]);

  // Supabase Realtime Subscription
  useEffect(() => {
    if (!isSupabaseConfigured()) return;

    let channel: any;

    const setupRealtime = async () => {
      const currentSession = sessionRef.current;
      if (!currentSession) return;

      channel = supabase
        .channel('appointments_changes')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'appointments',
            filter: `user_id=eq.${currentSession.user.id}`
          },
          (payload) => {
            console.log("Realtime evento recebido:", payload);
            const { eventType, new: newRecord, old: oldRecord } = payload;

            if (eventType === 'INSERT' || eventType === 'UPDATE') {
              const apt = {
                id: newRecord.id,
                date: normalizeDate(newRecord.date),
                time: normalizeTime(newRecord.time),
                clientName: newRecord.client_name,
                phone: newRecord.phone,
                service: newRecord.service,
                price: Number(newRecord.price),
                duration: newRecord.duration,
                status: newRecord.status,
                createdAt: new Date(newRecord.created_at).getTime()
              } as Appointment;
              
              setAppointments(prev => {
                const index = prev.findIndex(a => a.id === apt.id);
                
                if (index !== -1) {
                  // If it exists, update it but ONLY if the new data is complete
                  // This prevents REPLICA IDENTITY issues where 'new' might be incomplete
                  if (!apt.date || !apt.time || !apt.clientName) {
                    console.log('Ignoring incomplete Realtime update for existing appointment:', apt.id);
                    return prev;
                  }
                  const next = [...prev];
                  next[index] = apt;
                  return next;
                }

                if (eventType === 'INSERT') {
                  // If the record is incomplete, don't add it - wait for the manual fetch or a better event
                  if (!apt.date || !apt.time || !apt.clientName) {
                    console.log('Ignoring incomplete Realtime INSERT:', apt.id);
                    return prev;
                  }

                  // Check for a temporary appointment (non-UUID id) that matches
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
    };

    setupRealtime();

    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

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
    if (!currentSession) return;
    
    console.log('[LOAD_TRANSACTIONS] startDate:', startDate, '| endDate:', endDate);
    
    const resolvedTenantId = barberId || currentSession.user.id;
    const { data, error } = await supabase
      .from('transactions')
      .select('*')
      .eq('user_id', resolvedTenantId)
      .gte('date', `${startDate}T00:00:00`)
      .lte('date', `${endDate}T23:59:59`)
      .order('date', { ascending: false });
    if (!error && data) {
      console.log('[LOAD_TRANSACTIONS] registros retornados:', data?.map((t: any) => ({ id: t.id, date: t.date, description: t.description })));
      setTransactions(data.map((t: any) => ({
        id: t.id,
        type: t.type,
        amount: Number(t.amount),
        description: t.description,
        category: t.category,
        date: t.date,
        linkedAppointmentId: t.linked_appointment_id,
        paymentMethod: t.payment_method,
        createdAt: new Date(t.created_at).getTime(),
      })));
    }
  };

  const addTransaction = async (t: Omit<Transaction, 'id' | 'createdAt'>) => {
    const currentSession = sessionRef.current;
    if (!currentSession) return;

    if (userRole !== 'admin_owner') {
      console.error('[ADD_TRANSACTION] Não autorizado: usuário não é admin_owner');
      throw new Error("Não autorizado. Apenas o administrador pode gerenciar transações.");
    }

    console.log('[ADD_TRANSACTION] date recebida:', t.date);
    
    const resolvedTenantId = barberId || currentSession.user.id;
    console.log('[ADD_TRANSACTION] payload enviado ao Supabase:', {
      date: t.date,
      type: t.type,
      amount: t.amount,
      description: t.description,
      tenantId: resolvedTenantId
    });

    const { data, error } = await supabase
      .from('transactions')
      .insert({
        user_id: resolvedTenantId,
        type: t.type,
        amount: t.amount,
        description: t.description ?? null,
        category: t.category,
        date: typeof t.date === 'string' ? t.date.substring(0, 10) : t.date,
        linked_appointment_id: t.linkedAppointmentId ?? null,
        payment_method: t.paymentMethod ?? null,
      })
      .select()
      .single();
    if (!error && data) {
      setTransactions(state => [{ ...t, id: data.id, createdAt: Date.now() }, ...state]);
    }
  };

  const deleteTransaction = async (id: string) => {
    const currentSession = sessionRef.current;
    if (!currentSession) return;
    
    if (userRole !== 'admin_owner') {
      console.error('[DELETE_TRANSACTION] Não autorizado: usuário não é admin_owner');
      throw new Error("Não autorizado. Apenas o administrador pode excluir transações.");
    }

    const resolvedTenantId = barberId || currentSession.user.id;
    const { error } = await supabase
      .from('transactions')
      .delete()
      .eq('id', id)
      .eq('user_id', resolvedTenantId);
    if (!error) {
      setTransactions(state => state.filter(t => t.id !== id));
    }
  };

  const addNotification = useCallback(async (n: Omit<AppNotification, 'id' | 'createdAt' | 'read'>) => {
    const resolvedTenantId = n.tenantId || activeTenant?.id || barberId || '';
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
  }, [activeTenant, barberId, userRole]);

  const markNotificationAsRead = useCallback(async (id: string) => {
    const resolvedTenantId = activeTenant?.id || barberId || '';
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
  }, [activeTenant, barberId]);

  const markAllNotificationsAsRead = useCallback(async () => {
    const resolvedTenantId = activeTenant?.id || barberId || '';
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
  }, [activeTenant, barberId, userRole]);

  const deleteNotification = useCallback(async (id: string) => {
    const resolvedTenantId = activeTenant?.id || barberId || '';
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
  }, [activeTenant, barberId]);

  const addAppointment = useCallback(async (apt: Appointment, isExceptional?: boolean) => {
    console.log("1. Iniciando criação do agendamento");
    
    // 1. Time normalization
    const normalizedTimeValue = normalizeTime(apt.time);
    if (!normalizedTimeValue) {
      console.error("Horário inválido");
      return;
    }

    // 2. Exceptional handling
    let finalObservation = apt.observation || '';
    if (isExceptional && !finalObservation.startsWith('[EXCEPCIONAL]')) {
      finalObservation = `[EXCEPCIONAL] ${finalObservation}`.trim();
    }

    const resolvedTenantId = apt.tenantId || activeTenant?.id || barberId || '';
    const resolvedStaffId = apt.staffId && apt.staffId !== '' ? apt.staffId : resolvedTenantId;

    const finalApt: Appointment = {
      ...apt,
      time: normalizedTimeValue,
      observation: finalObservation,
      tenantId: resolvedTenantId,
      staffId: resolvedStaffId
    };

    // 3. Conflict validation (now scoped by staffId)
    const isConflict = appointmentsRef.current.some(a => 
      a.date === finalApt.date && 
      a.time === finalApt.time && 
      (a.staffId || a.tenantId) === (finalApt.staffId || finalApt.tenantId) &&
      a.id !== finalApt.id
    );

    if (isConflict) {
      console.error("Este horário já está ocupado por outro agendamento.");
      alert("Este horário já está ocupado por outro agendamento.");
      return;
    }

    console.log("2. Dados do agendamento:", finalApt);
    
    setAppointments(prev => {
      const next = [...prev, finalApt];
      console.log("5. Estado local atualizado:", next);
      return next;
    });
    
    const normalizedPhone = normalizePhone(finalApt.phone);
    
    setCustomers(prev => {
      const existing = prev[normalizedPhone];
      if (existing) return { ...prev, [normalizedPhone]: { ...existing, name: finalApt.clientName, phone: finalApt.phone } };
      return {
        ...prev,
        [normalizedPhone]: { phone: finalApt.phone, name: finalApt.clientName, cutCount: 0, history: [], photos: [] }
      };
    });

    // Optional: Add to unblocked_slots for consistency if exceptional
    if (isExceptional) {
      setUnblockedSlots(prev => {
        const dateSlots = prev[finalApt.date] || [];
        if (!dateSlots.includes(finalApt.time)) {
          const next = { ...prev, [finalApt.date]: [...dateSlots, finalApt.time] };
          if (isSupabaseConfigured()) {
            supabaseService.saveUnblockedSlot(finalApt.date, finalApt.time, true).catch(console.error);
          }
          return next;
        }
        return prev;
      });
    }

    try {
      const targetId = sessionRef.current?.user?.id || barberId;

      if (targetId) {
        console.log("3. Enviando para Supabase...");
        try {
          const savedApt = await supabaseService.saveAppointment(finalApt, targetId);
          console.log("4. Resposta do Supabase:", { data: savedApt, error: null });
          
          const normalizedSavedApt = normalizeAppointment(savedApt);

          // Update state with the real ID from Supabase
          setAppointments(prev => {
            const next = prev.map(a => a.id === finalApt.id ? normalizedSavedApt : a);
            console.log("5. Estado local atualizado (com ID real):", next);
            return next;
          });
          
          // Mark this date to skip the next fetch to avoid race conditions
          skipNextFetchRef.current[finalApt.date] = true;
          
          // Also save/update customer
          // Instead of fetching all customers, we just upsert the current one.
          // Supabase upsert will handle creation or update based on the phone (PK).
          await supabaseService.saveCustomer({ 
            phone: finalApt.phone, 
            name: finalApt.clientName, 
            cutCount: 0, 
            history: [], 
            photos: [] 
          }, targetId);
        } catch (err) {
          console.log("4. Resposta do Supabase:", { data: null, error: err });
          throw err;
        }
      }
    } catch (e) {
      console.error("Supabase sync error", e);
    }

    // Criar notificações operacionais automáticas
    const createAptNotifications = async () => {
      try {
        const staffName = staff.find(s => s.id === finalApt.staffId)?.name || 'Profissional';
        const formattedDate = finalApt.date.split('-').reverse().join('/');
        
        await addNotification({
          tenantId: resolvedTenantId,
          staffId: finalApt.staffId !== resolvedTenantId ? finalApt.staffId : null,
          title: 'Agendamento Confirmado',
          message: `O agendamento de ${finalApt.clientName} para o serviço de ${finalApt.service} no dia ${formattedDate} às ${finalApt.time} com ${staffName} foi confirmado.`,
          type: 'appointment_confirmed',
          priority: 'medium',
          groupKey: 'appointment_confirmed',
          expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).getTime(),
          meta: {
            appointmentId: finalApt.id,
            clientPhone: finalApt.phone,
            price: finalApt.price,
            date: finalApt.date,
            time: finalApt.time
          }
        });

        if (finalApt.staffId && finalApt.staffId !== resolvedTenantId) {
          await addNotification({
            tenantId: resolvedTenantId,
            staffId: null, // direcional ao admin
            title: 'Novo Agendamento Criado',
            message: `Novo agendamento de ${finalApt.clientName} com o profissional ${staffName} para ${finalApt.service} no dia ${formattedDate} às ${finalApt.time}.`,
            type: 'appointment_created',
            priority: 'medium',
            groupKey: 'appointment_created',
            expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).getTime(),
            meta: {
              appointmentId: finalApt.id,
              clientPhone: finalApt.phone,
              price: finalApt.price,
              date: finalApt.date,
              time: finalApt.time
            }
          });
        }
      } catch (err) {
        console.error('Erro ao disparar notificações de criação de agendamento:', err);
      }
    };
    createAptNotifications();

  }, [barberId, staff, addNotification, activeTenant]);

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
    if (finishingRef.current.has(id)) return;
    finishingRef.current.add(id);

    const apt = appointmentsRef.current.find(a => a.id === id);
    if (!apt || apt.status === 'completed') {
      finishingRef.current.delete(id);
      return;
    }

    const updatedApt = { ...apt, status: 'completed' as const };
    setAppointments(prevApts => 
      prevApts.map(a => a.id === id ? updatedApt : a)
    );

    setCustomers(prevCusts => {
      const normalizedPhone = normalizePhone(apt.phone);
      const customer = prevCusts[normalizedPhone] || { phone: apt.phone, name: apt.clientName, cutCount: 0, history: [], photos: [] };
      const updatedCust = {
        ...customer,
        cutCount: (customer.cutCount || 0) + 1,
        history: [{ date: apt.date, time: apt.time, service: apt.service, price: apt.price }, ...(customer.history || [])]
      };
      
      const sync = async () => {
        try {
          const currentSession = sessionRef.current;
          if (currentSession) {
            const savedApt = await supabaseService.saveAppointment(updatedApt);
            setAppointments(prev => prev.map(a => a.id === id ? normalizeAppointment(savedApt) : a));
            supabaseService.saveCustomer(updatedCust).catch(console.error);

            const { data: existingTx } = await supabase
              .from('transactions')
              .select('id')
              .eq('linked_appointment_id', apt.id)
              .maybeSingle();

            if (!existingTx) {
              console.log('[FINISH_APPOINTMENT] apt.date:', apt.date);
              console.log('[FINISH_APPOINTMENT] date que será usada na transação:', apt.date);
              
              addTransaction({
                type: 'income',
                category: 'walk_in',
                amount: apt.price,
                description: `${apt.service} — ${apt.clientName}`,
                date: `${apt.date}T12:00:00`,
                linkedAppointmentId: apt.id,
              });
            }
          }
        } finally {
          finishingRef.current.delete(id);
        }
      };
      sync();
      
      return {
        ...prevCusts,
        [normalizedPhone]: updatedCust
      };
    });
  }, []);

  const markNoShow = useCallback(async (id: string) => {
    const apt = appointmentsRef.current.find(a => a.id === id);
    if (!apt || apt.status !== 'pending') return;

    const updatedApt = { ...apt, status: 'no-show' as const };
    setAppointments(prevApts => 
      prevApts.map(a => a.id === id ? updatedApt : a)
    );

    setCustomers(prevCusts => {
      const normalizedPhone = normalizePhone(apt.phone);
      const customer = prevCusts[normalizedPhone] || { phone: apt.phone, name: apt.clientName, cutCount: 0, noShowCount: 0, history: [], photos: [] };
      const updatedCust = {
        ...customer,
        noShowCount: (customer.noShowCount || 0) + 1,
        history: [{ date: apt.date, time: apt.time, service: 'Falta registrada', price: 0 }, ...(customer.history || [])]
      };

      const sync = async () => {
        const currentSession = sessionRef.current;
        if (currentSession) {
          const savedApt = await supabaseService.saveAppointment(updatedApt);
          setAppointments(prev => prev.map(a => a.id === id ? normalizeAppointment(savedApt) : a));
          supabaseService.saveCustomer(updatedCust).catch(console.error);
        }
      };
      sync();

      // Disparar notificações automáticas
      const resolvedTenantId = apt.tenantId || activeTenant?.id || barberId || '';
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

      return {
        ...prevCusts,
        [normalizedPhone]: updatedCust
      };
    });
  }, [barberId, activeTenant, addNotification]);

  const revertAppointment = useCallback(async (id: string) => {
    const apt = appointmentsRef.current.find(a => a.id === id);
    if (!apt || apt.status === 'pending') return;
    const currentStatus = apt.status;

    const updatedApt = { ...apt, status: 'pending' as const };
    setAppointments(prevApts => 
      prevApts.map(a => a.id === id ? updatedApt : a)
    );

    setCustomers(prevCusts => {
      const normalizedPhone = normalizePhone(apt.phone);
      const customer = prevCusts[normalizedPhone];
      if (!customer) return prevCusts;
      
      const historySearchService = currentStatus === 'no-show' 
        ? 'Falta registrada' 
        : apt.service;
        
      const historyIndex = customer.history.findIndex(h => h.date === apt.date && h.service === historySearchService);
      let newHistory = [...customer.history];
      if (historyIndex !== -1) newHistory.splice(historyIndex, 1);
      
      const updatedCust = { 
        ...customer, 
        cutCount: currentStatus === 'completed' ? Math.max(0, (customer.cutCount || 0) - 1) : customer.cutCount,
        noShowCount: currentStatus === 'no-show' ? Math.max(0, (customer.noShowCount || 0) - 1) : customer.noShowCount,
        history: newHistory 
      };

      const sync = async () => {
        const currentSession = sessionRef.current;
        if (currentSession) {
          const savedApt = await supabaseService.saveAppointment(updatedApt);
          setAppointments(prev => prev.map(a => a.id === id ? normalizeAppointment(savedApt) : a));
          supabaseService.saveCustomer(updatedCust).catch(console.error);
        }
      };
      sync();

      return {
        ...prevCusts,
        [normalizedPhone]: updatedCust
      };
    });
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
      const resolvedTenantId = aptToDelete.tenantId || activeTenant?.id || barberId || '';
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
  }, [barberId, activeTenant, addNotification]);

  const updateCustomerPhoto = useCallback(async (phone: string, base64Photo: string, description?: string) => {
    const normalizedPhone = normalizePhone(phone);
    const newPhoto = {
      url: base64Photo,
      description: description || '',
      date: new Date().toISOString().substring(0, 10)
    };

    setCustomers(prev => {
      const customer = prev[normalizedPhone];
      if (!customer) return prev;
      const updatedCust = { ...customer, photos: [newPhoto, ...customer.photos] };
      return { ...prev, [normalizedPhone]: updatedCust };
    });

    const currentSession = sessionRef.current;
    if (currentSession) {
      supabaseService.addCustomerPhoto(phone, newPhoto).catch(console.error);
    }
  }, []);

  const updateCustomerAvatar = useCallback(async (phone: string, base64Photo: string) => {
    const normalizedPhone = normalizePhone(phone);
    let updatedCust: Customer | null = null;

    setCustomers(prev => {
      const customer = prev[normalizedPhone];
      if (!customer) return prev;
      updatedCust = { ...customer, avatar: base64Photo };
      return { ...prev, [normalizedPhone]: updatedCust };
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
    const normalizedPhone = normalizePhone(phone);

    // Ler o cliente atual FORA do setCustomers
    // usando a ref que mantém o estado atualizado
    const currentCustomer = customersRef.current[normalizedPhone];
    if (!currentCustomer) return;

    // Montar o objeto atualizado de forma síncrona
    const updatedCustomer: Customer = { ...currentCustomer, ...updates };
    const newPhone = updates.phone
      ? normalizePhone(updates.phone)
      : normalizedPhone;
    const phoneChanged = newPhone !== normalizedPhone;

    // Atualizar estado local
    setCustomers(prev => {
      if (phoneChanged) {
        const { [normalizedPhone]: _, ...rest } = prev;
        return { ...rest, [newPhone]: updatedCustomer };
      }
      return { ...prev, [normalizedPhone]: updatedCustomer };
    });

    // Atualizar appointments
    if (updates.name || updates.phone) {
      setAppointments(prev => prev.map(apt => {
        if (normalizePhone(apt.phone) === normalizedPhone) {
          return {
            ...apt,
            clientName: updates.name ?? apt.clientName,
            phone: updates.phone ?? apt.phone
          };
        }
        return apt;
      }));
    }

    // Chamar Supabase com o objeto já montado (nunca null)
    const currentSession = sessionRef.current;

    if (currentSession) {
      try {
        await supabaseService.updateCustomer(phone, updatedCustomer);
      } catch (err) {
        console.error('Erro ao atualizar cliente no Supabase:', err);
      }
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
      const newConfig = { ...prev[day], ...config };
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
    setWeeklySchedule(prev => {
      const currentConfig = prev[day];
      const breaks = currentConfig.breaks || [];
      const newBreaks = breaks.includes(time) ? breaks.filter(t => t !== time) : [...breaks, time];
      const newConfig = { ...currentConfig, breaks: newBreaks };
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
        console.log('[UI] handleSaveServices chamado em addService, lista:', newList);
        const savedServices = await supabaseService.saveServices(newList);
        console.log('[UI] saveServices retornou:', savedServices);
        console.log('[UI] estado atualizado com IDs do banco?', savedServices.map(s => s.id));
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
          console.log('[UI] handleSaveServices chamado em updateService, lista:', newList);
          try {
            const savedServices = await supabaseService.saveServices(newList);
            console.log('[UI] saveServices retornou:', savedServices);
            console.log('[UI] estado atualizado com IDs do banco?', savedServices.map(s => s.id));
            setServices(savedServices);
          } catch (e) {
            console.error('[UI] ERRO ao salvar em updateService:', e);
          }
        }
      };
      sync();
      return newList;
    });
  }, []);

  const updateBarberProfile = useCallback(async (profile: BarberProfile) => {
    setBarberProfile(profile);
    try {
      const currentSession = sessionRef.current;
      if (currentSession) await supabaseService.updateProfile(profile);
    } catch (e) {
      console.error("Supabase sync error in updateBarberProfile", e);
    }
  }, []);

  const addCustomer = useCallback(async (customer: Customer) => {
    const normalized = normalizePhone(customer.phone);
    let isNew = false;

    setCustomers(prev => {
      if (prev[normalized]) return prev;
      isNew = true;
      return { ...prev, [normalized]: customer };
    });

    if (isNew) {
      try {
        const targetId = sessionRef.current?.user?.id || barberId;
        if (targetId) {
          await supabaseService.saveCustomer(customer, targetId);
          console.log("Customer saved to Supabase successfully");
        }
      } catch (e) {
        console.error("Supabase sync error in addCustomer", e);
        throw e;
      }
    }
  }, [barberId]);

  const reorderServices = useCallback(async (newServices: ServiceItem[]) => {
    setServices(newServices);
    const sync = async () => {
      const currentSession = sessionRef.current;
      if (currentSession) {
        console.log('[UI] handleSaveServices chamado em reorderServices, lista:', newServices);
        try {
            const savedServices = await supabaseService.saveServices(newServices);
            console.log('[UI] saveServices retornou:', savedServices);
            console.log('[UI] estado atualizado com IDs do banco?', savedServices.map(s => s.id));
            setServices(savedServices);
        } catch (e) {
            console.error('[UI] ERRO ao salvar em reorderServices:', e);
        }
      }
    };
    sync();
  }, []);

  // Multi-staff helper callbacks
  const addStaff = useCallback(async (s: Omit<Staff, 'id' | 'tenantId'>) => {
    try {
      const targetId = sessionRef.current?.user?.id || barberId;
      if (!targetId) return;
      const newStaff = await supabaseService.saveStaff({
        ...s,
        tenantId: targetId
      });
      setStaff(prev => [...prev, {
        id: newStaff.id,
        tenantId: newStaff.tenant_id,
        userId: newStaff.user_id,
        name: newStaff.name,
        phone: newStaff.phone,
        photo: newStaff.photo || undefined,
        status: newStaff.status || 'active',
        commissionRate: newStaff.commission_rate || 0
      }]);
    } catch (err) {
      console.error('Error adding staff member:', err);
    }
  }, [barberId]);

  const updateStaff = useCallback(async (id: string, updates: Partial<Staff>) => {
    try {
      const existing = staff.find(s => s.id === id);
      if (!existing) return;
      const payload = { ...existing, ...updates };
      await supabaseService.saveStaff(payload);
      setStaff(prev => prev.map(s => s.id === id ? payload : s));
    } catch (err) {
      console.error('Error updating staff member:', err);
    }
  }, [staff]);

  const deleteStaff = useCallback(async (id: string) => {
    try {
      await supabaseService.deleteStaff(id);
      setStaff(prev => prev.filter(s => s.id !== id));
    } catch (err) {
      console.error('Error deleting staff member:', err);
    }
  }, []);

  const getStaffAvailability = useCallback(async (staffId: string) => {
    try {
      return await supabaseService.getStaffAvailability(staffId);
    } catch (err) {
      console.error('Error in getStaffAvailability callback:', err);
      return [];
    }
  }, []);

  const saveStaffAvailability = useCallback(async (availabilities: Omit<StaffAvailability, 'id'>[]) => {
    try {
      await supabaseService.saveStaffAvailability(availabilities);
    } catch (err) {
      console.error('Error in saveStaffAvailability callback:', err);
      throw err;
    }
  }, []);

  
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
      activeTenant,
      staff,
      userRole,
      permissions,
      selectedStaffId,
      setSelectedStaffId,
      addStaff,
      updateStaff,
      deleteStaff,
      getStaffAvailability,
      saveStaffAvailability,

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

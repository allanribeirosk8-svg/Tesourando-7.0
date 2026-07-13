import { supabase } from '../lib/supabase';
import { Appointment, BarberProfile, Customer, DayConfig, ServiceItem, Staff, Tenant, StaffAvailability } from '../types';
import { normalizePhone, normalizeTime } from '../utils/helpers';

function generateSlug(shopName: string, userId: string): string {
  const base = shopName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove acentos
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')   // remove caracteres especiais
    .replace(/\s+/g, '-')            // espaços viram hífens
    .replace(/-+/g, '-');            // hífens duplicados

  // Sufixo com os últimos 6 chars do userId para garantir unicidade
  const suffix = userId.replace(/-/g, '').slice(-6);
  return `${base}-${suffix}`;
}

let isNetworkOffline = false;

function handleNetworkError(methodName: string, err: any, fallbackValue: any) {
  const errMsg = err?.message || String(err);
  if (
    errMsg.includes('Failed to fetch') || 
    errMsg.includes('NetworkError') || 
    errMsg.includes('Load failed') || 
    errMsg.includes('fetch') ||
    errMsg.includes('network')
  ) {
    if (!isNetworkOffline) {
      console.warn(`[Supabase] Conexão de rede falhou ou está offline em ${methodName} (${errMsg}). Ativando modo offline resiliente.`);
      isNetworkOffline = true;
    }
    return fallbackValue;
  }
  console.error(`[${methodName}] Erro ao carregar/salvar:`, errMsg);
  return fallbackValue;
}

// Define database types to fix lint errors
export const supabaseService = {
  // Helper to get current user ID
  async getUserId() {
    if (isNetworkOffline) return null;
    try {
        const result = await supabase.auth.getSession();
        const session = result?.data?.session;
        console.log('[getUserId] session exists:', !!session);
        console.log('[getUserId] userId:', session?.user?.id ?? 'NULL');
        const error = result?.error;
        const data = result?.data;
        
        if (error) {
            console.error("Error getting session in getUserId:", error);
            return null;
        }
        return data?.session?.user?.id || null;
    } catch (e) {
        return handleNetworkError('getUserId', e, null);
    }
  },

  // Get the first barber profile ID for public access
  async getPublicBarberId() {
    if (isNetworkOffline) return null;
    try {
      const { data, error } = await supabase.from('profiles').select('id').limit(1).maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return (data as any).id;
    } catch (err: any) {
      return handleNetworkError('getPublicBarberId', err, null);
    }
  },

  // Profiles
  async getProfile(targetUserId?: string) {
    if (isNetworkOffline) return null;
    try {
      const userId = targetUserId || await this.getUserId();
      if (!userId) return null;

      const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single();
      if (error && error.code === 'PGRST116') {
        // Auto-create profile if missing
        const userResult = await supabase.auth.getUser();
        const user = userResult?.data?.user;
        const newProfile = {
          id: userId,
          name: user?.user_metadata?.name || 'Barbeiro',
          updated_at: new Date().toISOString()
        };
        await supabase.from('profiles').insert(newProfile as any);
        return {
          name: newProfile.name,
          personalPhone: '',
          shopName: 'Meu Corte',
          businessPhone: '',
          onboarding_seen: false,
          slug: ''
        } as BarberProfile;
      }
      if (error) throw error;
      if (!data) return null;

      const d = data as any;
      return {
        name: d.name,
        personalPhone: d.personal_phone || '',
        photo: d.photo,
        shopName: d.shop_name || 'Meu Corte',
        businessPhone: d.business_phone || '',
        address: d.address,
        logo: d.logo,
        description: d.description,
        instagram: d.instagram,
        website: d.website,
        onboarding_seen: d.onboarding_seen,
        slug: d.slug
      } as BarberProfile;
    } catch (err: any) {
      return handleNetworkError('getProfile', err, null);
    }
  },
  async updateProfile(profile: BarberProfile) {
    const { role, userId } = await this.getUserRoleAndTenant();
    if (role !== 'admin_owner' || !userId) {
      throw new Error('Apenas o proprietário do salão (admin_owner) pode atualizar o perfil do tenant.');
    }

    // Busca o slug atual para não sobrescrever
    const { data: existing } = await supabase
      .from('profiles')
      .select('slug')
      .eq('id', userId)
      .maybeSingle();

    const slug = (existing as any)?.slug || generateSlug(profile.shopName || profile.name || 'barbearia', userId);

    const { error } = await supabase.from('profiles').upsert({
      id: userId,
      name: profile.name,
      personal_phone: profile.personalPhone,
      photo: profile.photo,
      shop_name: profile.shopName,
      business_phone: profile.businessPhone,
      address: profile.address,
      logo: profile.logo,
      description: profile.description,
      instagram: profile.instagram,
      website: profile.website,
      onboarding_seen: profile.onboarding_seen,
      slug: slug,
      updated_at: new Date().toISOString()
    } as any);
    if (error) throw error;
  },

  // Services
  async getServices(targetUserId?: string) {
    if (isNetworkOffline) return [];
    try {
      const userId = targetUserId || await this.getUserId();
      console.log('[getServices] buscando para userId:', userId);

      if (!userId) {
        console.warn('[getServices] userId null - retornando []');
        return [];
      }

      const { data, error } = await supabase.from('services').select('*').eq('user_id', userId).order('order_index', { ascending: true });
      
      if (error) {
        throw error;
      }

      console.log('[getServices] dados brutos do banco:', data);
      console.log('[getServices] quantidade:', data?.length);

      if (!data) return [];

      const mapped = (data as any[]).map(s => ({
        id: s.id,
        name: s.name,
        price: Number(s.price),
        duration: s.duration
      })) as ServiceItem[];
      
      console.log('[getServices] retornando:', mapped);
      return mapped;
    } catch (err) {
      return handleNetworkError('getServices', err, []);
    }
  },
  async saveServices(services: ServiceItem[]) {
    console.log('[saveServices] INICIANDO', { services });
    const { role, userId } = await this.getUserRoleAndTenant();
    if (role !== 'admin_owner' || !userId) {
      throw new Error('Apenas o proprietário do salão (admin_owner) pode salvar ou gerenciar serviços.');
    }

    const existingIds = services.map(s => s.id);

    if (existingIds.length > 0) {
      await supabase
        .from('services')
        .delete()
        .eq('user_id', userId)
        .not('id', 'in', `(${existingIds.join(',')})`);
    } else {
      await supabase
        .from('services')
        .delete()
        .eq('user_id', userId);
    }

    const isUUID = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    const payload = services.map((s, index) => ({
      id: isUUID(s.id) ? s.id : crypto.randomUUID(),
      user_id: userId,
      name: s.name,
      price: s.price,
      duration: s.duration,
      order_index: index
    }));
    
    console.log('[saveServices] payload para upsert:', payload);

    const { data, error } = await supabase.from('services')
      .upsert(payload as any)
      .select();

    if (error) {
      console.error('[saveServices] ERRO no upsert:', error);
      console.error('[saveServices] error.code:', error.code);
      console.error('[saveServices] error.message:', error.message);
      console.error('[saveServices] error.details:', error.details);
      console.error('[saveServices] error.hint:', error.hint);
      throw error;
    }

    console.log('[saveServices] SUCESSO - data retornada:', data);
    return (data as any[]).map(s => ({
      id: s.id,
      name: s.name,
      price: Number(s.price),
      duration: s.duration
    })) as ServiceItem[];
  },
  async deleteService(id: string) {
    const { role, userId } = await this.getUserRoleAndTenant();
    if (role !== 'admin_owner' || !userId) {
      throw new Error('Apenas o proprietário do salão (admin_owner) pode excluir serviços.');
    }

    const { error } = await supabase.from('services').delete().eq('id', id).eq('user_id', userId);
    if (error) throw error;
  },

  // Customers
  async getCustomers(targetUserId?: string) {
    if (isNetworkOffline) return [];
    try {
      const userId = targetUserId || await this.getUserId();
      if (!userId) return [];

      const { data, error } = await supabase.from('customers').select('*, customer_photos(*)').eq('user_id', userId);
      if (error) throw error;
      if (!data) return [];
      return (data as any[]).map(c => ({
        phone: c.phone,
        name: c.name,
        avatar: c.avatar,
        cutCount: c.cut_count,
        noShowCount: c.no_show_count,
        photos: (c.customer_photos || []).map((p: any) => ({
          url: p.url,
          description: p.description,
          date: p.date ? p.date.substring(0, 10) : ''
        })),
        history: [] // History can be derived from appointments if needed, or stored separately
      })) as Customer[];
    } catch (err: any) {
      return handleNetworkError('getCustomers', err, []);
    }
  },
  async saveCustomer(customer: Customer, targetUserId?: string) {
    const userId = targetUserId || await this.getUserId();
    if (!userId) throw new Error('User not authenticated');

    const { photos, ...rest } = customer;
    const { data, error } = await supabase.from('customers').upsert({
    user_id: userId,
    phone: customer.phone,
    name: customer.name,
    avatar: customer.avatar,
    cut_count: customer.cutCount,
    no_show_count: customer.noShowCount || 0
    } as any, { onConflict: 'phone,user_id' }).select().single();
    
    if (error) throw error;
    
    // We don't save photos here anymore to avoid duplication. 
    // Photos should be saved via addCustomerPhoto or handle separately.
    
    return data;
  },
  async addCustomerPhoto(phone: string, photo: { url: string; description: string; date: string }) {
    const userId = await this.getUserId();
    if (!userId) throw new Error('User not authenticated');

    const { error } = await supabase.from('customer_photos').insert({
      user_id: userId,
      customer_phone: phone,
      url: photo.url,
      description: photo.description,
      date: photo.date
    } as any);
    
    if (error) throw error;
  },
  async updateCustomer(oldPhone: string, customer: Customer) {
    const userId = await this.getUserId();
    if (!userId) throw new Error('User not authenticated');

    const normalizedOld = normalizePhone(oldPhone);
    const normalizedNew = normalizePhone(customer.phone);

    if (normalizedOld !== normalizedNew) {
      // If phone changed, we need to handle the PK change
      // 1. Create new customer record
      const { error: insertError } = await supabase.from('customers').insert({
        user_id: userId,
        phone: customer.phone,
        name: customer.name,
        avatar: customer.avatar,
        cut_count: customer.cutCount,
        no_show_count: customer.noShowCount || 0
      } as any);
      
      if (insertError) throw insertError;

      // 2. Update photos to point to new phone
      const { error: photoError } = await (supabase.from('customer_photos') as any)
        .update({ customer_phone: customer.phone } as any)
        .eq('user_id', userId)
        .eq('customer_phone', oldPhone);
      
      if (photoError) throw photoError;

      // 3. Update appointments to point to new phone
      const { error: aptError } = await (supabase.from('appointments') as any)
        .update({ phone: customer.phone, client_name: customer.name } as any)
        .eq('user_id', userId)
        .eq('phone', oldPhone);
      
      if (aptError) throw aptError;

      // 4. Delete old customer record
      const { error: deleteError } = await (supabase.from('customers') as any)
        .delete()
        .eq('user_id', userId)
        .eq('phone', oldPhone);
      
      if (deleteError) throw deleteError;
    } else {
      // Just a normal update
      const { error } = await (supabase.from('customers') as any).update({
        name: customer.name,
        avatar: customer.avatar,
        cut_count: customer.cutCount,
        no_show_count: customer.noShowCount || 0
      } as any)
      .eq('user_id', userId)
      .eq('phone', customer.phone);
      
      if (error) throw error;

      // Also update appointments name if it changed
      const { error: aptError } = await (supabase.from('appointments') as any)
        .update({ client_name: customer.name } as any)
        .eq('user_id', userId)
        .eq('phone', customer.phone);
      
      if (aptError) throw aptError;
    }
  },
  async checkDuplicateCustomer(phone: string) {
    const userId = await this.getUserId();
    if (!userId) return null;

    const { data, error } = await supabase
      .from('customers')
      .select('phone, name')
      .eq('phone', phone)
      .eq('user_id', userId)
      .maybeSingle();
    
    if (error) throw error;
    return data;
  },

  // Appointments
  async getAppointments(targetUserId?: string) {
    if (isNetworkOffline) return [];
    try {
      const userId = targetUserId || await this.getUserId();
      if (!userId) return [];

      const { data, error } = await supabase.from('appointments').select('*').eq('user_id', userId);
      if (error) throw error;
      if (!data) return [];
      return (data as any[]).map(a => ({
        id: a.id,
        tenantId: a.tenant_id || userId,
        staffId: a.staff_id || userId,
        date: a.date ? a.date.substring(0, 10) : '',
        time: normalizeTime(a.time),
        clientName: a.client_name,
        phone: a.phone,
        service: a.service,
        price: Number(a.price),
        duration: a.duration,
        status: a.status,
        observation: a.observation,
        createdAt: new Date(a.created_at).getTime()
      })) as Appointment[];
    } catch (err: any) {
      return handleNetworkError('getAppointments', err, []);
    }
  },
  async getAppointmentsByDate(date: string, targetUserId?: string) {
    if (isNetworkOffline) return [];
    try {
      const userId = targetUserId || await this.getUserId();
      if (!userId) return [];

      const { data, error } = await supabase
        .from('appointments')
        .select('*')
        .eq('user_id', userId)
        .eq('date', date)
        .order('time', { ascending: true });
      
      if (error) throw error;
      if (!data) return [];
      return (data as any[]).map(a => ({
        id: a.id,
        tenantId: a.tenant_id || userId,
        staffId: a.staff_id || userId,
        date: a.date ? a.date.substring(0, 10) : '',
        time: normalizeTime(a.time),
        clientName: a.client_name,
        phone: a.phone,
        service: a.service,
        price: Number(a.price),
        duration: a.duration,
        status: a.status,
        observation: a.observation,
        createdAt: new Date(a.created_at).getTime()
      })) as Appointment[];
    } catch (err) {
      return handleNetworkError(`getAppointmentsByDate`, err, []);
    }
  },
  async saveAppointment(appointment: Appointment, targetUserId?: string) {
    const userId = targetUserId || await this.getUserId();
    if (!userId) throw new Error('User not authenticated');

    const isUUID = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

    const dataToSave: any = {
      user_id: userId,
      date: appointment.date,
      time: normalizeTime(appointment.time),
      client_name: appointment.clientName,
      phone: appointment.phone,
      service: appointment.service,
      price: appointment.price,
      duration: appointment.duration,
      status: appointment.status,
      observation: appointment.observation
    };

    if (isUUID(appointment.id)) {
      dataToSave.id = appointment.id;
    }

    try {
      const dataToSaveWithStaff = {
        ...dataToSave,
        tenant_id: appointment.tenantId || userId,
        staff_id: appointment.staffId || userId
      };
      const { data, error } = await supabase.from('appointments').upsert(dataToSaveWithStaff).select().single();
      if (!error && data) {
        const a = data as any;
        return {
          id: a.id,
          tenantId: a.tenant_id || userId,
          staffId: a.staff_id || userId,
          date: a.date,
          time: normalizeTime(a.time),
          clientName: a.client_name,
          phone: a.phone,
          service: a.service,
          price: Number(a.price),
          duration: a.duration,
          status: a.status,
          observation: a.observation,
          createdAt: new Date(a.created_at).getTime()
        } as Appointment;
      }
      if (error) throw error;
    } catch (e) {
      console.warn('[saveAppointment] Missing tenant_id/staff_id or other issue, retrying with legacy schema:', e);
      const { data, error } = await supabase.from('appointments').upsert(dataToSave).select().single();
      if (error) throw error;
      const a = data as any;
      return {
        id: a.id,
        tenantId: userId,
        staffId: userId,
        date: a.date,
        time: normalizeTime(a.time),
        clientName: a.client_name,
        phone: a.phone,
        service: a.service,
        price: Number(a.price),
        duration: a.duration,
        status: a.status,
        observation: a.observation,
        createdAt: new Date(a.created_at).getTime()
      } as Appointment;
    }
  },
  async deleteAppointment(id: string) {
    const userId = await this.getUserId();
    if (!userId) throw new Error('User not authenticated');

    const { error } = await supabase.from('appointments').delete().eq('id', id).eq('user_id', userId);
    if (error) throw error;
  },

  // Weekly Schedule
  async getWeeklySchedule(targetUserId?: string) {
    try {
      const userId = targetUserId || await this.getUserId();
      if (!userId) return {};

      const { data: schedule, error: sError } = await supabase.from('weekly_schedule').select('*').eq('user_id', userId);
      const { data: breaks, error: bError } = await supabase.from('weekly_breaks').select('*').eq('user_id', userId);
      if (sError || bError) throw sError || bError;

      const result: Record<number, DayConfig> = {};
      (schedule as any[])?.forEach(s => {
        result[s.day_of_week] = {
          start: normalizeTime(s.start_time),
          end: normalizeTime(s.end_time),
          isOpen: s.is_open,
          breaks: (breaks as any[])?.filter(b => b.day_of_week === s.day_of_week).map(b => normalizeTime(b.time)) || []
        };
      });
      return result;
    } catch (err) {
      console.error('[getWeeklySchedule] Erro ao carregar agenda semanal:', err);
      return {};
    }
  },
  async saveWeeklySchedule(day: number, config: DayConfig) {
    const { role, userId } = await this.getUserRoleAndTenant();
    if (role !== 'admin_owner' || !userId) {
      throw new Error('Apenas o proprietário do salão (admin_owner) pode alterar a agenda de padrão semanal.');
    }

    const payload = {
      user_id: userId,
      day_of_week: day,
      start_time: normalizeTime(config.start),
      end_time: normalizeTime(config.end),
      is_open: config.isOpen
    };

    console.group(`[DEBUG-AGENDA] saveWeeklySchedule - dia ${day}`);
    console.log('[DEBUG-AGENDA] Payload:', payload);
    console.log(`[DEBUG-AGENDA] day_of_week: ${day}, is_open: ${config.isOpen}`);
    console.log(`[DEBUG-AGENDA] Tipo de is_open: ${typeof config.isOpen}`);
    
    const { data, error } = await supabase.from('weekly_schedule').upsert(payload as any).select();
    
    console.log('[DEBUG-AGENDA] Resposta Supabase:', {
      sucesso: !error,
      erro: error,
      dados: data
    });
    console.groupEnd();
    
    if (error) throw error;

    // Handle breaks
    const { error: delError } = await supabase.from('weekly_breaks').delete().eq('day_of_week', day).eq('user_id', userId);
    if (delError) throw delError;

    if (config.breaks && config.breaks.length > 0) {
      const { error: bError } = await supabase.from('weekly_breaks').insert(
        config.breaks.map(time => ({ user_id: userId, day_of_week: day, time: normalizeTime(time) })) as any
      );
      if (bError) throw bError;
    }
  },

  // Blocked/Unblocked Slots
  async getBlockedSlots(targetUserId?: string) {
    try {
      const userId = targetUserId || await this.getUserId();
      if (!userId) return {};

      const { data, error } = await supabase.from('blocked_slots').select('*').eq('user_id', userId);
      if (error) throw error;
      if (!data) return {};
      const result: Record<string, string[]> = {};
      (data as any[])?.forEach(s => {
        if (!result[s.date]) result[s.date] = [];
        result[s.date].push(normalizeTime(s.time));
      });
      return result;
    } catch (err: any) {
      console.error('[getBlockedSlots] Erro ao carregar horários bloqueados:', err?.message || err);
      return {};
    }
  },
  async saveBlockedSlot(date: string, time: string, isBlocked: boolean) {
    const userId = await this.getUserId();
    if (!userId) throw new Error('User not authenticated');

    if (isBlocked) {
      await supabase.from('blocked_slots').upsert({ user_id: userId, date, time: normalizeTime(time) } as any);
    } else {
      await supabase.from('blocked_slots').delete().match({ user_id: userId, date, time: normalizeTime(time) });
    }
  },
  async getUnblockedSlots(targetUserId?: string) {
    try {
      const userId = targetUserId || await this.getUserId();
      if (!userId) return {};

      const { data, error } = await supabase.from('unblocked_slots').select('*').eq('user_id', userId);
      if (error) throw error;
      if (!data) return {};
      const result: Record<string, string[]> = {};
      (data as any[])?.forEach(s => {
        if (!result[s.date]) result[s.date] = [];
        result[s.date].push(normalizeTime(s.time));
      });
      return result;
    } catch (err: any) {
      console.error('[getUnblockedSlots] Erro ao carregar horários desbloqueados:', err?.message || err);
      return {};
    }
  },
  async saveUnblockedSlot(date: string, time: string, isUnblocked: boolean) {
    const userId = await this.getUserId();
    if (!userId) throw new Error('User not authenticated');

    if (isUnblocked) {
      await supabase.from('unblocked_slots').upsert({ user_id: userId, date, time: normalizeTime(time) } as any);
    } else {
      await supabase.from('unblocked_slots').delete().match({ user_id: userId, date, time: normalizeTime(time) });
    }
  },

  // Multi-tenant & Multi-staff extensions
  async getTenantBySlug(slug: string) {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('slug', slug)
        .maybeSingle();
      
      if (error) throw error;
      if (!data) return null;

      const d = data as any;
      return {
        id: d.id,
        name: d.shop_name || d.name || 'Meu Corte',
        slug: d.slug,
        logo: d.logo,
        businessPhone: d.business_phone || '',
        address: d.address,
        instagram: d.instagram,
        website: d.website,
        createdAt: d.created_at
      };
    } catch (err) {
      console.error('[getTenantBySlug] Error resolving tenant by slug:', err);
      return null;
    }
  },

  async getStaff(tenantId: string) {
    try {
      const { data, error } = await supabase
        .from('staff')
        .select('*')
        .eq('tenant_id', tenantId);

      if (error) {
        // If staff table does not exist or has RLS error, fall back to virtual staff
        if (error.code === 'PGRST116' || error.message?.includes('relation "staff" does not exist')) {
          const profile = await this.getProfile(tenantId);
          return [{
            id: tenantId,
            tenantId: tenantId,
            userId: tenantId,
            name: profile?.name || 'Profissional',
            phone: profile?.personalPhone || '',
            photo: profile?.photo || undefined,
            status: 'active',
            commissionRate: 100
          }];
        }
        throw error;
      }

      if (!data || data.length === 0) {
        // Fallback to profile as virtual staff
        const profile = await this.getProfile(tenantId);
        return [{
          id: tenantId,
          tenantId: tenantId,
          userId: tenantId,
          name: profile?.name || 'Profissional',
          phone: profile?.personalPhone || '',
          photo: profile?.photo || undefined,
          status: 'active',
          commissionRate: 100
        }];
      }

      return (data as any[]).map(s => ({
        id: s.id,
        tenantId: s.tenant_id,
        userId: s.user_id,
        name: s.name,
        phone: s.phone,
        photo: s.photo || undefined,
        status: s.status || 'active',
        commissionRate: Number(s.commission_rate || 0)
      }));
    } catch (err) {
      console.warn('[getStaff] Falling back to virtual staff on error:', err);
      const profile = await this.getProfile(tenantId);
      return [{
        id: tenantId,
        tenantId: tenantId,
        userId: tenantId,
        name: profile?.name || 'Profissional',
        phone: profile?.personalPhone || '',
        photo: profile?.photo || undefined,
        status: 'active',
        commissionRate: 100
      }];
    }
  },

  async saveStaff(staff: Omit<Staff, 'id' | 'tenantId'> & { id?: string; tenantId?: string }) {
    const { role } = await this.getUserRoleAndTenant();
    if (role !== 'admin_owner') {
      throw new Error('Apenas o proprietário do salão (admin_owner) pode gerenciar ou salvar equipe.');
    }

    const tenantId = staff.tenantId || await this.getUserId();
    if (!tenantId) throw new Error('Tenant ID not authenticated');

    const payload = {
      id: staff.id || crypto.randomUUID(),
      tenant_id: tenantId,
      user_id: staff.userId || null,
      name: staff.name,
      phone: staff.phone,
      photo: staff.photo || null,
      status: staff.status || 'active',
      commission_rate: staff.commissionRate || 0
    };

    const { data, error } = await supabase.from('staff').upsert(payload).select().single();
    if (error) {
      console.error('[saveStaff] Error upserting staff:', error);
      throw error;
    }
    return data;
  },

  async deleteStaff(id: string) {
    const { role } = await this.getUserRoleAndTenant();
    if (role !== 'admin_owner') {
      throw new Error('Apenas o proprietário do salão (admin_owner) pode excluir membros da equipe.');
    }

    const { error } = await supabase.from('staff').delete().eq('id', id);
    if (error) {
      console.error('[deleteStaff] Error deleting staff:', error);
      throw error;
    }
  },

  async getTenantIdForUser(userId: string): Promise<string> {
    try {
      const { data, error } = await supabase
        .from('staff')
        .select('tenant_id')
        .eq('user_id', userId)
        .maybeSingle();
      
      if (!error && data && (data as any).tenant_id) {
        console.log('[getTenantIdForUser] Mapeado colaborador para tenant_id:', (data as any).tenant_id);
        return (data as any).tenant_id;
      }
      return userId;
    } catch (err) {
      console.warn('[getTenantIdForUser] Erro ao buscar tenant para o usuário:', err);
      return userId;
    }
  },

  async getUserRoleAndTenant(): Promise<{ role: 'admin_owner' | 'staff' | 'client'; tenantId: string | null; userId: string | null }> {
    try {
      const userId = await this.getUserId();
      if (!userId) {
        return { role: 'client', tenantId: null, userId: null };
      }
      const tenantId = await this.getTenantIdForUser(userId);
      if (tenantId === userId) {
        return { role: 'admin_owner', tenantId, userId };
      } else {
        return { role: 'staff', tenantId, userId };
      }
    } catch (err) {
      console.warn('[getUserRoleAndTenant] Erro ao obter papel:', err);
      return { role: 'client', tenantId: null, userId: null };
    }
  },

  async getStaffAvailability(staffId: string): Promise<StaffAvailability[]> {
    try {
      const { data, error } = await supabase
        .from('staff_availability')
        .select('*')
        .eq('staff_id', staffId);

      if (error) {
        throw error;
      }

      if (!data || data.length === 0) {
        return [];
      }

      return (data as any[]).map(item => ({
        id: item.id,
        staffId: item.staff_id,
        dayOfWeek: item.day_of_week,
        startTime: normalizeTime(item.start_time),
        endTime: normalizeTime(item.end_time),
        breaks: item.breaks || [],
        isOpen: item.is_open,
        createdAt: item.created_at
      }));
    } catch (err) {
      console.warn('[getStaffAvailability] Erro ou tabela inexistente, usando fallback de agenda do tenant:', err);
      return [];
    }
  },

  async saveStaffAvailability(availabilities: Omit<StaffAvailability, 'id'>[]) {
    try {
      if (availabilities.length === 0) return;
      const staffId = availabilities[0].staffId;

      const { role, userId } = await this.getUserRoleAndTenant();
      if (role === 'client' || !userId) {
        throw new Error('Não autorizado.');
      }

      if (role === 'staff') {
        const { data: staffMember, error: staffErr } = await supabase
          .from('staff')
          .select('id')
          .eq('user_id', userId)
          .maybeSingle();

        if (staffErr || !staffMember || (staffMember as any).id !== staffId) {
          throw new Error('Apenas permitido editar sua própria disponibilidade.');
        }
      }

      await supabase.from('staff_availability').delete().eq('staff_id', staffId);

      const payloads = availabilities.map(a => ({
        id: crypto.randomUUID(),
        staff_id: a.staffId,
        day_of_week: a.dayOfWeek,
        start_time: normalizeTime(a.startTime),
        end_time: normalizeTime(a.endTime),
        breaks: a.breaks || [],
        is_open: a.isOpen
      }));

      const { error } = await supabase.from('staff_availability').insert(payloads as any);
      if (error) throw error;
    } catch (err) {
      console.error('[saveStaffAvailability] Erro ao salvar disponibilidade:', err);
      throw err;
    }
  },

  async getNotifications(tenantId: string, role: 'admin_owner' | 'staff' | 'client', staffUserId?: string | null): Promise<any[]> {
    if (isNetworkOffline) return [];
    try {
      if (role === 'client') return [];

      const loggedInUserId = await this.getUserId();
      if (!loggedInUserId) return [];

      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', loggedInUserId)
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) throw error;

      return (data || []).map((n: any) => ({
        id: n.id,
        tenantId: tenantId,
        staffId: null,
        title: n.title,
        message: n.body,
        type: n.type,
        read: n.read,
        createdAt: new Date(n.created_at).getTime(),
        priority: 'medium',
        expiresAt: null,
        groupKey: n.group_key,
        groupCount: n.group_count || 1,
        meta: n.data || {}
      }));
    } catch (err: any) {
      // Se a tabela não existir, usamos o fallback do localStorage de forma transparente
      if (err?.message?.includes('relation "notifications" does not exist') || err?.message?.includes('does not exist')) {
        const localKey = `meucorte_notifications_${tenantId}`;
        try {
          const stored = localStorage.getItem(localKey);
          if (!stored) return [];
          const all: any[] = JSON.parse(stored);
          const now = Date.now();
          
          let filtered = all.filter((n: any) => !n.expiresAt || n.expiresAt > now);
          
          if (role === 'staff' && staffUserId) {
            return filtered.filter(n => !n.staffId || n.staffId === staffUserId);
          } else if (role === 'client') {
            return [];
          }
          return filtered;
        } catch {
          return [];
        }
      }
      return handleNetworkError('getNotifications', err, []);
    }
  },

  async addNotification(n: { tenantId: string; staffId?: string | null; title: string; message: string; type: string; meta?: any; priority?: 'high' | 'medium' | 'low'; expiresAt?: number | null; groupKey?: string | null; }) {
    if (isNetworkOffline) return;
    try {
      if (!n.tenantId) return;

      // Determine target user_id (isolation is by user_id)
      let targetUserId = n.tenantId; // default to tenant/owner UUID
      if (n.staffId) {
        // Find staff user_id
        const { data: staffData } = await supabase
          .from('staff')
          .select('user_id')
          .eq('id', n.staffId)
          .maybeSingle();
        if (staffData?.user_id) {
          targetUserId = staffData.user_id;
        } else {
          targetUserId = n.staffId;
        }
      }

      // Call the rpc function on supabase
      const { error } = await supabase.rpc('add_or_group_notification', {
        p_user_id: targetUserId,
        p_title: n.title,
        p_body: n.message,
        p_type: n.type,
        p_data: n.meta || {},
        p_group_key: n.groupKey || null
      });

      if (error) {
        throw error;
      }
    } catch (err: any) {
      if (
        err?.message?.includes('relation "notifications" does not exist') ||
        err?.message?.includes('does not exist') ||
        err?.message?.includes('function "add_or_group_notification" does not exist')
      ) {
        const localKey = `meucorte_notifications_${n.tenantId}`;
        try {
          const stored = localStorage.getItem(localKey) || '[]';
          const all = JSON.parse(stored);

          if (n.groupKey) {
            const existingGroup = all.find((x: any) => x.groupKey === n.groupKey && !x.read && (x.staffId === n.staffId || (!x.staffId && !n.staffId)));
            if (existingGroup) {
              existingGroup.groupCount = (existingGroup.groupCount || 1) + 1;
              existingGroup.createdAt = Date.now();
              existingGroup.meta = { ...existingGroup.meta, ...n.meta, lastGroupUpdate: Date.now() };
              localStorage.setItem(localKey, JSON.stringify(all.slice(0, 100)));
              return;
            }
          }

          all.unshift({
            id: crypto.randomUUID(),
            tenantId: n.tenantId,
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
            meta: n.meta || {}
          });
          localStorage.setItem(localKey, JSON.stringify(all.slice(0, 100))); // Manter últimas 100
        } catch (e) {
          console.warn('Erro ao salvar notificação localmente:', e);
        }
        return;
      }
      handleNetworkError('addNotification', err, null);
    }
  },

  async markNotificationAsRead(id: string, tenantId: string) {
    if (isNetworkOffline) return;
    try {
      if (!tenantId) return;
      const { error } = await supabase.from('notifications').update({ read: true }).eq('id', id);
      if (error) throw error;
    } catch (err: any) {
      if (err?.message?.includes('relation "notifications" does not exist') || err?.message?.includes('does not exist')) {
        const localKey = `meucorte_notifications_${tenantId}`;
        try {
          const stored = localStorage.getItem(localKey);
          if (stored) {
            const all = JSON.parse(stored);
            const updated = all.map((n: any) => n.id === id ? { ...n, read: true } : n);
            localStorage.setItem(localKey, JSON.stringify(updated));
          }
        } catch {}
        return;
      }
      handleNetworkError('markNotificationAsRead', err, null);
    }
  },

  async markAllNotificationsAsRead(tenantId: string, role: 'admin_owner' | 'staff' | 'client', staffUserId?: string | null) {
    if (isNetworkOffline) return;
    try {
      if (!tenantId) return;
      const loggedInUserId = await this.getUserId();
      if (!loggedInUserId) return;
      const { error } = await supabase.from('notifications').update({ read: true }).eq('user_id', loggedInUserId).eq('read', false);
      if (error) throw error;
    } catch (err: any) {
      if (err?.message?.includes('relation "notifications" does not exist') || err?.message?.includes('does not exist')) {
        const localKey = `meucorte_notifications_${tenantId}`;
        try {
          const stored = localStorage.getItem(localKey);
          if (stored) {
            const all = JSON.parse(stored);
            const updated = all.map((n: any) => ({ ...n, read: true }));
            localStorage.setItem(localKey, JSON.stringify(updated));
          }
        } catch {}
        return;
      }
      handleNetworkError('markAllNotificationsAsRead', err, null);
    }
  },

  async deleteNotification(id: string, tenantId: string) {
    if (isNetworkOffline) return;
    try {
      if (!tenantId) return;
      const { error } = await supabase.from('notifications').delete().eq('id', id);
      if (error) throw error;
    } catch (err: any) {
      if (err?.message?.includes('relation "notifications" does not exist') || err?.message?.includes('does not exist')) {
        const localKey = `meucorte_notifications_${tenantId}`;
        try {
          const stored = localStorage.getItem(localKey);
          if (stored) {
            const all = JSON.parse(stored);
            const updated = all.filter((n: any) => n.id !== id);
            localStorage.setItem(localKey, JSON.stringify(updated));
          }
        } catch {}
        return;
      }
      handleNetworkError('deleteNotification', err, null);
    }
  }
};

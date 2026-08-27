import { supabase } from '../lib/supabase';
import { Appointment, BarberProfile, Customer, DayConfig, ServiceItem, Staff, Tenant, StaffAvailability, Barbershop, BarbershopMember, BarbershopInvite, OnboardingState } from '../types';
import { normalizePhone, normalizeTime } from '../utils/helpers';

export function normalizeRequestedSlug(rawSlug: string): string {
  if (!rawSlug) return '';
  return rawSlug
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove acentos
    .replace(/[^a-z0-9-]/g, '-')     // troca caracteres especiais por hífen
    .replace(/-+/g, '-')             // hífens duplicados
    .replace(/^-|-$/g, '');          // hífens nas pontas
}

export function generateSlug(shopName: string, userId: string): string {
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

function isNetworkError(err: any): boolean {
  if (!err) return false;
  const errMsg = (err?.message || err?.details || String(err)).toLowerCase();
  return (
    errMsg.includes('failed to fetch') ||
    errMsg.includes('networkerror') ||
    errMsg.includes('load failed') ||
    errMsg.includes('network error') ||
    errMsg.includes('fetch') ||
    errMsg.includes('connection refused')
  );
}

function handleNetworkError(methodName: string, err: any, fallbackValue: any) {
  const errMsg = err?.message || String(err);
  if (isNetworkError(err)) {
    console.warn(`[handleNetworkError] Erro transitório de rede em ${methodName}: "${errMsg}"`);
    return fallbackValue;
  }
  console.error(`[${methodName}] Erro:`, errMsg);
  return fallbackValue;
}

// Define database types to fix lint errors
export const supabaseService = {
  // Helper to get current user ID
  async getUserId() {
    try {
        const result = await supabase.auth.getSession();
        const session = result?.data?.session;
        const error = result?.error;
        const data = result?.data;
        
        if (error) {
            console.error("Error getting session in getUserId:", error);
            return null;
        }

        if (session) {
          isNetworkOffline = false;
        }

        const uid = data?.session?.user?.id || null;
        return uid;
    } catch (e) {
        return handleNetworkError('getUserId', e, null);
    }
  },

  // Get the first barber profile ID for public access
  async getPublicBarberId() {
    try {
      const { data, error } = await supabase.from('profiles').select('id').limit(1).maybeSingle();
      if (error) throw error;
      if (!data) return null;
      isNetworkOffline = false;
      return (data as any).id;
    } catch (err: any) {
      return handleNetworkError('getPublicBarberId', err, null);
    }
  },

  // Profiles
  async getProfile(targetUserIdOrShopId?: string) {
    try {
      const idToUse = targetUserIdOrShopId || await this.getUserId();
      if (!idToUse) return null;

      // 1. Tentar buscar em profiles por id
      const { data, error } = await supabase.from('profiles').select('*').eq('id', idToUse).maybeSingle();
      if (!error && data) {
        isNetworkOffline = false;
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
          slug: d.slug
        } as BarberProfile;
      }

      // 2. Se não encontrou por profile.id, pode ser um barbershop_id
      const { data: shopData } = await supabase.from('barbershops').select('*').eq('id', idToUse).maybeSingle();
      if (shopData) {
        isNetworkOffline = false;
        const { data: ownerProf } = await supabase.from('profiles').select('*').eq('id', shopData.owner_id).maybeSingle();
        return {
          name: ownerProf?.name || 'Barbeiro',
          personalPhone: ownerProf?.personal_phone || '',
          photo: ownerProf?.photo || '',
          shopName: shopData.name || ownerProf?.shop_name || 'Meu Corte',
          businessPhone: ownerProf?.business_phone || '',
          address: ownerProf?.address || '',
          logo: ownerProf?.logo || '',
          description: ownerProf?.description || '',
          instagram: ownerProf?.instagram || '',
          website: ownerProf?.website || '',
          slug: shopData.slug || ownerProf?.slug || ''
        } as BarberProfile;
      }

      return null;
    } catch (err: any) {
      return handleNetworkError('getProfile', err, null);
    }
  },
  async ensureUniqueProfileSlug(requestedSlug: string, userId: string): Promise<string> {
    const normalized = normalizeRequestedSlug(requestedSlug);
    if (!normalized) return '';

    // 1. Verifica em profiles se outro usuário já possui este slug
    const { data: prof, error: profErr } = await supabase
      .from('profiles')
      .select('id')
      .eq('slug', normalized)
      .maybeSingle();

    if (profErr && profErr.code !== 'PGRST116') {
      console.warn('[ensureUniqueProfileSlug] Erro ao verificar profile slug:', profErr.message);
    }

    if (prof && prof.id !== userId) {
      throw new Error(`O identificador (slug) "${normalized}" já está em uso por outro usuário. Por favor, escolha outro.`);
    }

    // 2. Verifica em barbershops se pertence a outro owner
    const { data: shop, error: shopErr } = await supabase
      .from('barbershops')
      .select('owner_id')
      .eq('slug', normalized)
      .maybeSingle();

    if (shopErr && shopErr.code !== 'PGRST116') {
      console.warn('[ensureUniqueProfileSlug] Erro ao verificar barbershop slug:', shopErr.message);
    }

    if (shop && shop.owner_id !== userId) {
      throw new Error(`O identificador (slug) "${normalized}" já está em uso por outra barbearia. Por favor, escolha outro.`);
    }

    return normalized;
  },

  async buildProfilePayload(profile: BarberProfile, userId: string): Promise<any> {
    let finalSlug = '';
    const requestedSlug = profile.slug ? normalizeRequestedSlug(profile.slug) : '';

    if (requestedSlug) {
      finalSlug = await this.ensureUniqueProfileSlug(requestedSlug, userId);
    } else {
      const { data: existing } = await supabase
        .from('profiles')
        .select('slug')
        .eq('id', userId)
        .maybeSingle();

      if (existing?.slug) {
        finalSlug = existing.slug;
      } else {
        finalSlug = generateSlug(profile.shopName || profile.name || 'barbearia', userId);
      }
    }

    const payload = {
      id: userId,
      name: profile.name || 'Barbeiro',
      personal_phone: profile.personalPhone || '',
      photo: profile.photo || '',
      shop_name: profile.shopName || '',
      business_phone: profile.businessPhone || '',
      address: profile.address || '',
      logo: profile.logo || '',
      description: profile.description || '',
      instagram: profile.instagram || '',
      website: profile.website || '',
      slug: finalSlug,
      updated_at: new Date().toISOString()
    };

    return payload;
  },

  async updateProfile(profile: BarberProfile) {
    const userId = await this.getUserId();
    if (!userId) {
      throw new Error('Usuário não autenticado para atualizar o perfil.');
    }

    const payload = await this.buildProfilePayload(profile, userId);

    console.log('[PHOTO_FLOW_UPDATE]', {
      userId,
      staffProfileId: null,
      barbershopId: userId,
      table: 'profiles',
      photoSize: profile.photo ? `${profile.photo.length} bytes` : '0 bytes'
    });

    const { error } = await supabase.from('profiles').upsert(payload as any);
    if (error) {
      console.error('[updateProfile] Erro ao salvar perfil:', error.message);
      throw error;
    }
  },

  // Services
  async getServices(targetUserIdOrBarbershopId?: string) {
    try {
      const idToUse = targetUserIdOrBarbershopId || await this.getUserId();

      if (!idToUse) {
        return [];
      }

      const ctx = await this.resolveTenantContext(idToUse);
      const barbershopId = ctx.barbershopId;
      const ownerId = ctx.tenantOwnerId || idToUse;
      const memberIds = ctx.memberUserIds && ctx.memberUserIds.length > 0 ? ctx.memberUserIds : [ownerId, idToUse];

      let query = supabase.from('services').select('*');
      if (barbershopId) {
        query = query.or(`barbershop_id.eq.${barbershopId},user_id.in.(${memberIds.join(',')}),user_id.eq.${ownerId}`);
      } else {
        query = query.or(`user_id.eq.${idToUse},user_id.eq.${ownerId}`);
      }

      const { data, error } = await query.order('order_index', { ascending: true });
      
      if (error) {
        throw error;
      }

      isNetworkOffline = false;
      if (!data) return [];

      const mapped = (data as any[]).map(s => ({
        id: s.id,
        name: s.name,
        price: Number(s.price),
        duration: s.duration
      })) as ServiceItem[];
      
      return mapped;
    } catch (err) {
      return handleNetworkError('getServices', err, []);
    }
  },
  async saveServices(services: ServiceItem[]) {
    const { role, userId } = await this.getUserRoleAndTenant();
    if (role !== 'admin_owner' || !userId) {
      throw new Error('Apenas o proprietário do salão (admin_owner) pode salvar ou gerenciar serviços.');
    }

    const ctx = await this.resolveTenantContext(userId);
    const barbershopId = ctx.barbershopId;

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
    const payload = services.map((s, index) => {
      const item: any = {
        id: isUUID(s.id) ? s.id : crypto.randomUUID(),
        user_id: userId,
        name: s.name,
        price: s.price,
        duration: s.duration,
        order_index: index
      };
      if (barbershopId) {
        item.barbershop_id = barbershopId;
      }
      return item;
    });

    const { data, error } = await supabase.from('services')
      .upsert(payload as any)
      .select();

    if (error) {
      console.error('ERRO no upsert de serviços:', error);
      throw error;
    }

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
      const idToUse = targetUserId || await this.getUserId();
      if (!idToUse) throw new Error('Usuário não autenticado');

      const ctx = await this.resolveTenantContext(idToUse);
      const barbershopId = ctx.barbershopId;
      if (!barbershopId) {
        throw new Error('Contexto da barbearia não encontrado para o usuário.');
      }

      const { data, error } = await supabase
        .from('customers')
        .select('*, customer_photos(*)')
        .eq('barbershop_id', barbershopId);

      if (error) throw error;
      if (!data) return [];

      return (data as any[]).map(c => ({
        id: c.id,
        phone: c.phone,
        name: c.name,
        avatar: c.avatar,
        cutCount: c.cut_count || 0,
        noShowCount: c.no_show_count || 0,
        notes: c.notes || undefined,
        totalVisits: c.total_visits || undefined,
        totalSpent: c.total_spent || undefined,
        lastVisit: c.last_visit || undefined,
        createdAt: c.created_at || undefined,
        updatedAt: c.updated_at || undefined,
        photos: (c.customer_photos || []).map((p: any) => ({
          url: p.url || p.photo_url,
          description: p.description || '',
          date: p.date ? p.date.substring(0, 10) : ''
        })),
        history: [] // History is dynamically fetched and combined from appointments across all barbershop staff
      })) as Customer[];
    } catch (err: any) {
      if (isNetworkOffline) {
        return handleNetworkError('getCustomers', err, []);
      }
      throw err;
    }
  },
  async saveCustomer(customer: Customer, targetUserId?: string) {
    const sessionRes = await supabase.auth.getSession();
    const currentAuthId = sessionRes?.data?.session?.user?.id;
    const userId = targetUserId || currentAuthId || await this.getUserId();
    if (!userId && !currentAuthId) throw new Error('Usuário não autenticado');

    const ctx = await this.resolveTenantContext(userId || currentAuthId!);
    const barbershopId = ctx.barbershopId;
    if (!barbershopId) {
      throw new Error('Contexto da barbearia não encontrado ao salvar cliente.');
    }

    const normalizedPhone = normalizePhone(customer.phone) || customer.phone;

    const payload: any = {
      barbershop_id: barbershopId,
      user_id: currentAuthId || userId,
      phone: normalizedPhone,
      name: customer.name,
      avatar: customer.avatar ?? null,
      cut_count: customer.cutCount ?? 0,
      no_show_count: customer.noShowCount ?? 0
    };

    // 1. Pesquisar cliente existente por barbershop_id + telefone normalizado
    const { data: existing, error: findError } = await supabase
      .from('customers')
      .select('id, phone, barbershop_id')
      .eq('barbershop_id', barbershopId)
      .eq('phone', normalizedPhone)
      .maybeSingle();

    if (findError) throw findError;

    if (existing?.id) {
      // 2. Atualizar registro existente da barbearia por id + barbershop_id
      const { data, error } = await supabase
        .from('customers')
        .update(payload)
        .eq('id', existing.id)
        .eq('barbershop_id', barbershopId)
        .select()
        .maybeSingle();

      if (error) throw error;
      return data;
    }

    // 3. Inserir novo registro compartilhado para a barbearia
    const { data, error } = await supabase
      .from('customers')
      .insert(payload)
      .select()
      .maybeSingle();

    if (error) {
      // Se houver conflito concorrente de chave única, tentar atualizar
      if (error.code === '23505') {
        const { data: fbData, error: fbErr } = await supabase
          .from('customers')
          .update(payload)
          .eq('barbershop_id', barbershopId)
          .eq('phone', normalizedPhone)
          .select()
          .maybeSingle();

        if (fbErr) throw fbErr;
        return fbData;
      }
      throw error;
    }

    return data;
  },
  async addCustomerPhoto(phone: string, photo: { url: string; description: string; date: string }) {
    const sessionRes = await supabase.auth.getSession();
    const currentAuthId = sessionRes?.data?.session?.user?.id;
    const userId = currentAuthId || await this.getUserId();
    if (!userId) throw new Error('Usuário não autenticado');

    const ctx = await this.resolveTenantContext(userId);
    const barbershopId = ctx.barbershopId;
    if (!barbershopId) {
      throw new Error('Contexto da barbearia não encontrado ao adicionar foto.');
    }

    const normalizedPhone = normalizePhone(phone) || phone;

    // Buscar customer_id da barbearia se existir
    let customerId: string | null = null;
    const { data: cust } = await supabase
      .from('customers')
      .select('id')
      .eq('barbershop_id', barbershopId)
      .eq('phone', normalizedPhone)
      .maybeSingle();
    if (cust?.id) customerId = cust.id;

    const payload: any = {
      barbershop_id: barbershopId,
      customer_phone: normalizedPhone,
      user_id: userId,
      url: photo.url,
      description: photo.description || '',
      date: photo.date || new Date().toISOString()
    };
    if (customerId) {
      payload.customer_id = customerId;
    }

    const { error } = await supabase.from('customer_photos').insert(payload as any);
    if (error) throw error;
  },
  async updateCustomer(oldPhone: string, customer: Customer) {
    const sessionRes = await supabase.auth.getSession();
    const currentAuthId = sessionRes?.data?.session?.user?.id;
    const userId = currentAuthId || await this.getUserId();
    if (!userId) throw new Error('Usuário não autenticado');

    const ctx = await this.resolveTenantContext(userId);
    const barbershopId = ctx.barbershopId;
    if (!barbershopId) {
      throw new Error('Contexto da barbearia não encontrado ao atualizar cliente.');
    }

    const normalizedOld = normalizePhone(oldPhone) || oldPhone;
    const normalizedNew = normalizePhone(customer.phone) || customer.phone;

    if (normalizedOld !== normalizedNew) {
      // 1. Verificar se novo telefone já existe na mesma barbearia
      const { data: duplicate, error: dupError } = await supabase
        .from('customers')
        .select('id')
        .eq('barbershop_id', barbershopId)
        .eq('phone', normalizedNew)
        .maybeSingle();

      if (dupError) throw dupError;
      if (duplicate) {
        throw new Error(`Já existe um cliente cadastrado com o telefone ${customer.phone} nesta barbearia.`);
      }

      // 2. Inserir novo registro de cliente com o novo telefone
      const newPayload: any = {
        barbershop_id: barbershopId,
        user_id: userId,
        phone: normalizedNew,
        name: customer.name,
        avatar: customer.avatar ?? null,
        cut_count: customer.cutCount ?? 0,
        no_show_count: customer.noShowCount ?? 0
      };

      const { error: insertError } = await supabase.from('customers').insert(newPayload as any);
      if (insertError) throw insertError;

      // 3. Atualizar fotos para o novo telefone dentro da mesma barbearia
      const { error: photoErr } = await (supabase.from('customer_photos') as any)
        .update({ customer_phone: normalizedNew })
        .eq('barbershop_id', barbershopId)
        .eq('customer_phone', normalizedOld);
      if (photoErr) throw photoErr;

      // 4. Atualizar appointments para o novo telefone dentro da mesma barbearia
      const { error: aptErr } = await (supabase.from('appointments') as any)
        .update({ phone: normalizedNew, client_name: customer.name })
        .eq('barbershop_id', barbershopId)
        .eq('phone', normalizedOld);
      if (aptErr) throw aptErr;

      // 5. Excluir cliente antigo dentro da mesma barbearia
      const { error: deleteErr } = await (supabase.from('customers') as any)
        .delete()
        .eq('barbershop_id', barbershopId)
        .eq('phone', normalizedOld);
      if (deleteErr) throw deleteErr;
    } else {
      // Atualização normal sem mudança de telefone
      const updatePayload: any = {
        name: customer.name,
        avatar: customer.avatar ?? null,
        cut_count: customer.cutCount ?? 0,
        no_show_count: customer.noShowCount ?? 0
      };

      let updateQuery = (supabase.from('customers') as any)
        .update(updatePayload)
        .eq('barbershop_id', barbershopId);

      if (customer.id) {
        updateQuery = updateQuery.eq('id', customer.id);
      } else {
        updateQuery = updateQuery.eq('phone', normalizedOld);
      }

      const { error } = await updateQuery;
      if (error) throw error;

      // Atualizar nome nos appointments correspondentes dentro da mesma barbearia
      const { error: aptErr } = await (supabase.from('appointments') as any)
        .update({ client_name: customer.name })
        .eq('barbershop_id', barbershopId)
        .eq('phone', normalizedOld);
      if (aptErr) throw aptErr;
    }
  },
  async checkDuplicateCustomer(phone: string) {
    const sessionRes = await supabase.auth.getSession();
    const currentAuthId = sessionRes?.data?.session?.user?.id;
    const userId = currentAuthId || await this.getUserId();
    if (!userId) return null;

    const ctx = await this.resolveTenantContext(userId);
    const barbershopId = ctx.barbershopId;
    if (!barbershopId) {
      throw new Error('Contexto da barbearia não encontrado ao verificar duplicidade.');
    }

    const normalizedPhone = normalizePhone(phone) || phone;

    const { data, error } = await supabase
      .from('customers')
      .select('id, phone, name, barbershop_id')
      .eq('barbershop_id', barbershopId)
      .eq('phone', normalizedPhone)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data;
  },

  // Appointments
  async getAppointments(targetUserId?: string) {
    if (isNetworkOffline) return [];
    try {
      const idToUse = targetUserId || await this.getUserId();
      if (!idToUse) return [];

      const ctx = await this.resolveTenantContext(idToUse);
      const barbershopId = ctx.barbershopId;
      if (!barbershopId) {
        throw new Error(`[getAppointments] Contexto de barbearia (barbershop_id) não encontrado para o usuário ${idToUse}.`);
      }

      let query = supabase.from('appointments').select('*').eq('barbershop_id', barbershopId);

      if (ctx.role === 'staff') {
        if (!ctx.staffProfileId) {
          throw new Error(`[getAppointments] Perfil de colaborador (staff_profiles.id) não encontrado para o colaborador ${idToUse}.`);
        }
        query = query.eq('staff_id', ctx.staffProfileId);
      }

      const { data, error } = await query;
      if (error) throw error;
      if (!data) return [];

      return (data as any[]).map(a => {
        if (!a.barbershop_id) {
          throw new Error(`[getAppointments] Appointment ${a.id} possui barbershop_id nulo no banco.`);
        }
        return {
          id: a.id,
          tenantId: a.barbershop_id,
          staffId: a.staff_id ?? null,
          userId: a.user_id,
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
        } as Appointment;
      });
    } catch (err: any) {
      return handleNetworkError('getAppointments', err, []);
    }
  },

  async getAppointmentsByDate(date: string, targetUserId?: string) {
    if (isNetworkOffline) return [];
    try {
      const idToUse = targetUserId || await this.getUserId();
      if (!idToUse) return [];

      const ctx = await this.resolveTenantContext(idToUse);
      const barbershopId = ctx.barbershopId;
      if (!barbershopId) {
        throw new Error(`[getAppointmentsByDate] Contexto de barbearia (barbershop_id) não encontrado para o usuário ${idToUse}.`);
      }

      let query = supabase
        .from('appointments')
        .select('*')
        .eq('barbershop_id', barbershopId)
        .eq('date', date);

      if (ctx.role === 'staff') {
        if (!ctx.staffProfileId) {
          throw new Error(`[getAppointmentsByDate] Perfil de colaborador (staff_profiles.id) não encontrado para o colaborador ${idToUse}.`);
        }
        query = query.eq('staff_id', ctx.staffProfileId);
      }

      const { data, error } = await query.order('time', { ascending: true });
      
      if (error) throw error;
      if (!data) return [];

      return (data as any[]).map(a => {
        if (!a.barbershop_id) {
          throw new Error(`[getAppointmentsByDate] Appointment ${a.id} possui barbershop_id nulo no banco.`);
        }
        return {
          id: a.id,
          tenantId: a.barbershop_id,
          staffId: a.staff_id ?? null,
          userId: a.user_id,
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
        } as Appointment;
      });
    } catch (err) {
      return handleNetworkError(`getAppointmentsByDate`, err, []);
    }
  },

  async getMyAppointments(viewerUserId: string): Promise<Appointment[]> {
    if (isNetworkOffline) return [];
    try {
      const ctx = await this.resolveTenantContext(viewerUserId);
      const barbershopId = ctx.barbershopId;
      if (!barbershopId) {
        throw new Error(`[getMyAppointments] Contexto de barbearia (barbershop_id) não encontrado para o usuário ${viewerUserId}.`);
      }

      if (!ctx.staffProfileId) {
        // Owner/admin sem staff_profiles: não tentar usar userId como staff_id; retornar array vazio
        return [];
      }

      const query = supabase
        .from('appointments')
        .select('*')
        .eq('barbershop_id', barbershopId)
        .eq('staff_id', ctx.staffProfileId);

      const { data, error } = await query;

      if (error) throw error;
      return (data || []).map((a: any) => {
        if (!a.barbershop_id) {
          throw new Error(`[getMyAppointments] Appointment ${a.id} possui barbershop_id nulo no banco.`);
        }
        return {
          id: a.id,
          tenantId: a.barbershop_id,
          staffId: a.staff_id ?? null,
          userId: a.user_id,
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
        } as Appointment;
      });
    } catch (err) {
      return handleNetworkError('getMyAppointments', err, []);
    }
  },

  async getTeamAppointments(tenantOwnerUserId: string): Promise<Appointment[]> {
    return this.getAppointments(tenantOwnerUserId);
  },

  async getStaffAppointments(staffUserIdOrId: string, tenantOwnerUserId: string): Promise<Appointment[]> {
    if (isNetworkOffline) return [];
    try {
      const ctx = await this.resolveTenantContext(tenantOwnerUserId);
      const barbershopId = ctx.barbershopId;
      if (!barbershopId) {
        throw new Error(`[getStaffAppointments] Contexto de barbearia (barbershop_id) não encontrado para a barbearia ${tenantOwnerUserId}.`);
      }

      // Validar se staffUserIdOrId é staffProfileId ou userId e buscar staff_profiles.id real
      let targetStaffProfileId = staffUserIdOrId;
      const { data: staffData } = await supabase
        .from('staff_profiles')
        .select('id, user_id, barbershop_id')
        .or(`id.eq.${staffUserIdOrId},user_id.eq.${staffUserIdOrId}`)
        .eq('barbershop_id', barbershopId)
        .maybeSingle();

      if (staffData?.id) {
        targetStaffProfileId = staffData.id;
      }

      const query = supabase
        .from('appointments')
        .select('*')
        .eq('barbershop_id', barbershopId)
        .eq('staff_id', targetStaffProfileId);

      const { data, error } = await query;

      if (error) throw error;
      return (data || []).map((a: any) => {
        if (!a.barbershop_id) {
          throw new Error(`[getStaffAppointments] Appointment ${a.id} possui barbershop_id nulo no banco.`);
        }
        return {
          id: a.id,
          tenantId: a.barbershop_id,
          staffId: a.staff_id ?? null,
          userId: a.user_id,
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
        } as Appointment;
      });
    } catch (err) {
      return handleNetworkError('getStaffAppointments', err, []);
    }
  },

  async updateAppointmentStatus(appointmentId: string, status: 'pending' | 'completed' | 'no-show' | 'cancelled'): Promise<Appointment> {
    const currentUserId = await this.getUserId();
    if (!currentUserId) throw new Error('User not authenticated');

    const ctx = await this.resolveTenantContext(currentUserId);
    const barbershopId = ctx.barbershopId;
    if (!barbershopId) {
      throw new Error(`[updateAppointmentStatus] Contexto de barbearia (barbershop_id) não encontrado.`);
    }

    let query = supabase
      .from('appointments')
      .update({ status })
      .eq('id', appointmentId)
      .eq('barbershop_id', barbershopId);

    if (ctx.role === 'staff') {
      if (!ctx.staffProfileId) {
        throw new Error(`[updateAppointmentStatus] Perfil de colaborador (staff_profiles.id) não encontrado para o staff autenticado.`);
      }
      query = query.eq('staff_id', ctx.staffProfileId);
    }

    const { data, error } = await query.select('*').maybeSingle();
    if (error) throw error;
    if (!data) {
      throw new Error(`[updateAppointmentStatus] Nenhum registro atualizado. Detalhes: appointmentId="${appointmentId}", barbershopId="${barbershopId}", role="${ctx.role}", staffProfileId="${ctx.staffProfileId || 'N/A'}".`);
    }

    const a = data as any;
    return {
      id: a.id,
      tenantId: a.barbershop_id,
      staffId: a.staff_id ?? null,
      userId: a.user_id,
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
    } as Appointment;
  },

  async completeAppointment(appointmentId: string): Promise<Appointment> {
    return this.updateAppointmentStatus(appointmentId, 'completed');
  },

  async revertAppointment(appointmentId: string): Promise<Appointment> {
    return this.updateAppointmentStatus(appointmentId, 'pending');
  },

  async markAppointmentNoShow(appointmentId: string): Promise<Appointment> {
    return this.updateAppointmentStatus(appointmentId, 'no-show');
  },

  async saveAppointment(appointment: Appointment, targetUserId?: string) {
    const currentUserId = await this.getUserId();
    const idToUse = targetUserId || appointment.tenantId || currentUserId;
    if (!idToUse && !currentUserId) throw new Error('User not authenticated');

    const ctx = await this.resolveTenantContext(idToUse || currentUserId!);
    const barbershopId = ctx.barbershopId;
    if (!barbershopId) {
      throw new Error(`[saveAppointment] Contexto de barbearia (barbershop_id) não encontrado.`);
    }

    const isAdmin = ctx.role === 'admin_owner';
    let effectiveStaffId = isAdmin ? (appointment.staffId || ctx.staffProfileId) : ctx.staffProfileId;

    if (!effectiveStaffId) {
      throw new Error(`[saveAppointment] Profissional (staff_id) obrigatório não fornecido ou não encontrado.`);
    }

    // Validar se effectiveStaffId é um staff_profiles.id real pertencente a este barbershop_id
    const { data: staffRow, error: staffErr } = await supabase
      .from('staff_profiles')
      .select('id, barbershop_id')
      .or(`id.eq.${effectiveStaffId},user_id.eq.${effectiveStaffId}`)
      .eq('barbershop_id', barbershopId)
      .maybeSingle();

    if (staffErr || !staffRow) {
      throw new Error(`[saveAppointment] Profissional id="${effectiveStaffId}" não é um staff_profiles válido da barbearia ${barbershopId}.`);
    }

    effectiveStaffId = staffRow.id;

    const isUUID = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

    const dataToSave: any = {
      barbershop_id: barbershopId,
      staff_id: effectiveStaffId,
      user_id: currentUserId || ctx.tenantOwnerId || ctx.userId,
      created_by: currentUserId || ctx.userId,
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

    const { data, error } = await supabase.from('appointments').upsert(dataToSave).select().single();
    if (error) throw error;
    const a = data as any;
    if (!a.barbershop_id) {
      throw new Error(`[saveAppointment] Appointment ${a.id} salvo com barbershop_id nulo.`);
    }
    return {
      id: a.id,
      tenantId: a.barbershop_id,
      staffId: a.staff_id ?? null,
      userId: a.user_id,
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
  },
  async deleteAppointment(id: string) {
    const userId = await this.getUserId();
    if (!userId) throw new Error('User not authenticated');

    const { error } = await supabase.from('appointments').delete().eq('id', id);
    if (error) throw error;
  },

  // Weekly Schedule
  async getWeeklySchedule(targetUserId?: string) {
    try {
      const idToUse = targetUserId || await this.getUserId();
      if (!idToUse) return {};

      let ownerId = idToUse;
      const { data: shop } = await supabase
        .from('barbershops')
        .select('owner_id')
        .eq('id', idToUse)
        .maybeSingle();

      if (shop?.owner_id) {
        ownerId = shop.owner_id;
      }

      const { data: schedule, error: sError } = await supabase
        .from('weekly_schedule')
        .select('*')
        .or(`user_id.eq.${idToUse},user_id.eq.${ownerId}`);
      const { data: breaks, error: bError } = await supabase
        .from('weekly_breaks')
        .select('*')
        .or(`user_id.eq.${idToUse},user_id.eq.${ownerId}`);
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

    const { data, error } = await supabase.from('weekly_schedule').upsert(payload as any).select();
    
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
      const idToUse = targetUserId || await this.getUserId();
      if (!idToUse) return {};

      let ownerId = idToUse;
      const { data: shop } = await supabase
        .from('barbershops')
        .select('owner_id')
        .eq('id', idToUse)
        .maybeSingle();

      if (shop?.owner_id) {
        ownerId = shop.owner_id;
      }

      const { data, error } = await supabase
        .from('blocked_slots')
        .select('*')
        .or(`user_id.eq.${idToUse},user_id.eq.${ownerId}`);
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
      const idToUse = targetUserId || await this.getUserId();
      if (!idToUse) return {};

      let ownerId = idToUse;
      const { data: shop } = await supabase
        .from('barbershops')
        .select('owner_id')
        .eq('id', idToUse)
        .maybeSingle();

      if (shop?.owner_id) {
        ownerId = shop.owner_id;
      }

      const { data, error } = await supabase
        .from('unblocked_slots')
        .select('*')
        .or(`user_id.eq.${idToUse},user_id.eq.${ownerId}`);
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

  async getStaff(tenantId: string): Promise<Staff[]> {
    try {
      let ownerUserId = tenantId;
      let barbershopId = tenantId;

      const { data: shop } = await supabase
        .from('barbershops')
        .select('id, owner_id')
        .or(`id.eq.${tenantId},owner_id.eq.${tenantId}`)
        .maybeSingle();

      if (shop) {
        barbershopId = shop.id;
        ownerUserId = shop.owner_id;
      }

      const { data, error } = await supabase
        .from('staff_profiles')
        .select('*')
        .eq('barbershop_id', barbershopId);

      if (error) {
        if (
          error.code === 'PGRST116' || 
          error.code === '42P01' || 
          error.message?.includes('does not exist') || 
          error.message?.includes('não existe')
        ) {
          return [];
        }
        throw error;
      }

      const rawMembers: any[] = data || [];
      const seenUserIds = new Set<string>();
      const seenIds = new Set<string>();
      const deduplicatedStaff: Staff[] = [];

      for (const s of rawMembers) {
        if (s.user_id) {
          if (seenUserIds.has(s.user_id)) {
            console.warn(`[getStaff] Inconsistência detectada: Múltiplos staff_profiles com user_id="${s.user_id}". Mantendo o primeiro e ignorando duplicado id="${s.id}".`);
            continue;
          }
          seenUserIds.add(s.user_id);
        }
        if (seenIds.has(s.id)) {
          console.warn(`[getStaff] Inconsistência detectada: Múltiplos staff_profiles com id="${s.id}".`);
          continue;
        }
        seenIds.add(s.id);

        const isOwner = s.user_id === ownerUserId || s.role === 'admin' || s.role === 'admin_owner';
        deduplicatedStaff.push({
          id: s.id,
          tenantId: s.barbershop_id || barbershopId,
          userId: s.user_id || undefined,
          name: s.name || 'Profissional',
          phone: s.phone || '',
          photo: s.photo ?? null,
          status: s.status || 'active',
          commissionRate: Number(s.commission_rate || 0),
          role: (isOwner ? 'admin' : 'staff') as 'admin' | 'staff'
        });
      }

      // Ordenar para que o Administrador/Owner fique sempre no topo da lista
      deduplicatedStaff.sort((a, b) => {
        const aIsAdmin = (a.role === 'admin' || a.userId === ownerUserId) ? 1 : 0;
        const bIsAdmin = (b.role === 'admin' || b.userId === ownerUserId) ? 1 : 0;
        if (aIsAdmin !== bIsAdmin) {
          return bIsAdmin - aIsAdmin; // Administrador primeiro
        }
        return (a.name || '').localeCompare(b.name || '');
      });

      isNetworkOffline = false;
      return deduplicatedStaff;
    } catch (err: any) {
      if (isNetworkError(err)) {
        return handleNetworkError('getStaff', err, []);
      }
      console.error('[getStaff] Erro ao buscar equipe:', err);
      throw err;
    }
  },

  async saveStaff(staff: Omit<Staff, 'id' | 'tenantId'> & { id?: string; tenantId?: string; role?: 'admin' | 'staff' | 'admin_owner'; barbershopId?: string }) {
    const { role } = await this.getUserRoleAndTenant();
    const currentUserId = await this.getUserId();
    const isSelf = !!(currentUserId && (staff.userId === currentUserId || staff.id === currentUserId));

    if (role !== 'admin_owner' && !isSelf) {
      throw new Error('Apenas o proprietário do salão (admin_owner) pode gerenciar ou salvar equipe.');
    }

    const tenantId = staff.tenantId || await this.getTenantIdForUser(currentUserId || '') || await this.getUserId();
    if (!tenantId) throw new Error('Tenant ID not authenticated');

    const id = staff.id || crypto.randomUUID();
    const staffRole = staff.role === 'admin' || staff.role === 'admin_owner' ? 'admin' : 'staff';

    const tenantContext = await this.resolveTenantContext(currentUserId || undefined);
    const activeBarbershopId = staff.barbershopId || tenantContext.barbershopId || staff.tenantId || await this.getTenantIdForUser(currentUserId || '') || await this.getUserId();
    const tenantOwnerId = tenantContext.tenantOwnerId || tenantId;

    console.log('[PHOTO_FLOW_UPDATE]', {
      userId: isSelf ? currentUserId : (staff.userId || null),
      staffProfileId: id,
      barbershopId: activeBarbershopId || tenantId,
      table: 'staff_profiles',
      photoSize: staff.photo ? `${staff.photo.length} bytes` : '0 bytes'
    });

    const payload: any = {
      id: id,
      tenant_id: tenantOwnerId || tenantId,
      barbershop_id: activeBarbershopId || tenantId,
      user_id: staff.userId || (isSelf ? currentUserId : null),
      name: staff.name,
      phone: staff.phone,
      photo: staff.photo || null,
      status: staff.status || 'active',
      role: staffRole
    };

    if (role === 'admin_owner') {
      payload.commission_rate = staff.commissionRate || 0;
    } else if (staff.commissionRate !== undefined) {
      payload.commission_rate = staff.commissionRate;
    }

    let resultData: any = null;

    if (role === 'admin_owner' && !isSelf) {
      try {
        const { data, error } = await supabase.from('staff_profiles').upsert(payload).select().single();
        if (error) throw error;
        resultData = data;

        // Se houver userId e for admin_owner, atualiza o papel em barbershop_members
        if (staff.userId) {
          try {
            await supabase
              .from('barbershop_members')
              .update({ role: staffRole })
              .eq('barbershop_id', tenantId)
              .eq('user_id', staff.userId);
          } catch (memberErr) {
            console.warn('[saveStaff] Warning updating barbershop_members role:', memberErr);
          }
        }
      } catch (upsertErr) {
        console.warn('[saveStaff] Erro ao fazer upsert em staff_profiles como admin:', upsertErr);
        throw upsertErr;
      }
    } else if (currentUserId) {
      // Validação do UUID do funcionário
      const userId = currentUserId;
      if (staff.userId && staff.userId !== userId) {
        throw new Error('Operação não permitida: user_id não corresponde ao funcionário autenticado');
      }

      let staffProfileId = staff.id;
      let barbershopId = staff.barbershopId || activeBarbershopId || tenantContext.barbershopId || tenantId;

      // Localizar o registro em staff_profiles correspondente ao usuário atual
      const { data: existingStaffRow } = await supabase
        .from('staff_profiles')
        .select('id, user_id, barbershop_id')
        .eq('user_id', userId)
        .maybeSingle();

      if (existingStaffRow) {
        staffProfileId = existingStaffRow.id;
        if (existingStaffRow.barbershop_id) {
          barbershopId = existingStaffRow.barbershop_id;
        }
      }

      if (!barbershopId) {
        const { data: memberRow } = await supabase
          .from('barbershop_members')
          .select('barbershop_id')
          .eq('user_id', userId)
          .maybeSingle();
        if (memberRow?.barbershop_id) {
          barbershopId = memberRow.barbershop_id;
        }
      }

      // Validação de barbershop_id correspondente ao tenant atual
      const expectedTenant = activeBarbershopId || tenantContext.barbershopId || tenantId;
      if (!barbershopId || (expectedTenant && barbershopId !== expectedTenant && barbershopId !== tenantContext.barbershopId)) {
        if (!barbershopId && expectedTenant) {
          barbershopId = expectedTenant;
        }
      }

      if (!staffProfileId) {
        throw new Error('staff_profile id não encontrado para o funcionário');
      }

      if (!barbershopId) {
        throw new Error('barbershop_id não encontrado para o tenant atual');
      }

      // Payload estritamente restrito a { photo: photoValue } sem alterar tenant_id, user_id, barbershop_id
      const photoValue = staff.photo !== undefined ? (staff.photo || null) : null;
      const updatePayload = { photo: photoValue };
      const photoSize = photoValue ? photoValue.length : 0;

      console.log('[PHOTO_FLOW_UPDATE]', {
        userId,
        staffProfileId,
        barbershopId,
        table: 'staff_profiles',
        payloadKeys: Object.keys(updatePayload),
        photoSize: `${photoSize} bytes`
      });

      const { data, error } = await supabase
        .from('staff_profiles')
        .update(updatePayload)
        .eq('id', staffProfileId)
        .eq('user_id', userId)
        .eq('barbershop_id', barbershopId)
        .select('id, user_id, barbershop_id, photo')
        .single();

      if (error) {
        console.error('[PHOTO_FLOW_UPDATE_ERROR]', {
          userId,
          staffProfileId,
          barbershopId,
          table: 'staff_profiles',
          errorCode: error.code,
          errorMessage: error.message
        });
        // Repassar erro original, especialmente 42501, sem mascaramento
        throw error;
      }

      if (!data) {
        throw new Error('Nenhum staff_profile atualizado');
      }

      const returnedPhotoSize = data.photo ? data.photo.length : 0;
      console.log('[PHOTO_FLOW_AFTER_UPDATE]', {
        userId,
        staffProfileId,
        barbershopId,
        table: 'staff_profiles',
        photoSize: `${returnedPhotoSize} bytes`
      });

      // Leitura de verificação pelo mesmo: id, user_id, barbershop_id
      const { data: verifyData, error: verifyError } = await supabase
        .from('staff_profiles')
        .select('id, user_id, barbershop_id, photo')
        .eq('id', staffProfileId)
        .eq('user_id', userId)
        .eq('barbershop_id', barbershopId)
        .single();

      console.log('[PHOTO_FLOW_VERIFY]', {
        userId,
        staffProfileId,
        barbershopId,
        table: 'staff_profiles',
        photoSize: verifyData?.photo ? `${verifyData.photo.length} bytes` : '0 bytes',
        error: verifyError ? { code: verifyError.code, message: verifyError.message } : null
      });

      resultData = {
        id: staffProfileId,
        tenant_id: tenantOwnerId || tenantId,
        barbershop_id: barbershopId,
        user_id: userId,
        name: staff.name,
        phone: staff.phone,
        photo: data.photo,
        status: staff.status || 'active',
        commission_rate: staff.commissionRate || 0,
        role: staffRole
      };
    }

    if (!resultData) {
      resultData = {
        id: id,
        tenant_id: tenantId,
        barbershop_id: tenantId,
        user_id: staff.userId || (isSelf ? currentUserId : null),
        name: staff.name,
        phone: staff.phone,
        photo: staff.photo || null,
        status: staff.status || 'active',
        commission_rate: staff.commissionRate || 0,
        role: staffRole
      };
    }

    // Atualizar cache local do tenant
    const localKey = `meucorte_staff_${tenantId}`;
    try {
      const stored = localStorage.getItem(localKey);
      let list: Staff[] = stored ? JSON.parse(stored) : [];
      const mappedStaff: Staff = {
        id: resultData.id,
        tenantId: resultData.tenant_id || resultData.barbershop_id || tenantId,
        userId: resultData.user_id,
        name: resultData.name,
        phone: resultData.phone,
        photo: resultData.photo || undefined,
        status: resultData.status || 'active',
        commissionRate: resultData.commission_rate || 0,
        role: (resultData.role === 'admin' ? 'admin' : 'staff') as 'admin' | 'staff'
      };
      const index = list.findIndex((s: any) => s.id === id || (s.userId && s.userId === mappedStaff.userId));
      if (index > -1) {
        list[index] = mappedStaff;
      } else {
        list.push(mappedStaff);
      }
      localStorage.setItem(localKey, JSON.stringify(list));
    } catch {}

    return resultData;
  },

  async deleteStaff(id: string) {
    const { role } = await this.getUserRoleAndTenant();
    if (role !== 'admin_owner') {
      throw new Error('Apenas o proprietário do salão (admin_owner) pode excluir membros da equipe.');
    }

    try {
      const { error } = await supabase.from('staff_profiles').delete().eq('id', id);
      if (error) throw error;

      // Update local storage
      const tenantId = await this.getUserId();
      if (tenantId) {
        const localKey = `meucorte_staff_${tenantId}`;
        try {
          const stored = localStorage.getItem(localKey);
          if (stored) {
            let list: Staff[] = JSON.parse(stored);
            list = list.filter((s: any) => s.id !== id);
            localStorage.setItem(localKey, JSON.stringify(list));
          }
        } catch {}
      }
    } catch (error: any) {
      const tenantId = await this.getUserId();
      if (tenantId) {
        const localKey = `meucorte_staff_${tenantId}`;
        try {
          const stored = localStorage.getItem(localKey);
          if (stored) {
            let list: Staff[] = JSON.parse(stored);
            list = list.filter((s: any) => s.id !== id);
            localStorage.setItem(localKey, JSON.stringify(list));
          }
        } catch {}
      }

      if (
        error.code === '42P01' || 
        error.message?.includes('does not exist') || 
        error.message?.includes('não existe')
      ) {
        return;
      }
      console.warn('[deleteStaff] Warning deleting staff:', error);
    }
  },

  async getTenantIdForUser(userId: string): Promise<string> {
    try {
      // 1. Tenta buscar em barbershop_members
      const { data: members, error: memberError } = await supabase
        .from('barbershop_members')
        .select('barbershop_id, role')
        .eq('user_id', userId);

      if (!memberError && members && members.length > 0) {
        const targetShopId = members[0].barbershop_id;
        if (targetShopId) {
          return targetShopId;
        }
      }

      // 2. Se for proprietário direto na tabela barbershops
      const { data: ownedShop } = await supabase
        .from('barbershops')
        .select('id')
        .eq('owner_id', userId)
        .maybeSingle();

      if (ownedShop?.id) {
        return ownedShop.id;
      }

      // 3. Fallback para staff_profiles
      const { data: staffData, error: staffError } = await supabase
        .from('staff_profiles')
        .select('barbershop_id')
        .eq('user_id', userId)
        .maybeSingle();
      
      if (!staffError && staffData && (staffData as any).barbershop_id) {
        return (staffData as any).barbershop_id;
      }
      return userId;
    } catch (err) {
      console.warn('[getTenantIdForUser] Erro ao buscar tenant para o usuário:', err);
      return userId;
    }
  },

  async resolveTenantContext(targetUserId?: string): Promise<{
    barbershopId: string | null;
    tenantOwnerId: string;
    userId: string;
    role: 'admin_owner' | 'staff' | 'client';
    memberUserIds: string[];
    staffProfileId: string | null;
    staffProfileIds: string[];
  }> {
    try {
      const currentAuthUser = await this.getUserId();
      const inputId = targetUserId || currentAuthUser;
      if (!inputId) {
        return { barbershopId: null, tenantOwnerId: '', userId: '', role: 'client', memberUserIds: [], staffProfileId: null, staffProfileIds: [] };
      }

      let barbershopId: string | null = null;
      let tenantOwnerId = inputId;
      let detectedRole: 'admin_owner' | 'staff' | 'client' = 'admin_owner';
      let staffProfileId: string | null = null;

      // 1. Tentar verificar se inputId é proprietário em barbershops
      const { data: shopByOwner } = await supabase
        .from('barbershops')
        .select('id, owner_id')
        .eq('owner_id', inputId)
        .maybeSingle();

      if (shopByOwner) {
        barbershopId = (shopByOwner as any).id;
        tenantOwnerId = (shopByOwner as any).owner_id || inputId;
        detectedRole = 'admin_owner';
      }

      // 2. Tentar identificar se inputId é diretamente um ID de barbearia (UUID de barbershops)
      if (!barbershopId) {
        const { data: shopById } = await supabase
          .from('barbershops')
          .select('id, owner_id')
          .eq('id', inputId)
          .maybeSingle();

        if (shopById) {
          barbershopId = (shopById as any).id;
          tenantOwnerId = (shopById as any).owner_id || inputId;
          if (currentAuthUser === shopById.owner_id || inputId === shopById.owner_id) {
            detectedRole = 'admin_owner';
          }
        }
      }

      // 3. Se não encontrou, tentar barbershop_members pelo inputId
      if (!barbershopId) {
        const { data: members } = await supabase
          .from('barbershop_members')
          .select('barbershop_id, role, user_id, barbershops(id, owner_id)')
          .eq('user_id', inputId);

        if (members && members.length > 0) {
          const member = members[0] as any;
          barbershopId = member.barbershop_id;
          tenantOwnerId = member.barbershops?.owner_id || inputId;
          detectedRole = (member.role === 'owner' || member.role === 'admin' || member.role === 'admin_owner') ? 'admin_owner' : 'staff';
        }
      }

      // 4. Se não encontrou, tentar staff_profiles por user_id
      if (!barbershopId) {
        const { data: staffData } = await supabase
          .from('staff_profiles')
          .select('id, barbershop_id, user_id, role')
          .eq('user_id', inputId)
          .maybeSingle();

        if (staffData) {
          barbershopId = (staffData as any).barbershop_id || null;
          staffProfileId = (staffData as any).id || null;
          detectedRole = (staffData as any).role === 'admin' || (staffData as any).role === 'owner' ? 'admin_owner' : 'staff';
          
          if (barbershopId) {
            const { data: shopFromStaff } = await supabase
              .from('barbershops')
              .select('id, owner_id')
              .eq('id', barbershopId)
              .maybeSingle();
            if (shopFromStaff) {
              tenantOwnerId = (shopFromStaff as any).owner_id || tenantOwnerId;
            } else {
              tenantOwnerId = inputId;
            }
          }
        }
      }

      // 5. Coletar todos os memberUserIds e staffProfileIds da barbearia
      const memberIdsSet = new Set<string>();
      const staffProfileIdsSet = new Set<string>();

      if (tenantOwnerId) memberIdsSet.add(tenantOwnerId);
      if (inputId) memberIdsSet.add(inputId);
      if (currentAuthUser) memberIdsSet.add(currentAuthUser);

      if (barbershopId) {
        const [membersRes, staffRes] = await Promise.all([
          supabase.from('barbershop_members').select('user_id').eq('barbershop_id', barbershopId),
          supabase.from('staff_profiles').select('id, user_id').eq('barbershop_id', barbershopId)
        ]);

        (membersRes.data || []).forEach((m: any) => {
          if (m.user_id) memberIdsSet.add(m.user_id);
        });

        (staffRes.data || []).forEach((s: any) => {
          if (s.id) staffProfileIdsSet.add(s.id);
          if (s.user_id) memberIdsSet.add(s.user_id);
          if (s.user_id === inputId || s.user_id === currentAuthUser || s.id === inputId) {
            staffProfileId = s.id;
          }
        });
      } else {
        const { data: staffRes } = await supabase
          .from('staff_profiles')
          .select('id, user_id')
          .eq('user_id', inputId);

        (staffRes || []).forEach((s: any) => {
          if (s.id) staffProfileIdsSet.add(s.id);
          if (s.user_id) memberIdsSet.add(s.user_id);
          if (s.user_id === inputId || s.user_id === currentAuthUser || s.id === inputId) {
            staffProfileId = s.id;
          }
        });
      }

      return {
        barbershopId,
        tenantOwnerId,
        userId: currentAuthUser || inputId,
        role: detectedRole,
        memberUserIds: Array.from(memberIdsSet),
        staffProfileId,
        staffProfileIds: Array.from(staffProfileIdsSet)
      };
    } catch (err) {
      console.warn('[resolveTenantContext] Erro ao resolver contexto:', err);
      const fallbackId = targetUserId || '';
      return {
        barbershopId: null,
        tenantOwnerId: fallbackId,
        userId: fallbackId,
        role: 'admin_owner',
        memberUserIds: fallbackId ? [fallbackId] : [],
        staffProfileId: null,
        staffProfileIds: []
      };
    }
  },

  async getTenantMemberIds(tenantOwnerUserId: string): Promise<string[]> {
    try {
      const ctx = await this.resolveTenantContext(tenantOwnerUserId);
      if (ctx.memberUserIds && ctx.memberUserIds.length > 0) {
        return ctx.memberUserIds;
      }
      return [tenantOwnerUserId];
    } catch {
      return [tenantOwnerUserId];
    }
  },

  async getUserRoleAndTenant(): Promise<{ role: 'admin_owner' | 'staff' | 'client'; tenantId: string | null; userId: string | null }> {
    try {
      const userId = await this.getUserId();
      if (!userId) {
        return { role: 'client', tenantId: null, userId: null };
      }

      // 1. Tenta buscar nas novas tabelas de membros da barbearia
      const { data: members, error: memberError } = await supabase
        .from('barbershop_members')
        .select('barbershop_id, role, barbershops(owner_id)')
        .eq('user_id', userId);

      if (!memberError && members && members.length > 0) {
        const memberData = members[0];
        const role = (memberData as any).role === 'owner' ? 'admin_owner' : 'staff';
        const ownerId = (memberData as any).barbershops?.owner_id || userId;
        return { role, tenantId: ownerId, userId };
      }

      // Fallback legado
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

      // Update local storage cache
      const localKey = `meucorte_availability_${staffId}`;
      try {
        localStorage.setItem(localKey, JSON.stringify(data || []));
      } catch {}

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
    } catch (err: any) {
      console.warn('[getStaffAvailability] Erro ou tabela inexistente, tentando fallback do localStorage:', err);
      
      // Try local storage fallback
      const localKey = `meucorte_availability_${staffId}`;
      try {
        const stored = localStorage.getItem(localKey);
        if (stored) {
          const data = JSON.parse(stored) as any[];
          return data.map(item => ({
            id: item.id || crypto.randomUUID(),
            staffId: item.staff_id || item.staffId || staffId,
            dayOfWeek: item.day_of_week ?? item.dayOfWeek,
            startTime: normalizeTime(item.start_time || item.startTime),
            endTime: normalizeTime(item.end_time || item.endTime),
            breaks: item.breaks || [],
            isOpen: item.is_open ?? item.isOpen,
            createdAt: item.created_at || item.createdAt
          }));
        }
      } catch {}
      
      return [];
    }
  },

  async saveStaffAvailability(availabilities: Omit<StaffAvailability, 'id'>[]) {
    if (availabilities.length === 0) return;
    const staffId = availabilities[0].staffId;

    try {
      const { role, userId } = await this.getUserRoleAndTenant();
      if (role === 'client' || !userId) {
        throw new Error('Não autorizado.');
      }

      let isStaffTableOk = true;
      if (role === 'staff') {
        try {
          const { data: staffMember, error: staffErr } = await supabase
            .from('staff_profiles')
            .select('id')
            .eq('user_id', userId)
            .maybeSingle();

          if (staffErr) {
            if (staffErr.code === '42P01' || staffErr.message?.includes('does not exist') || staffErr.message?.includes('não existe')) {
              isStaffTableOk = false;
            } else {
              throw staffErr;
            }
          } else if (!staffMember || (staffMember as any).id !== staffId) {
            throw new Error('Apenas permitido editar sua própria disponibilidade.');
          }
        } catch (err: any) {
          if (err.code === '42P01' || err.message?.includes('does not exist') || err.message?.includes('não existe')) {
            isStaffTableOk = false;
          } else {
            throw err;
          }
        }
      }

      if (isStaffTableOk) {
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
        
        // Save to cache too
        const localKey = `meucorte_availability_${staffId}`;
        try {
          localStorage.setItem(localKey, JSON.stringify(payloads));
        } catch {}
        return;
      }
      
      throw { code: '42P01', message: 'Fallback to localStorage directly due to missing tables' };
    } catch (err: any) {
      if (
        err.code === '42P01' || 
        err.message?.includes('does not exist') || 
        err.message?.includes('não existe')
      ) {
        console.warn('[saveStaffAvailability] Staff availability table does not exist, falling back to localStorage');
        
        // Save to localStorage directly
        const localKey = `meucorte_availability_${staffId}`;
        try {
          const payloads = availabilities.map(a => ({
            id: crypto.randomUUID(),
            staff_id: a.staffId,
            day_of_week: a.dayOfWeek,
            start_time: normalizeTime(a.startTime),
            end_time: normalizeTime(a.endTime),
            breaks: a.breaks || [],
            is_open: a.isOpen
          }));
          localStorage.setItem(localKey, JSON.stringify(payloads));
        } catch (localErr) {
          console.warn('[saveStaffAvailability] Failed to write fallback to localStorage:', localErr);
        }
        return;
      }
      
      console.warn('[saveStaffAvailability] Warning saving availability:', err);
      
      // Fallback local even for standard errors to ensure flawless offline experience
      const localKey = `meucorte_availability_${staffId}`;
      try {
        const payloads = availabilities.map(a => ({
          id: crypto.randomUUID(),
          staff_id: a.staffId,
          day_of_week: a.dayOfWeek,
          start_time: normalizeTime(a.startTime),
          end_time: normalizeTime(a.endTime),
          breaks: a.breaks || [],
          is_open: a.isOpen
        }));
        localStorage.setItem(localKey, JSON.stringify(payloads));
      } catch {}
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
          .from('staff_profiles')
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
        err?.message?.includes('function "add_or_group_notification" does not exist') ||
        err?.message?.includes('not allowed')
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
  },

  // Barbershop & Invite database helpers
  async getBarbershop(): Promise<Barbershop | null> {
    try {
      const userId = await this.getUserId();
      if (!userId) return null;

      // 1. Tentar primeiro por owner_id
      const { data: ownedShops, error } = await supabase
        .from('barbershops')
        .select('*')
        .eq('owner_id', userId);

      if (error && error.code !== '42P01' && !error.message?.includes('does not exist') && !error.message?.includes('não existe')) {
        throw error;
      }

      if (ownedShops && ownedShops.length > 0) {
        const data = ownedShops[0];
        return {
          id: data.id,
          ownerId: data.owner_id,
          name: data.name,
          slug: data.slug,
          createdAt: data.created_at
        };
      }

      // 2. Fallback para buscar via associação em barbershop_members
      const { data: memberships, error: memberErr } = await supabase
        .from('barbershop_members')
        .select('barbershop_id')
        .eq('user_id', userId);

      if (!memberErr && memberships && memberships.length > 0) {
        const targetId = memberships[0].barbershop_id;
        const { data: associateShops, error: assocErr } = await supabase
          .from('barbershops')
          .select('*')
          .eq('id', targetId);

        if (!assocErr && associateShops && associateShops.length > 0) {
          const data = associateShops[0];
          return {
            id: data.id,
            ownerId: data.owner_id,
            name: data.name,
            slug: data.slug,
            createdAt: data.created_at
          };
        }
      }

      return null;
    } catch (err) {
      console.warn('[getBarbershop] Info:', err);
      return null;
    }
  },

  async getCurrentProfile(targetUserId?: string): Promise<BarberProfile | null> {
    const userId = targetUserId || await this.getUserId();
    if (!userId) return null;

    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;

    const d = data as any;
    return {
      name: d.name || '',
      personalPhone: d.personal_phone || '',
      photo: d.photo || '',
      shopName: d.shop_name || '',
      businessPhone: d.business_phone || '',
      address: d.address || '',
      logo: d.logo || '',
      description: d.description || '',
      instagram: d.instagram || '',
      website: d.website || '',
      onboarding_seen: !!d.onboarding_seen,
      slug: d.slug || ''
    } as BarberProfile;
  },

  async getOwnedBarbershop(targetUserId?: string): Promise<Barbershop | null> {
    const userId = targetUserId || await this.getUserId();
    if (!userId) return null;

    const { data, error } = await supabase
      .from('barbershops')
      .select('*')
      .eq('owner_id', userId)
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;

    return {
      id: data.id,
      ownerId: data.owner_id,
      name: data.name,
      slug: data.slug,
      createdAt: data.created_at
    };
  },

  async getOwnerMembership(barbershopId: string, userId: string): Promise<BarbershopMember | null> {
    if (!barbershopId || !userId) return null;

    const { data, error } = await supabase
      .from('barbershop_members')
      .select('*')
      .eq('barbershop_id', barbershopId)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;

    return {
      barbershopId: data.barbershop_id,
      userId: data.user_id,
      role: data.role,
      joinedAt: data.joined_at
    };
  },

  async ensureOwnerMembership(barbershopId: string, userId: string): Promise<BarbershopMember> {
    if (!barbershopId || !userId) {
      throw new Error('Barbershop ID e User ID são obrigatórios para garantir membership.');
    }

    const existing = await this.getOwnerMembership(barbershopId, userId);
    if (existing) {
      if (existing.role !== 'owner') {
        const { data, error } = await supabase
          .from('barbershop_members')
          .update({ role: 'owner' })
          .eq('barbershop_id', barbershopId)
          .eq('user_id', userId)
          .select()
          .single();

        if (error) throw error;
        return {
          barbershopId: data.barbershop_id,
          userId: data.user_id,
          role: data.role,
          joinedAt: data.joined_at
        };
      }
      return existing;
    }

    const { data, error } = await supabase
      .from('barbershop_members')
      .insert({
        barbershop_id: barbershopId,
        user_id: userId,
        role: 'owner'
      })
      .select()
      .single();

    if (error) throw error;

    return {
      barbershopId: data.barbershop_id,
      userId: data.user_id,
      role: data.role,
      joinedAt: data.joined_at
    };
  },

  async resolveOnboardingState(targetUserId?: string): Promise<OnboardingState> {
    const userId = targetUserId || await this.getUserId();

    if (!userId) {
      const state: OnboardingState = {
        userId: '',
        isAuthenticated: false,
        hasProfile: false,
        profile: null,
        hasBarbershop: false,
        barbershop: null,
        hasOwnerMembership: false,
        isStaffMember: false,
        status: isNetworkOffline ? 'network_error' : 'no_session',
        isComplete: false,
        step: 1
      };
      return state;
    }

    try {
      // 1. Consultar barbershop_members
      const { data: memberRows, error: memberErr } = await supabase
        .from('barbershop_members')
        .select('*')
        .eq('user_id', userId);

      // 2. Consultar staff_profiles
      const { data: staffRows, error: staffErr } = await supabase
        .from('staff_profiles')
        .select('*')
        .eq('user_id', userId);

      // 3. Consultar profiles
      const { data: profileRow, error: profileErr } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      // Verificar se houve falha de rede real em todas as tentativas
      const hasNetErr = isNetworkError(memberErr) || isNetworkError(staffErr) || isNetworkError(profileErr);
      if (hasNetErr) {
        handleNetworkError('resolveOnboardingState', memberErr || staffErr || profileErr, null);
        const state: OnboardingState = {
          userId,
          isAuthenticated: true,
          hasProfile: !!profileRow,
          profile: profileRow ? {
            name: profileRow.name || '',
            personalPhone: profileRow.personal_phone || '',
            photo: profileRow.photo || '',
            shopName: profileRow.shop_name || '',
            businessPhone: profileRow.business_phone || '',
            address: profileRow.address || '',
            logo: profileRow.logo || '',
            description: profileRow.description || '',
            instagram: profileRow.instagram || '',
            website: profileRow.website || '',
            onboarding_seen: !!profileRow.onboarding_seen,
            slug: profileRow.slug || ''
          } : null,
          hasBarbershop: false,
          barbershop: null,
          hasOwnerMembership: false,
          isStaffMember: false,
          status: 'network_error',
          isComplete: true, // Network error não deve bloquear nem abrir SetupWizard!
          step: 4
        };
        return state;
      }

      isNetworkOffline = false;

      const profileObj: BarberProfile = profileRow ? {
        name: profileRow.name || '',
        personalPhone: profileRow.personal_phone || '',
        photo: profileRow.photo || '',
        shopName: profileRow.shop_name || '',
        businessPhone: profileRow.business_phone || '',
        address: profileRow.address || '',
        logo: profileRow.logo || '',
        description: profileRow.description || '',
        instagram: profileRow.instagram || '',
        website: profileRow.website || '',
        onboarding_seen: true,
        slug: profileRow.slug || ''
      } : {
        name: '',
        personalPhone: '',
        shopName: '',
        businessPhone: '',
        address: '',
        logo: '',
        description: '',
        instagram: '',
        website: '',
        onboarding_seen: true,
        slug: ''
      };

      // 4. Se encontrou registro em barbershop_members
      if (memberRows && memberRows.length > 0) {
        const member = memberRows[0];
        const barbershopId = member.barbershop_id;
        const memberRole = member.role; // 'owner' | 'admin' | 'staff'

        // Carregar dados da barbearia
        const { data: shopData } = await supabase
          .from('barbershops')
          .select('*')
          .eq('id', barbershopId)
          .maybeSingle();

        const barbershopObj: Barbershop | null = shopData ? {
          id: shopData.id,
          ownerId: shopData.owner_id,
          name: shopData.name,
          slug: shopData.slug,
          createdAt: shopData.created_at
        } : null;

        // Carregar staff_profile correspondente se for staff/admin
        const rawStaff = staffRows?.find((s: any) => s.tenant_id === barbershopId || s.user_id === userId) || (staffRows && staffRows[0]) || null;
        const mappedStaffProfile: Staff | null = rawStaff ? {
          id: rawStaff.id,
          tenantId: rawStaff.tenant_id || barbershopId,
          userId: rawStaff.user_id || userId,
          name: rawStaff.name || 'Profissional',
          phone: rawStaff.phone || '',
          photo: rawStaff.photo ?? null,
          status: rawStaff.status || 'active',
          commissionRate: Number(rawStaff.commission_rate || 0),
          role: (rawStaff.role === 'admin' ? 'admin' : 'staff')
        } : null;

        const membershipObj: BarbershopMember = {
          barbershopId: member.barbershop_id,
          userId: member.user_id,
          role: member.role,
          joinedAt: member.joined_at
        };

        if (memberRole === 'staff' || memberRole === 'admin') {
          const state: OnboardingState = {
            userId,
            isAuthenticated: true,
            hasProfile: true,
            profile: profileObj,
            hasBarbershop: !!barbershopObj,
            barbershop: barbershopObj,
            hasOwnerMembership: false,
            isStaffMember: true,
            status: 'complete',
            isComplete: true,
            step: 4,
            membership: membershipObj,
            staffProfile: mappedStaffProfile
          };
          return state;
        }

        if (memberRole === 'owner') {
          const state: OnboardingState = {
            userId,
            isAuthenticated: true,
            hasProfile: true,
            profile: profileObj,
            hasBarbershop: !!barbershopObj,
            barbershop: barbershopObj,
            hasOwnerMembership: true,
            isStaffMember: false,
            status: 'complete',
            isComplete: true,
            step: 4,
            membership: membershipObj,
            staffProfile: mappedStaffProfile
          };
          return state;
        }
      }

      // 5. Se não estiver em barbershop_members, verificar se é proprietário direto na tabela barbershops
      const ownedBarbershop = await this.getOwnedBarbershop(userId);
      if (ownedBarbershop) {
        let ownerMembership = await this.getOwnerMembership(ownedBarbershop.id, userId);
        if (!ownerMembership) {
          try {
            ownerMembership = await this.ensureOwnerMembership(ownedBarbershop.id, userId);
          } catch (err) {
            console.error('[resolveOnboardingState] Erro ao garantir membership owner:', err);
          }
        }

        const state: OnboardingState = {
          userId,
          isAuthenticated: true,
          hasProfile: true,
          profile: profileObj,
          hasBarbershop: true,
          barbershop: ownedBarbershop,
          hasOwnerMembership: true,
          isStaffMember: false,
          status: 'complete',
          isComplete: true,
          step: 4,
          membership: ownerMembership
        };
        return state;
      }

      // 6. Verificar se tem staff_profiles mesmo sem barbershop_members (compatibilidade)
      if (staffRows && staffRows.length > 0) {
        const rawStaff = staffRows[0];
        const targetShopId = rawStaff.tenant_id;
        const { data: shopData } = await supabase
          .from('barbershops')
          .select('*')
          .eq('id', targetShopId)
          .maybeSingle();

        const barbershopObj: Barbershop | null = shopData ? {
          id: shopData.id,
          ownerId: shopData.owner_id,
          name: shopData.name,
          slug: shopData.slug,
          createdAt: shopData.created_at
        } : null;

        const mappedStaffProfile: Staff = {
          id: rawStaff.id,
          tenantId: rawStaff.tenant_id,
          userId: rawStaff.user_id || userId,
          name: rawStaff.name || profileObj.name || 'Profissional',
          phone: rawStaff.phone || profileObj.personalPhone || '',
          photo: rawStaff.photo || profileObj.photo || undefined,
          status: rawStaff.status || 'active',
          commissionRate: Number(rawStaff.commission_rate || 0),
          role: (rawStaff.role === 'admin' ? 'admin' : 'staff')
        };

        const state: OnboardingState = {
          userId,
          isAuthenticated: true,
          hasProfile: true,
          profile: profileObj,
          hasBarbershop: !!barbershopObj,
          barbershop: barbershopObj,
          hasOwnerMembership: false,
          isStaffMember: true,
          status: 'complete',
          isComplete: true,
          step: 4,
          membership: {
            barbershopId: targetShopId,
            userId,
            role: 'staff',
            joinedAt: new Date().toISOString()
          },
          staffProfile: mappedStaffProfile
        };
        return state;
      }

      // 7. Usuário genuinamente novo (sem perfil nem barbearia cadastrada)
      const hasValidProfile = !!(profileRow && profileRow.name && profileRow.name.trim() !== '');
      if (!hasValidProfile) {
        const state: OnboardingState = {
          userId,
          isAuthenticated: true,
          hasProfile: false,
          profile: null,
          hasBarbershop: false,
          barbershop: null,
          hasOwnerMembership: false,
          isStaffMember: false,
          status: 'needs_profile',
          isComplete: false,
          step: 1
        };
        return state;
      }

      const state: OnboardingState = {
        userId,
        isAuthenticated: true,
        hasProfile: true,
        profile: profileObj,
        hasBarbershop: false,
        barbershop: null,
        hasOwnerMembership: false,
        isStaffMember: false,
        status: 'needs_barbershop',
        isComplete: false,
        step: 2
      };
      return state;
    } catch (err: any) {
      console.error('[resolveOnboardingState] Erro inesperado ao resolver onboarding:', err);
      if (isNetworkError(err)) {
        handleNetworkError('resolveOnboardingState', err, null);
        const state: OnboardingState = {
          userId,
          isAuthenticated: true,
          hasProfile: false,
          profile: null,
          hasBarbershop: false,
          barbershop: null,
          hasOwnerMembership: false,
          isStaffMember: false,
          status: 'network_error',
          isComplete: true,
          step: 4
        };
        return state;
      }
      throw err;
    }
  },

  async completeOwnerSetupIfPossible(targetUserId?: string): Promise<OnboardingState> {
    return await this.resolveOnboardingState(targetUserId);
  },

  async createBarbershop(name: string, requestedSlug?: string): Promise<Barbershop> {
    const userId = await this.getUserId();
    if (!userId) throw new Error('User not authenticated');

    // Idempotency: Se a barbearia já existe para o usuário, retorna a existente
    const existing = await this.getOwnedBarbershop(userId);
    if (existing) {
      await this.ensureOwnerMembership(existing.id, userId);
      return existing;
    }

    const normalizedSlug = requestedSlug ? normalizeRequestedSlug(requestedSlug) : '';
    let shopSlug = '';
    if (normalizedSlug) {
      shopSlug = await this.ensureUniqueProfileSlug(normalizedSlug, userId);
    } else {
      shopSlug = generateSlug(name, userId);
    }

    const { data, error } = await supabase
      .from('barbershops')
      .insert({
        owner_id: userId,
        name,
        slug: shopSlug
      })
      .select()
      .single();

    if (error) throw error;

    await this.ensureOwnerMembership(data.id, userId);

    return {
      id: data.id,
      ownerId: data.owner_id,
      name: data.name,
      slug: data.slug,
      createdAt: data.created_at
    };
  },

  async getBarbershopMembers(): Promise<BarbershopMember[]> {
    try {
      const userId = await this.getUserId();
      if (!userId) return [];

      const { data: memberships, error: mInfoErr } = await supabase
        .from('barbershop_members')
        .select('barbershop_id')
        .eq('user_id', userId);

      if (mInfoErr || !memberships || memberships.length === 0) return [];

      const targetBarbershopId = memberships[0].barbershop_id;

      const { data, error } = await supabase
        .from('barbershop_members')
        .select('role, joined_at, user_id, profiles(name, personal_phone, photo)')
        .eq('barbershop_id', targetBarbershopId);

      if (error) throw error;
      return (data || []).map((m: any) => ({
        barbershopId: targetBarbershopId,
        userId: m.user_id,
        role: m.role,
        joinedAt: m.joined_at,
        name: m.profiles?.name || 'Membro',
        phone: m.profiles?.personal_phone || '',
        photo: m.profiles?.photo || undefined
      }));
    } catch (err) {
      console.warn('[getBarbershopMembers] Info:', err);
      return [];
    }
  },

  async createInvite(email: string, role: 'staff' | 'admin' = 'staff'): Promise<BarbershopInvite> {
    const userId = await this.getUserId();
    if (!userId) throw new Error('User not authenticated');

    const { data: barbershops, error: bsErr } = await supabase
      .from('barbershops')
      .select('id')
      .eq('owner_id', userId);

    if (bsErr || !barbershops || barbershops.length === 0) throw new Error('Barbershop not found for owner');

    const targetBarbershopId = barbershops[0].id;

    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString(); // 7 days

    const { data, error } = await supabase
      .from('barbershop_invites')
      .insert({
        barbershop_id: targetBarbershopId,
        email,
        role,
        token,
        expires_at: expiresAt,
        invited_by: userId
      })
      .select()
      .single();

    if (error) throw error;

    return {
      id: data.id,
      barbershopId: data.barbershop_id,
      email: data.email,
      role: data.role,
      token: data.token,
      expiresAt: data.expires_at,
      acceptedAt: data.accepted_at,
      invitedBy: data.invited_by,
      createdAt: data.created_at
    };
  },

  async getInvites(): Promise<BarbershopInvite[]> {
    try {
      const userId = await this.getUserId();
      if (!userId) return [];

      const { data: barbershops, error: bsErr } = await supabase
        .from('barbershops')
        .select('id')
        .eq('owner_id', userId);

      if (bsErr || !barbershops || barbershops.length === 0) return [];

      const targetBarbershopId = barbershops[0].id;

      const { data, error } = await supabase
        .from('barbershop_invites')
        .select('*')
        .eq('barbershop_id', targetBarbershopId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data || []).map((d: any) => ({
        id: d.id,
        barbershopId: d.barbershop_id,
        email: d.email,
        role: d.role,
        token: d.token,
        expiresAt: d.expires_at,
        acceptedAt: d.accepted_at,
        invitedBy: d.invited_by,
        createdAt: d.created_at
      }));
    } catch (err) {
      console.warn('[getInvites] Info:', err);
      return [];
    }
  },

  async acceptInvite(token: string): Promise<BarbershopMember> {
    const { data, error } = await supabase.rpc('accept_barbershop_invite', { p_token: token });
    if (error) throw error;
    return {
      barbershopId: data.barbershop_id,
      userId: data.user_id,
      role: data.role,
      joinedAt: data.joined_at
    };
  },

  async createStaffDirectly(params: {
    email: string;
    password?: string;
    role: 'staff' | 'admin';
    name: string;
    phone?: string;
    commissionRate?: number;
    barbershopId?: string;
  }): Promise<any> {
    const userId = await this.getUserId();
    if (!userId) {
      throw new Error('Não autenticado');
    }

    let barbershopId: string | null = params.barbershopId || null;
    
    if (!barbershopId) {
      try {
        // 1. Tentar primeiro buscar barbearias das quais o usuário é dono (owner_id)
        const { data: ownedShops, error: ownerErr } = await supabase
          .from('barbershops')
          .select('id, name')
          .eq('owner_id', userId);

        if (!ownerErr && ownedShops && ownedShops.length > 0) {
          barbershopId = ownedShops[0].id;
        }

        // 2. Se não encontrar por owner_id, tentar barbershop_members por user_id = usuário logado
        if (!barbershopId) {
          const { data: memberships, error: memberErr } = await supabase
            .from('barbershop_members')
            .select('barbershop_id')
            .eq('user_id', userId);

          if (!memberErr && memberships && memberships.length > 0) {
            barbershopId = memberships[0].barbershop_id;
          }
        }

        // 3. Se ainda não resolveu, chamar o método getBarbershop() que possui fluxo completo de resolução
        if (!barbershopId) {
          const bs = await this.getBarbershop();
          if (bs) {
            barbershopId = bs.id;
          }
        }

        // 4. Fallback final: usar getTenantIdForUser para mapear o id do proprietário e obter sua barbearia
        if (!barbershopId) {
          const tenantId = await this.getTenantIdForUser(userId);
          if (tenantId) {
            const { data: tenantShops } = await supabase
              .from('barbershops')
              .select('id')
              .eq('owner_id', tenantId);

            if (tenantShops && tenantShops.length > 0) {
              barbershopId = tenantShops[0].id;
            }
          }
        }
      } catch (err: any) {
        console.warn('Erro imprevisto durante as camadas de resolução do ID da barbearia:', err);
      }
    }

    if (!barbershopId) {
      throw new Error('Não foi possível determinar a barbearia do usuário.');
    }

    try {
      if (isNetworkOffline) {
        throw new Error('Sem conexão com o servidor');
      }

      const functionPayload = {
        email: params.email,
        password: params.password || 'Mudar@123',
        barbershop_id: barbershopId,
        role: params.role,
        name: params.name,
        phone: params.phone || '',
        commissionRate: params.commissionRate ?? 30
      };

      const { data, error } = await supabase.functions.invoke('create-staff', {
        body: functionPayload
      });

      if (error) {
        let errorMessage = error.message;
        let isValidationError = false;
        const status = (error as any).status;

        try {
          if (error.context && typeof error.context.json === 'function') {
            const body = await error.context.json();
            if (body && body.error) {
              errorMessage = body.error;
            }
          }
        } catch (jsonErr: any) {
          // ignore
        }

        if (status && status !== 404) {
          isValidationError = true;
        } else if (errorMessage && (
          errorMessage.includes('já possui uma conta') || 
          errorMessage.includes('already registered') || 
          errorMessage.includes('Password should be') || 
          errorMessage.includes('Apenas proprietários') ||
          errorMessage.includes('Não autorizado')
        )) {
          isValidationError = true;
        }

        const customErr = new Error(errorMessage);
        if (isValidationError) {
          (customErr as any).isValidationError = true;
        }
        throw customErr;
      }

      return data;
    } catch (err: any) {
      console.error('Erro fatal na criação direta de funcionário:', err);
      throw err;
    }
  }
};

import { supabase } from '../lib/supabase';
import { Appointment, BarberProfile, Customer, DayConfig, ServiceItem, Staff, Tenant, StaffAvailability, Barbershop, BarbershopMember, BarbershopInvite, OnboardingState, AccessKind, UserBarbershopContext, AuthContextResult, ActiveContext, MembershipRole, TenantContext, AuthContext, SetupMode, Transaction } from '../types';
import { normalizePhone, normalizeTime, validateBrazilianPhone, normalizeBrazilianPhoneForComparison } from '../utils/helpers';

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

function timeStrToMinutes(t: string): number {
  const norm = normalizeTime(t);
  if (norm === '24:00') return 24 * 60;
  const [h, m] = norm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function minutesToTimeStr(mins: number): string {
  if (mins >= 24 * 60) return '24:00';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function mergeBreakSlotsToIntervals(slots: string[]): Array<{ start_time: string; end_time: string }> {
  if (!slots || slots.length === 0) return [];
  const sortedMins = Array.from(
    new Set(
      slots
        .map(s => normalizeTime(s))
        .filter(Boolean)
        .map(timeStrToMinutes)
    )
  ).sort((a, b) => a - b);

  if (sortedMins.length === 0) return [];

  const intervals: Array<{ start_time: string; end_time: string }> = [];
  let curStart = sortedMins[0];
  let curEnd = sortedMins[0] + 30;

  for (let i = 1; i < sortedMins.length; i++) {
    const m = sortedMins[i];
    if (m <= curEnd) {
      curEnd = Math.max(curEnd, m + 30);
    } else {
      intervals.push({
        start_time: minutesToTimeStr(curStart),
        end_time: minutesToTimeStr(curEnd)
      });
      curStart = m;
      curEnd = m + 30;
    }
  }

  intervals.push({
    start_time: minutesToTimeStr(curStart),
    end_time: minutesToTimeStr(curEnd)
  });

  return intervals;
}

export function expandBreakRowToSlots(row: { time?: string | null; start_time?: string | null; end_time?: string | null }): string[] {
  const rawStart = row.start_time || row.time;
  if (!rawStart) return [];
  const normStart = normalizeTime(rawStart);
  if (!normStart) return [];

  if (row.end_time) {
    const normEnd = row.end_time.startsWith('24:00') ? '24:00' : normalizeTime(row.end_time);
    const startMins = timeStrToMinutes(normStart);
    const endMins = timeStrToMinutes(normEnd);
    if (endMins > startMins && endMins - startMins <= 24 * 60) {
      const slots: string[] = [];
      for (let m = startMins; m < endMins; m += 30) {
        slots.push(minutesToTimeStr(m));
      }
      return slots;
    }
  }

  return [normStart];
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
  async getUserProfile(userId?: string): Promise<BarberProfile | null> {
    try {
      const idToUse = userId || await this.getUserId();
      if (!idToUse) return null;

      const { data, error } = await supabase.from('profiles').select('*').eq('id', idToUse).maybeSingle();
      if (error || !data) return null;

      isNetworkOffline = false;
      const d = data as any;
      return {
        name: d.name || '',
        personalPhone: d.personal_phone || '',
        photo: d.photo || '',
        shopName: d.shop_name || 'Meu Corte',
        businessPhone: d.business_phone || '',
        address: d.address || '',
        logo: d.logo || '',
        description: d.description || '',
        instagram: d.instagram || '',
        website: d.website || '',
        onboarding_seen: !!d.onboarding_seen,
        slug: d.slug || ''
      };
    } catch (err: any) {
      return handleNetworkError('getUserProfile', err, null);
    }
  },

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
  async getServices(targetBarbershopId?: string) {
    try {
      let barbershopId = targetBarbershopId;
      if (!barbershopId) {
        const userId = await this.getUserId();
        if (!userId) return [];
        const activeCtx = await this.resolveSingleActiveContext(userId);
        if ('barbershopId' in activeCtx && activeCtx.barbershopId) {
          barbershopId = activeCtx.barbershopId;
        }
      }

      if (!barbershopId) {
        return [];
      }

      const { data, error } = await supabase
        .from('services')
        .select('*')
        .eq('barbershop_id', barbershopId)
        .order('order_index', { ascending: true });
      
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
  async saveServices(services: ServiceItem[], explicitBarbershopId?: string) {
    const userId = await this.getUserId();
    if (!userId) throw new Error('Usuário não autenticado');

    let barbershopId = explicitBarbershopId;
    if (!barbershopId) {
      const activeCtx = await this.resolveSingleActiveContext(userId);
      if ('barbershopId' in activeCtx && activeCtx.barbershopId) {
        barbershopId = activeCtx.barbershopId;
      }
    }

    if (!barbershopId) {
      throw new Error('Contexto de barbearia não encontrado para salvar serviços.');
    }

    const existingIds = services.map(s => s.id);

    if (existingIds.length > 0) {
      await supabase
        .from('services')
        .delete()
        .eq('barbershop_id', barbershopId)
        .not('id', 'in', `(${existingIds.join(',')})`);
    } else {
      await supabase
        .from('services')
        .delete()
        .eq('barbershop_id', barbershopId);
    }

    const isUUID = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    const payload = services.map((s, index) => ({
      id: isUUID(s.id) ? s.id : crypto.randomUUID(),
      barbershop_id: barbershopId,
      user_id: userId,
      name: s.name,
      price: s.price,
      duration: s.duration,
      order_index: index
    }));

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
  async deleteService(id: string, explicitBarbershopId?: string) {
    const userId = await this.getUserId();
    if (!userId) throw new Error('Usuário não autenticado');

    let barbershopId = explicitBarbershopId;
    if (!barbershopId) {
      const activeCtx = await this.resolveSingleActiveContext(userId);
      if ('barbershopId' in activeCtx && activeCtx.barbershopId) {
        barbershopId = activeCtx.barbershopId;
      }
    }

    let query = supabase.from('services').delete().eq('id', id);
    if (barbershopId) {
      query = query.eq('barbershop_id', barbershopId);
    }

    const { error } = await query;
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

      return (data as any[]).map(c => {
        let phoneNorm = c.phone_normalized;
        if (!phoneNorm && c.phone) {
          try {
            phoneNorm = normalizeBrazilianPhoneForComparison(c.phone);
          } catch {
            phoneNorm = normalizePhone(c.phone);
          }
        }
        return {
          id: c.id,
          phone: c.phone,
          phoneNormalized: phoneNorm || undefined,
          phone_normalized: phoneNorm || undefined,
          barbershopId: c.barbershop_id,
          barbershop_id: c.barbershop_id,
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
        } as Customer;
      });
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

    const validation = validateBrazilianPhone(customer.phone);
    if (!validation.valid) {
      throw new Error(validation.message || 'Telefone brasileiro inválido.');
    }
    const normalizedPhone = validation.normalized;

    const payload: any = {
      barbershop_id: barbershopId,
      user_id: currentAuthId || userId,
      phone: customer.phone,
      phone_normalized: normalizedPhone,
      name: customer.name,
      avatar: customer.avatar ?? null,
      cut_count: customer.cutCount ?? 0,
      no_show_count: customer.noShowCount ?? 0
    };

    // 1. Pesquisar cliente existente por barbershop_id + phone_normalized
    const { data: existing, error: findError } = await supabase
      .from('customers')
      .select('id, phone, phone_normalized, name, barbershop_id')
      .eq('barbershop_id', barbershopId)
      .eq('phone_normalized', normalizedPhone)
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
      // Se houver conflito de chave única (23505), buscar e selecionar o cliente existente
      if (error.code === '23505') {
        const { data: existingCust, error: getErr } = await supabase
          .from('customers')
          .select('*')
          .eq('barbershop_id', barbershopId)
          .eq('phone_normalized', normalizedPhone)
          .maybeSingle();

        if (!getErr && existingCust) {
          return existingCust;
        }
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

    const validation = validateBrazilianPhone(phone);
    if (!validation.valid) {
      throw new Error(validation.message || 'Telefone inválido para foto de cliente.');
    }
    const normalizedPhone = validation.normalized;

    // Buscar customer_id da barbearia se existir
    const { data: cust } = await supabase
      .from('customers')
      .select('id')
      .eq('barbershop_id', barbershopId)
      .eq('phone_normalized', normalizedPhone)
      .maybeSingle();

    const customerId: string | null = cust?.id || null;

    const payload: any = {
      barbershop_id: barbershopId,
      customer_phone: phone,
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

    const valOld = validateBrazilianPhone(oldPhone);
    const valNew = validateBrazilianPhone(customer.phone);
    if (!valNew.valid) {
      throw new Error(valNew.message || 'Telefone inválido.');
    }

    const normalizedOld = valOld.valid ? valOld.normalized : normalizePhone(oldPhone);
    const normalizedNew = valNew.normalized;

    if (normalizedOld !== normalizedNew) {
      // 1. Verificar se novo telefone já existe em outro cliente na mesma barbearia
      const { data: duplicate, error: dupError } = await supabase
        .from('customers')
        .select('id, name')
        .eq('barbershop_id', barbershopId)
        .eq('phone_normalized', normalizedNew)
        .maybeSingle();

      if (dupError) throw dupError;
      if (duplicate && duplicate.id !== customer.id) {
        throw new Error(`Já existe um cliente cadastrado (${duplicate.name || 'existente'}) com o telefone ${customer.phone} nesta barbearia.`);
      }

      // 2. Atualizar registro do cliente
      const updatePayload: any = {
        name: customer.name,
        phone: customer.phone,
        phone_normalized: normalizedNew,
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
        updateQuery = updateQuery.eq('phone_normalized', normalizedOld);
      }

      const { error: updateErr } = await updateQuery;
      if (updateErr) throw updateErr;

      // 3. Atualizar fotos para o novo telefone dentro da mesma barbearia
      if (customer.id) {
        await (supabase.from('customer_photos') as any)
          .update({ customer_phone: customer.phone })
          .eq('barbershop_id', barbershopId)
          .eq('customer_id', customer.id);
      } else {
        await (supabase.from('customer_photos') as any)
          .update({ customer_phone: customer.phone })
          .eq('barbershop_id', barbershopId)
          .eq('customer_phone', oldPhone);
      }

      // 4. Atualizar appointments para o novo telefone dentro da mesma barbearia
      await (supabase.from('appointments') as any)
        .update({ phone: customer.phone, client_name: customer.name })
        .eq('barbershop_id', barbershopId)
        .eq('phone', oldPhone);
    } else {
      // Atualização normal sem mudança de chave canônica de telefone
      const updatePayload: any = {
        name: customer.name,
        phone: customer.phone,
        phone_normalized: normalizedNew,
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
        updateQuery = updateQuery.eq('phone_normalized', normalizedOld);
      }

      const { error } = await updateQuery;
      if (error) throw error;

      // Atualizar nome nos appointments correspondentes dentro da mesma barbearia
      await (supabase.from('appointments') as any)
        .update({ client_name: customer.name })
        .eq('barbershop_id', barbershopId)
        .eq('phone', customer.phone);
    }
  },
  async checkDuplicateCustomer(phone: string, targetBarbershopId?: string) {
    let barbershopId = targetBarbershopId;
    if (!barbershopId) {
      const sessionRes = await supabase.auth.getSession();
      const currentAuthId = sessionRes?.data?.session?.user?.id;
      const userId = currentAuthId || await this.getUserId();
      if (!userId) return null;

      const ctx = await this.resolveTenantContext(userId);
      barbershopId = ctx.barbershopId;
    }

    if (!barbershopId) {
      throw new Error('Contexto da barbearia não encontrado ao verificar duplicidade.');
    }

    const validation = validateBrazilianPhone(phone);
    if (!validation.valid) return null;
    const normalizedPhone = validation.normalized;

    const { data, error } = await supabase
      .from('customers')
      .select('id, phone, phone_normalized, name, barbershop_id')
      .eq('barbershop_id', barbershopId)
      .eq('phone_normalized', normalizedPhone)
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
          isExceptional: !!a.is_exceptional,
          exceptionalBy: a.exceptional_by ?? null,
          exceptionalAt: a.exceptional_at ?? null,
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
          isExceptional: !!a.is_exceptional,
          exceptionalBy: a.exceptional_by ?? null,
          exceptionalAt: a.exceptional_at ?? null,
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

  async createMyAppointment(params: {
    barbershopId: string;
    clientName: string;
    clientPhone: string;
    serviceIds: string[];
    date: string;
    time: string;
    observation?: string;
  }): Promise<Appointment> {
    const isUuid = (value: string) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

    if (!params.barbershopId || !isUuid(params.barbershopId)) {
      throw new Error(`[createMyAppointment] Contexto de barbearia inválido (barbershop_id): "${params.barbershopId}".`);
    }

    if (!params.serviceIds || params.serviceIds.length === 0) {
      throw new Error("Selecione ao menos um serviço para o agendamento.");
    }

    const { data, error } = await supabase.rpc('create_my_appointment', {
      p_barbershop_id: params.barbershopId,
      p_client_name: params.clientName.trim(),
      p_client_phone: params.clientPhone.replace(/\D/g, ''),
      p_service_ids: params.serviceIds,
      p_date: params.date,
      p_time: normalizeTime(params.time),
      p_observation: params.observation ? params.observation.trim() : null
    });

    if (error) {
      console.error("[createMyAppointment] Erro da RPC create_my_appointment:", error);
      throw error;
    }

    if (!data) {
      throw new Error("[createMyAppointment] Resposta vazia da RPC create_my_appointment.");
    }

    const rawApt = (typeof data === 'string' ? JSON.parse(data) : data) as any;
    if (!rawApt.id || !isUuid(rawApt.id)) {
      throw new Error(`[createMyAppointment] Servidor retornou ID não-UUID: "${rawApt.id}".`);
    }

    return {
      id: rawApt.id,
      tenantId: rawApt.barbershop_id,
      staffId: rawApt.staff_id ?? null,
      userId: rawApt.user_id,
      date: rawApt.date ? rawApt.date.substring(0, 10) : params.date,
      time: normalizeTime(rawApt.time),
      clientName: rawApt.client_name,
      phone: rawApt.phone,
      service: rawApt.service,
      price: Number(rawApt.price),
      duration: Number(rawApt.duration),
      status: (rawApt.status === 'confirmed' ? 'pending' : rawApt.status) || 'pending',
      observation: rawApt.observation,
      createdAt: rawApt.created_at ? new Date(rawApt.created_at).getTime() : Date.now()
    } as Appointment;
  },

  async completeMyAppointment(appointmentId: string): Promise<{ appointment: Appointment; transaction?: Transaction }> {
    const isUuid = (value: string) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

    if (!appointmentId || !isUuid(appointmentId)) {
      throw new Error('Este agendamento ainda não foi sincronizado com o servidor. Atualize a agenda e tente novamente.');
    }

    const { data, error } = await supabase.rpc('complete_my_appointment', {
      p_appointment_id: appointmentId
    });

    if (error) {
      console.error("[completeMyAppointment] Erro na RPC complete_my_appointment:", error);
      throw error;
    }

    if (!data) {
      throw new Error("[completeMyAppointment] Resposta vazia da RPC complete_my_appointment.");
    }

    const res = (typeof data === 'string' ? JSON.parse(data) : data) as any;
    const rawApt = res.appointment || res;

    const formattedApt: Appointment = {
      id: rawApt.id || appointmentId,
      tenantId: rawApt.barbershop_id,
      staffId: rawApt.staff_id ?? null,
      userId: rawApt.user_id,
      date: rawApt.date ? rawApt.date.substring(0, 10) : '',
      time: normalizeTime(rawApt.time || '12:00'),
      clientName: rawApt.client_name,
      phone: rawApt.phone,
      service: rawApt.service,
      price: Number(rawApt.price || 0),
      duration: Number(rawApt.duration || 30),
      status: 'completed',
      observation: rawApt.observation,
      createdAt: rawApt.created_at ? new Date(rawApt.created_at).getTime() : Date.now()
    };

    let formattedTx: Transaction | undefined;
    if (res.transaction) {
      const t = res.transaction;
      formattedTx = {
        id: t.id,
        tenantId: t.barbershop_id,
        staffId: t.staff_id || undefined,
        type: t.type,
        amount: Number(t.amount),
        description: t.description,
        category: t.category,
        date: t.date,
        linkedAppointmentId: t.linked_appointment_id,
        paymentMethod: t.payment_method,
        createdAt: new Date(t.created_at).getTime()
      };
    }

    return { appointment: formattedApt, transaction: formattedTx };
  },

  async completeAppointment(appointmentId: string): Promise<Appointment> {
    const isUuid = (value: string) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

    if (!appointmentId || !isUuid(appointmentId)) {
      throw new Error('Este agendamento ainda não foi sincronizado com o servidor. Atualize a agenda e tente novamente.');
    }

    const { appointment } = await this.completeMyAppointment(appointmentId);
    return appointment;
  },

  async revertAppointment(appointmentId: string): Promise<Appointment> {
    const isUuid = (value: string) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

    if (!appointmentId || !isUuid(appointmentId)) {
      throw new Error('Este agendamento ainda não foi sincronizado com o servidor. Atualize a agenda e tente novamente.');
    }

    return this.updateAppointmentStatus(appointmentId, 'pending');
  },

  async markAppointmentNoShow(appointmentId: string): Promise<Appointment> {
    const isUuid = (value: string) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

    if (!appointmentId || !isUuid(appointmentId)) {
      throw new Error('Este agendamento ainda não foi sincronizado com o servidor. Atualize a agenda e tente novamente.');
    }

    const { error } = await supabase.rpc('mark_my_appointment_no_show', {
      p_appointment_id: appointmentId
    });

    if (error) {
      console.error('[markAppointmentNoShow] Erro na RPC mark_my_appointment_no_show:', error);
      throw error;
    }

    return {
      id: appointmentId,
      status: 'no-show'
    } as any;
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

    if (ctx.role === 'staff') {
      throw new Error(`[saveAppointment] Usuários com perfil de colaborador/staff não têm permissão para inserir ou atualizar agendamentos diretamente na tabela appointments. Utilize createMyAppointment via RPC.`);
    }

    const isAdmin = ctx.role === 'admin_owner';
    let effectiveStaffId = isAdmin ? (appointment.staffId || ctx.staffProfileId) : ctx.staffProfileId;

    if (!effectiveStaffId) {
      throw new Error(`[saveAppointment] Profissional (staff_id) obrigatório não fornecido ou não encontrado.`);
    }

    // Validar se effectiveStaffId é um staff_profiles.id real pertencente a este barbershop_id e está ATIVO
    const { data: staffRow, error: staffErr } = await supabase
      .from('staff_profiles')
      .select('id, barbershop_id, status')
      .or(`id.eq.${effectiveStaffId},user_id.eq.${effectiveStaffId}`)
      .eq('barbershop_id', barbershopId)
      .maybeSingle();

    if (staffErr || !staffRow) {
      throw new Error(`[saveAppointment] Profissional id="${effectiveStaffId}" não é um staff_profiles válido da barbearia ${barbershopId}.`);
    }

    if (staffRow.status === 'inactive') {
      throw new Error(`[saveAppointment] Não é permitido agendar para um profissional inativo.`);
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
      observation: appointment.observation,
      is_exceptional: appointment.isExceptional === true
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
      isExceptional: !!a.is_exceptional,
      exceptionalBy: a.exceptional_by ?? null,
      exceptionalAt: a.exceptional_at ?? null,
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
  async getWeeklySchedule(targetBarbershopId?: string) {
    try {
      let barbershopId = targetBarbershopId;
      if (!barbershopId) {
        const userId = await this.getUserId();
        if (!userId) return {};
        const activeCtx = await this.resolveSingleActiveContext(userId);
        if ('barbershopId' in activeCtx && activeCtx.barbershopId) {
          barbershopId = activeCtx.barbershopId;
        }
      }

      if (!barbershopId) return {};

      const { data: schedule, error: sError } = await supabase
        .from('weekly_schedule')
        .select('*')
        .eq('barbershop_id', barbershopId);
      const { data: breaks, error: bError } = await supabase
        .from('weekly_breaks')
        .select('*')
        .eq('barbershop_id', barbershopId)
        .is('staff_id', null);
      if (sError || bError) throw sError || bError;

      const allBreaks = (breaks as any[]) || [];

      const result: Record<number, DayConfig> = {};
      (schedule as any[])?.forEach(s => {
        const dayBreaks = allBreaks
          .filter(b => b.day_of_week === s.day_of_week && b.staff_id == null)
          .flatMap(b => expandBreakRowToSlots(b))
          .filter(Boolean);
        const uniqueDayBreaks = Array.from(new Set(dayBreaks));

        result[s.day_of_week] = {
          start: normalizeTime(s.start_time),
          end: normalizeTime(s.end_time),
          isOpen: s.is_open,
          breaks: uniqueDayBreaks
        };
      });
      return result;
    } catch (err) {
      console.error('[getWeeklySchedule] Erro ao carregar agenda semanal:', err);
      return {};
    }
  },
  async saveWeeklySchedule(day: number, config: DayConfig, explicitBarbershopId?: string) {
    const userId = await this.getUserId();
    if (!userId) throw new Error('Usuário não autenticado');

    let barbershopId = explicitBarbershopId;
    if (!barbershopId) {
      const activeCtx = await this.resolveSingleActiveContext(userId);
      if ('barbershopId' in activeCtx && activeCtx.barbershopId) {
        barbershopId = activeCtx.barbershopId;
      }
    }

    if (!barbershopId) {
      throw new Error('Barbershop ID obrigatório para salvar agenda semanal.');
    }

    // Verificar se já existe registro em weekly_schedule para preservar o user_id pai (evitando conflito com FK legada)
    const { data: existingRow } = await supabase
      .from('weekly_schedule')
      .select('id, user_id')
      .eq('barbershop_id', barbershopId)
      .eq('day_of_week', day)
      .maybeSingle();

    const effectiveUserId = existingRow?.user_id || userId;

    const payload: any = {
      user_id: effectiveUserId,
      barbershop_id: barbershopId,
      day_of_week: day,
      start_time: normalizeTime(config.start),
      end_time: normalizeTime(config.end),
      is_open: config.isOpen
    };

    if (existingRow?.id) {
      const { error: updErr } = await supabase
        .from('weekly_schedule')
        .update(payload as any)
        .eq('id', existingRow.id);
      if (updErr) throw updErr;
    } else {
      const { error } = await supabase
        .from('weekly_schedule')
        .upsert(payload as any, { onConflict: 'barbershop_id,day_of_week' })
        .select();

      if (error) {
        const { error: insErr } = await supabase
          .from('weekly_schedule')
          .insert(payload as any);
        if (insErr) throw insErr;
      }
    }

    // Handle breaks - deduplicate, normalize, and merge contiguous 30-min blocks into clean intervals
    const rawBreaks = config.isOpen ? (config.breaks || []) : [];
    const mergedIntervals = mergeBreakSlotsToIntervals(rawBreaks);

    // Delete existing general breaks for this day and barbershop
    const { error: delError } = await supabase
      .from('weekly_breaks')
      .delete()
      .eq('day_of_week', day)
      .eq('barbershop_id', barbershopId)
      .is('staff_id', null);
    if (delError) {
      console.warn('[saveWeeklySchedule] Aviso ao limpar breaks anteriores:', delError);
    }

    if (mergedIntervals.length > 0) {
      const breakPayloads = mergedIntervals.map(interval => ({
        user_id: effectiveUserId,
        barbershop_id: barbershopId,
        staff_id: null,
        day_of_week: day,
        time: interval.start_time,
        start_time: interval.start_time,
        end_time: interval.end_time
      }));

      const { error: insertErr } = await supabase.from('weekly_breaks').insert(breakPayloads as any);
      if (insertErr && (insertErr as any).code !== '23505') {
        console.error('[saveWeeklySchedule] Erro ao inserir breaks semanais:', insertErr);
        throw insertErr;
      }
    }
  },

  // Blocked/Unblocked Slots
  async getBlockedSlots(targetBarbershopId?: string) {
    try {
      let barbershopId = targetBarbershopId;
      if (!barbershopId) {
        const userId = await this.getUserId();
        if (!userId) return {};
        const activeCtx = await this.resolveSingleActiveContext(userId);
        if ('barbershopId' in activeCtx && activeCtx.barbershopId) {
          barbershopId = activeCtx.barbershopId;
        }
      }
      if (!barbershopId) return {};

      const { data, error } = await supabase
        .from('blocked_slots')
        .select('*')
        .eq('barbershop_id', barbershopId);
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
  async saveBlockedSlot(date: string, time: string, isBlocked: boolean, explicitBarbershopId?: string) {
    const userId = await this.getUserId();
    if (!userId) throw new Error('User not authenticated');
    
    let barbershopId = explicitBarbershopId;
    if (!barbershopId) {
      const activeCtx = await this.resolveSingleActiveContext(userId);
      if ('barbershopId' in activeCtx && activeCtx.barbershopId) {
        barbershopId = activeCtx.barbershopId;
      }
    }
    if (!barbershopId) throw new Error('Contexto de barbearia não encontrado para horário bloqueado.');

    if (isBlocked) {
      const payload: any = { user_id: userId, barbershop_id: barbershopId, date, time: normalizeTime(time) };
      await supabase.from('blocked_slots').upsert(payload);
    } else {
      await supabase.from('blocked_slots').delete().match({ barbershop_id: barbershopId, date, time: normalizeTime(time) });
    }
  },
  async getUnblockedSlots(targetBarbershopId?: string) {
    try {
      let barbershopId = targetBarbershopId;
      if (!barbershopId) {
        const userId = await this.getUserId();
        if (!userId) return {};
        const activeCtx = await this.resolveSingleActiveContext(userId);
        if ('barbershopId' in activeCtx && activeCtx.barbershopId) {
          barbershopId = activeCtx.barbershopId;
        }
      }
      if (!barbershopId) return {};

      const { data, error } = await supabase
        .from('unblocked_slots')
        .select('*')
        .eq('barbershop_id', barbershopId);
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
  async saveUnblockedSlot(date: string, time: string, isUnblocked: boolean, explicitBarbershopId?: string) {
    const userId = await this.getUserId();
    if (!userId) throw new Error('User not authenticated');
    
    let barbershopId = explicitBarbershopId;
    if (!barbershopId) {
      const activeCtx = await this.resolveSingleActiveContext(userId);
      if ('barbershopId' in activeCtx && activeCtx.barbershopId) {
        barbershopId = activeCtx.barbershopId;
      }
    }
    if (!barbershopId) throw new Error('Contexto de barbearia não encontrado para horário desbloqueado.');

    if (isUnblocked) {
      const payload: any = { user_id: userId, barbershop_id: barbershopId, date, time: normalizeTime(time) };
      await supabase.from('unblocked_slots').upsert(payload);
    } else {
      await supabase.from('unblocked_slots').delete().match({ barbershop_id: barbershopId, date, time: normalizeTime(time) });
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

  async getStaff(tenantOrBarbershopId: string): Promise<Staff[]> {
    try {
      let barbershopId = tenantOrBarbershopId;

      const { data: shop } = await supabase
        .from('barbershops')
        .select('id, owner_id')
        .or(`id.eq.${tenantOrBarbershopId},owner_id.eq.${tenantOrBarbershopId}`)
        .maybeSingle();

      if (shop) {
        barbershopId = shop.id;
      }

      // Buscar por barbershop_id direto
      let query = supabase
        .from('staff_profiles')
        .select('*')
        .eq('barbershop_id', barbershopId);

      const { data, error } = await query.order('created_at', { ascending: true });

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

      // Migração e reconciliação automática: Se algum registro antigo estiver com barbershop_id nulo, atualizar agora
      if (data && data.length > 0) {
        for (const s of data) {
          if (!s.barbershop_id) {
            try {
              await supabase
                .from('staff_profiles')
                .update({ barbershop_id: barbershopId })
                .eq('id', s.id);
              s.barbershop_id = barbershopId;
            } catch (patchErr) {
              console.warn(`[getStaff] Aviso ao reconciliar barbershop_id para registro ${s.id}:`, patchErr);
            }
          }
        }
      }

      // Buscar membership para resolver os papéis com precisão
      const { data: memberRows } = await supabase
        .from('barbershop_members')
        .select('user_id, role')
        .eq('barbershop_id', barbershopId);

      const memberRoleMap = new Map<string, MembershipRole>();
      if (shop?.owner_id) {
        memberRoleMap.set(shop.owner_id, 'owner');
      }
      if (memberRows) {
        for (const m of memberRows) {
          if (m.user_id) {
            const resolvedRole: MembershipRole = m.role === 'owner' ? 'owner' : (m.role === 'admin' ? 'admin' : 'staff');
            memberRoleMap.set(m.user_id, resolvedRole);
          }
        }
      }

      let rawMembers: any[] = data || [];

      // Se o owner tem barbershop_member mas não tem staff_profiles, criar um registro real no banco
      const ownerUserId = shop?.owner_id;
      if (ownerUserId && !rawMembers.some(s => s.user_id === ownerUserId)) {
        try {
          const { data: ownerProf } = await supabase
            .from('profiles')
            .select('name, personal_phone, photo')
            .eq('id', ownerUserId)
            .maybeSingle();

          const { data: newOwnerStaff } = await supabase
            .from('staff_profiles')
            .insert({
              barbershop_id: barbershopId,
              user_id: ownerUserId,
              name: ownerProf?.name || 'Proprietário',
              phone: ownerProf?.personal_phone || '',
              photo: ownerProf?.photo || null,
              status: 'active',
              commission_rate: 0
            })
            .select()
            .single();

          if (newOwnerStaff) {
            rawMembers = [newOwnerStaff, ...rawMembers];
          }
        } catch (ownerStaffErr) {
          console.warn('[getStaff] Aviso ao garantir staff_profiles para o proprietário:', ownerStaffErr);
        }
      }

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

        const memRole: MembershipRole = (s.user_id && memberRoleMap.get(s.user_id)) || (s.user_id === ownerUserId ? 'owner' : 'staff');
        const systemRole = memRole === 'owner' ? 'admin_owner' : (memRole === 'admin' ? 'admin' : 'staff');

        deduplicatedStaff.push({
          id: s.id,
          tenantId: s.barbershop_id || barbershopId,
          barbershopId: s.barbershop_id || barbershopId,
          userId: s.user_id || undefined,
          staffProfileId: s.id,
          membershipRole: memRole,
          name: s.name || 'Profissional',
          phone: s.phone ?? '',
          photo: s.photo ?? undefined,
          status: s.status ?? 'active',
          commissionRate: Number(s.commission_rate ?? 0),
          role: memRole,
          createdAt: s.created_at
        });
      }

      // Ordenação rigorosa: Owner no topo, depois Admins, depois Staff em ordem alfabética
      deduplicatedStaff.sort((a, b) => {
        if (a.membershipRole === 'owner') return -1;
        if (b.membershipRole === 'owner') return 1;
        if (a.membershipRole === 'admin' && b.membershipRole !== 'admin') return -1;
        if (b.membershipRole === 'admin' && a.membershipRole !== 'admin') return 1;
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

  async updateStaffProfileByAdminOwner(params: {
    barbershopId: string;
    staffProfileId: string;
    name: string;
    phone?: string;
    photo?: string | null;
    commissionRate: number;
    status: 'active' | 'inactive';
  }): Promise<any> {
    const { barbershopId, staffProfileId, name, phone, photo, commissionRate, status } = params;

    if (!barbershopId) {
      throw new Error('Identificador da barbearia (barbershopId) é obrigatório.');
    }
    if (!staffProfileId) {
      throw new Error('Identificador do perfil do profissional (staffProfileId) é obrigatório.');
    }
    if (!name || !name.trim()) {
      throw new Error('Nome do profissional é obrigatório.');
    }

    const commRateNum = Number(commissionRate);
    if (!Number.isFinite(commRateNum) || commRateNum < 0 || commRateNum > 100) {
      throw new Error('Taxa de comissão inválida (deve estar entre 0 e 100).');
    }

    if (status !== 'active' && status !== 'inactive') {
      throw new Error('Status inválido. Permitido apenas "active" ou "inactive".');
    }

    const rpcPayload = {
      p_barbershop_id: barbershopId,
      p_staff_profile_id: staffProfileId,
      p_name: name.trim(),
      p_phone: phone !== undefined ? phone.trim() : null,
      p_photo: photo !== undefined ? (photo || null) : null,
      p_commission_rate: commRateNum,
      p_status: status
    };

    const { data, error } = await supabase.rpc('update_staff_profile_by_admin_owner', rpcPayload);

    if (error) {
      console.error('[updateStaffProfileByAdminOwner] Erro retornado pela RPC:', error);
      throw error;
    }

    if (!data) {
      throw new Error('A operação não retornou dados do profissional atualizado.');
    }

    return data;
  },

  async updateMyStaffProfile(params: {
    barbershopId: string;
    name?: string;
    phone?: string;
    photo?: string | null;
  }): Promise<any> {
    const { barbershopId, name, phone, photo } = params;
    const rpcPayload = {
      p_barbershop_id: barbershopId,
      p_name: name ? name.trim() : null,
      p_phone: phone !== undefined ? phone.trim() : null,
      p_photo: photo !== undefined ? (photo || null) : null
    };

    const { data, error } = await supabase.rpc('update_my_staff_profile', rpcPayload);
    if (error) {
      console.error('[updateMyStaffProfile] Erro retornado pela RPC:', error);
      throw error;
    }
    return data;
  },

  async saveStaff(staff: Omit<Staff, 'id' | 'tenantId' | 'role'> & { id?: string; tenantId?: string; role?: MembershipRole | 'admin_owner'; barbershopId?: string }) {
    const { role } = await this.getUserRoleAndTenant();
    const currentUserId = await this.getUserId();
    const isSelf = !!(currentUserId && (staff.userId === currentUserId || staff.id === currentUserId));

    if (role !== 'admin_owner' && role !== 'admin' && !isSelf) {
      throw new Error('Apenas o proprietário ou administradores podem gerenciar ou salvar equipe.');
    }

    // Resolver barbershopId real
    let barbershopId = staff.barbershopId;
    if (!barbershopId) {
      const tenantContext = await this.resolveTenantContext(currentUserId || undefined);
      barbershopId = tenantContext.barbershopId || undefined;
    }
    if (!barbershopId && staff.tenantId) {
      const { data: bs } = await supabase
        .from('barbershops')
        .select('id, owner_id')
        .or(`id.eq.${staff.tenantId},owner_id.eq.${staff.tenantId}`)
        .maybeSingle();
      if (bs) {
        barbershopId = bs.id;
      }
    }

    if (!barbershopId) {
      throw new Error('Contexto da barbearia (barbershop_id) não encontrado.');
    }

    if (!staff.id) {
      throw new Error('Para cadastrar novos colaboradores com login, utilize o fluxo createStaffDirectly.');
    }

    const staffRole = staff.role === 'admin' || staff.role === 'owner' || (staff.role as any) === 'admin_owner' ? 'admin' : 'staff';
    let resultData: any = null;

    if (isSelf && role === 'staff') {
      // Funcionário comum atualizando seus próprios dados pessoais
      resultData = await this.updateMyStaffProfile({
        barbershopId,
        name: staff.name,
        phone: staff.phone,
        photo: staff.photo
      });
    } else {
      // Admin ou Owner atualizando perfil de profissional via RPC autorizada
      const commRate = staff.commissionRate !== undefined && Number.isFinite(Number(staff.commissionRate))
        ? Number(staff.commissionRate)
        : 0;

      resultData = await this.updateStaffProfileByAdminOwner({
        barbershopId,
        staffProfileId: staff.id,
        name: staff.name,
        phone: staff.phone,
        photo: staff.photo,
        commissionRate: commRate,
        status: staff.status || 'active'
      });

      // Se houver alteração de papel administrativo para o usuário
      if (staff.userId && staff.role && (staff.role === 'staff' || staff.role === 'admin')) {
        try {
          await supabase.rpc('change_member_role', {
            p_barbershop_id: barbershopId,
            p_target_user_id: staff.userId,
            p_new_role: staff.role
          });
        } catch (roleErr) {
          console.warn('[saveStaff] Aviso ao atualizar papel do membro via RPC:', roleErr);
        }
      }
    }

    if (!resultData) {
      throw new Error('Erro ao salvar registro de profissional no banco de dados.');
    }

    return {
      id: resultData.id || staff.id,
      tenantId: resultData.barbershop_id || barbershopId,
      barbershopId: resultData.barbershop_id || barbershopId,
      userId: resultData.user_id || staff.userId,
      name: resultData.name || staff.name,
      phone: resultData.phone ?? staff.phone ?? '',
      photo: resultData.photo ?? staff.photo ?? null,
      status: resultData.status || staff.status || 'active',
      commissionRate: Number(resultData.commission_rate ?? staff.commissionRate ?? 0),
      role: staffRole
    };
  },

  async removeStaffFromBarbershop({
    staffProfileId,
    staffUserId,
    barbershopId
  }: {
    staffProfileId: string;
    staffUserId?: string | null;
    barbershopId: string;
  }): Promise<void> {
    const currentUserId = await this.getUserId();
    if (!currentUserId) {
      throw new Error('Usuário não autenticado.');
    }

    let resolvedBarbershopId = barbershopId;
    if (!resolvedBarbershopId) {
      const bs = await this.getBarbershop();
      resolvedBarbershopId = bs?.id || '';
    }

    if (!resolvedBarbershopId) {
      throw new Error('Identificador da barbearia (barbershopId) é obrigatório.');
    }

    if (!staffProfileId) {
      throw new Error('Identificador do perfil do profissional (staffProfileId) é obrigatório.');
    }

    // Chamar a RPC segura remove_staff_from_barbershop
    const { data, error } = await supabase.rpc('remove_staff_from_barbershop', {
      p_barbershop_id: resolvedBarbershopId,
      p_staff_profile_id: staffProfileId,
      p_staff_user_id: staffUserId || null
    });

    if (error) {
      console.error('[removeStaffFromBarbershop] Erro retornado pela RPC:', error);
      throw error;
    }

    if (!data || data.success !== true) {
      throw new Error(data?.message || 'Falha ao desvincular profissional da barbearia.');
    }

    console.info(`[removeStaffFromBarbershop] Profissional ${staffProfileId} desvinculado com sucesso da barbearia ${resolvedBarbershopId}.`);
  },

  async reactivateStaff({
    staffProfileId,
    barbershopId
  }: {
    staffProfileId: string;
    barbershopId: string;
  }): Promise<void> {
    const currentUserId = await this.getUserId();
    if (!currentUserId) {
      throw new Error('Usuário não autenticado.');
    }

    let resolvedBarbershopId = barbershopId;
    if (!resolvedBarbershopId) {
      const bs = await this.getBarbershop();
      resolvedBarbershopId = bs?.id || '';
    }

    if (!resolvedBarbershopId) {
      throw new Error('Identificador da barbearia (barbershopId) é obrigatório.');
    }

    if (!staffProfileId) {
      throw new Error('Identificador do perfil do profissional (staffProfileId) é obrigatório.');
    }

    // Chamar a RPC segura reactivate_staff
    const { data, error } = await supabase.rpc('reactivate_staff', {
      p_barbershop_id: resolvedBarbershopId,
      p_staff_profile_id: staffProfileId
    });

    if (error) {
      console.error('[reactivateStaff] Erro retornado pela RPC:', error);
      throw error;
    }

    if (!data || data.success !== true) {
      throw new Error(data?.message || 'Falha ao reativar profissional na barbearia.');
    }

    console.info(`[reactivateStaff] Profissional ${staffProfileId} reativado com sucesso na barbearia ${resolvedBarbershopId}.`);
  },

  async deleteStaff(id: string, barbershopId?: string) {
    let targetShopId = barbershopId;
    if (!targetShopId) {
      const { data: staffData } = await supabase
        .from('staff_profiles')
        .select('id, user_id, barbershop_id')
        .eq('id', id)
        .maybeSingle();
      targetShopId = staffData?.barbershop_id || (await this.getBarbershop())?.id;
    }

    if (!targetShopId) {
      throw new Error('Não foi possível identificar a barbearia deste profissional para desvinculá-lo.');
    }

    await this.removeStaffFromBarbershop({
      staffProfileId: id,
      barbershopId: targetShopId
    });
  },

  async createStaffMemberWithoutLogin(params: {
    barbershopId: string;
    ownerId: string;
    name: string;
    phone?: string;
    photo?: string;
    commissionRate?: number;
  }): Promise<Staff> {
    const currentUserId = await this.getUserId();
    if (!currentUserId) throw new Error('Usuário não autenticado.');

    const newId = crypto.randomUUID();
    const { data, error } = await supabase
      .from('staff_profiles')
      .insert({
        id: newId,
        barbershop_id: params.barbershopId,
        user_id: null,
        name: params.name.trim(),
        phone: params.phone || '',
        photo: params.photo || null,
        status: 'active',
        commission_rate: params.commissionRate !== undefined ? Number(params.commissionRate) : 30
      })
      .select()
      .single();

    if (error) {
      console.error('[createStaffMemberWithoutLogin] Erro ao cadastrar profissional:', error);
      throw new Error(`Erro ao salvar profissional no banco de dados: ${error.message}`);
    }

    return {
      id: data.id,
      tenantId: data.barbershop_id,
      barbershopId: data.barbershop_id,
      userId: null,
      name: data.name,
      phone: data.phone || '',
      photo: data.photo || null,
      status: data.status || 'active',
      commissionRate: Number(data.commission_rate || 0),
      role: 'staff'
    };
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
          .select('id, barbershop_id, user_id')
          .eq('user_id', inputId)
          .maybeSingle();

        if (staffData) {
          barbershopId = (staffData as any).barbershop_id || null;
          staffProfileId = (staffData as any).id || null;
          detectedRole = 'staff';
          
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

  async getUserRoleAndTenant(): Promise<{ role: 'admin_owner' | 'staff' | 'client'; tenantId: string | null; userId: string | null; barbershopId: string | null }> {
    try {
      const userId = await this.getUserId();
      if (!userId) {
        return { role: 'client', tenantId: null, userId: null, barbershopId: null };
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
        const bId = (memberData as any).barbershop_id || null;
        return { role, tenantId: bId || ownerId, userId, barbershopId: bId };
      }

      // Fallback legado
      const tenantId = await this.getTenantIdForUser(userId);
      if (tenantId === userId) {
        return { role: 'admin_owner', tenantId, userId, barbershopId: tenantId };
      } else {
        return { role: 'staff', tenantId, userId, barbershopId: tenantId };
      }
    } catch (err) {
      console.warn('[getUserRoleAndTenant] Erro ao obter papel:', err);
      return { role: 'client', tenantId: null, userId: null, barbershopId: null };
    }
  },

  async getStaffAvailability(staffId: string): Promise<StaffAvailability[]> {
    try {
      const { barbershopId } = await this.getUserRoleAndTenant();
      
      let targetShopId = barbershopId;
      if (!targetShopId) {
        const { data: spRow } = await supabase
          .from('staff_profiles')
          .select('barbershop_id')
          .eq('id', staffId)
          .maybeSingle();
        if (spRow?.barbershop_id) {
          targetShopId = spRow.barbershop_id;
        }
      }

      // Carregar pausas salvas localmente como fallback complementar caso o RPC tenha usado fallback sem breaks
      const localKey = `meucorte_availability_${staffId}`;
      const localBreaksMap: Record<number, string[]> = {};
      try {
        const rawLocal = localStorage.getItem(localKey);
        if (rawLocal) {
          const parsedLocal = JSON.parse(rawLocal);
          if (Array.isArray(parsedLocal)) {
            parsedLocal.forEach((l: any) => {
              if (typeof l.dayOfWeek === 'number' && Array.isArray(l.breaks)) {
                localBreaksMap[l.dayOfWeek] = l.breaks.map((b: string) => normalizeTime(b)).filter(Boolean);
              }
            });
          }
        }
      } catch {}

      // 1. Tentar ler primeiro da tabela de horários individuais (staff_availability)
      try {
        const { data: indAvail, error: indErr } = await supabase
          .from('staff_availability')
          .select('*')
          .eq('staff_id', staffId);

        if (!indErr && indAvail && indAvail.length > 0) {
          // Buscar pausas individuais do profissional
          let breaksQuery = supabase.from('weekly_breaks').select('*').eq('staff_id', staffId);
          if (targetShopId) breaksQuery = breaksQuery.eq('barbershop_id', targetShopId);
          const { data: breaksData } = await breaksQuery;
          const breaks = breaksData || [];

          const result: StaffAvailability[] = (indAvail as any[]).map(item => {
            const dayBreaks = (breaks as any[])
              .filter((b: any) => b.day_of_week === item.day_of_week)
              .flatMap((b: any) => expandBreakRowToSlots(b))
              .filter(Boolean);
            const colBreaks = (item.breaks || []).map((b: string) => normalizeTime(b)).filter(Boolean);
            const dbBreaks = Array.from(new Set([...colBreaks, ...dayBreaks]));
            const fallbackLocalBreaks = dbBreaks.length > 0 ? dbBreaks : (item.is_open ? (localBreaksMap[item.day_of_week] || []) : []);
            const allBreaks = Array.from(new Set(fallbackLocalBreaks));

            return {
              id: item.id || `${staffId}_${item.day_of_week}`,
              staffId: staffId,
              dayOfWeek: item.day_of_week,
              startTime: normalizeTime(item.start_time),
              endTime: normalizeTime(item.end_time),
              breaks: allBreaks,
              isOpen: item.is_open,
              createdAt: item.created_at
            };
          });

          try { localStorage.setItem(localKey, JSON.stringify(result)); } catch {}
          return result;
        }
      } catch (availReadErr) {
        console.warn('[getStaffAvailability] Aviso ao consultar staff_availability:', availReadErr);
      }

      // 2. HERANÇA DA GRADE GERAL: Se o profissional não possui horários individuais específicos,
      // herda o horário de funcionamento da barbearia (weekly_schedule) e pausas gerais (staff_id IS NULL).
      if (targetShopId) {
        const [scheduleRes, breaksRes] = await Promise.all([
          supabase.from('weekly_schedule').select('*').eq('barbershop_id', targetShopId),
          supabase.from('weekly_breaks').select('*').eq('barbershop_id', targetShopId).is('staff_id', null)
        ]);

        if (!scheduleRes.error && scheduleRes.data && scheduleRes.data.length > 0) {
          const breaks = breaksRes.data || [];
          const result: StaffAvailability[] = scheduleRes.data.map((s: any) => {
            const dayBreaks = (breaks as any[])
              .filter((b: any) => b.day_of_week === s.day_of_week)
              .flatMap((b: any) => expandBreakRowToSlots(b))
              .filter(Boolean);

            return {
              id: `${staffId}_${s.day_of_week}`,
              staffId: staffId,
              dayOfWeek: s.day_of_week,
              startTime: normalizeTime(s.start_time),
              endTime: normalizeTime(s.end_time),
              breaks: Array.from(new Set(dayBreaks)),
              isOpen: s.is_open,
              createdAt: s.created_at
            };
          });

          return result;
        }
      }

      return [];
    } catch (err: any) {
      console.warn('[getStaffAvailability] Erro ao carregar disponibilidade:', err);
      const localKey = `meucorte_availability_${staffId}`;
      try {
        const stored = localStorage.getItem(localKey);
        if (stored) return JSON.parse(stored);
      } catch {}
      return [];
    }
  },

  async saveStaffAvailability(availabilities: Omit<StaffAvailability, 'id'>[]) {
    if (availabilities.length === 0) return;
    const staffId = availabilities[0].staffId;

    try {
      const { role, userId, barbershopId } = await this.getUserRoleAndTenant();
      if (role === 'client' || !userId) {
        throw new Error('Não autorizado.');
      }

      const { data: spRow } = await supabase
        .from('staff_profiles')
        .select('id, barbershop_id, user_id, status')
        .eq('id', staffId)
        .maybeSingle();

      const targetShopId = barbershopId || spRow?.barbershop_id || null;
      const targetStaffUserId = spRow?.user_id || userId;

      if (!targetShopId) {
        throw new Error('Identificador da barbearia não encontrado ao salvar disponibilidade.');
      }

      // Security check for staff: can only edit own schedule and must be active
      if (role === 'staff') {
        const { data: staffMember, error: staffErr } = await supabase
          .from('staff_profiles')
          .select('id, status')
          .eq('user_id', userId)
          .maybeSingle();

        if (staffErr) {
          throw staffErr;
        } else if (!staffMember || (staffMember as any).id !== staffId) {
          throw new Error('Apenas permitido editar sua própria disponibilidade.');
        } else if (staffMember.status === 'inactive') {
          throw new Error('Profissional inativo não pode editar horários. Solicite reativação primeiro.');
        }
      }

      const saveLocalAvailabilityCache = () => {
        const localKey = `meucorte_availability_${staffId}`;
        try {
          const cachedData = availabilities.map(a => ({
            id: `${staffId}_${a.dayOfWeek}`,
            staffId: a.staffId,
            dayOfWeek: a.dayOfWeek,
            startTime: normalizeTime(a.startTime),
            endTime: normalizeTime(a.endTime),
            breaks: a.isOpen ? Array.from(new Set((a.breaks || []).map((b: string) => normalizeTime(b)).filter(Boolean))) : [],
            isOpen: a.isOpen
          }));
          localStorage.setItem(localKey, JSON.stringify(cachedData));
        } catch {}
      };

      // PASSO CRÍTICO: Garantir que os registros pai em weekly_schedule existam para os 7 dias (0..6)
      // ANTES de inserir/atualizar weekly_breaks (evitando erro 23503 de FK weekly_breaks_day_of_week_fkey)
      const ensureParentScheduleAndGetUserMap = async (): Promise<Map<number, string>> => {
        const [{ data: existingWsRows }, { data: shopRow }] = await Promise.all([
          supabase
            .from('weekly_schedule')
            .select('id, day_of_week, user_id')
            .eq('barbershop_id', targetShopId),
          supabase
            .from('barbershops')
            .select('owner_id')
            .eq('id', targetShopId)
            .maybeSingle()
        ]);

        const fallbackOwnerUserId =
          shopRow?.owner_id ||
          (existingWsRows && existingWsRows.length > 0 ? existingWsRows[0].user_id : null) ||
          targetStaffUserId ||
          userId;

        const wsUserByDay = new Map<number, string>();
        (existingWsRows || []).forEach((row: any) => {
          if (typeof row.day_of_week === 'number' && row.user_id) {
            wsUserByDay.set(row.day_of_week, row.user_id);
          }
        });

        const missingDays: any[] = [];
        for (let d = 0; d <= 6; d++) {
          if (!wsUserByDay.has(d) && fallbackOwnerUserId) {
            const refDay = availabilities.find(a => a.dayOfWeek === d);
            missingDays.push({
              user_id: fallbackOwnerUserId,
              barbershop_id: targetShopId,
              day_of_week: d,
              start_time: refDay ? normalizeTime(refDay.startTime) : '09:00',
              end_time: refDay ? normalizeTime(refDay.endTime) : '18:00',
              is_open: refDay ? refDay.isOpen : d !== 0
            });
            wsUserByDay.set(d, fallbackOwnerUserId);
          }
        }

        if (missingDays.length > 0) {
          const { error: upsertWsErr } = await supabase
            .from('weekly_schedule')
            .upsert(missingDays as any, { onConflict: 'barbershop_id,day_of_week' });

          if (upsertWsErr) {
            // Fallback individual caso a constraint de conflito seja diferente
            for (const row of missingDays) {
              await supabase.from('weekly_schedule').insert(row as any);
            }
          }
        }

        return wsUserByDay;
      };

      const wsUserByDay = await ensureParentScheduleAndGetUserMap();

      const syncBreaksWithUserId = async () => {
        // 1. Atualizar a coluna breaks em staff_availability com os slots de 30min
        await Promise.all(
          availabilities.map(a => {
            const cleanBreaks = a.isOpen
              ? Array.from(new Set((a.breaks || []).map((b: string) => normalizeTime(b)).filter(Boolean)))
              : [];
            return supabase
              .from('staff_availability')
              .update({ breaks: cleanBreaks } as any)
              .eq('barbershop_id', targetShopId)
              .eq('staff_id', staffId)
              .eq('day_of_week', a.dayOfWeek);
          })
        );

        // 2. Limpar pausas anteriores deste profissional em weekly_breaks
        await supabase
          .from('weekly_breaks')
          .delete()
          .eq('staff_id', staffId)
          .eq('barbershop_id', targetShopId);

        // 3. Converter blocos contínuos de 30min em intervalos limpos (start_time, end_time)
        const breakRows: any[] = [];
        availabilities.forEach(a => {
          if (!a.isOpen) return;
          const scheduleUserId = wsUserByDay.get(a.dayOfWeek);
          if (!scheduleUserId) return;

          const mergedIntervals = mergeBreakSlotsToIntervals(a.breaks || []);
          mergedIntervals.forEach(interval => {
            breakRows.push({
              user_id: scheduleUserId,
              staff_id: a.staffId,
              barbershop_id: targetShopId,
              day_of_week: a.dayOfWeek,
              time: interval.start_time,
              start_time: interval.start_time,
              end_time: interval.end_time
            });
          });
        });

        if (breakRows.length > 0) {
          const { error: wbInsErr } = await supabase.from('weekly_breaks').insert(breakRows as any);
          if (wbInsErr && (wbInsErr as any).code !== '23505' && (wbInsErr as any).code !== '23503') {
            console.warn('[saveStaffAvailability] Aviso ao sincronizar weekly_breaks diretamente:', wbInsErr);
          }
        }
      };

      // 1. Salvar a grade base em staff_availability via RPC transacional atômica (passando breaks: [] para que
      // a RPC legada no banco não falhe em weekly_breaks antes da mesclagem de intervalos)
      const rpcPayloadWithoutBreaks = availabilities.map(a => ({
        day_of_week: a.dayOfWeek,
        start_time: normalizeTime(a.startTime),
        end_time: normalizeTime(a.endTime),
        is_open: a.isOpen,
        breaks: []
      }));

      const { data: rpcRes, error: rpcErr } = await supabase.rpc('save_staff_schedule_atomic', {
        p_barbershop_id: targetShopId,
        p_staff_id: staffId,
        p_schedule: rpcPayloadWithoutBreaks
      });

      if (!rpcErr && rpcRes && rpcRes.success === true) {
        await syncBreaksWithUserId();
        saveLocalAvailabilityCache();
        return;
      }

      if (rpcErr) {
        console.warn('[saveStaffAvailability] Aviso na RPC save_staff_schedule_atomic, aplicando fallback direto:', rpcErr.message);
      }

      // 2. Fallback direto caso a RPC não esteja disponível ou falhe
      await supabase
        .from('staff_availability')
        .delete()
        .eq('staff_id', staffId)
        .eq('barbershop_id', targetShopId);

      const availabilityRows = availabilities.map(a => ({
        id: crypto.randomUUID(),
        barbershop_id: targetShopId,
        staff_id: staffId,
        day_of_week: a.dayOfWeek,
        start_time: normalizeTime(a.startTime),
        end_time: normalizeTime(a.endTime),
        is_open: a.isOpen,
        breaks: a.isOpen ? Array.from(new Set((a.breaks || []).map((b: string) => normalizeTime(b)).filter(Boolean))) : []
      }));

      const { error: directInsErr } = await supabase.from('staff_availability').insert(availabilityRows as any);
      if (directInsErr) {
        throw new Error(directInsErr.message || 'Erro ao salvar horários do profissional no banco de dados.');
      }

      await syncBreaksWithUserId();
      saveLocalAvailabilityCache();
    } catch (err: any) {
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
  async getBarbershop(targetBarbershopId?: string): Promise<Barbershop | null> {
    try {
      const userId = await this.getUserId();
      if (!userId) return null;

      // 0. Se targetBarbershopId explícito foi fornecido, buscar direto por id
      if (targetBarbershopId) {
        const { data: directShop, error: directErr } = await supabase
          .from('barbershops')
          .select('*')
          .eq('id', targetBarbershopId)
          .maybeSingle();

        if (!directErr && directShop) {
          return {
            id: directShop.id,
            ownerId: directShop.owner_id,
            name: directShop.name,
            slug: directShop.slug,
            phone: directShop.phone || directShop.business_phone || '',
            businessPhone: directShop.business_phone || directShop.phone || '',
            address: directShop.address || '',
            logo: directShop.logo || '',
            description: directShop.description || '',
            instagram: directShop.instagram || '',
            website: directShop.website || '',
            createdAt: directShop.created_at
          };
        }
      }

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
          phone: data.phone || data.business_phone || '',
          businessPhone: data.business_phone || data.phone || '',
          address: data.address || '',
          logo: data.logo || '',
          description: data.description || '',
          instagram: data.instagram || '',
          website: data.website || '',
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
            phone: data.phone || data.business_phone || '',
            businessPhone: data.business_phone || data.phone || '',
            address: data.address || '',
            logo: data.logo || '',
            description: data.description || '',
            instagram: data.instagram || '',
            website: data.website || '',
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

  async ensureOwnerStaffProfile(barbershopId: string): Promise<Staff> {
    if (!barbershopId) {
      throw new Error('barbershopId é obrigatório para garantir o perfil profissional do proprietário.');
    }

    const { data, error } = await supabase.rpc('ensure_owner_staff_profile', {
      p_barbershop_id: barbershopId
    });

    if (error) {
      console.error('[ensureOwnerStaffProfile] Erro ao executar RPC ensure_owner_staff_profile:', error);
      throw error;
    }

    if (!data) {
      throw new Error('Falha ao obter perfil profissional do proprietário retornado pela RPC.');
    }

    return {
      id: data.id,
      tenantId: data.barbershop_id,
      userId: data.user_id,
      barbershopId: data.barbershop_id,
      name: data.name,
      phone: data.phone || '',
      photo: data.photo || undefined,
      status: data.status || 'active',
      commissionRate: Number(data.commission_rate ?? 100),
      role: 'owner'
    };
  },

  async resolveAuthContexts(targetUserId?: string): Promise<AuthContext> {
    const userId = targetUserId || await this.getUserId();

    if (!userId) {
      return {
        authenticatedUserId: '',
        contexts: [],
        activeContext: null,
        status: 'unauthenticated'
      };
    }

    try {
      // 1. Consultas simultâneas de banco real
      const [memberRes, ownedRes, staffRes] = await Promise.all([
        supabase.from('barbershop_members').select('barbershop_id, role, joined_at').eq('user_id', userId),
        supabase.from('barbershops').select('id, owner_id, name, slug, created_at').eq('owner_id', userId),
        supabase.from('staff_profiles').select('id, barbershop_id, user_id, status, name, phone, photo').eq('user_id', userId)
      ]);

      const memberRows: any[] = memberRes.data || [];
      const ownedRows: any[] = ownedRes.data || [];
      const staffRows: any[] = staffRes.data || [];

      // 2. Reparar e garantir idempotentemente membership role='owner' e staff_profiles para cada barbearia própria
      for (const ownedShop of ownedRows) {
        const hasOwnerMem = memberRows.some(m => m.barbershop_id === ownedShop.id && m.role === 'owner');
        if (!hasOwnerMem) {
          try {
            await supabase.from('barbershop_members').upsert({
              barbershop_id: ownedShop.id,
              user_id: userId,
              role: 'owner'
            }, { onConflict: 'barbershop_id,user_id' });

            memberRows.push({
              barbershop_id: ownedShop.id,
              user_id: userId,
              role: 'owner',
              joined_at: new Date().toISOString()
            });
          } catch (repairErr) {
            console.warn('[resolveAuthContexts] Aviso ao reparar owner membership:', repairErr);
          }
        }

        const hasOwnerStaff = staffRows.some(s => s.barbershop_id === ownedShop.id);
        if (!hasOwnerStaff) {
          try {
            const { data: newOwnerStaff } = await supabase.rpc('ensure_owner_staff_profile', {
              p_barbershop_id: ownedShop.id
            });

            if (newOwnerStaff) {
              staffRows.push({
                id: newOwnerStaff.id,
                barbershop_id: newOwnerStaff.barbershop_id,
                user_id: newOwnerStaff.user_id,
                status: newOwnerStaff.status || 'active',
                name: newOwnerStaff.name,
                phone: newOwnerStaff.phone,
                photo: newOwnerStaff.photo
              });
            }
          } catch (staffRepairErr) {
            console.warn('[resolveAuthContexts] Aviso ao garantir staff_profile do owner via RPC:', staffRepairErr);
          }
        }
      }

      // 3. Coletar metadados de todas as barbearias envolvidas
      const allBarbershopIds = Array.from(new Set([
        ...ownedRows.map(b => b.id),
        ...memberRows.map(m => m.barbershop_id)
      ].filter(Boolean)));

      const barbershopsMap = new Map<string, any>();
      ownedRows.forEach(b => barbershopsMap.set(b.id, b));

      const missingShopIds = allBarbershopIds.filter(id => !barbershopsMap.has(id));
      if (missingShopIds.length > 0) {
        const { data: extShops } = await supabase
          .from('barbershops')
          .select('id, owner_id, name, slug, created_at')
          .in('id', missingShopIds);

        (extShops || []).forEach(b => barbershopsMap.set(b.id, b));
      }

      // 4. Construir contexts do usuário
      const contexts: TenantContext[] = [];
      let hasInconsistentStaff = false;
      let hasInactiveStaff = false;

      for (const m of memberRows) {
        const shop = barbershopsMap.get(m.barbershop_id);
        if (!shop) continue;

        const role: MembershipRole = m.role === 'owner' ? 'owner' : (m.role === 'admin' ? 'admin' : 'staff');
        const isOwner = shop.owner_id === userId || role === 'owner';

        const staff = staffRows.find((s: any) => s.barbershop_id === m.barbershop_id);

        if (!isOwner && staff && staff.status === 'inactive') {
          hasInactiveStaff = true;
          continue;
        }

        if (!isOwner && !staff) {
          hasInconsistentStaff = true;
        }

        if (!contexts.some(c => c.barbershopId === shop.id)) {
          contexts.push({
            barbershopId: shop.id,
            barbershopName: shop.name || 'Barbearia',
            barbershopSlug: shop.slug || '',
            role,
            staffProfileId: staff?.id || null,
            isOwner,
            logoUrl: null
          });
        }
      }

      // 5. Ordenação: Owner primeiro, depois Admin, depois Staff; alfabética dentro do mesmo papel
      const rolePriority: Record<MembershipRole, number> = { owner: 1, admin: 2, staff: 3 };
      contexts.sort((a, b) => {
        const pA = rolePriority[a.role] || 99;
        const pB = rolePriority[b.role] || 99;
        if (pA !== pB) return pA - pB;
        return a.barbershopName.localeCompare(b.barbershopName);
      });

      // 6. Avaliar status
      if (contexts.length === 0) {
        if (hasInactiveStaff || staffRows.some((s: any) => s.status === 'inactive')) {
          return {
            authenticatedUserId: userId,
            contexts: [],
            activeContext: null,
            status: 'access_revoked'
          };
        }
        return {
          authenticatedUserId: userId,
          contexts: [],
          activeContext: null,
          status: 'needs_onboarding'
        };
      }

      if (hasInconsistentStaff && contexts.every(c => !c.isOwner && !c.staffProfileId)) {
        return {
          authenticatedUserId: userId,
          contexts,
          activeContext: null,
          status: 'inconsistent'
        };
      }

      if (contexts.length === 1) {
        return {
          authenticatedUserId: userId,
          contexts,
          activeContext: contexts[0],
          status: 'ready'
        };
      }

      return {
        authenticatedUserId: userId,
        contexts,
        activeContext: null,
        status: 'needs_context_selection'
      };

    } catch (err: any) {
      console.error('[resolveAuthContexts] Erro ao resolver contextos:', err);
      return {
        authenticatedUserId: userId,
        contexts: [],
        activeContext: null,
        status: 'access_revoked'
      };
    }
  },

  async resolveSingleActiveContext(targetUserId?: string): Promise<ActiveContext> {
    const userId = targetUserId || await this.getUserId();
    if (!userId) {
      return {
        kind: 'access_revoked',
        userId: '',
        reason: 'Sessão inválida ou expirada.'
      };
    }

    const authCtx = await this.resolveAuthContexts(userId);

    if (authCtx.status === 'access_revoked') {
      return {
        kind: 'access_revoked',
        userId,
        reason: 'Seu perfil de profissional nesta barbearia está inativo no momento. Entre em contato com a administração da barbearia para solicitar sua reativação.'
      };
    }

    if (authCtx.status === 'needs_onboarding') {
      return {
        kind: 'needs_onboarding',
        userId
      };
    }

    if (authCtx.status === 'needs_context_selection') {
      return {
        kind: 'multiple_contexts_not_supported',
        userId,
        contexts: authCtx.contexts.map(c => ({
          barbershopId: c.barbershopId,
          barbershopName: c.barbershopName,
          role: c.role,
          staffProfileId: c.staffProfileId
        }))
      };
    }

    if (authCtx.status === 'ready' && authCtx.activeContext) {
      const single = authCtx.activeContext;
      return {
        kind: single.role,
        userId,
        barbershopId: single.barbershopId,
        barbershopName: single.barbershopName,
        membershipRole: single.role,
        staffProfileId: single.staffProfileId
      };
    }

    return {
      kind: 'access_revoked',
      userId,
      reason: authCtx.status === 'inconsistent' 
        ? 'Conta vinculada como colaborador sem perfil operacional correspondente.'
        : 'Acesso revogado ou indisponível nesta barbearia.'
    };
  },

  async resolveAuthContext(targetUserId?: string, selectedBarbershopId?: string): Promise<AuthContextResult> {
    const userId = targetUserId || await this.getUserId();

    if (!userId) {
      return {
        userId: null,
        profile: null,
        memberships: [],
        ownedBarbershops: [],
        userContexts: [],
        activeMembership: null,
        activeBarbershopId: null,
        activeBarbershop: null,
        staffProfile: null,
        accessKind: 'no_membership'
      };
    }

    try {
      // 1. Consultas simultâneas de alta performance
      const [profileRes, memberRes, ownedRes, staffRes] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
        supabase.from('barbershop_members').select('*').eq('user_id', userId),
        supabase.from('barbershops').select('*').eq('owner_id', userId),
        supabase.from('staff_profiles').select('*').eq('user_id', userId)
      ]);

      const profileRow = profileRes.data;
      const memberRows = memberRes.data || [];
      const ownedRows = ownedRes.data || [];
      const staffRows = staffRes.data || [];

      const profileObj: BarberProfile | null = profileRow ? {
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
      } : null;

      const ownedBarbershops: Barbershop[] = ownedRows.map((b: any) => ({
        id: b.id,
        ownerId: b.owner_id,
        name: b.name,
        slug: b.slug,
        createdAt: b.created_at
      }));

      const memberships: BarbershopMember[] = memberRows.map((m: any) => ({
        barbershopId: m.barbershop_id,
        userId: m.user_id,
        role: m.role,
        joinedAt: m.joined_at
      }));

      // 2. Coletar IDs de barbearias de membership que ainda não foram carregadas
      const ownedIds = new Set(ownedBarbershops.map(b => b.id));
      const externalShopIds = memberRows
        .map((m: any) => m.barbershop_id)
        .filter((id: string) => id && !ownedIds.has(id));

      let memberBarbershops: Barbershop[] = [];
      if (externalShopIds.length > 0) {
        const { data: memberShopsData } = await supabase
          .from('barbershops')
          .select('*')
          .in('id', externalShopIds);

        if (memberShopsData) {
          memberBarbershops = memberShopsData.map((b: any) => ({
            id: b.id,
            ownerId: b.owner_id,
            name: b.name,
            slug: b.slug,
            createdAt: b.created_at
          }));
        }
      }

      // Mapa de barbearias por ID
      const allShopsMap = new Map<string, Barbershop>();
      ownedBarbershops.forEach(b => allShopsMap.set(b.id, b));
      memberBarbershops.forEach(b => allShopsMap.set(b.id, b));

      // 3. Construir lista de contextos do usuário (UserBarbershopContext[])
      const userContexts: UserBarbershopContext[] = [];

      // A) Para barbearias próprias:
      for (const bs of ownedBarbershops) {
        const staffRow = staffRows.find((s: any) => s.barbershop_id === bs.id);
        const mappedStaff: Staff | null = staffRow ? {
          id: staffRow.id,
          tenantId: staffRow.barbershop_id || bs.id,
          barbershopId: staffRow.barbershop_id || bs.id,
          userId: staffRow.user_id || userId,
          name: staffRow.name || profileObj?.name || 'Proprietário',
          phone: staffRow.phone || profileObj?.personalPhone || '',
          photo: staffRow.photo || profileObj?.photo || null,
          status: staffRow.status || 'active',
          commissionRate: Number(staffRow.commission_rate || 0),
          role: 'owner'
        } : null;

        userContexts.push({
          barbershop: bs,
          role: 'owner',
          staffProfile: mappedStaff
        });
      }

      // B) Para memberships externas:
      for (const m of memberRows) {
        if (ownedIds.has(m.barbershop_id)) continue; // Já adicionado como owner
        const bs = allShopsMap.get(m.barbershop_id);
        if (!bs) continue; // Barbearia pode ter sido deletada

        const staffRow = staffRows.find((s: any) => s.barbershop_id === bs.id);
        const mappedStaff: Staff | null = staffRow ? {
          id: staffRow.id,
          tenantId: staffRow.barbershop_id || bs.id,
          barbershopId: staffRow.barbershop_id || bs.id,
          userId: staffRow.user_id || userId,
          name: staffRow.name || profileObj?.name || 'Profissional',
          phone: staffRow.phone || profileObj?.personalPhone || '',
          photo: staffRow.photo || profileObj?.photo || null,
          status: staffRow.status || 'active',
          commissionRate: Number(staffRow.commission_rate || 0),
          role: m.role === 'admin' ? 'admin' : 'staff'
        } : null;

        userContexts.push({
          barbershop: bs,
          role: m.role as 'owner' | 'admin' | 'staff',
          staffProfile: mappedStaff
        });
      }

      // 4. Avaliar accessKind
      if (userContexts.length === 0) {
        const hasInactiveStaff = staffRows.some((s: any) => s.status === 'inactive') || memberRows.length > 0;
        if (hasInactiveStaff) {
          return {
            userId,
            profile: profileObj,
            memberships,
            ownedBarbershops,
            userContexts: [],
            activeMembership: null,
            activeBarbershopId: null,
            activeBarbershop: null,
            staffProfile: null,
            accessKind: 'access_revoked'
          };
        }
        // Usuário com conta, mas sem barbearia própria e sem membership
        return {
          userId,
          profile: profileObj,
          memberships,
          ownedBarbershops,
          userContexts: [],
          activeMembership: null,
          activeBarbershopId: null,
          activeBarbershop: null,
          staffProfile: null,
          accessKind: 'owner_needs_barbershop'
        };
      }

      if (userContexts.length > 1) {
        // Múltiplos contextos: verificar se há uma seleção explícita
        if (selectedBarbershopId) {
          const selectedCtx = userContexts.find(c => c.barbershop.id === selectedBarbershopId);
          if (selectedCtx) {
            const roleKind: AccessKind = selectedCtx.role === 'owner' 
              ? 'owner_ready' 
              : (selectedCtx.role === 'admin' ? 'admin_ready' : 'staff_ready');

            const activeMember = memberships.find(m => m.barbershopId === selectedCtx.barbershop.id) || {
              barbershopId: selectedCtx.barbershop.id,
              userId,
              role: selectedCtx.role,
              joinedAt: new Date().toISOString()
            };

            return {
              userId,
              profile: profileObj,
              memberships,
              ownedBarbershops,
              userContexts,
              activeMembership: activeMember,
              activeBarbershopId: selectedCtx.barbershop.id,
              activeBarbershop: selectedCtx.barbershop,
              staffProfile: selectedCtx.staffProfile || null,
              accessKind: roleKind
            };
          }
        }

        // Sem seleção explícita: exibir seletor de barbearia
        return {
          userId,
          profile: profileObj,
          memberships,
          ownedBarbershops,
          userContexts,
          activeMembership: null,
          activeBarbershopId: null,
          activeBarbershop: null,
          staffProfile: null,
          accessKind: 'multi_tenant_selection'
        };
      }

      // Contexto único: resolução direta
      const singleCtx = userContexts[0];
      const singleKind: AccessKind = singleCtx.role === 'owner'
        ? 'owner_ready'
        : (singleCtx.role === 'admin' ? 'admin_ready' : 'staff_ready');

      const activeMember = memberships.find(m => m.barbershopId === singleCtx.barbershop.id) || {
        barbershopId: singleCtx.barbershop.id,
        userId,
        role: singleCtx.role,
        joinedAt: new Date().toISOString()
      };

      return {
        userId,
        profile: profileObj,
        memberships,
        ownedBarbershops,
        userContexts,
        activeMembership: activeMember,
        activeBarbershopId: singleCtx.barbershop.id,
        activeBarbershop: singleCtx.barbershop,
        staffProfile: singleCtx.staffProfile || null,
        accessKind: singleKind
      };
    } catch (err: any) {
      console.error('[resolveAuthContext] Erro ao resolver contexto de autorização:', err);
      return {
        userId,
        profile: null,
        memberships: [],
        ownedBarbershops: [],
        userContexts: [],
        activeMembership: null,
        activeBarbershopId: null,
        activeBarbershop: null,
        staffProfile: null,
        accessKind: 'owner_needs_barbershop'
      };
    }
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
        const rawStaff = staffRows?.find((s: any) => s.barbershop_id === barbershopId || s.user_id === userId) || (staffRows && staffRows[0]) || null;
        const mappedStaffProfile: Staff | null = rawStaff ? {
          id: rawStaff.id,
          tenantId: rawStaff.barbershop_id || barbershopId,
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

      // 6. Verificar se tem staff_profiles ativo mesmo sem barbershop_members (compatibilidade)
      const activeStaffRows = staffRows?.filter((s: any) => s.status !== 'inactive');
      if (activeStaffRows && activeStaffRows.length > 0) {
        const rawStaff = activeStaffRows[0];
        const targetShopId = rawStaff.barbershop_id;
        const { data: shopData } = await supabase
          .from('barbershops')
          .select('*')
          .or(`id.eq.${targetShopId},owner_id.eq.${targetShopId}`)
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
          tenantId: rawStaff.barbershop_id,
          barbershopId: rawStaff.barbershop_id || (shopData ? shopData.id : undefined),
          userId: rawStaff.user_id || userId,
          name: rawStaff.name || profileObj.name || 'Profissional',
          phone: rawStaff.phone || profileObj.personalPhone || '',
          photo: rawStaff.photo || profileObj.photo || undefined,
          status: rawStaff.status || 'active',
          commissionRate: Number(rawStaff.commission_rate || 0),
          role: 'staff'
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

      // 7. Usuário sem barbearia cadastrada (precisa criar sua própria barbearia pelo SetupWizard)
      // O campo "Nome da conta" (slug) fica na etapa 1 e é estritamente obrigatório.
      // Usuários que vêm de contas de colaboradores desvinculados ou novos donos devem começar SEMPRE na etapa 1.
      const hasValidProfile = !!(profileRow && profileRow.name && profileRow.name.trim() !== '' && profileRow.slug && profileRow.slug.trim() !== '');
      if (!hasValidProfile) {
        const state: OnboardingState = {
          userId,
          isAuthenticated: true,
          hasProfile: !!profileRow,
          profile: profileRow ? profileObj : null,
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
        step: 1 // Sempre iniciar na etapa 1 para confirmar o Nome da conta
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

  async createBarbershop(name: string, requestedSlug?: string, mode?: SetupMode): Promise<Barbershop> {
    const userId = await this.getUserId();
    if (!userId) throw new Error('User not authenticated');

    // Se mode não for explicitamente 'additional_barbershop', verificar se já possui barbearia própria existente
    if (mode !== 'additional_barbershop') {
      const existing = await this.getOwnedBarbershop(userId);
      if (existing) {
        await this.ensureOwnerMembership(existing.id, userId);
        return existing;
      }
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

    // Garantir registro real em staff_profiles para o proprietário na nova barbearia
    try {
      const { data: ownerProf } = await supabase
        .from('profiles')
        .select('name, personal_phone, photo')
        .eq('id', userId)
        .maybeSingle();

      await supabase
        .from('staff_profiles')
        .insert({
          barbershop_id: data.id,
          user_id: userId,
          name: ownerProf?.name || name,
          phone: ownerProf?.personal_phone || '',
          photo: ownerProf?.photo || null,
          status: 'active',
          commission_rate: 0
        });
    } catch (ownerStaffErr) {
      console.warn('[createBarbershop] Aviso ao criar staff_profiles inicial para owner:', ownerStaffErr);
    }

    return {
      id: data.id,
      ownerId: data.owner_id,
      name: data.name,
      slug: data.slug,
      createdAt: data.created_at
    };
  },

  async getBarbershopMembers(targetBarbershopId?: string): Promise<BarbershopMember[]> {
    try {
      let resolvedShopId = targetBarbershopId;
      if (!resolvedShopId) {
        const userId = await this.getUserId();
        if (!userId) return [];

        const { data: memberships, error: mInfoErr } = await supabase
          .from('barbershop_members')
          .select('barbershop_id')
          .eq('user_id', userId);

        if (mInfoErr || !memberships || memberships.length === 0) return [];
        resolvedShopId = memberships[0].barbershop_id;
      }

      const { data, error } = await supabase
        .from('barbershop_members')
        .select('role, joined_at, user_id, profiles(name, personal_phone, photo)')
        .eq('barbershop_id', resolvedShopId);

      if (error) throw error;
      return (data || []).map((m: any) => ({
        barbershopId: resolvedShopId,
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

  async getInvites(targetBarbershopId?: string): Promise<BarbershopInvite[]> {
    let shopId = targetBarbershopId;
    if (!shopId) {
      const userId = await this.getUserId();
      if (!userId) return [];
      const activeCtx = await this.resolveSingleActiveContext(userId);
      if ('barbershopId' in activeCtx && activeCtx.barbershopId) {
        shopId = activeCtx.barbershopId;
      }
    }

    if (!shopId) {
      return [];
    }

    const { data, error } = await supabase
      .from('barbershop_invites')
      .select(`
        id,
        barbershop_id,
        email,
        role,
        token,
        expires_at,
        accepted_at,
        invited_by,
        created_at
      `)
      .eq('barbershop_id', shopId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[getInvites] Erro ao buscar convites da barbearia:', error);
      throw error;
    }

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

      const functionPayload: any = {
        email: params.email,
        barbershop_id: barbershopId,
        role: params.role,
        name: params.name,
        phone: params.phone || '',
        commissionRate: params.commissionRate ?? 30
      };

      if (params.password) {
        functionPayload.password = params.password;
      }

      const { data, error } = await supabase.functions.invoke('create-staff', {
        body: functionPayload
      });

      if (error) {
        let errorMessage = error.message;
        let isValidationError = false;
        const status = (error as any).status || (error as any).context?.status;

        try {
          if (error.context) {
            let body: any = null;
            if (typeof error.context.json === 'function') {
              try {
                body = await (error.context as any).clone().json();
              } catch {
                body = await (error.context as any).json();
              }
            } else if (typeof error.context.text === 'function') {
              const txt = await (error.context as any).text();
              try { body = JSON.parse(txt); } catch { body = { error: txt }; }
            }
            if (body && body.error) {
              errorMessage = body.error;
            }
          }
        } catch (jsonErr: any) {
          console.warn('[createStaffDirectly] Aviso ao extrair JSON de erro:', jsonErr);
        }

        // Formatação amigável de mensagens conhecidas para o usuário
        if (
          errorMessage.includes('already been registered') || 
          errorMessage.includes('already registered') || 
          errorMessage.includes('já possui uma conta')
        ) {
          errorMessage = 'Este e-mail já está sendo utilizado por outro profissional no sistema.';
          isValidationError = true;
        } else if (
          errorMessage.includes('já está cadastrado e ativo') || 
          errorMessage.includes('já está cadastrado')
        ) {
          errorMessage = 'Este e-mail já está sendo utilizado por outro profissional nesta barbearia.';
          isValidationError = true;
        } else if (errorMessage.includes('pertence ao proprietário')) {
          errorMessage = 'Este e-mail pertence ao proprietário deste estabelecimento e não pode ser utilizado para outro profissional.';
          isValidationError = true;
        } else if (errorMessage.includes('Edge Function returned a non-2xx status code')) {
          errorMessage = 'Não foi possível cadastrar o profissional. Verifique se o e-mail já está em uso por outro profissional.';
          isValidationError = true;
        }

        if (status && status !== 404) {
          isValidationError = true;
        }

        const customErr = new Error(errorMessage);
        if (isValidationError) {
          (customErr as any).isValidationError = true;
        }
        throw customErr;
      }

      if (data && (!data.success || data.error)) {
        let msg = data.error || 'Erro ao criar profissional';
        if (msg.includes('already been registered') || msg.includes('already registered') || msg.includes('já possui uma conta')) {
          msg = 'Este e-mail já está sendo utilizado por outro profissional no sistema.';
        } else if (msg.includes('já está cadastrado e ativo') || msg.includes('já está cadastrado')) {
          msg = 'Este e-mail já está sendo utilizado por outro profissional nesta barbearia.';
        }
        const err = new Error(msg);
        (err as any).isValidationError = true;
        throw err;
      }

      if (data && data.success) {
        const staffId = data.staff?.id || data.staff_id;
        const newUserId = data.user_id;

        // 1. Garantir explicitamente que staff_profiles.barbershop_id foi preenchido corretamente
        if (staffId && barbershopId) {
          try {
            await supabase
              .from('staff_profiles')
              .update({ barbershop_id: barbershopId })
              .eq('id', staffId);
          } catch (updateErr) {
            console.warn('[createStaffDirectly] Aviso ao assegurar barbershop_id em staff_profiles:', updateErr);
          }
        }

        // 2. Garantir que barbershop_members foi criado
        if (newUserId && barbershopId) {
          try {
            const { data: existingMember } = await supabase
              .from('barbershop_members')
              .select('id, role')
              .eq('barbershop_id', barbershopId)
              .eq('user_id', newUserId)
              .maybeSingle();

            if (!existingMember) {
              await supabase
                .from('barbershop_members')
                .insert({
                  barbershop_id: barbershopId,
                  user_id: newUserId,
                  role: params.role === 'admin' ? 'admin' : 'staff'
                });
            }
          } catch (memberErr) {
            console.warn('[createStaffDirectly] Aviso ao assegurar barbershop_members:', memberErr);
          }
        }
      }

      return data;
    } catch (err: any) {
      if (err?.isValidationError) {
        console.warn('[createStaffDirectly] Validação ao criar profissional:', err.message);
      } else {
        console.error('Erro na criação direta de funcionário:', err);
      }
      throw err;
    }
  }
};

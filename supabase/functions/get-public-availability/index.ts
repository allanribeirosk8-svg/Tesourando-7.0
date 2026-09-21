import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { slug, date, staff_id, service_id, service_ids } = body;

    if (!slug || typeof slug !== 'string' || !date || typeof date !== 'string') {
      return new Response(JSON.stringify({ error: 'Parâmetros slug e date são obrigatórios.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Exigir obrigatoriamente service_id ou service_ids (bloqueia total_duration arbitrário do cliente)
    let requestedServiceIds: string[] = [];
    if (Array.isArray(service_ids) && service_ids.length > 0) {
      requestedServiceIds = service_ids.map((id: any) => String(id).trim()).filter(Boolean);
    } else if (service_id && typeof service_id === 'string' && service_id.trim() !== '') {
      requestedServiceIds = [service_id.trim()];
    }

    if (requestedServiceIds.length === 0) {
      return new Response(JSON.stringify({ error: 'É obrigatório informar ao menos um service_id ou service_ids válido.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (requestedServiceIds.length > 10) {
      return new Response(JSON.stringify({ error: 'Máximo de 10 serviços permitidos por consulta.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 1. Validação estrita de formato YYYY-MM-DD
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    const cleanDate = date.trim();
    if (!dateRegex.test(cleanDate)) {
      return new Response(JSON.stringify({ error: 'Formato de data inválido. Use YYYY-MM-DD.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Validação de data não passada (baseada no dia atual em horário local de Brasília/tenant UTC-3)
    const nowUtc = new Date();
    // Offset -3 horas para Brasil
    const localNow = new Date(nowUtc.getTime() - (3 * 3600 * 1000));
    const todayStr = localNow.toISOString().slice(0, 10);
    if (cleanDate < todayStr) {
      return new Response(JSON.stringify({ error: 'Não é possível verificar disponibilidade para datas passadas.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const maxFutureDate = new Date(localNow.getTime() + (180 * 24 * 3600 * 1000)).toISOString().slice(0, 10);
    if (cleanDate > maxFutureDate) {
      return new Response(JSON.stringify({ error: 'A data não pode ultrapassar o limite de 180 dias no futuro.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const cleanSlug = slug.trim().toLowerCase();
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      return new Response(JSON.stringify({ error: 'Configuração do servidor incompleta.' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    // 2. Resolução estrita do tenant: ÚNICA E EXCLUSIVAMENTE em barbershops
    const { data: shop, error: shopErr } = await supabaseAdmin
      .from('barbershops')
      .select('id')
      .eq('slug', cleanSlug)
      .maybeSingle();

    if (shopErr || !shop) {
      return new Response(JSON.stringify({ error: 'Barbearia não encontrada.' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const barbershopId = shop.id;

    // 3. Determinar duração oficial consultando os serviços exclusivos deste tenant
    const { data: servList, error: servErr } = await supabaseAdmin
      .from('services')
      .select('id, duration')
      .eq('barbershop_id', barbershopId)
      .in('id', requestedServiceIds);

    if (servErr || !servList || servList.length !== requestedServiceIds.length) {
      return new Response(JSON.stringify({ error: 'Um ou mais serviços informados não foram localizados nesta barbearia.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const duration = servList.reduce((sum: number, s: any) => sum + (Number(s.duration) || 30), 0);

    // 4. Validar se o staff_id fornecido pertence a este tenant e está ativo
    let targetStaffId: string | null = null;
    if (staff_id && typeof staff_id === 'string' && staff_id.trim() !== '') {
      const { data: staffRec, error: staffErr } = await supabaseAdmin
        .from('staff_profiles')
        .select('id')
        .eq('id', staff_id.trim())
        .eq('barbershop_id', barbershopId)
        .eq('status', 'active')
        .maybeSingle();

      if (staffErr || !staffRec) {
        return new Response(JSON.stringify({ error: 'Profissional não encontrado ou inativo nesta barbearia.' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      targetStaffId = staffRec.id;
    }

    // 5. Obter lista de todos os profissionais ativos do tenant
    const { data: allActiveStaff } = await supabaseAdmin
      .from('staff_profiles')
      .select('id')
      .eq('barbershop_id', barbershopId)
      .eq('status', 'active');

    const activeStaffIds = (allActiveStaff || []).map((s: any) => s.id);
    if (activeStaffIds.length === 0) {
      return new Response(JSON.stringify({ available_slots: [] }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 6. Determinar dia da semana (0 = Domingo, 1 = Segunda, ..., 6 = Sábado)
    const [year, month, day] = cleanDate.split('-').map(Number);
    const dateObj = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    const dayOfWeek = dateObj.getUTCDay();

    // 7. Horário de funcionamento do dia exclusivamente por barbershop_id
    const { data: sched } = await supabaseAdmin
      .from('weekly_schedule')
      .select('start_time, end_time, is_open')
      .eq('barbershop_id', barbershopId)
      .eq('day_of_week', dayOfWeek)
      .maybeSingle();

    if (!sched || !sched.is_open) {
      return new Response(JSON.stringify({ available_slots: [] }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 8. Buscar pausas semanais, bloqueios e desbloqueios de data do tenant
    const [breaksRes, blockedRes, unblockedRes] = await Promise.all([
      supabaseAdmin
        .from('weekly_breaks')
        .select('time, start_time, end_time')
        .eq('barbershop_id', barbershopId)
        .eq('day_of_week', dayOfWeek),
      supabaseAdmin
        .from('blocked_slots')
        .select('time, staff_id')
        .eq('barbershop_id', barbershopId)
        .eq('date', cleanDate),
      supabaseAdmin
        .from('unblocked_slots')
        .select('time, staff_id')
        .eq('barbershop_id', barbershopId)
        .eq('date', cleanDate)
    ]);

    const tenantBreaks = (breaksRes.data || []).map((b: any) => {
      const start = b.start_time ? String(b.start_time).substring(0, 5) : String(b.time || '').substring(0, 5);
      const end = b.end_time ? String(b.end_time).substring(0, 5) : null;
      return { start, end };
    });

    const blockedRows = blockedRes.data || [];
    const unblockedRows = unblockedRes.data || [];

    // 9. Buscar agendamentos do tenant no dia (não cancelados/não no-show)
    const { data: apts } = await supabaseAdmin
      .from('appointments')
      .select('time, duration, staff_id')
      .eq('barbershop_id', barbershopId)
      .eq('date', cleanDate)
      .not('status', 'in', '("cancelled","no-show")');

    const existingApts = apts || [];

    // 10. Geração e validação dos slots
    const toMin = (t: string) => {
      const [h, m] = t.split(':').map(Number);
      return h * 60 + m;
    };
    const toStr = (min: number) => {
      const h = Math.floor(min / 60).toString().padStart(2, '0');
      const m = (min % 60).toString().padStart(2, '0');
      return `${h}:${m}`;
    };

    const startMin = toMin(String(sched.start_time).substring(0, 5));
    const endMin = toMin(String(sched.end_time).substring(0, 5));
    const rawSlots: string[] = [];

    for (let m = startMin; m + duration <= endMin; m += 30) {
      rawSlots.push(toStr(m));
    }

    // Se for hoje, filtrar horários já passados
    const currentMinToday = (localNow.getHours() * 60) + localNow.getMinutes();

    // Helper: verifica se um horário está explicitamente desbloqueado
    const isSlotExplicitlyUnblocked = (sId: string | null, slotMin: number) => {
      return unblockedRows.some((u: any) => {
        if (u.staff_id && sId && u.staff_id !== sId) return false;
        const uTimeStr = String(u.time || '').substring(0, 5);
        return uTimeStr && toMin(uTimeStr) === slotMin;
      });
    };

    // Helper: verifica se um profissional específico está disponível durante o intervalo do slot
    const isStaffFreeForSlot = (sId: string, slotMin: number, slotEndMin: number) => {
      const explicitlyUnblocked = isSlotExplicitlyUnblocked(sId, slotMin);

      // Bloqueio de slot específico ou geral do tenant
      if (!explicitlyUnblocked) {
        const isBlocked = blockedRows.some((b: any) => {
          if (b.staff_id && b.staff_id !== sId) return false;
          const bTimeStr = String(b.time || '').substring(0, 5);
          if (!bTimeStr) return false;
          const bMin = toMin(bTimeStr);
          const bEndMin = bMin + 30; // duração padrão do bloqueio de slot
          return slotMin < bEndMin && slotEndMin > bMin;
        });
        if (isBlocked) return false;
      }

      // Conflito com agendamentos existentes
      const hasConflict = existingApts.some((apt: any) => {
        if (apt.staff_id !== sId) return false;
        const aMin = toMin(String(apt.time).substring(0, 5));
        const aEndMin = aMin + (Number(apt.duration) || 30);
        return slotMin < aEndMin && slotEndMin > aMin;
      });
      if (hasConflict) return false;

      return true;
    };

    const availableSlots = rawSlots.filter(slot => {
      // Se for a data de hoje, não permitir slots anteriores ao horário corrente (+ 10 min margem)
      if (cleanDate === todayStr) {
        if (toMin(slot) <= currentMinToday + 10) return false;
      }

      const slotMin = toMin(slot);
      const slotEndMin = slotMin + duration;
      const generalUnblocked = isSlotExplicitlyUnblocked(null, slotMin);

      if (!generalUnblocked) {
        // Pausas gerais da barbearia
        const fallsInBreak = tenantBreaks.some((brk: any) => {
          if (!brk.start) return false;
          const brkStartMin = toMin(brk.start);
          const brkEndMin = brk.end ? toMin(brk.end) : brkStartMin + 30;
          return slotMin < brkEndMin && slotEndMin > brkStartMin;
        });
        if (fallsInBreak) return false;

        // Bloqueio geral do tenant sem staff_id atribuído
        const hasGeneralBlock = blockedRows.some((b: any) => {
          if (b.staff_id) return false;
          const bTimeStr = String(b.time || '').substring(0, 5);
          if (!bTimeStr) return false;
          const bMin = toMin(bTimeStr);
          const bEndMin = bMin + 30;
          return slotMin < bEndMin && slotEndMin > bMin;
        });
        if (hasGeneralBlock) return false;
      }

      if (targetStaffId) {
        // Regra para profissional específico:
        return isStaffFreeForSlot(targetStaffId, slotMin, slotEndMin);
      } else {
        // Regra "qualquer profissional":
        // O horário está disponível se pelo menos UM dos profissionais ativos do tenant estiver livre
        return activeStaffIds.some((sId: string) => isStaffFreeForSlot(sId, slotMin, slotEndMin));
      }
    });

    return new Response(JSON.stringify({ available_slots: availableSlots }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: 'Erro ao calcular horários disponíveis.' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

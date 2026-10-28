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

    // 1. Validação estrita de formato YYYY-MM-DD e existência real no calendário
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    const cleanDate = date.trim();
    if (!dateRegex.test(cleanDate)) {
      return new Response(JSON.stringify({ error: 'Formato de data inválido. Use YYYY-MM-DD.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const [year, month, day] = cleanDate.split('-').map(Number);
    const dateObj = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    if (
      isNaN(dateObj.getTime()) ||
      dateObj.getUTCFullYear() !== year ||
      dateObj.getUTCMonth() !== month - 1 ||
      dateObj.getUTCDate() !== day
    ) {
      return new Response(JSON.stringify({ error: 'Data inexistente ou inválida no calendário.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Validação estrita de tipo de staff_id (se fornecido, deve ser UUID válido)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (staff_id !== undefined && staff_id !== null && String(staff_id).trim() !== '') {
      if (typeof staff_id !== 'string' || !uuidRegex.test(staff_id.trim())) {
        return new Response(JSON.stringify({ error: 'Parâmetro staff_id deve ser um UUID válido.' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
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

    for (const s of servList) {
      const d = Number(s.duration);
      if (isNaN(d) || d <= 0) {
        return new Response(JSON.stringify({ error: `Serviço "${s.id}" possui duração inválida cadastrada na barbearia.` }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const duration = servList.reduce((sum: number, s: any) => sum + Number(s.duration), 0);
    if (duration <= 0 || duration > 720) {
      return new Response(JSON.stringify({ error: 'Duração total de serviços inválida. Deve estar entre 1 e 720 minutos.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

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
    const { data: allActiveStaff, error: activeStaffErr } = await supabaseAdmin
      .from('staff_profiles')
      .select('id')
      .eq('barbershop_id', barbershopId)
      .eq('status', 'active');

    if (activeStaffErr) {
      console.error('[get-public-availability] Erro ao consultar profissionais ativos:', activeStaffErr);
      return new Response(JSON.stringify({ error: 'Erro ao consultar equipe.' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

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

    // 7. Horário de funcionamento geral da barbearia (base para herança)
    const { data: sched, error: schedErr } = await supabaseAdmin
      .from('weekly_schedule')
      .select('start_time, end_time, is_open')
      .eq('barbershop_id', barbershopId)
      .eq('day_of_week', dayOfWeek)
      .maybeSingle();

    if (schedErr) {
      console.error('[get-public-availability] Erro ao consultar weekly_schedule:', schedErr);
      return new Response(JSON.stringify({ error: 'Erro ao consultar funcionamento da barbearia.' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 8. Buscar pausas semanais, bloqueios, desbloqueios e disponibilidade individual
    const [breaksRes, blockedRes, unblockedRes, staffAvailRes] = await Promise.all([
      supabaseAdmin
        .from('weekly_breaks')
        .select('time, start_time, end_time, staff_id')
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
        .eq('date', cleanDate),
      supabaseAdmin
        .from('staff_availability')
        .select('*')
        .eq('barbershop_id', barbershopId)
        .eq('day_of_week', dayOfWeek)
        .in('staff_id', targetStaffId ? [targetStaffId] : activeStaffIds)
    ]);

    // Tratar explicitamente erros de todas as consultas essenciais (nunca ignorar nem converter em lista vazia)
    if (breaksRes.error) {
      console.error('[get-public-availability] Erro ao consultar weekly_breaks:', breaksRes.error);
      return new Response(JSON.stringify({ error: 'Erro ao consultar intervalos da barbearia.' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (blockedRes.error) {
      console.error('[get-public-availability] Erro ao consultar blocked_slots:', blockedRes.error);
      return new Response(JSON.stringify({ error: 'Erro ao consultar bloqueios da barbearia.' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (unblockedRes.error) {
      console.error('[get-public-availability] Erro ao consultar unblocked_slots:', unblockedRes.error);
      return new Response(JSON.stringify({ error: 'Erro ao consultar desbloqueios da barbearia.' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (staffAvailRes.error) {
      console.error('[get-public-availability] Erro ao consultar staff_availability:', staffAvailRes.error);
      return new Response(JSON.stringify({ error: 'Erro ao consultar disponibilidade da equipe.' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const allBreaks = breaksRes.data || [];
    const tenantGeneralBreaks = allBreaks.filter((b: any) => !b.staff_id).map((b: any) => {
      const start = b.start_time ? String(b.start_time).substring(0, 5) : String(b.time || '').substring(0, 5);
      const end = b.end_time ? String(b.end_time).substring(0, 5) : null;
      return { start, end };
    });

    const blockedRows = blockedRes.data || [];
    const unblockedRows = unblockedRes.data || [];
    const staffAvailMap = new Map<string, any>();
    (staffAvailRes.data || []).forEach((sa: any) => staffAvailMap.set(sa.staff_id, sa));

    // 9. Buscar agendamentos do tenant no dia (não cancelados/não no-show)
    const { data: apts, error: aptsErr } = await supabaseAdmin
      .from('appointments')
      .select('time, duration, staff_id')
      .eq('barbershop_id', barbershopId)
      .eq('date', cleanDate)
      .not('status', 'in', '("cancelled","no-show")');

    if (aptsErr) {
      console.error('[get-public-availability] Erro ao consultar appointments:', aptsErr);
      return new Response(JSON.stringify({ error: 'Erro ao consultar agendamentos existentes.' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const existingApts = apts || [];

    // 10. Construir grade efetiva por profissional (substituição individual ou herança geral)
    const toMin = (t: string) => {
      const [h, m] = t.split(':').map(Number);
      return h * 60 + m;
    };
    const toStr = (min: number) => {
      const h = Math.floor(min / 60).toString().padStart(2, '0');
      const m = (min % 60).toString().padStart(2, '0');
      return `${h}:${m}`;
    };

    interface EffectiveSchedule {
      staffId: string;
      isOpen: boolean;
      startMin: number;
      endMin: number;
      hasIndividual: boolean;
      breaks: string[];
    }

    const candidateIds = targetStaffId ? [targetStaffId] : activeStaffIds;
    const effectiveStaffSchedules: EffectiveSchedule[] = [];

    const parseEndTimeMin = (t: string, startMin: number) => {
      const raw = String(t || '').trim();
      if (raw.startsWith('24:00')) return 1440;
      const min = toMin(raw.substring(0, 5));
      if (min === 0 && startMin > 0) {
        console.warn(`[get-public-availability] Aviso: end_time "00:00" detectado para expediente iniciado às ${startMin}min. Representação canônica esperada é "24:00".`);
        return 1440;
      }
      return min;
    };

    for (const sId of candidateIds) {
      const ind = staffAvailMap.get(sId);
      if (ind) {
        if (ind.is_open) {
          const sMin = toMin(String(ind.start_time).substring(0, 5));
          const actualEnd = parseEndTimeMin(ind.end_time, sMin);
          effectiveStaffSchedules.push({
            staffId: sId,
            isOpen: true,
            startMin: sMin,
            endMin: actualEnd,
            hasIndividual: true,
            breaks: Array.isArray(ind.breaks) ? ind.breaks : []
          });
        }
      } else {
        // Herança da grade geral da barbearia
        if (sched && sched.is_open) {
          const sMin = toMin(String(sched.start_time).substring(0, 5));
          const actualEnd = parseEndTimeMin(sched.end_time, sMin);
          effectiveStaffSchedules.push({
            staffId: sId,
            isOpen: true,
            startMin: sMin,
            endMin: actualEnd,
            hasIndividual: false,
            breaks: []
          });
        }
      }
    }

    // Se nenhum profissional candidato tiver expediente aberto hoje, retorna vazio
    if (effectiveStaffSchedules.length === 0) {
      return new Response(JSON.stringify({ available_slots: [] }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Gerar conjunto de slots candidatos a partir de cada grade efetiva dos profissionais
    // Suporta inícios não alinhados à hora cheia (ex: 08:15, 08:45)
    const slotMinutesSet = new Set<number>();
    for (const eff of effectiveStaffSchedules) {
      for (let m = eff.startMin; m + duration <= eff.endMin && m + duration <= 1440; m += 30) {
        slotMinutesSet.add(m);
      }
    }
    const rawSlots = Array.from(slotMinutesSet)
      .sort((a, b) => a - b)
      .map(m => toStr(m));

    const currentMinToday = (localNow.getHours() * 60) + localNow.getMinutes();

    // Desbloqueio geral: staff_id IS NULL. Supera exclusivamente pausas/bloqueios gerais.
    const isGeneralUnblockedForSlot = (slotMin: number) => {
      return unblockedRows.some((u: any) => !u.staff_id && toMin(String(u.time || '').substring(0, 5)) === slotMin);
    };

    // Desbloqueio individual: staff_id = sId. Supera exclusivamente pausas/bloqueios deste profissional.
    const isStaffIndividualUnblockedForSlot = (sId: string, slotMin: number) => {
      return unblockedRows.some((u: any) => u.staff_id === sId && toMin(String(u.time || '').substring(0, 5)) === slotMin);
    };

    // Helper: verifica se um profissional específico está disponível durante o intervalo do slot
    const isStaffFreeForSlot = (eff: EffectiveSchedule, slotMin: number, slotEndMin: number) => {
      // 1. Expediente efetivo deste profissional
      if (slotMin < eff.startMin || slotEndMin > eff.endMin) {
        return false;
      }

      // 1.1 Ancoragem estrita ao início do expediente deste profissional (passos de 30 min)
      // Garante que profissionais com inícios distintos (ex: 08:00 vs 08:15) só recebam slots alinhados à sua grade
      if ((slotMin - eff.startMin) % 30 !== 0) {
        return false;
      }

      // 2. Pausas e Bloqueios Gerais da Barbearia
      const generalUnblocked = isGeneralUnblockedForSlot(slotMin);
      if (!generalUnblocked) {
        // Pausas gerais aplicam-se apenas a quem NÃO possui grade individual própria (herança geral)
        if (!eff.hasIndividual) {
          const fallsInGeneralBreak = tenantGeneralBreaks.some((brk: any) => {
            if (!brk.start) return false;
            const brkStartMin = toMin(brk.start);
            const brkEndMin = brk.end ? toMin(brk.end) : brkStartMin + 30;
            return slotMin < brkEndMin && slotEndMin > brkStartMin;
          });
          if (fallsInGeneralBreak) return false;
        }

        // Bloqueio pontual geral de calendário fecha a barbearia para todos
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

      // 3. Pausas e Bloqueios Individuais deste profissional
      const individualUnblocked = isStaffIndividualUnblockedForSlot(eff.staffId, slotMin);
      if (!individualUnblocked) {
        if (eff.hasIndividual) {
          const hasBreak = eff.breaks.some((brk: string) => {
            const bMin = toMin(String(brk).substring(0, 5));
            return slotMin < bMin + 30 && slotEndMin > bMin;
          });
          if (hasBreak) return false;
        }

        // Bloqueio pontual específico deste profissional
        const hasStaffBlock = blockedRows.some((b: any) => {
          if (b.staff_id !== eff.staffId) return false;
          const bTimeStr = String(b.time || '').substring(0, 5);
          if (!bTimeStr) return false;
          const bMin = toMin(bTimeStr);
          const bEndMin = bMin + 30;
          return slotMin < bEndMin && slotEndMin > bMin;
        });
        if (hasStaffBlock) return false;
      }

      // 4. Conflito com agendamentos existentes (sempre verificado, mesmo com desbloqueio)
      const hasConflict = existingApts.some((apt: any) => {
        if (apt.staff_id !== eff.staffId) return false;
        const aMin = toMin(String(apt.time).substring(0, 5));
        const aptDuration = Number(apt.duration) > 0 ? Number(apt.duration) : 30;
        const aEndMin = aMin + aptDuration;
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

      if (targetStaffId) {
        // Regra para profissional específico:
        const eff = effectiveStaffSchedules.find(e => e.staffId === targetStaffId);
        if (!eff) return false;
        return isStaffFreeForSlot(eff, slotMin, slotEndMin);
      } else {
        // Regra "qualquer profissional": avalia cada candidato efetivo com suas respectivas regras e desbloqueios
        return effectiveStaffSchedules.some(eff => isStaffFreeForSlot(eff, slotMin, slotEndMin));
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

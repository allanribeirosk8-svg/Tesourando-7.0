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
    const { 
      slug, 
      client_name, 
      client_phone, 
      service_ids, 
      staff_id, 
      date, 
      time, 
      observation,
      website_honeypot // Campo anti-spam
    } = body;

    // 1. Defesa Anti-Spam (Honeypot)
    if (website_honeypot && String(website_honeypot).trim() !== '') {
      // Retorna sucesso simulado para bots sem persistir nada
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 2. Validações de Entrada e Tamanhos Máximos
    if (!slug || typeof slug !== 'string' || !client_name || !client_phone || !date || !time || !service_ids) {
      return new Response(JSON.stringify({ error: 'Todos os campos obrigatórios devem ser preenchidos.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const cleanName = String(client_name).trim();
    if (cleanName.length < 3 || cleanName.length > 80) {
      return new Response(JSON.stringify({ error: 'O nome do cliente deve ter entre 3 e 80 caracteres.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const phoneDigits = String(client_phone).replace(/\D/g, '');
    if (phoneDigits.length < 10 || phoneDigits.length > 11) {
      return new Response(JSON.stringify({ error: 'Telefone inválido. Deve conter DDD e 8 ou 9 dígitos.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const cleanDate = String(date).trim();
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(cleanDate)) {
      return new Response(JSON.stringify({ error: 'Formato de data inválido. Use YYYY-MM-DD.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Validação de data não passada e limite máximo futuro de 180 dias
    const nowUtc = new Date();
    const localNow = new Date(nowUtc.getTime() - (3 * 3600 * 1000));
    const todayStr = localNow.toISOString().slice(0, 10);
    if (cleanDate < todayStr) {
      return new Response(JSON.stringify({ error: 'Data não pode ser no passado.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const maxFutureDate = new Date(localNow.getTime() + (180 * 24 * 3600 * 1000)).toISOString().slice(0, 10);
    if (cleanDate > maxFutureDate) {
      return new Response(JSON.stringify({ error: 'A data não pode exceder 180 dias no futuro.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const cleanTime = String(time).trim();
    const timeRegex = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
    if (!timeRegex.test(cleanTime)) {
      return new Response(JSON.stringify({ error: 'Formato de horário inválido.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const cleanObs = observation ? String(observation).trim().slice(0, 500) : null;

    if (!Array.isArray(service_ids) || service_ids.length === 0 || service_ids.length > 10) {
      return new Response(JSON.stringify({ error: 'Selecione entre 1 e 10 serviços válidos.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

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

    // 3. Execução Transacional Atômica via RPC com Lock (FOR UPDATE)
    // A RPC no PostgreSQL executa toda a validação de slug, tenant, serviços do tenant,
    // staff do tenant, horário com timezone, bloqueio de concorrência com FOR UPDATE,
    // upsert de customer, criação de appointment e disparo de notificação.
    const { data: bookingResult, error: rpcError } = await supabaseAdmin.rpc('process_public_booking_atomic', {
      p_slug: slug.trim().toLowerCase(),
      p_client_name: cleanName,
      p_client_phone: phoneDigits,
      p_service_ids: service_ids,
      p_staff_id: staff_id && typeof staff_id === 'string' && staff_id.trim() !== '' ? staff_id.trim() : null,
      p_date: cleanDate,
      p_time: cleanTime.length === 5 ? `${cleanTime}:00` : cleanTime,
      p_observation: cleanObs
    });

    if (rpcError) {
      // Se a RPC lançar erro de concorrência ou conflito
      if (rpcError.code === '23505' || rpcError.message?.includes('SLOT_OCCUPIED') || rpcError.message?.includes('conflito')) {
        return new Response(JSON.stringify({
          error: 'Este horário acabou de ser reservado por outro cliente. Por favor, escolha outro horário.',
          code: 'SLOT_OCCUPIED'
        }), {
          status: 409,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (rpcError.message?.includes('Barbearia não encontrada') || rpcError.message?.includes('NOT_FOUND')) {
        return new Response(JSON.stringify({ error: 'Barbearia não encontrada.' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ error: rpcError.message || 'Erro ao processar agendamento.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 4. Retorno Sanitizado com Confirmação Mínima (Sem dados internos nem owner_id)
    return new Response(JSON.stringify({
      success: true,
      appointment: {
        id: bookingResult.appointment_id,
        date: bookingResult.date,
        time: bookingResult.time,
        service: bookingResult.service_name,
        client_name: bookingResult.client_name,
        staff_name: bookingResult.staff_name || null
      }
    }), {
      status: 201,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: 'Falha inesperada no servidor.' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

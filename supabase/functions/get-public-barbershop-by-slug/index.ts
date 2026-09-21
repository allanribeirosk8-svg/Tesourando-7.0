import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    let slug = '';
    if (req.method === 'GET') {
      const url = new URL(req.url);
      slug = url.searchParams.get('slug') || '';
    } else {
      const body = await req.json().catch(() => ({}));
      slug = body.slug || '';
    }

    if (!slug || typeof slug !== 'string' || slug.trim().length === 0) {
      return new Response(JSON.stringify({ error: 'Slug da barbearia é obrigatório.' }), {
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

    // 1. Resolução estrita: ÚNICA E EXCLUSIVAMENTE em barbershops por slug
    // NUNCA fazer fallback para profiles.slug ou profiles.id
    const { data: shop, error: shopErr } = await supabaseAdmin
      .from('barbershops')
      .select('id, name, slug, phone, address, logo, description, instagram')
      .eq('slug', cleanSlug)
      .maybeSingle();

    if (shopErr || !shop) {
      return new Response(JSON.stringify({ error: 'Barbearia não encontrada.' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const barbershopId = shop.id;

    // 2. Buscar serviços públicos exclusivos deste tenant
    const { data: services, error: servErr } = await supabaseAdmin
      .from('services')
      .select('id, name, price, duration, order_index')
      .eq('barbershop_id', barbershopId)
      .order('order_index', { ascending: true });

    if (servErr) {
      return new Response(JSON.stringify({ error: 'Erro ao carregar serviços da barbearia.' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 3. Buscar profissionais ativos exclusivos deste tenant (sem dados sensíveis)
    const { data: staffList, error: staffErr } = await supabaseAdmin
      .from('staff_profiles')
      .select('id, name, photo, status')
      .eq('barbershop_id', barbershopId)
      .eq('status', 'active');

    if (staffErr) {
      return new Response(JSON.stringify({ error: 'Erro ao carregar equipe da barbearia.' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 4. Buscar horários de funcionamento padrão da barbearia
    const { data: schedule, error: schedErr } = await supabaseAdmin
      .from('weekly_schedule')
      .select('day_of_week, start_time, end_time, is_open')
      .eq('barbershop_id', barbershopId);

    if (schedErr) {
      return new Response(JSON.stringify({ error: 'Erro ao carregar grade de horários.' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Retornar estritamente payload limpo e sanitizado (sem owner_id, sem metadados internos)
    return new Response(JSON.stringify({
      barbershop: {
        id: shop.id,
        name: shop.name,
        slug: shop.slug,
        phone: shop.phone,
        address: shop.address,
        logo: shop.logo,
        description: shop.description,
        instagram: shop.instagram
      },
      services: services || [],
      staff: staffList || [],
      schedule: schedule || []
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: 'Erro interno ao processar requisição.' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

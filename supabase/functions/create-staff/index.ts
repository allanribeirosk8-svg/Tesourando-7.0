// Follow Deno and Supabase Edge Function standards
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

// Regex padrão RFC 5322 simplificada para validação estrita de e-mail
const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

serve(async (req) => {
  // Handle CORS preflight request
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const requestId = crypto.randomUUID().slice(0, 8);

  try {
    // 1. Authenticate requester using their Authorization header (JWT token)
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      console.warn(`[CREATE_STAFF_EDGE][${requestId}] Falha: Cabeçalho de autorização ausente.`);
      return new Response(JSON.stringify({ error: 'Falta cabeçalho de autorização' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
      console.error(`[CREATE_STAFF_EDGE][${requestId}] Falha crítica: Variáveis de ambiente incompletas.`);
      return new Response(JSON.stringify({ error: 'Configuração do Supabase incompleta nas variáveis de ambiente da Edge Function' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    })

    const { data: { user: requester }, error: reqError } = await supabaseClient.auth.getUser()
    if (reqError || !requester) {
      console.warn(`[CREATE_STAFF_EDGE][${requestId}] Falha na autenticação do requester.`);
      return new Response(JSON.stringify({ error: 'Não autorizado: Token inválido ou expirado' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 2. Parse request body
    const bodyText = await req.text();
    let body: any = {};
    try {
      body = JSON.parse(bodyText);
    } catch {
      return new Response(JSON.stringify({ error: 'Corpo da requisição com JSON inválido' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const rawEmail = typeof body.email === 'string' ? body.email : '';
    const rawPassword = typeof body.password === 'string' ? body.password : '';
    const rawBarbershopId = typeof body.barbershop_id === 'string' ? body.barbershop_id : '';
    const rawRole = typeof body.role === 'string' ? body.role : '';
    const rawName = typeof body.name === 'string' ? body.name : '';
    const rawPhone = typeof body.phone === 'string' ? body.phone : '';
    const rawCommission = body.commissionRate;

    // 3. Validação estrita dos parâmetros de entrada
    const normalizedEmail = rawEmail.trim().toLowerCase();
    const normalizedName = rawName.trim();
    const normalizedPhone = rawPhone.trim();
    const targetBarbershopId = rawBarbershopId.trim();
    const targetRole = rawRole.trim() === 'admin' ? 'admin' : (rawRole.trim() === 'staff' ? 'staff' : null);

    if (!normalizedEmail || !EMAIL_REGEX.test(normalizedEmail)) {
      return new Response(JSON.stringify({ error: 'E-mail inválido ou ausente.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!targetBarbershopId || !UUID_REGEX.test(targetBarbershopId)) {
      return new Response(JSON.stringify({ error: 'Identificador de barbearia (UUID) inválido ou ausente.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!targetRole) {
      return new Response(JSON.stringify({ error: 'Papel inválido. Permitido apenas "staff" ou "admin".' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!normalizedName || normalizedName.length < 2 || normalizedName.length > 100) {
      return new Response(JSON.stringify({ error: 'O nome do profissional deve ter entre 2 e 100 caracteres.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let parsedCommission = 30;
    if (rawCommission !== undefined && rawCommission !== null && rawCommission !== '') {
      const numComm = Number(rawCommission);
      if (isNaN(numComm) || numComm < 0 || numComm > 100) {
        return new Response(JSON.stringify({ error: 'Taxa de comissão deve ser um número entre 0 e 100.' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      parsedCommission = numComm;
    }

    // 4. Validar se o solicitante é proprietário (owner) ou administrador (admin) da barbearia
    const { data: barbershop, error: bsError } = await supabaseClient
      .from('barbershops')
      .select('id, owner_id')
      .eq('id', targetBarbershopId)
      .maybeSingle();

    if (bsError || !barbershop) {
      console.warn(`[CREATE_STAFF_EDGE][${requestId}] Barbearia não encontrada ou sem permissão RLS.`);
      return new Response(JSON.stringify({ error: 'Barbearia não encontrada ou acesso não autorizado.' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let isRequesterAuthorized = (barbershop.owner_id === requester.id);
    if (!isRequesterAuthorized) {
      const { data: memberRecord, error: memberErr } = await supabaseClient
        .from('barbershop_members')
        .select('role')
        .eq('barbershop_id', targetBarbershopId)
        .eq('user_id', requester.id)
        .maybeSingle();

      if (!memberErr && memberRecord && (memberRecord.role === 'owner' || memberRecord.role === 'admin')) {
        isRequesterAuthorized = true;
      }
    }

    if (!isRequesterAuthorized) {
      console.warn(`[CREATE_STAFF_EDGE][${requestId}] Acesso negado: Requester não é owner/admin do tenant.`);
      return new Response(JSON.stringify({ error: 'Apenas proprietários ou administradores podem cadastrar profissionais.' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 5. Inicializar cliente administrativo (service_role)
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    // 6. Resolução Escalável de Usuário por E-mail (Via RPC lookup_user_by_email_exact)
    // Permite lookup direto via índice sem carregar ou paginar listUsers em memória.
    let resolvedUser: { id: string; email: string } | null = null;
    const { data: lookupData, error: lookupErr } = await supabaseAdmin
      .rpc('lookup_user_by_email_exact', { target_email: normalizedEmail });

    if (!lookupErr && lookupData && Array.isArray(lookupData) && lookupData.length > 0) {
      resolvedUser = {
        id: lookupData[0].user_id,
        email: normalizedEmail
      };
    }

    // Flags estritas para rollback atômico compensatório
    let createdAuthUserId: string | null = null;
    let createdProfileId: string | null = null;
    let createdMemberKey: { barbershop_id: string; user_id: string } | null = null;
    let createdStaffProfileId: string | null = null;

    // =========================================================================
    // CENÁRIO A: USUÁRIO JÁ EXISTE NO SUPABASE AUTH
    // =========================================================================
    if (resolvedUser) {
      const existingUserId = resolvedUser.id;

      // Não permitir vincular o proprietário da barbearia como staff
      if (existingUserId === barbershop.owner_id) {
        return new Response(JSON.stringify({ error: 'Este e-mail pertence ao proprietário deste estabelecimento.' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Verificar se já possui vínculo ativo nesta barbearia
      const { data: existingStaffRecord } = await supabaseAdmin
        .from('staff_profiles')
        .select('id, status')
        .eq('barbershop_id', targetBarbershopId)
        .eq('user_id', existingUserId)
        .maybeSingle();

      const { data: existingMember } = await supabaseAdmin
        .from('barbershop_members')
        .select('role')
        .eq('barbershop_id', targetBarbershopId)
        .eq('user_id', existingUserId)
        .maybeSingle();

      if (existingMember && existingStaffRecord && existingStaffRecord.status === 'active') {
        return new Response(JSON.stringify({
          error: 'Este profissional já está cadastrado e ativo nesta barbearia.',
          code: 'STAFF_ALREADY_MEMBER',
          alreadyMember: true,
          staff_id: existingStaffRecord.id
        }), {
          status: 409,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Regra de Ouro:
      // - NUNCA alterar a senha do usuário existente.
      // - NUNCA alterar tabela "profiles" (nome, telefone ou dados globais).
      // - Dados específicos do estabelecimento pertencem EXCLUSIVAMENTE a staff_profiles.

      // 1. Inserir ou atualizar barbershop_members para este tenant
      const { error: memberUpsertErr } = await supabaseAdmin
        .from('barbershop_members')
        .upsert({
          barbershop_id: targetBarbershopId,
          user_id: existingUserId,
          role: targetRole
        }, { onConflict: 'barbershop_id,user_id' });

      if (memberUpsertErr) {
        console.error(`[CREATE_STAFF_EDGE][${requestId}] Erro ao gravar barbershop_members para usuário existente.`);
        return new Response(JSON.stringify({ error: 'Erro ao associar membro à barbearia.' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (!existingMember) {
        createdMemberKey = { barbershop_id: targetBarbershopId, user_id: existingUserId };
      }

      // 2. Criar ou reativar staff_profiles isolado por barbershop_id
      // (Removido tenant_id legado de todos os inserts e updates)
      let finalStaffRecord: any = null;
      if (existingStaffRecord) {
        const { data: updatedStaff, error: updateStaffErr } = await supabaseAdmin
          .from('staff_profiles')
          .update({
            status: 'active',
            name: normalizedName,
            phone: normalizedPhone,
            commission_rate: parsedCommission
          })
          .eq('id', existingStaffRecord.id)
          .select()
          .single();

        if (updateStaffErr) {
          console.error(`[CREATE_STAFF_EDGE][${requestId}] Erro ao reativar staff_profiles.`);
          // Rollback: se criamos a membership nesta requisição, reverter
          if (createdMemberKey) {
            await supabaseAdmin.from('barbershop_members').delete()
              .eq('barbershop_id', createdMemberKey.barbershop_id)
              .eq('user_id', createdMemberKey.user_id);
          }
          return new Response(JSON.stringify({ error: 'Erro ao reativar perfil operacional do profissional.' }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        finalStaffRecord = updatedStaff;
      } else {
        const newStaffId = crypto.randomUUID();
        const { data: createdStaff, error: createStaffErr } = await supabaseAdmin
          .from('staff_profiles')
          .insert({
            id: newStaffId,
            barbershop_id: targetBarbershopId,
            user_id: existingUserId,
            name: normalizedName,
            phone: normalizedPhone,
            status: 'active',
            commission_rate: parsedCommission
          })
          .select()
          .single();

        if (createStaffErr) {
          console.error(`[CREATE_STAFF_EDGE][${requestId}] Erro ao inserir staff_profiles para usuário existente.`);
          if (createdMemberKey) {
            await supabaseAdmin.from('barbershop_members').delete()
              .eq('barbershop_id', createdMemberKey.barbershop_id)
              .eq('user_id', createdMemberKey.user_id);
          }
          return new Response(JSON.stringify({ error: 'Erro ao criar perfil operacional do profissional.' }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        finalStaffRecord = createdStaff;
      }

      console.info(`[CREATE_STAFF_EDGE][${requestId}] Usuário existente vinculado com sucesso à barbearia.`);
      return new Response(JSON.stringify({
        success: true,
        linked: true,
        reactivated: Boolean(existingStaffRecord),
        user_id: existingUserId,
        role: targetRole,
        staff_id: finalStaffRecord?.id,
        staff: finalStaffRecord
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // =========================================================================
    // CENÁRIO B: NOVO USUÁRIO
    // =========================================================================
    // Senha é estritamente obrigatória apenas para criação de nova conta
    const trimmedPass = rawPassword.trim();
    if (!trimmedPass || trimmedPass.length < 6) {
      return new Response(JSON.stringify({ error: 'A senha provisória é obrigatória para cadastrar um novo profissional e deve ter no mínimo 6 caracteres.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 1. Criar novo usuário no Supabase Auth
    const { data: authUser, error: createAuthErr } = await supabaseAdmin.auth.admin.createUser({
      email: normalizedEmail,
      password: trimmedPass,
      email_confirm: true,
      user_metadata: { name: normalizedName }
    });

    if (createAuthErr || !authUser?.user) {
      console.warn(`[CREATE_STAFF_EDGE][${requestId}] Falha ao criar usuário no Auth.`);
      const isDuplicate = createAuthErr?.message?.includes('already been registered') ||
                          createAuthErr?.message?.includes('already registered') ||
                          createAuthErr?.message?.includes('already exists');
      return new Response(JSON.stringify({
        error: isDuplicate
          ? 'Este e-mail já está sendo utilizado no sistema.'
          : 'Não foi possível criar as credenciais de acesso do novo profissional.'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    createdAuthUserId = authUser.user.id;

    // 2. Garantir profile básico global de forma idempotente para novos usuários
    const { error: profileErr } = await supabaseAdmin
      .from('profiles')
      .upsert({
        id: createdAuthUserId,
        name: normalizedName,
        personal_phone: normalizedPhone,
        updated_at: new Date().toISOString()
      }, { onConflict: 'id' });

    if (profileErr) {
      console.error(`[CREATE_STAFF_EDGE][${requestId}] Falha ao registrar profile para novo usuário.`);
      // Rollback Auth
      const { error: rbAuthErr } = await supabaseAdmin.auth.admin.deleteUser(createdAuthUserId);
      if (rbAuthErr) {
        console.error(`[CREATE_STAFF_EDGE][${requestId}][CRITICAL_ROLLBACK_FAIL] Falha ao deletar Auth ${createdAuthUserId}`);
      }
      return new Response(JSON.stringify({ error: 'Erro ao inicializar perfil global do novo usuário.' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    createdProfileId = createdAuthUserId;

    // 3. Inserir membership em barbershop_members
    const { error: memberInsertErr } = await supabaseAdmin
      .from('barbershop_members')
      .insert({
        barbershop_id: targetBarbershopId,
        user_id: createdAuthUserId,
        role: targetRole
      });

    if (memberInsertErr) {
      console.error(`[CREATE_STAFF_EDGE][${requestId}] Falha ao criar barbershop_members para novo usuário.`);
      // Compensação estrita dos recursos criados nesta requisição
      await supabaseAdmin.from('profiles').delete().eq('id', createdProfileId);
      const { error: rbAuthErr } = await supabaseAdmin.auth.admin.deleteUser(createdAuthUserId);
      if (rbAuthErr) {
        console.error(`[CREATE_STAFF_EDGE][${requestId}][CRITICAL_ROLLBACK_FAIL] Falha ao deletar Auth ${createdAuthUserId}`);
      }
      return new Response(JSON.stringify({ error: 'Erro ao vincular membro à barbearia.' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    createdMemberKey = { barbershop_id: targetBarbershopId, user_id: createdAuthUserId };

    // 4. Inserir registro operacional em staff_profiles (sem tenant_id legado)
    const newStaffProfileId = crypto.randomUUID();
    const { data: createdStaffRecord, error: staffInsertErr } = await supabaseAdmin
      .from('staff_profiles')
      .insert({
        id: newStaffProfileId,
        barbershop_id: targetBarbershopId,
        user_id: createdAuthUserId,
        name: normalizedName,
        phone: normalizedPhone,
        status: 'active',
        commission_rate: parsedCommission
      })
      .select()
      .single();

    if (staffInsertErr || !createdStaffRecord) {
      console.error(`[CREATE_STAFF_EDGE][${requestId}] Falha ao criar staff_profiles para novo usuário.`);
      // Rollback compensatório completo apenas do que foi criado nesta execução
      await supabaseAdmin.from('barbershop_members').delete()
        .eq('barbershop_id', createdMemberKey.barbershop_id)
        .eq('user_id', createdMemberKey.user_id);
      await supabaseAdmin.from('profiles').delete().eq('id', createdProfileId);
      const { error: rbAuthErr } = await supabaseAdmin.auth.admin.deleteUser(createdAuthUserId);
      if (rbAuthErr) {
        console.error(`[CREATE_STAFF_EDGE][${requestId}][CRITICAL_ROLLBACK_FAIL] Falha ao deletar Auth ${createdAuthUserId}`);
      }

      return new Response(JSON.stringify({ error: 'Erro ao criar perfil operacional do profissional.' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    createdStaffProfileId = createdStaffRecord.id;

    console.info(`[CREATE_STAFF_EDGE][${requestId}] Novo profissional criado com sucesso absoluto.`);
    return new Response(JSON.stringify({
      success: true,
      created: true,
      user_id: createdAuthUserId,
      role: targetRole,
      staff_id: createdStaffProfileId,
      staff: createdStaffRecord
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    console.error(`[CREATE_STAFF_EDGE][${requestId}] Exceção não tratada na execução.`);
    return new Response(JSON.stringify({ error: 'Falha interna ao processar o cadastro do profissional.' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

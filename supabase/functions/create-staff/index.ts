// Follow Deno and Supabase Edge Function standards
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

serve(async (req) => {
  // Handle CORS preflight request
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Log [CREATE_STAFF_EDGE_01]
    console.log("[CREATE_STAFF_EDGE_01] Nova requisição de criação direta de profissional recebida.");

    // 1. Authenticate the requester using their Authorization header (JWT token)
    const authHeader = req.headers.get('Authorization')
    
    // Log [CREATE_STAFF_EDGE_02]
    const headerKeys = Array.from(req.headers.keys());
    console.log("[CREATE_STAFF_EDGE_02] Cabeçalhos de requisição e variáveis de ambiente:", {
      hasAuthHeader: !!authHeader,
      authHeaderLength: authHeader ? authHeader.length : 0,
      headersReceived: headerKeys,
      supabaseUrlSet: !!Deno.env.get('SUPABASE_URL'),
      supabaseAnonKeySet: !!Deno.env.get('SUPABASE_ANON_KEY'),
      supabaseServiceRoleKeySet: !!Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    });

    if (!authHeader) {
      console.error("[CREATE_STAFF_EDGE_02_ERR] Falha: Cabeçalho de autorização ausente.");
      return new Response(JSON.stringify({ error: 'Falta cabeçalho de autorização' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
      console.error("[CREATE_STAFF_EDGE_02_CONFIG_ERR] Falha: Configuração do Supabase incompleta nas variáveis de ambiente da Edge Function.");
      return new Response(JSON.stringify({ error: 'Configuração do Supabase incompleta nas variáveis de ambiente da Edge Function' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    })

    // Log [CREATE_STAFF_EDGE_03]
    console.log("[CREATE_STAFF_EDGE_03] Validando token do requester via auth.getUser()...");
    const { data: { user: requester }, error: reqError } = await supabaseClient.auth.getUser()
    if (reqError || !requester) {
      console.error("[CREATE_STAFF_EDGE_03_ERR] Falha na autenticação do requester:", reqError?.message || 'Token inválido');
      return new Response(JSON.stringify({ error: 'Não autorizado: Token inválido ou expirado' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Log [CREATE_STAFF_EDGE_04]
    console.log(`[CREATE_STAFF_EDGE_04] Requester autenticado com sucesso: ${requester.email} (ID: ${requester.id})`);

    // 2. Parse request body
    const bodyText = await req.text();
    let body: any = {};
    try {
      body = JSON.parse(bodyText);
    } catch (parseErr: any) {
      console.error("[CREATE_STAFF_EDGE_05_PARSE_ERR] Erro ao decodificar JSON do corpo:", parseErr.message);
      return new Response(JSON.stringify({ error: 'Corpo da requisição com JSON inválido' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { email, password, barbershop_id, role, name, phone, commissionRate } = body;

    // Log [CREATE_STAFF_EDGE_05]
    console.log("[CREATE_STAFF_EDGE_05] Parâmetros recebidos no corpo da requisição:", { 
      email, 
      role, 
      name, 
      phone, 
      barbershop_id, 
      commissionRate,
      passwordLength: password ? password.length : 0 
    });

    if (!email || !password || !barbershop_id || !role || !name) {
      console.error("[CREATE_STAFF_EDGE_05_VALIDATION_ERR] Falha: Campos obrigatórios ausentes:", {
        hasEmail: !!email,
        hasPassword: !!password,
        hasBarbershopId: !!barbershop_id,
        hasRole: !!role,
        hasName: !!name
      });
      return new Response(JSON.stringify({ error: 'Campos obrigatórios ausentes: email, password, barbershop_id, role, name' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Verify if requester is indeed the owner or an admin of the barbershop
    // Log [CREATE_STAFF_EDGE_06]
    console.log(`[CREATE_STAFF_EDGE_06] Verificando barbearia ID: ${barbershop_id} para o requester...`);
    const { data: barbershop, error: bsError } = await supabaseClient
      .from('barbershops')
      .select('owner_id')
      .eq('id', barbershop_id)
      .maybeSingle()

    if (bsError || !barbershop) {
      console.error("[CREATE_STAFF_EDGE_06_ERR] Falha: Barbearia não encontrada ou erro de permissão do RLS:", bsError?.message);
      return new Response(JSON.stringify({ error: `Barbearia não encontrada ou erro ao carregar: ${bsError?.message || 'Sem dados'}` }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    console.log(`[CREATE_STAFF_EDGE_06a] Barbearia encontrada no banco. Owner ID proprietário: ${barbershop.owner_id}`);

    // Confirm that the requester is the owner of the barbershop or an admin member
    if (barbershop.owner_id !== requester.id) {
      console.log(`[CREATE_STAFF_EDGE_06b] Requester não é o dono direto. Verificando papel em barbershop_members...`);
      const { data: member, error: memberRoleErr } = await supabaseClient
        .from('barbershop_members')
        .select('role')
        .eq('barbershop_id', barbershop_id)
        .eq('user_id', requester.id)
        .maybeSingle()

      if (memberRoleErr) {
        console.error(`[CREATE_STAFF_EDGE_06_ERR2] Erro ao consultar privilégios em barbershop_members:`, memberRoleErr.message);
        return new Response(JSON.stringify({ error: `Erro ao validar permissões: ${memberRoleErr.message}` }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      if (!member || (member.role !== 'owner' && member.role !== 'admin')) {
        console.error(`[CREATE_STAFF_EDGE_06_ACCESS_DENIED] Acesso negado. Papel do requester resolvido: ${member?.role || 'Nenhum'}`);
        return new Response(JSON.stringify({ error: 'Apenas proprietários ou administradores podem adicionar profissionais diretamente.' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      console.log(`[CREATE_STAFF_EDGE_07] Requester possui permissão autorizada (papel do membro: ${member.role})`);
    } else {
      // Log [CREATE_STAFF_EDGE_07]
      console.log("[CREATE_STAFF_EDGE_07] Requester é o dono direto (owner_id) da barbearia.");
    }

    // 3. Create a service_role administrative client to create the user securely
    // Log [CREATE_STAFF_EDGE_08]
    console.log("[CREATE_STAFF_EDGE_08] Criando cliente administrativo com SERVICE_ROLE...");
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    })

    // 4. Check if a user with this email already exists in Supabase Auth
    console.log(`[CREATE_STAFF_EDGE_09] Verificando se o usuário com email: ${email} já existe no sistema...`);
    let existingUser: any = null;
    try {
      const { data: userListData } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (userListData && userListData.users) {
        existingUser = userListData.users.find((u: any) => u.email?.toLowerCase() === email.toLowerCase()) || null;
      }
    } catch (listErr: any) {
      console.warn("[CREATE_STAFF_EDGE_09_WARN] Aviso ao listar usuários Auth:", listErr?.message);
    }

    // Se o usuário já existe em auth.users
    if (existingUser) {
      console.log(`[CREATE_STAFF_EDGE_09_EXISTS] Usuário já registrado no Auth encontrado: ID ${existingUser.id}`);

      // Validação: não permitir adicionar o próprio dono como colaborador
      if (existingUser.id === barbershop.owner_id) {
        return new Response(JSON.stringify({ error: 'Este e-mail pertence ao proprietário deste estabelecimento.' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Verificar se já tem membership ativa e staff_profile ativo nesta mesma barbearia
      const { data: existingMember } = await supabaseAdmin
        .from('barbershop_members')
        .select('role')
        .eq('barbershop_id', barbershop_id)
        .eq('user_id', existingUser.id)
        .maybeSingle();

      const { data: existingStaffRecord } = await supabaseAdmin
        .from('staff_profiles')
        .select('id, status')
        .eq('barbershop_id', barbershop_id)
        .eq('user_id', existingUser.id)
        .maybeSingle();

      if (existingMember && existingStaffRecord && existingStaffRecord.status === 'active') {
        console.log(`[CREATE_STAFF_EDGE_09_CONFLICT] Profissional já vinculado e ativo na barbearia ${barbershop_id}`);
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

      // VINCULAÇÃO / REATIVAÇÃO DO PROFISSIONAL NESTA BARBEARIA
      // Nota arquitetural: O usuário já possui conta global. NUNCA alterar sua senha sem fluxo próprio.
      console.log(`[CREATE_STAFF_EDGE_09_LINK] Vinculando/reativando profissional ${existingUser.id} na barbearia ${barbershop_id}...`);

      // 1. Garantir membership nesta barbearia
      const targetRole = role === 'admin' ? 'admin' : 'staff';
      const { error: memberUpsertErr } = await supabaseAdmin
        .from('barbershop_members')
        .upsert({
          barbershop_id: barbershop_id,
          user_id: existingUser.id,
          role: targetRole
        }, { onConflict: 'barbershop_id,user_id' });

      if (memberUpsertErr) {
        console.error("[CREATE_STAFF_EDGE_MEMBER_ERR] Erro ao vincular barbershop_members:", memberUpsertErr.message);
        return new Response(JSON.stringify({ error: `Erro ao vincular membro: ${memberUpsertErr.message}` }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // 2. Garantir profile básico se ausente
      await supabaseAdmin
        .from('profiles')
        .upsert({
          id: existingUser.id,
          name: name,
          personal_phone: phone || '',
          updated_at: new Date().toISOString()
        }, { onConflict: 'id', ignoreDuplicates: false });

      // 3. Criar ou reativar staff_profiles na barbearia
      let finalStaffRecord: any = null;
      let finalStaffId = existingStaffRecord?.id;

      if (existingStaffRecord) {
        const { data: updatedStaff, error: updateStaffErr } = await supabaseAdmin
          .from('staff_profiles')
          .update({
            status: 'active',
            name: name,
            phone: phone || '',
            commission_rate: commissionRate !== undefined ? Number(commissionRate) : 30
          })
          .eq('id', existingStaffRecord.id)
          .select()
          .single();

        if (updateStaffErr) {
          console.error("[CREATE_STAFF_EDGE_STAFF_UPDATE_ERR] Erro ao reativar staff_profiles:", updateStaffErr.message);
          return new Response(JSON.stringify({ error: `Erro ao reativar registro profissional: ${updateStaffErr.message}` }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        finalStaffRecord = updatedStaff;
      } else {
        finalStaffId = crypto.randomUUID();
        const { data: createdStaff, error: createStaffErr } = await supabaseAdmin
          .from('staff_profiles')
          .insert({
            id: finalStaffId,
            barbershop_id: barbershop_id,
            tenant_id: barbershop.owner_id,
            user_id: existingUser.id,
            name: name,
            phone: phone || '',
            status: 'active',
            commission_rate: commissionRate !== undefined ? Number(commissionRate) : 30
          })
          .select()
          .single();

        if (createStaffErr) {
          console.error("[CREATE_STAFF_EDGE_STAFF_INSERT_ERR] Erro ao criar staff_profiles:", createStaffErr.message);
          return new Response(JSON.stringify({ error: `Erro ao criar perfil profissional: ${createStaffErr.message}` }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        finalStaffRecord = createdStaff;
      }

      console.log(`[CREATE_STAFF_EDGE_LINKED] Profissional vinculado com sucesso (Staff ID: ${finalStaffId})`);
      const successPayload = {
        success: true,
        linked: true,
        reactivated: Boolean(existingStaffRecord),
        user_id: existingUser.id,
        email,
        name,
        role: targetRole,
        staff_id: finalStaffId,
        staff: finalStaffRecord || null
      };

      return new Response(JSON.stringify(successPayload), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 5. Novo usuário: criar no Supabase Auth com email confirmado
    // Log [CREATE_STAFF_EDGE_09]
    console.log(`[CREATE_STAFF_EDGE_09] Solicitando criação do novo usuário no Supabase Auth com email: ${email}...`);
    const { data: authUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name, role }
    })

    if (createError || !authUser.user) {
      console.error("[CREATE_STAFF_EDGE_09_ERR] Erro retornado ao criar usuário no Supabase Auth:", {
        message: createError?.message,
        errorObject: createError
      });
      const isDuplicate = createError?.message?.includes('already been registered') || 
                          createError?.message?.includes('already registered') ||
                          createError?.message?.includes('already exists');
      const errorMsg = isDuplicate 
        ? 'Este e-mail já está sendo utilizado por outro profissional no sistema.'
        : `Erro ao criar usuário em Auth: ${createError?.message}`;
      return new Response(JSON.stringify({ error: errorMsg }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const newUserId = authUser.user.id
    console.log(`[CREATE_STAFF_EDGE_09a] Usuário criado com sucesso em Auth! New User ID gerado: ${newUserId}`);

    // 5. Insert member relationship in barbershop_members
    // Log [CREATE_STAFF_EDGE_10]
    console.log(`[CREATE_STAFF_EDGE_10] Inserindo relacionamento na tabela "barbershop_members" para o novo usuário...`);
    const { error: insertMemberErr } = await supabaseAdmin
      .from('barbershop_members')
      .insert({
        barbershop_id: barbershop_id,
        user_id: newUserId,
        role: role === 'admin' ? 'admin' : 'staff'
      })

    if (insertMemberErr) {
      // Log [CREATE_STAFF_EDGE_ROLLBACK_01]
      console.error("[CREATE_STAFF_EDGE_10_ERR] Erro ao vincular membro na tabela barbershop_members:", insertMemberErr.message);
      console.log(`[CREATE_STAFF_EDGE_ROLLBACK_01] Iniciando rollback: Excluindo usuário de Auth (${newUserId})...`);
      const { error: delUserErr } = await supabaseAdmin.auth.admin.deleteUser(newUserId)
      console.log(`[CREATE_STAFF_EDGE_ROLLBACK_01_RES] Resultado da exclusão do Auth no rollback:`, delUserErr ? delUserErr.message : 'Sucesso');
      
      return new Response(JSON.stringify({ error: `Erro ao vincular membro: ${insertMemberErr.message}` }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    console.log(`[CREATE_STAFF_EDGE_10a] Relacionamento inserido com sucesso em barbershop_members.`);

    // 6. Insert/Upsert user details in profiles to prevent primary key conflicts if trigger runs
    // Log [CREATE_STAFF_EDGE_11]
    console.log(`[CREATE_STAFF_EDGE_11] Gravando/Upserting detalhes na tabela "profiles" para o usuário: ${newUserId}...`);
    const { error: profileErr } = await supabaseAdmin
      .from('profiles')
      .upsert({
        id: newUserId,
        name: name,
        personal_phone: phone || '',
        updated_at: new Date().toISOString()
      })

    if (profileErr) {
      // Log [CREATE_STAFF_EDGE_ROLLBACK_02]
      console.error("[CREATE_STAFF_EDGE_11_ERR] Erro ao salvar perfil do profissional na tabela profiles:", profileErr.message);
      console.log(`[CREATE_STAFF_EDGE_ROLLBACK_02] Iniciando rollback em cascata...`);
      
      console.log(`[CREATE_STAFF_EDGE_ROLLBACK_02a] Removendo associação em barbershop_members...`);
      const { error: delMemberErr } = await supabaseAdmin.from('barbershop_members').delete().eq('barbershop_id', barbershop_id).eq('user_id', newUserId);
      console.log(`[CREATE_STAFF_EDGE_ROLLBACK_02a_RES] Resultado:`, delMemberErr ? delMemberErr.message : 'Sucesso');

      console.log(`[CREATE_STAFF_EDGE_ROLLBACK_02b] Excluindo usuário de Auth (${newUserId})...`);
      const { error: delUserErr } = await supabaseAdmin.auth.admin.deleteUser(newUserId);
      console.log(`[CREATE_STAFF_EDGE_ROLLBACK_02b_RES] Resultado:`, delUserErr ? delUserErr.message : 'Sucesso');

      return new Response(JSON.stringify({ error: `Erro ao criar perfil em profiles: ${profileErr.message}` }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    console.log(`[CREATE_STAFF_EDGE_11a] Perfil inserido/atualizado com sucesso na tabela profiles.`);

    // 7. Insert the staff member record in 'staff_profiles' table linked to correct tenant_id
    // Log [CREATE_STAFF_EDGE_12]
    console.log(`[CREATE_STAFF_EDGE_12] Criando registro de profissional na tabela "staff_profiles"...`);
    const staffId = crypto.randomUUID()
    const { data: staffRecord, error: staffErr } = await supabaseAdmin
      .from('staff_profiles')
      .insert({
        id: staffId,
        barbershop_id: barbershop_id,
        tenant_id: barbershop.owner_id, // Linked to owner/tenant id of the barbershop
        user_id: newUserId,
        name: name,
        phone: phone || '',
        status: 'active',
        commission_rate: commissionRate !== undefined ? Number(commissionRate) : 30
      })
      .select()
      .single()

    if (staffErr) {
      // Log [CREATE_STAFF_EDGE_ROLLBACK_03]
      console.error("[CREATE_STAFF_EDGE_12_ERR] Erro ao criar registro na tabela staff:", staffErr.message);
      console.log(`[CREATE_STAFF_EDGE_ROLLBACK_03] Iniciando rollback completo em cascata...`);

      console.log(`[CREATE_STAFF_EDGE_ROLLBACK_03a] Removendo registro criado de profiles...`);
      const { error: delProfileErr } = await supabaseAdmin.from('profiles').delete().eq('id', newUserId);
      console.log(`[CREATE_STAFF_EDGE_ROLLBACK_03a_RES] Resultado:`, delProfileErr ? delProfileErr.message : 'Sucesso');

      console.log(`[CREATE_STAFF_EDGE_ROLLBACK_03b] Removendo associação em barbershop_members...`);
      const { error: delMemberErr } = await supabaseAdmin.from('barbershop_members').delete().eq('barbershop_id', barbershop_id).eq('user_id', newUserId);
      console.log(`[CREATE_STAFF_EDGE_ROLLBACK_03b_RES] Resultado:`, delMemberErr ? delMemberErr.message : 'Sucesso');

      console.log(`[CREATE_STAFF_EDGE_ROLLBACK_03c] Excluindo usuário de Auth (${newUserId})...`);
      const { error: delUserErr } = await supabaseAdmin.auth.admin.deleteUser(newUserId);
      console.log(`[CREATE_STAFF_EDGE_ROLLBACK_03c_RES] Resultado:`, delUserErr ? delUserErr.message : 'Sucesso');

      return new Response(JSON.stringify({ error: `Erro ao registrar profissional em staff: ${staffErr.message}` }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Log [CREATE_STAFF_EDGE_13]
    console.log("[CREATE_STAFF_EDGE_13] Profissional criado com sucesso completo! Preparando resposta final de sucesso.");
    
    const successPayload = {
      success: true,
      user_id: newUserId,
      email,
      name,
      role,
      staff_id: staffId,
      staff: staffRecord || null
    };

    console.log("[CREATE_STAFF_EDGE_13a] Payload de sucesso enviado para o cliente:", {
      ...successPayload,
      staff: staffRecord ? { id: staffRecord.id, name: staffRecord.name, tenant_id: staffRecord.tenant_id } : null
    });

    return new Response(JSON.stringify(successPayload), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (err: any) {
    // Log [CREATE_STAFF_EDGE_99]
    console.error("[CREATE_STAFF_EDGE_99] Exceção geral capturada na Edge Function:", {
      message: err.message,
      stack: err.stack || 'Sem stack disponível'
    });
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

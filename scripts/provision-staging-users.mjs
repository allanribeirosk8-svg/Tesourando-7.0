// scripts/provision-staging-users.mjs
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

const SUPABASE_URL = process.env.STAGING_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('[FATAL] STAGING_SUPABASE_URL e STAGING_SUPABASE_SERVICE_ROLE_KEY são obrigatórias.');
  process.exit(1);
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function getOrCreateUser(email, password, name) {
  // 1. Tentar criar o usuário
  const { data: createData, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name }
  });

  if (!createError && createData?.user?.id) {
    const userId = createData.user.id;
    if (!uuidRegex.test(userId)) {
      console.error(`[FATAL] ID retornado para ${email} não é um UUID válido: ${userId}`);
      process.exit(1);
    }
    console.log(`[AUTH API] Criado nesta execução: ${email} -> ${userId}`);
    return { id: userId, created_by_this_run: true };
  }

  // 2. Se for duplicidade, recuperar usuário pré-existente sem sobrescrever
  if (createError && (createError.message.includes('already registered') || createError.status === 422)) {
    console.log(`[AUTH API] Usuário ${email} já existente detectado. Recuperando ID...`);
    const { data: listData, error: listError } = await supabaseAdmin.auth.admin.listUsers({
      page: 1,
      perPage: 1000
    });

    if (listError || !listData?.users) {
      console.error(`[FATAL] Erro ao listar usuários para recuperar ${email}:`, listError?.message);
      process.exit(1);
    }

    const existingUser = listData.users.find(u => u.email?.toLowerCase() === email.toLowerCase());
    if (!existingUser || !existingUser.id || !uuidRegex.test(existingUser.id)) {
      console.error(`[FATAL] Não foi possível recuperar UUID válido para ${email}`);
      process.exit(1);
    }

    console.log(`[AUTH API] Conta pré-existente preservada: ${email} -> ${existingUser.id}`);
    return { id: existingUser.id, created_by_this_run: false };
  }

  // 3. Qualquer outro erro encerra o processo
  console.error(`[FATAL] Erro de provisionamento para ${email}:`, createError?.message);
  process.exit(1);
}

async function main() {
  try {
    console.log('[PROVISIONAMENTO] Inicializando contas reais em Auth...');
    const owner = await getOrCreateUser('owner.homolog@teste.com', 'SenhaForte123!', 'Owner Homolog');
    const staffA = await getOrCreateUser('staff_a.homolog@teste.com', 'SenhaForte123!', 'Barbeiro A (08:15)');
    const staffB = await getOrCreateUser('staff_b.homolog@teste.com', 'SenhaForte123!', 'Barbeiro B (08:00)');

    const context = {
      owner_uid: owner.id,
      owner_created_by_this_run: owner.created_by_this_run,
      staff_a_uid: staffA.id,
      staff_a_created_by_this_run: staffA.created_by_this_run,
      staff_b_uid: staffB.id,
      staff_b_created_by_this_run: staffB.created_by_this_run,
      provisioned_at: new Date().toISOString()
    };

    const outDir = path.resolve('scripts');
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }
    const outPath = path.join(outDir, 'staging-auth-context.json');
    fs.writeFileSync(outPath, JSON.stringify(context, null, 2), 'utf-8');
    console.log(`[PROVISIONAMENTO] Contexto persistido em ${outPath}`);
  } catch (err) {
    console.error('[FATAL] Falha não tratada:', err);
    process.exit(1);
  }
}

main();

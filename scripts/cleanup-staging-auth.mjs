// scripts/cleanup-staging-auth.mjs
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

async function cleanUserIfCreated(userId, flag, label) {
  if (!flag) {
    console.log(`[LIMPEZA AUTH] Preservando conta pré-existente: ${label} (${userId})`);
    return;
  }
  if (!userId) return;

  const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
  if (error) {
    console.warn(`[LIMPEZA AUTH] Aviso ao remover ${label} (${userId}):`, error.message);
  } else {
    console.log(`[LIMPEZA AUTH] Removida conta criada nesta execução: ${label} (${userId})`);
  }
}

async function main() {
  const contextPath = path.resolve('scripts/staging-auth-context.json');
  if (!fs.existsSync(contextPath)) {
    console.log('[LIMPEZA AUTH] Arquivo staging-auth-context.json não encontrado. Nada a limpar em Auth.');
    return;
  }

  const context = JSON.parse(fs.readFileSync(contextPath, 'utf-8'));
  console.log('[LIMPEZA AUTH] Iniciando remoção seletiva de contas Auth...');

  await cleanUserIfCreated(context.owner_uid, context.owner_created_by_this_run, 'Owner');
  await cleanUserIfCreated(context.staff_a_uid, context.staff_a_created_by_this_run, 'Barbeiro A');
  await cleanUserIfCreated(context.staff_b_uid, context.staff_b_created_by_this_run, 'Barbeiro B');

  fs.unlinkSync(contextPath);
  console.log('[LIMPEZA AUTH] Arquivo de contexto descartado com sucesso.');
}

main().catch(err => {
  console.error('[FATAL] Erro na limpeza de Auth:', err);
  process.exit(1);
});

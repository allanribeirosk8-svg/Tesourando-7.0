// scripts/run-staging-suite.mjs
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const DB_URL = process.env.STAGING_DATABASE_URL;
const SUPABASE_URL = process.env.STAGING_SUPABASE_URL;
const SERVICE_KEY = process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.STAGING_SUPABASE_ANON_KEY || SERVICE_KEY;

function sanitizeUrl(rawUrl) {
  if (!rawUrl) return '(não configurado)';
  try {
    const parsed = new URL(rawUrl);
    parsed.password = '***';
    return parsed.toString();
  } catch {
    return 'postgres://***@host:port/database';
  }
}

function runCommand(command, args, description) {
  console.log(`\n==================================================`);
  console.log(`[ETAPA] ${description}`);
  console.log(`[COMANDO] ${command} ${args.filter(a => !a.startsWith('postgresql://') && !a.startsWith('postgres://')).join(' ')}`);
  console.log(`==================================================`);

  try {
    execFileSync(command, args, { stdio: 'inherit' });
  } catch (error) {
    console.error(`\n[FATAL] Erro ao executar ${description}. Interrompendo.`);
    process.exit(1);
  }
}

async function runHttpQuery(label, params) {
  const url = new URL(`${SUPABASE_URL}/functions/v1/get-public-availability`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  console.log(`\n--- [HTTP REQUEST] ${label} ---`);
  console.log(`URL: ${url.origin}${url.pathname}?${url.searchParams.toString()}`);

  try {
    const res = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${ANON_KEY}`,
        'apikey': ANON_KEY
      }
    });

    const status = res.status;
    const bodyText = await res.text();
    let parsedBody;
    try {
      parsedBody = JSON.parse(bodyText);
    } catch {
      parsedBody = bodyText;
    }

    console.log(`HTTP Status: ${status}`);
    console.log(`Response Body:`);
    console.log(JSON.stringify(parsedBody, null, 2));
    return { status, body: parsedBody };
  } catch (err) {
    console.error(`[HTTP ERROR] Falha na chamada para ${label}:`, err.message);
    return null;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const isCleanupOnly = args.includes('--cleanup-only');
  const skipCleanup = args.includes('--skip-cleanup');

  console.log(`Iniciando orquestração da suite de homologação.`);
  console.log(`Banco alvo: ${sanitizeUrl(DB_URL)}`);
  console.log(`Supabase URL: ${SUPABASE_URL || '(não configurado)'}`);

  if (isCleanupOnly) {
    console.log(`\nModo somente limpeza ativado.`);
    if (DB_URL) {
      runCommand('psql', ['-v', 'ON_ERROR_STOP=1', '-d', DB_URL, '-f', 'scripts/03_http_snapshot_cleanup.sql'], 'Limpeza de Dados SQL de Homologação');
    }
    if (SUPABASE_URL && SERVICE_KEY) {
      runCommand('node', ['scripts/cleanup-staging-auth.mjs'], 'Limpeza de Usuários Auth de Homologação');
    }
    console.log('\nLimpeza concluída.');
    return;
  }

  if (!DB_URL || !SUPABASE_URL || !SERVICE_KEY) {
    console.error('\n[AVISO DE CONFIGURAÇÃO]');
    console.error('Para executar os testes contra o banco real de homologação, configure as seguintes variáveis:');
    console.error('  export STAGING_DATABASE_URL="postgres://postgres:senha@db.host.supabase.co:5432/postgres"');
    console.error('  export STAGING_SUPABASE_URL="https://seu-projeto-staging.supabase.co"');
    console.error('  export STAGING_SUPABASE_SERVICE_ROLE_KEY="eyJhbGciOi..."');
    console.error('  export STAGING_SUPABASE_ANON_KEY="eyJhbGciOi..."');
    console.error('\nNenhum banco ou credencial de produção deve ser utilizado.');
    console.log('\nStatus: TESTES PENDENTES DE EXECUÇÃO EM HOMOLOGAÇÃO.');
    process.exit(0);
  }

  // 1. Provisionamento de contas reais em Auth
  runCommand('node', ['scripts/provision-staging-users.mjs'], 'Provisionamento de Usuários de Teste em Auth');

  const contextPath = path.resolve('scripts/staging-auth-context.json');
  if (!fs.existsSync(contextPath)) {
    console.error('[FATAL] Arquivo staging-auth-context.json não foi gerado.');
    process.exit(1);
  }
  const authContext = JSON.parse(fs.readFileSync(contextPath, 'utf-8'));

  // 2. Testes transacionais isolados com ROLLBACK
  runCommand('psql', [
    '-v', 'ON_ERROR_STOP=1',
    '-v', `owner_uid=${authContext.owner_uid}`,
    '-v', `staff_a_uid=${authContext.staff_a_uid}`,
    '-v', `staff_b_uid=${authContext.staff_b_uid}`,
    '-d', DB_URL,
    '-f', 'scripts/01_transactional_tests.sql'
  ], 'Execução de Testes Transacionais (com ROLLBACK)');

  // 3. Preparação persistente do snapshot para validação HTTP
  runCommand('psql', [
    '-v', 'ON_ERROR_STOP=1',
    '-v', `owner_uid=${authContext.owner_uid}`,
    '-v', `staff_a_uid=${authContext.staff_a_uid}`,
    '-v', `staff_b_uid=${authContext.staff_b_uid}`,
    '-d', DB_URL,
    '-f', 'scripts/02_http_snapshot_setup.sql'
  ], 'Preparação Persistente do Snapshot HTTP (com COMMIT)');

  // 4. Calcular próxima segunda-feira para testes HTTP
  const now = new Date();
  const dayOfWeek = now.getUTCDay(); // 0 is Sunday, 1 is Monday
  const daysUntilMonday = ((1 - dayOfWeek + 7) % 7) || 7;
  const targetDate = new Date(now.getTime() + daysUntilMonday * 24 * 60 * 60 * 1000);
  const targetDateStr = targetDate.toISOString().split('T')[0];

  console.log(`\nData alvo de teste (Segunda-Feira): ${targetDateStr}`);

  // 5. Chamadas HTTP reais à Edge Function get-public-availability
  if (SUPABASE_URL && ANON_KEY) {
    console.log('\nExecutando consultas HTTP reais na Edge Function...');

    // Consulta 1: Barbeiro A (08:15 às 24:00) com serviço de 15 min. Reserva existente às 23:45 deve bloquear slot 23:45.
    await runHttpQuery('Barbeiro A - Serviço 15m (Bloqueio 23:45 esperado)', {
      barbershop_slug: 'barbearia-homolog',
      staff_id: 'c1111111-1111-1111-1111-111111111111',
      date: targetDateStr,
      service_id: 'd2222222-2222-2222-2222-222222222222'
    });

    // Consulta 2: Barbeiro B (08:00 às 24:00) com serviço de 30 min. Reserva existente às 08:30 deve bloquear slot 08:30.
    await runHttpQuery('Barbeiro B - Serviço 30m (Bloqueio 08:30 esperado)', {
      barbershop_slug: 'barbearia-homolog',
      staff_id: 'c2222222-2222-2222-2222-222222222222',
      date: targetDateStr,
      service_id: 'd1111111-1111-1111-1111-111111111111'
    });

    // Consulta 3: Qualquer profissional com serviço de 30 min.
    await runHttpQuery('Qualquer Profissional - Serviço 30m', {
      barbershop_slug: 'barbearia-homolog',
      date: targetDateStr,
      service_id: 'd1111111-1111-1111-1111-111111111111'
    });
  }

  // 6. Limpeza (a menos que explicitamente ignorada)
  if (!skipCleanup) {
    runCommand('psql', ['-v', 'ON_ERROR_STOP=1', '-d', DB_URL, '-f', 'scripts/03_http_snapshot_cleanup.sql'], 'Limpeza de Dados SQL do Snapshot');
    runCommand('node', ['scripts/cleanup-staging-auth.mjs'], 'Limpeza de Contas Auth Criadas');
  } else {
    console.log('\n[AVISO] --skip-cleanup ativado: fixtures preservadas em homologação.');
    console.log('Para limpar posteriormente, execute: node scripts/run-staging-suite.mjs --cleanup-only');
  }

  console.log('\nSuite de homologação finalizada com sucesso.');
}

main().catch(err => {
  console.error('[FATAL] Erro geral:', err);
  process.exit(1);
});

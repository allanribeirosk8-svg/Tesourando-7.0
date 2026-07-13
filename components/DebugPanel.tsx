import React, { useState } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

// =============================================================
// PAINEL DE DIAGNÓSTICO — MEUCORTE
// Uso: Importe e cole <DebugPanel /> temporariamente no AdminApp
// logo abaixo do <main> quando autenticado.
// Remova após corrigir.
// =============================================================

type LogEntry = {
  time: string;
  level: 'info' | 'ok' | 'error' | 'warn';
  msg: string;
};

const tag = (level: LogEntry['level'], msg: string): LogEntry => ({
  time: new Date().toLocaleTimeString('pt-BR'),
  level,
  msg,
});

export const DebugPanel: React.FC = () => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [running, setRunning] = useState(false);
  const [open, setOpen] = useState(true);

  const add = (entry: LogEntry) => setLogs(prev => [entry, ...prev]);

  const runDiagnostic = async () => {
    setLogs([]);
    setRunning(true);

    // ── 1. Variáveis de ambiente ──────────────────────────────
    add(tag('info', '── 1. Verificando variáveis de ambiente ──'));
    // @ts-ignore
    const url = import.meta.env.VITE_SUPABASE_URL;
    // @ts-ignore
    const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
    add(tag(url ? 'ok' : 'error', `VITE_SUPABASE_URL: ${url ? url.substring(0, 30) + '…' : 'NÃO ENCONTRADA'}`));
    add(tag(key ? 'ok' : 'error', `VITE_SUPABASE_ANON_KEY: ${key ? key.substring(0, 20) + '…' : 'NÃO ENCONTRADA'}`));
    add(tag(isSupabaseConfigured() ? 'ok' : 'error', `isSupabaseConfigured(): ${isSupabaseConfigured()}`));

    if (!isSupabaseConfigured()) {
      add(tag('error', 'PARADO: Supabase não configurado. Verifique o .env.local'));
      setRunning(false);
      return;
    }

    // ── 2. Sessão atual ───────────────────────────────────────
    add(tag('info', '── 2. Verificando sessão (getSession) ──'));
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) {
        add(tag('error', `getSession() erro: ${error.message}`));
      } else if (!data.session) {
        add(tag('warn', 'getSession(): sem sessão ativa — usuário não está logado'));
      } else {
        add(tag('ok', `getSession(): sessão ativa — user_id: ${data.session.user.id}`));
        add(tag('ok', `email: ${data.session.user.email}`));
        add(tag('ok', `token expira em: ${new Date(data.session.expires_at! * 1000).toLocaleString('pt-BR')}`));
      }
    } catch (e: any) {
      add(tag('error', `getSession() exception: ${e.message}`));
    }

    // ── 3. getUser (network call) ─────────────────────────────
    add(tag('info', '── 3. Verificando getUser() (chamada de rede) ──'));
    try {
      const { data, error } = await supabase.auth.getUser();
      if (error) {
        add(tag('error', `getUser() erro: ${error.message} — Isso confirma o problema do iframe/AI Studio`));
      } else {
        add(tag('ok', `getUser(): ok — ${data.user?.email}`));
      }
    } catch (e: any) {
      add(tag('error', `getUser() exception: ${e.message}`));
    }

    // ── 4. SELECT público (profiles) ─────────────────────────
    add(tag('info', '── 4. SELECT público em profiles ──'));
    try {
      const { data, error } = await supabase.from('profiles').select('id, name').limit(3);
      if (error) {
        add(tag('error', `profiles SELECT erro: ${error.message} (code: ${error.code})`));
      } else {
        add(tag('ok', `profiles SELECT: ${data?.length ?? 0} linha(s) retornada(s)`));
        (data as any[])?.forEach(p => add(tag('ok', `  → id: ${p.id}, name: ${p.name}`)));
      }
    } catch (e: any) {
      add(tag('error', `profiles SELECT exception: ${e.message}`));
    }

    // ── 5. SELECT público (services) ─────────────────────────
    add(tag('info', '── 5. SELECT público em services ──'));
    try {
      const { data, error } = await supabase.from('services').select('id, name, user_id').limit(5);
      if (error) {
        add(tag('error', `services SELECT erro: ${error.message}`));
      } else {
        add(tag('ok', `services SELECT: ${data?.length ?? 0} serviço(s)`));
        (data as any[])?.forEach(s => add(tag('ok', `  → ${s.name} (user_id: ${s.user_id})`)));
      }
    } catch (e: any) {
      add(tag('error', `services SELECT exception: ${e.message}`));
    }

    // ── 6. INSERT em appointments (autenticado) ───────────────
    add(tag('info', '── 6. Tentando INSERT em appointments ──'));
    try {
      const session = (await supabase.auth.getSession()).data.session;
      if (!session) {
        add(tag('warn', 'INSERT pulado: sem sessão ativa'));
      } else {
        const testApt = {
          user_id: session.user.id,
          date: '2099-01-01',
          time: '09:00',
          client_name: 'TESTE_DEBUG',
          phone: '(00) 00000-0000',
          service: 'Diagnóstico',
          price: 0,
          duration: 15,
          status: 'pending',
        };
        const { data, error } = await supabase.from('appointments').insert(testApt as any).select().single();
        if (error) {
          add(tag('error', `appointments INSERT erro: ${error.message} (code: ${error.code})`));
        } else {
          add(tag('ok', `appointments INSERT: sucesso — id: ${(data as any).id}`));

          // Limpa o registro de teste
          const { error: delErr } = await supabase.from('appointments').delete().eq('id', (data as any).id);
          add(tag(delErr ? 'warn' : 'ok', delErr ? `DELETE do teste falhou: ${delErr.message}` : 'Registro de teste removido'));
        }
      }
    } catch (e: any) {
      add(tag('error', `appointments INSERT exception: ${e.message}`));
    }

    // ── 7. INSERT em services (autenticado) ───────────────────
    add(tag('info', '── 7. Tentando INSERT em services ──'));
    try {
      const session = (await supabase.auth.getSession()).data.session;
      if (!session) {
        add(tag('warn', 'INSERT pulado: sem sessão ativa'));
      } else {
        const testSvc = {
          user_id: session.user.id,
          name: 'TESTE_DEBUG',
          price: 0,
          duration: 15,
          order_index: 999,
        };
        const { data, error } = await supabase.from('services').insert(testSvc as any).select().single();
        if (error) {
          add(tag('error', `services INSERT erro: ${error.message} (code: ${error.code})`));
        } else {
          add(tag('ok', `services INSERT: sucesso — id: ${(data as any).id}`));
          await supabase.from('services').delete().eq('id', (data as any).id);
          add(tag('ok', 'Registro de teste removido'));
        }
      }
    } catch (e: any) {
      add(tag('error', `services INSERT exception: ${e.message}`));
    }

    // ── 8. UPSERT em customers ────────────────────────────────
    add(tag('info', '── 8. Tentando UPSERT em customers ──'));
    try {
      const session = (await supabase.auth.getSession()).data.session;
      if (!session) {
        add(tag('warn', 'UPSERT pulado: sem sessão ativa'));
      } else {
        const testCust = {
          user_id: session.user.id,
          phone: '(00) 99999-DEBUG',
          name: 'TESTE_DEBUG',
          cut_count: 0,
          no_show_count: 0,
        };
        const { data, error } = await supabase
          .from('customers')
          .upsert(testCust as any, { onConflict: 'phone,user_id' })
          .select()
          .single();
        if (error) {
          add(tag('error', `customers UPSERT erro: ${error.message} (code: ${error.code})`));
        } else {
          add(tag('ok', `customers UPSERT: sucesso — id: ${(data as any).id}`));
          await supabase.from('customers').delete().eq('id', (data as any).id);
          add(tag('ok', 'Registro de teste removido'));
        }
      }
    } catch (e: any) {
      add(tag('error', `customers UPSERT exception: ${e.message}`));
    }

    add(tag('info', '── Diagnóstico concluído ──'));
    setRunning(false);
  };

  const levelColor = (level: LogEntry['level']) => {
    if (level === 'ok') return '#10b981';
    if (level === 'error') return '#ef4444';
    if (level === 'warn') return '#f59e0b';
    return '#94a3b8';
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{ position: 'fixed', bottom: 80, right: 16, zIndex: 9999, background: '#1e293b', color: '#fff', border: 'none', borderRadius: 12, padding: '8px 14px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
      >
        🔍 DEBUG
      </button>
    );
  }

  return (
    <div id="debug-panel" style={{
      position: 'fixed', bottom: 70, left: 8, right: 8, zIndex: 9999,
      background: '#0f172a', color: '#e2e8f0', borderRadius: 16,
      boxShadow: '0 25px 50px rgba(0,0,0,0.5)', fontFamily: 'monospace',
      fontSize: 11, maxHeight: '60vh', display: 'flex', flexDirection: 'column',
      border: '1px solid #1e293b'
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid #1e293b' }}>
        <span style={{ fontWeight: 900, fontSize: 12, color: '#38bdf8', letterSpacing: 1 }}>🔍 MEUKORTE DEBUG</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={runDiagnostic}
            disabled={running}
            style={{ background: running ? '#334155' : '#3b82f6', color: '#fff', border: 'none', borderRadius: 8, padding: '5px 12px', fontSize: 11, fontWeight: 700, cursor: running ? 'not-allowed' : 'pointer' }}
          >
            {running ? '⏳ Rodando…' : '▶ Executar'}
          </button>
          <button
            onClick={() => setLogs([])}
            style={{ background: '#1e293b', color: '#94a3b8', border: 'none', borderRadius: 8, padding: '5px 10px', fontSize: 11, cursor: 'pointer' }}
          >
            Limpar
          </button>
          <button
            onClick={() => setOpen(false)}
            style={{ background: '#1e293b', color: '#94a3b8', border: 'none', borderRadius: 8, padding: '5px 10px', fontSize: 11, cursor: 'pointer' }}
          >
            ✕
          </button>
        </div>
      </div>

      {/* Log area */}
      <div style={{ overflowY: 'auto', flex: 1, padding: '8px 14px' }}>
        {logs.length === 0 ? (
          <p style={{ color: '#475569', marginTop: 12 }}>Clique em ▶ Executar para iniciar o diagnóstico.</p>
        ) : (
          logs.map((l, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 3, alignItems: 'flex-start' }}>
              <span style={{ color: '#475569', flexShrink: 0 }}>{l.time}</span>
              <span style={{ color: levelColor(l.level), flexShrink: 0, width: 12 }}>
                {l.level === 'ok' ? '✓' : l.level === 'error' ? '✗' : l.level === 'warn' ? '!' : '·'}
              </span>
              <span style={{ color: l.level === 'error' ? '#fca5a5' : l.level === 'warn' ? '#fde68a' : l.level === 'ok' ? '#a7f3d0' : '#94a3b8', wordBreak: 'break-all' }}>
                {l.msg}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

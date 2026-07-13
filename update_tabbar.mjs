import fs from 'fs';

let content = fs.readFileSync('pages/AdminApp.tsx', 'utf8');

// 1. Remove the settings button from header
const headerTarget = `{/* Right: Actions */}
        <div className="flex items-center gap-3">
          <button onClick={() => setShowSettingsModal(true)} className="w-10 h-10 rounded-full bg-surface  text-title  flex items-center justify-center hover:bg-primary/40 :bg-primary transition-colors border border-title/30  shadow-sm" title="Configurações">
            <Settings size={18} />
          </button>
        </div>`;

if (content.includes(headerTarget)) {
  content = content.replace(headerTarget, `{/* Right: Actions */}
        <div className="flex items-center gap-3 w-10">
        </div>`);
  console.log('Replaced header settings button.');
} else {
  console.log('Header settings button not found.');
}

// 2. Replace the nav
const navRegex = /<nav className="bg-primary  border-t border-title\/30  pb-safe px-2 flex justify-between items-center h-\[54px\] shadow-\[0_-4px_20px_rgba\(0,0,0,0\.04\)\] pointer-events-auto">[\s\S]*?<\/nav>/m;

const newNav = `<nav className="bg-surface/90 backdrop-blur-[12px] border-t border-white/10 pb-safe flex justify-between items-center h-[64px] pointer-events-auto px-2 relative z-50">
            {[
              { id: 'clientes', label: 'Clientes', icon: Users, ariaLabel: 'Ir para Clientes' },
              { id: 'relatorios', label: 'Relatórios', icon: BarChart3, ariaLabel: 'Ir para Relatórios' },
              { id: 'agenda', label: 'Agenda', icon: Calendar, ariaLabel: 'Ir para Agenda', isCenter: true },
              { id: 'servicos', label: 'Serviços', icon: Scissors, ariaLabel: 'Ir para Serviços' },
              { id: 'configuracoes', label: 'Configurações', icon: Settings, ariaLabel: 'Ir para Configurações' },
            ].map((item) => {
              const isActive = item.id === 'configuracoes' ? showSettingsModal : activeTab === item.id;
              
              if (item.isCenter) {
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      setActiveTab('agenda');
                      setShowSettingsModal(false);
                    }}
                    className="flex flex-col items-center justify-start flex-1 h-[64px] transition-all duration-[180ms] ease-[cubic-bezier(0.16,1,0.3,1)] active:-translate-y-2.5 active:scale-[0.92]"
                    aria-label={item.ariaLabel}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    <div className="bg-secondary rounded-full flex items-center justify-center -translate-y-2.5 shadow-[0_4px_16px_rgba(249,148,23,0.45)] relative transition-all duration-[180ms]" style={{ padding: '10px 12px' }}>
                      <item.icon size={26} className="text-white" />
                      {pendingTodayCount > 0 && (
                        <div className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full flex items-center justify-center text-[8px] font-bold border-2 border-white ">
                          {pendingTodayCount}
                        </div>
                      )}
                    </div>
                    <span className="text-secondary font-semibold text-[12px] -mt-1 transition-all duration-[180ms]">
                      {item.label}
                    </span>
                  </button>
                );
              }
              
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    if (item.id === 'configuracoes') {
                      setShowSettingsModal(true);
                    } else {
                      setShowSettingsModal(false);
                      setActiveTab(item.id as any);
                      if(item.id !== 'clientes') setTargetCustomerPhone(null);
                    }
                  }}
                  className="flex flex-col items-center justify-center flex-1 h-full min-h-[44px] transition-all duration-[180ms] ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-[0.88] active:opacity-75 relative"
                  aria-label={item.ariaLabel}
                  aria-current={isActive ? 'page' : undefined}
                >
                  <div className="relative mb-0.5 flex flex-col items-center justify-center pt-1">
                    <div className={\`w-1 h-1 rounded-full bg-secondary transition-opacity duration-[180ms] ease-in-out absolute -top-1.5 \${isActive ? 'opacity-100' : 'opacity-0'}\`} />
                    <item.icon size={22} className={\`transition-colors duration-[180ms] ease-[cubic-bezier(0.16,1,0.3,1)] \${isActive ? 'text-secondary' : 'text-muted'}\`} />
                  </div>
                  <span className={\`text-[12px] font-medium transition-colors duration-[180ms] ease-[cubic-bezier(0.16,1,0.3,1)] \${isActive ? 'text-secondary' : 'text-muted'}\`}>
                    {item.label}
                  </span>
                </button>
              );
            })}
          </nav>`;

if (navRegex.test(content)) {
  content = content.replace(navRegex, newNav);
  console.log('Replaced nav successfully.');
} else {
  console.log('Nav not matched.');
}

fs.writeFileSync('pages/AdminApp.tsx', content);

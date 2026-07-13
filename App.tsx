import React, { useState } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppProvider, useStore } from './context/Store';
import { ClientApp } from './pages/ClientApp';
import { AdminApp } from './pages/AdminApp';
import AgendamentoPublico from './pages/AgendamentoPublico';
import { SplashScreen } from './components/SplashScreen';

const AppContent: React.FC<{
  showSplash: boolean;
  appReady: boolean;
  isClientRoute: boolean;
  onSplashComplete: () => void;
}> = ({ showSplash, appReady, isClientRoute, onSplashComplete }) => {
  const { isLoading } = useStore();

  // Se o splash screen deve ser mostrado, nós o renderizamos imediatamente.
  // Ele ficará estático na fase 'bridge' até que os dados estejam prontos (appReady e !isLoading).
  if (showSplash) {
    return (
      <SplashScreen 
        isReady={appReady && !isLoading} 
        onComplete={onSplashComplete} 
      />
    );
  }

  // Fallback de segurança para carregamento caso o splash não esteja ativo e os dados ainda estejam carregando
  if (!isClientRoute && (!appReady || isLoading)) {
    return (
      <div 
        style={{ 
          position: 'fixed', 
          inset: 0, 
          backgroundColor: '#1E1B4B',
          zIndex: 9999 
        }} 
      />
    );
  }

  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/admin" replace />} />
        <Route path="/admin" element={<AdminApp />} />
        <Route path="/agendar/:slug" element={<AgendamentoPublico />} />
      </Routes>
    </HashRouter>
  );
};

const App: React.FC = () => {
  const isClientRoute = window.location.hash.includes('/agendar');
  const shouldShowSplash = !isClientRoute && !sessionStorage.getItem('splashShown');
  const [showSplash, setShowSplash] = useState(!!shouldShowSplash);
  const [appReady, setAppReady] = useState(false);

  return (
    <AppProvider isPublicRoute={isClientRoute} onReady={() => {
      setAppReady(true);
    }}>
      <AppContent
        showSplash={showSplash}
        appReady={appReady}
        isClientRoute={isClientRoute}
        onSplashComplete={() => {
          sessionStorage.setItem('splashShown', 'true');
          setShowSplash(false);
        }}
      />
    </AppProvider>
  );
};

export default App;
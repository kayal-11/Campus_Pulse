import { useEffect, useMemo, useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { CampusDataProvider } from './context/CampusDataContext';
import MainLayout from './layouts/MainLayout';
import Auth from './pages/Auth';
import Home from './pages/Home';
import Dashboard from './pages/Dashboard';
import Energy from './pages/Energy';
import Buildings from './pages/Buildings';
import Analytics from './pages/Analytics';
import Prediction from './pages/Prediction';
import Alerts from './pages/Alerts';
import Admin from './pages/Admin';
import Settings from './pages/Settings';

const pages = {
  Home,
  Dashboard,
  Energy,
  Buildings,
  Analytics,
  Prediction,
  Alerts,
  Admin,
  Settings,
};

function AppContent() {
  const { isAuthenticated, loading, user } = useAuth();
  const [activePage, setActivePage] = useState('Home');
  const [adminSearchQuery, setAdminSearchQuery] = useState('');

  const PageComponent = useMemo(() => pages[activePage] || Home, [activePage]);

  useEffect(() => {
    if (activePage !== 'Admin') {
      setAdminSearchQuery('');
    }
  }, [activePage]);

  if (loading) {
    return (
      <div className="auth-page">
        <div className="auth-loading">Loading…</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Auth />;
  }

  return (
    <CampusDataProvider key={user.id}>
      <MainLayout
        activePage={activePage}
        onNavigate={setActivePage}
        adminSearchQuery={adminSearchQuery}
        onAdminSearchChange={setAdminSearchQuery}
      >
        {activePage === 'Admin' ? <Admin searchQuery={adminSearchQuery} /> : <PageComponent />}
      </MainLayout>
    </CampusDataProvider>
  );
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App;

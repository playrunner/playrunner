/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  Outlet,
} from 'react-router-dom';
import Login from './pages/Login';
import Editor from './pages/Editor';
import Projects from './pages/Projects';
import ProjectDetail from './pages/ProjectDetail';
import Settings from './pages/Settings';
import SettingsPassword from './pages/SettingsPassword';
import DesignSystem from './pages/DesignSystem';
import Environments from './pages/Environments';
import Integrations from './pages/Integrations';
import Insights from './pages/Insights';
import Teams from './pages/Teams';
import OAuthCallback from './pages/OAuthCallback';
import { ThemeProvider } from './components/ThemeProvider';
import { PageLayout } from './components/PageLayout';
import { auth } from './lib/auth';
import { IntegrationSdkProvider } from '@playrunner/integration-sdk';
import { integrationSdkHost } from './integrations/sdkHost';

function RequireAuth() {
  const [user, setUser] = useState(auth.currentUser);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const unsubscribe = auth.onAuthStateChanged((nextUser) => {
      setUser(nextUser);
    });

    void auth.validateSession().finally(() => {
      if (isMounted) {
        setIsReady(true);
      }
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  if (!isReady) {
    return <div className="min-h-screen bg-background" />;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}

function AppShell() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/design" element={<DesignSystem />} />
        <Route path="/oauth/callback/:provider" element={<OAuthCallback />} />
        <Route element={<RequireAuth />}>
          <Route path="/" element={<Navigate to="/projects" replace />} />
          <Route element={<PageLayout />}>
            <Route path="/projects" element={<Projects />} />
            <Route path="/projects/:id" element={<ProjectDetail />} />
            <Route path="/workflow" element={<Editor />} />
            <Route path="/workflow/:id" element={<Editor />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/settings/password" element={<SettingsPassword />} />
            <Route path="/environments" element={<Environments />} />
            <Route path="/integrations" element={<Integrations />} />
            <Route path="/insights" element={<Insights />} />
            <Route
              path="/reports"
              element={<Navigate to="/insights" replace />}
            />
            <Route
              path="/analytics"
              element={<Navigate to="/insights" replace />}
            />
            <Route path="/teams" element={<Teams />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default function App() {
  return (
    <ThemeProvider defaultTheme="system" storageKey="vite-ui-theme">
      <IntegrationSdkProvider host={integrationSdkHost}>
        <AppShell />
      </IntegrationSdkProvider>
    </ThemeProvider>
  );
}

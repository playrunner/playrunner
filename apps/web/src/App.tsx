/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Login from "./pages/Login";
import Editor from "./pages/Editor";
import Projects from "./pages/Projects";
import ProjectDetail from "./pages/ProjectDetail";
import Settings from "./pages/Settings";
import DesignSystem from "./pages/DesignSystem";
import Environments from "./pages/Environments";
import Integrations from "./pages/Integrations";
import Analytics from "./pages/Analytics";
import Teams from "./pages/Teams";
import OAuthCallback from "./pages/OAuthCallback";
import { ThemeProvider } from "./components/ThemeProvider";
import { PageLayout } from "./components/PageLayout";

function AppShell() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<Login />} />
        <Route path="/design" element={<DesignSystem />} />
        <Route path="/oauth/callback/:provider" element={<OAuthCallback />} />
        <Route element={<PageLayout />}>
          <Route path="/projects" element={<Projects />} />
          <Route path="/projects/:id" element={<ProjectDetail />} />
          <Route path="/workflow" element={<Editor />} />
          <Route path="/workflow/:id" element={<Editor />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/environments" element={<Environments />} />
          <Route path="/integrations" element={<Integrations />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/teams" element={<Teams />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default function App() {
  return (
    <ThemeProvider defaultTheme="system" storageKey="vite-ui-theme">
      <AppShell />
    </ThemeProvider>
  );
}

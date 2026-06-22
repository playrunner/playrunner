import React, { createContext, useContext, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { HeaderActions } from './HeaderActions';

interface HeaderContextValue {
  setHeaderLeft: (content: React.ReactNode) => void;
  setHeaderCenter: (content: React.ReactNode) => void;
}

const HeaderContext = createContext<HeaderContextValue>({
  setHeaderLeft: () => {},
  setHeaderCenter: () => {},
});

export function useHeader() {
  return useContext(HeaderContext);
}

export function PageLayout() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [headerLeft, setHeaderLeft] = useState<React.ReactNode>(null);
  const [headerCenter, setHeaderCenter] = useState<React.ReactNode>(null);

  return (
    <HeaderContext.Provider value={{ setHeaderLeft, setHeaderCenter }}>
      <div className="flex h-screen bg-background overflow-hidden">
        <Sidebar
          isOpen={isSidebarOpen}
          onClose={() => setIsSidebarOpen(false)}
          onOpen={() => setIsSidebarOpen(true)}
        />

        <div className="flex-1 flex flex-col min-w-0 h-full relative">
          <header className="h-16 border-b border-subtle flex items-center px-6 gap-4 shrink-0 bg-surface/50 backdrop-blur-md z-30">
            {headerLeft}
            <div className="flex-1 flex justify-center">{headerCenter}</div>
            <HeaderActions />
          </header>

          <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
            <Outlet />
          </div>
        </div>
      </div>
    </HeaderContext.Provider>
  );
}

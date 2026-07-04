import React, { createContext, useContext, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { ExternalLink, GitPullRequest, X } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { HeaderActions } from './HeaderActions';
import { getDocsUrl } from '../lib/docs';
import { cn } from '../lib/utils';

const CONTRIBUTOR_BANNER_DISMISSED_KEY =
  'playrunner.contributorBannerDismissed';

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
  const location = useLocation();
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [headerLeft, setHeaderLeft] = useState<React.ReactNode>(null);
  const [headerCenter, setHeaderCenter] = useState<React.ReactNode>(null);
  const [isContributorBannerDismissed, setIsContributorBannerDismissed] =
    useState(() => {
      if (typeof window === 'undefined') {
        return false;
      }

      return (
        window.localStorage.getItem(CONTRIBUTOR_BANNER_DISMISSED_KEY) === 'true'
      );
    });
  const contributingUrl = getDocsUrl('docs/contributing');
  const isWorkflowRoute = location.pathname.startsWith('/workflow');

  const dismissContributorBanner = () => {
    setIsContributorBannerDismissed(true);
    window.localStorage.setItem(CONTRIBUTOR_BANNER_DISMISSED_KEY, 'true');
  };

  return (
    <HeaderContext.Provider value={{ setHeaderLeft, setHeaderCenter }}>
      <div
        className={cn(
          'flex flex-col bg-background',
          isWorkflowRoute ? 'h-dvh' : 'min-h-dvh',
        )}
      >
        {isContributorBannerDismissed ? null : (
          <div className="grid min-h-10 w-full shrink-0 grid-cols-[2rem_minmax(0,1fr)_2rem] items-center gap-2 border-b border-subtle bg-surface px-3 py-2 text-sm font-medium text-[var(--foreground)]">
            <span aria-hidden="true" />
            <a
              href={contributingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-w-0 flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center transition-colors hover:text-muted"
            >
              <GitPullRequest className="h-4 w-4 shrink-0 text-muted" />
              <span>Playrunner needs contributors.</span>
              <span className="inline-flex items-center gap-1 text-muted">
                Become a contributor
                <ExternalLink className="h-3.5 w-3.5" />
              </span>
            </a>
            <button
              type="button"
              onClick={dismissContributorBanner}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-hover hover:text-[var(--foreground)]"
              title="Dismiss contributor banner"
              aria-label="Dismiss contributor banner"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        <div
          className={cn(
            'flex flex-1',
            isWorkflowRoute ? 'min-h-0' : 'items-start',
          )}
        >
          <Sidebar
            isOpen={isSidebarOpen}
            isPinned={!isWorkflowRoute}
            onClose={() => setIsSidebarOpen(false)}
            onOpen={() => setIsSidebarOpen(true)}
          />

          <div
            className={cn(
              'relative flex min-w-0 flex-1 flex-col',
              isWorkflowRoute && 'min-h-0',
            )}
          >
            <header className="sticky top-0 h-16 border-b border-subtle flex items-center px-6 gap-4 shrink-0 bg-surface/50 backdrop-blur-md z-30">
              {headerLeft}
              <div className="flex-1 flex justify-center">{headerCenter}</div>
              <HeaderActions />
            </header>

            <div
              className={cn(
                'flex flex-1 flex-col',
                isWorkflowRoute && 'min-h-0',
              )}
            >
              <Outlet />
            </div>
          </div>
        </div>
      </div>
    </HeaderContext.Provider>
  );
}

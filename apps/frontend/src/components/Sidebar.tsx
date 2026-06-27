import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  User,
  Settings as SettingsIcon,
  FolderClosed,
  LogOut,
  MoreVertical,
  Palette,
  Server,
  Boxes,
  BarChart2,
  Users,
  PanelLeft,
  GitPullRequest,
  ExternalLink,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { auth } from '../lib/auth';
import { getDocsUrl } from '../lib/docs';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  onOpen?: () => void;
}

function NavItem({
  icon: Icon,
  label,
  isOpen,
  isActive,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  isOpen: boolean;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={cn(
        'w-full flex items-center rounded-md text-sm font-medium transition-colors border h-9 px-2 gap-3 overflow-hidden',
        isActive
          ? 'text-[var(--foreground)] bg-[var(--surface-hover)] border-[var(--border)]'
          : 'text-muted hover:text-[var(--foreground)] hover:bg-surface-hover border-transparent',
      )}
    >
      <Icon
        className={cn(
          'w-4 h-4 shrink-0',
          isActive && 'text-[var(--foreground)]',
        )}
      />
      <span
        className={cn(
          'whitespace-nowrap transition-opacity duration-100',
          isOpen ? 'opacity-100' : 'opacity-0',
        )}
      >
        {label}
      </span>
    </button>
  );
}

function ExternalNavItem({
  icon: Icon,
  label,
  isOpen,
  href,
}: {
  icon: React.ElementType;
  label: string;
  isOpen: boolean;
  href: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={label}
      className="w-full flex items-center rounded-md text-sm font-medium transition-colors border h-9 px-2 gap-3 overflow-hidden text-muted hover:text-[var(--foreground)] hover:bg-surface-hover border-transparent"
    >
      <Icon className="w-4 h-4 shrink-0" />
      <span
        className={cn(
          'whitespace-nowrap transition-opacity duration-100',
          isOpen ? 'opacity-100' : 'opacity-0',
        )}
      >
        {label}
      </span>
      <ExternalLink
        className={cn(
          'w-3.5 h-3.5 shrink-0 ml-auto transition-opacity duration-100',
          isOpen ? 'opacity-100' : 'opacity-0',
        )}
      />
    </a>
  );
}

function getUserDisplayName(user: typeof auth.currentUser) {
  return (
    user?.name?.trim() || user?.email?.trim() || user?.username || 'Local user'
  );
}

export function Sidebar({ isOpen, onClose, onOpen }: SidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [displayName, setDisplayName] = useState(
    getUserDisplayName(auth.currentUser),
  );
  const contributingUrl = getDocsUrl('docs/contributing');

  useEffect(() => {
    return auth.onAuthStateChanged((user) => {
      setDisplayName(getUserDisplayName(user));
    });
  }, []);

  const textClass = cn(
    'whitespace-nowrap transition-opacity duration-100',
    isOpen ? 'opacity-100' : 'opacity-0',
  );

  return (
    <>
      {isOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/50 z-40 transition-opacity"
          onClick={onClose}
        />
      )}

      <div
        className={cn(
          'sticky top-0 flex h-screen flex-col self-start bg-surface/50 backdrop-blur-md z-50 shadow-none transition-[width] duration-300 ease-in-out shrink-0 border-r border-strong',
          isOpen ? 'w-56' : 'w-[52px]',
        )}
      >
        <div className="w-full h-full flex flex-col overflow-hidden">
          <div className="h-16 flex items-center shrink-0 px-2.5 gap-1 overflow-hidden">
            <div className="w-8 h-8 flex items-center justify-center shrink-0">
              <img
                src="/images/playrunner-icon.svg"
                alt="Playrunner"
                className="w-7 h-7 object-contain"
              />
            </div>
            <span className={cn(textClass, 'font-bold text-lg tracking-tight')}>
              Playrunner
            </span>
          </div>

          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto px-2.5 py-4 space-y-1">
              <NavItem
                icon={FolderClosed}
                label="Projects"
                isOpen={isOpen}
                isActive={
                  location.pathname === '/projects' ||
                  location.pathname.startsWith('/projects/') ||
                  location.pathname.startsWith('/workflow')
                }
                onClick={() => {
                  navigate('/projects');
                }}
              />

              <NavItem
                icon={Server}
                label="Environments"
                isOpen={isOpen}
                isActive={location.pathname === '/environments'}
                onClick={() => {
                  navigate('/environments');
                }}
              />
              <NavItem
                icon={Boxes}
                label="Integrations"
                isOpen={isOpen}
                isActive={location.pathname === '/integrations'}
                onClick={() => {
                  navigate('/integrations');
                }}
              />
              <NavItem
                icon={BarChart2}
                label="Insights"
                isOpen={isOpen}
                isActive={
                  location.pathname === '/insights' ||
                  location.pathname === '/reports' ||
                  location.pathname === '/analytics'
                }
                onClick={() => {
                  navigate('/insights');
                }}
              />
              <NavItem
                icon={Palette}
                label="Design System"
                isOpen={isOpen}
                isActive={location.pathname === '/design'}
                onClick={() => {
                  navigate('/design');
                }}
              />
              <ExternalNavItem
                icon={GitPullRequest}
                label="Contributing"
                isOpen={isOpen}
                href={contributingUrl}
              />
            </div>

            <div className="relative border-t border-subtle shrink-0">
              {isUserMenuOpen && (
                <div
                  className={cn(
                    'absolute bottom-full mb-2 bg-surface shadow-lg border border-strong rounded-lg overflow-hidden py-1 z-50',
                    isOpen ? 'left-3 right-3' : 'left-full ml-2 w-48',
                  )}
                >
                  <button
                    className="w-full text-left px-4 py-2 flex items-center gap-2 text-sm text-[var(--foreground)] hover:bg-surface-hover transition-colors"
                    onClick={() => {
                      navigate('/settings');
                      setIsUserMenuOpen(false);
                    }}
                  >
                    <SettingsIcon className="w-4 h-4 text-muted" />
                    Settings
                  </button>
                  <button
                    className="w-full text-left px-4 py-2 flex items-center gap-2 text-sm text-[var(--foreground)] hover:bg-surface-hover transition-colors"
                    onClick={() => {
                      navigate('/teams');
                      setIsUserMenuOpen(false);
                    }}
                  >
                    <Users className="w-4 h-4 text-muted" />
                    Teams
                  </button>
                  <div className="h-px bg-border-strong my-1" />
                  <button
                    className="w-full text-left px-4 py-2 text-sm text-error hover:bg-red-500/10 transition-colors flex items-center gap-2"
                    onClick={() => {
                      void auth.signOut().finally(() => {
                        navigate('/login');
                        setIsUserMenuOpen(false);
                      });
                    }}
                  >
                    <LogOut className="w-4 h-4" />
                    Log out
                  </button>
                </div>
              )}
              <button
                onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                className="w-full flex items-center hover:bg-surface-hover transition-colors text-left focus:outline-none px-2.5 py-3 gap-3 overflow-hidden"
                title="User Menu"
              >
                <div className="w-8 h-8 rounded-full bg-surface-hover border border-strong flex items-center justify-center shrink-0">
                  <User className="w-4 h-4 text-muted" />
                </div>
                <span
                  className={cn(
                    textClass,
                    'text-sm font-medium text-[var(--foreground)] truncate',
                  )}
                >
                  {displayName}
                </span>
                <MoreVertical
                  className={cn(
                    'w-4 h-4 text-muted shrink-0 ml-auto transition-opacity duration-100',
                    isOpen ? 'opacity-100' : 'opacity-0',
                  )}
                />
              </button>
            </div>
          </div>
        </div>

        <div className="absolute top-4 right-2.5 z-50">
          <button
            onClick={isOpen ? onClose : onOpen}
            className="w-8 h-8 flex items-center justify-center rounded-md text-muted hover:text-[var(--foreground)] hover:bg-surface-hover transition-colors shrink-0 focus:outline-none"
            title={isOpen ? 'Collapse Sidebar' : 'Expand Sidebar'}
          >
            <PanelLeft
              className={cn(
                'w-4 h-4 transition-transform duration-300',
                !isOpen && 'rotate-180',
              )}
            />
          </button>
        </div>
      </div>
    </>
  );
}

import { useState, useEffect } from 'react';
import { Plus, CheckCircle2, Settings } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { auth } from '../lib/auth';
import { DbAPI } from '../lib/db';
import { INTEGRATIONS } from '../integrations/registry';

export default function Integrations() {
  const [activeModal, setActiveModal] = useState<string | null>(null);

  const [connections, setConnections] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let unsubscribes: Array<() => void> = [];

    const unsubscribeAuth = auth.onAuthStateChanged((user) => {
      // Clear previous subscriptions when auth state changes
      unsubscribes.forEach((unsub) => {
        if (typeof unsub === 'function') {
          try {
            unsub();
          } catch (e) {
            console.error('Failed to unsubscribe', e);
          }
        }
      });
      unsubscribes = [];

      if (!user) return;

      unsubscribes = INTEGRATIONS.map((integration) => {
        // Only check status for integrations that have settings modals (custom auth)
        if (!integration.SettingsModal) return () => {};
        const authPath = integration.getAuthPath
          ? integration.getAuthPath(user.uid)
          : '';

        if (authPath.includes('cloud_credentials')) {
          if (typeof DbAPI.subscribeToCloudCredential === 'function') {
            return DbAPI.subscribeToCloudCredential(
              user.uid,
              integration.id,
              (exists) => {
                setConnections((prev) => ({
                  ...prev,
                  [integration.id]: exists,
                }));
              },
            );
          } else {
            console.error(
              'DbAPI.subscribeToCloudCredential is not a function. HMR issue?',
            );
            return () => {};
          }
        }

        return DbAPI.subscribeToIntegration(
          user.uid,
          integration.id,
          (exists) => {
            setConnections((prev) => ({ ...prev, [integration.id]: exists }));
          },
        );
      });
    });

    return () => {
      unsubscribeAuth();
      unsubscribes.forEach((unsub) => {
        if (typeof unsub === 'function') {
          try {
            unsub();
          } catch (e) {
            console.error('Failed to unsubscribe', e);
          }
        }
      });
    };
  }, []);

  const displayIntegrations = INTEGRATIONS.filter(
    (i) => i.showInIntegrationsPage !== false,
  );

  return (
    <>
      {INTEGRATIONS.map((integration) => {
        if (!integration.SettingsModal) return null;
        const ModalComponent = integration.SettingsModal;
        return (
          <ModalComponent
            key={integration.id}
            isOpen={activeModal === integration.id}
            onClose={() => setActiveModal(null)}
          />
        );
      })}

      <main className="max-w-6xl mx-auto p-8 w-full">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-[var(--foreground)] tracking-tight">
              Connected Integrations
            </h2>
            <p className="text-muted mt-1">
              Manage external services and tools connected to your workspace.
            </p>
          </div>
          <Button variant="primary">
            <Plus className="w-4 h-4 mr-2" />
            Add Custom Integration
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {displayIntegrations.map((integration) => {
            const isConnected =
              connections[integration.id] ?? integration.connected;
            const isDisabled = Boolean(integration.disabled);

            return (
              <div
                key={integration.id}
                className="bg-surface border border-subtle rounded-xl p-5 hover:border-strong transition-colors group flex flex-col items-start text-left"
              >
                <div className="flex items-center justify-between w-full mb-4 gap-3">
                  <div className="w-12 h-12 rounded-lg bg-background border border-subtle flex items-center justify-center p-2 shadow-sm">
                    {integration.icon ? (
                      typeof integration.icon === 'string' ? (
                        integration.iconRenderMode === 'mask' ? (
                          <div
                            className="w-full h-full bg-current"
                            style={{
                              WebkitMaskImage: `url(${integration.icon})`,
                              WebkitMaskSize: 'contain',
                              WebkitMaskRepeat: 'no-repeat',
                              WebkitMaskPosition: 'center',
                              maskImage: `url(${integration.icon})`,
                              maskSize: 'contain',
                              maskRepeat: 'no-repeat',
                              maskPosition: 'center',
                            }}
                          />
                        ) : (
                          <img
                            src={integration.icon}
                            alt={integration.name}
                            className="w-full h-full object-contain"
                          />
                        )
                      ) : (
                        <integration.icon className="w-6 h-6" />
                      )
                    ) : (
                      <div className="text-lg font-bold text-muted">
                        {integration.name[0]}
                      </div>
                    )}
                  </div>
                  {isConnected ? (
                    <span className="flex items-center gap-1 text-xs font-medium text-emerald-500 bg-emerald-500/10 px-2 py-1 rounded-full">
                      <CheckCircle2 className="w-3 h-3" />
                      Connected
                    </span>
                  ) : isDisabled ? (
                    <Badge
                      variant="outline"
                      className="uppercase tracking-wide"
                    >
                      COMING SOON
                    </Badge>
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        if (integration.SettingsModal)
                          setActiveModal(integration.id);
                      }}
                    >
                      Connect
                    </Button>
                  )}
                </div>
                <div className="flex-1">
                  <h3 className="text-base font-semibold text-[var(--foreground)]">
                    {integration.name}
                  </h3>
                  <p className="text-sm text-muted mt-1 line-clamp-2">
                    {integration.description}
                  </p>
                  {isDisabled ? (
                    <p className="text-xs text-muted mt-3">
                      {integration.disabledReason}
                    </p>
                  ) : null}
                </div>
                <div className="mt-4 pt-4 border-t border-subtle -mx-5 px-5 flex items-center justify-between self-stretch">
                  <span className="text-xs font-medium text-muted uppercase tracking-wider">
                    {integration.category}
                  </span>
                  {integration.SettingsModal && !isDisabled && (
                    <button
                      onClick={() => setActiveModal(integration.id)}
                      className="p-1 rounded-md text-muted hover:text-[var(--foreground)] transition-colors opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                    >
                      <Settings className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </main>
    </>
  );
}

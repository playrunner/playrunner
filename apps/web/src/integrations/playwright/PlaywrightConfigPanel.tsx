import React, { useEffect, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import { Select } from "../../components/ui/Select";
import { Input } from "../../components/ui/Input";
import { cn } from "../../lib/utils";
import { playwrightRunnerConfig } from "../../config/playwrightRunnerConfig";

const DEFAULT_PLAYWRIGHT_VERSION = playwrightRunnerConfig.defaultTag;
const PLAYWRIGHT_VERSION_OPTIONS = playwrightRunnerConfig.versions;
const DEFAULT_CPU = 2;
const DEFAULT_MEMORY = 4;

function inferPlaywrightRuntime(config: Record<string, any>): "typescript" | "python" {
  if (config.action === "upload" || config.action === "run") {
    return "typescript";
  }
  if (config.testLanguage === "python") {
    return "python";
  }
  return "typescript";
}

export const PlaywrightConfigPanel: React.FC<{
  config: Record<string, any>;
  onChange: (nodeId: string, newConfig: Record<string, any>) => void;
  nodeId: string;
  isConnected: boolean;
  onConnectOAuth?: (providerId?: string) => void;
  integrationData?: any; // We might need to pass this or fetch it
}> = ({ config, onChange, nodeId, isConnected, integrationData, onConnectOAuth }) => {
  const [repositories, setRepositories] = useState<{ id: string; full_name: string }[]>([]);
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [isLoadingRepos, setIsLoadingRepos] = useState(false);
  const [isLoadingBranches, setIsLoadingBranches] = useState(false);
  const [activeTab, setActiveTab] = useState<"config" | "env" | "resources">("config");
  const latestConfigRef = useRef(config);

  useEffect(() => {
    latestConfigRef.current = config;
  }, [config]);

  useEffect(() => {
    const updates: Record<string, any> = {};
    let shouldUpdate = false;
    
    if (config.action === "run" && !config.testScript) {
      updates.testScript = `import { test, expect } from '@playwright/test';

test.describe('navigation', () => {
  test.beforeEach(async ({ page }) => {
    // Go to the starting url before each test.
    await page.goto('https://playwright.dev/');
  });

  test('main navigation', async ({ page }) => {
    // Assertions use the expect API.
    await expect(page).toHaveURL('https://playwright.dev/');
  });
});`;
      shouldUpdate = true;
    }
    
    if (!config.playwrightVersion) {
      updates.playwrightVersion = DEFAULT_PLAYWRIGHT_VERSION;
      shouldUpdate = true;
    }

    if (!config.cpu) {
      updates.cpu = DEFAULT_CPU;
      shouldUpdate = true;
    }

    if (!config.memory) {
      updates.memory = DEFAULT_MEMORY;
      shouldUpdate = true;
    }

    const inferredRuntime = inferPlaywrightRuntime(latestConfigRef.current);
    if (config.testLanguage !== inferredRuntime) {
      updates.testLanguage = inferredRuntime;
      shouldUpdate = true;
    }
    
    if (shouldUpdate) {
      onChange(nodeId, { ...latestConfigRef.current, ...updates });
    }
  }, [config.action, config.cpu, config.memory, config.testScript, config.playwrightVersion, config.testLanguage, nodeId, onChange]);

  useEffect(() => {
    async function fetchRepos() {
      if (!integrationData?.accessToken) return;
      setIsLoadingRepos(true);
      try {
        const res = await fetch("https://api.github.com/user/installations", {
          headers: {
            Authorization: `Bearer ${integrationData.accessToken}`,
            Accept: "application/vnd.github.v3+json"
          }
        });
        const data = await res.json();
        if (data.installations && data.installations.length > 0) {
           let allRepos: any[] = [];
           for (const inst of data.installations) {
             const repoRes = await fetch(`https://api.github.com/user/installations/${inst.id}/repositories`, {
                headers: {
                   Authorization: `Bearer ${integrationData.accessToken}`,
                   Accept: "application/vnd.github.v3+json"
                }
             });
             const repoData = await repoRes.json();
             if (repoData.repositories) {
               allRepos = [...allRepos, ...repoData.repositories];
             }
           }
           setRepositories(allRepos);
        }
      } catch (err) {
        console.error("Failed to fetch repositories:", err);
      } finally {
        setIsLoadingRepos(false);
      }
    }
    fetchRepos();
  }, [integrationData?.accessToken]);

  useEffect(() => {
    async function fetchBranches() {
      if (!integrationData?.accessToken || !config.repository) return;
      setIsLoadingBranches(true);
      try {
        const res = await fetch(`https://api.github.com/repos/${config.repository}/branches`, {
          headers: {
            Authorization: `Bearer ${integrationData.accessToken}`,
            Accept: "application/vnd.github.v3+json"
          }
        });
        const data = await res.json();
        if (Array.isArray(data)) {
           setBranches(data);
        }
      } catch (err) {
        console.error("Failed to fetch branches:", err);
      } finally {
        setIsLoadingBranches(false);
      }
    }
    fetchBranches();
  }, [integrationData?.accessToken, config.repository]);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const data = e.dataTransfer.getData('text/plain');
    if (data && data.startsWith('process.env.')) {
      const varName = data.replace('process.env.', '');
      const existingVars = config.envVars || [];
      if (!existingVars.includes(varName)) {
        onChange(nodeId, { ...config, envVars: [...existingVars, varName] });
      }
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  return (
    <>
      <div className="flex items-center gap-2 mt-6 mb-4 overflow-x-auto pb-1 scrollbar-hide">
        <button
          onClick={() => setActiveTab("config")}
          className={cn(
            "px-3 py-1.5 rounded-full text-[13px] font-medium transition-colors focus:outline-none select-none",
            activeTab === "config"
              ? "bg-[var(--node-bg)] text-[var(--foreground)] border border-[var(--node-border)]"
              : "bg-[var(--control-bg)] text-muted border border-transparent hover:text-[var(--foreground)]"
          )}
        >
          Configuration
        </button>
        <button
          onClick={() => setActiveTab("env")}
          className={cn(
            "px-3 py-1.5 rounded-full text-[13px] font-medium transition-colors focus:outline-none select-none",
            activeTab === "env"
              ? "bg-[var(--node-bg)] text-[var(--foreground)] border border-[var(--node-border)]"
              : "bg-[var(--control-bg)] text-muted border border-transparent hover:text-[var(--foreground)]"
          )}
        >
          Environment
        </button>
        <button
          onClick={() => setActiveTab("resources")}
          className={cn(
            "px-3 py-1.5 rounded-full text-[13px] font-medium transition-colors focus:outline-none select-none",
            activeTab === "resources"
              ? "bg-[var(--node-bg)] text-[var(--foreground)] border border-[var(--node-border)]"
              : "bg-[var(--control-bg)] text-muted border border-transparent hover:text-[var(--foreground)]"
          )}
        >
          Resources
        </button>
      </div>

      {!config.dismissedLanguageInfo && (
        <div className="bg-[var(--background)] border border-subtle rounded-md p-2.5 flex gap-2.5 items-start mb-4 relative group pr-8">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted mt-0.5 shrink-0"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
          <div className="text-[11px] text-muted leading-relaxed space-y-1">
            <p><span className="text-[var(--foreground)] font-medium">Language Support:</span> We currently support <strong>Python and TypeScript</strong> for cloned repositories, and <strong>TypeScript only</strong> for Zip uploads.</p>
            <p><span className="text-[var(--foreground)] font-medium">Azure Playwright Testing:</span> For TypeScript, if a <code className="text-[10px] font-mono text-muted bg-[#18181b] px-1 py-0.5 rounded border border-subtle">playwright.service.config.ts</code> is detected alongside your standard config, it will be automatically executed. For Python, standard <code className="text-[10px] font-mono text-muted bg-[#18181b] px-1 py-0.5 rounded border border-subtle">pytest.ini</code> and <code className="text-[10px] font-mono text-muted bg-[#18181b] px-1 py-0.5 rounded border border-subtle">conftest.py</code> configurations are supported.</p>
          </div>
          <button 
            onClick={() => onChange(nodeId, { ...config, dismissedLanguageInfo: true })}
            className="absolute top-2.5 right-2.5 text-muted hover:text-[var(--foreground)] transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
      )}

      <div>
        {activeTab === "config" && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted">Action</label>
              <Select 
                value={config.action || "clone"}
                onChange={(e) => {
                  const nextAction = e.target.value;
                  const updates: Record<string, any> = { ...config, action: nextAction };
                  if (nextAction === "run" && !config.testScript) {
                    updates.testScript = `import { test, expect } from '@playwright/test';

test.describe('navigation', () => {
  test.beforeEach(async ({ page }) => {
    // Go to the starting url before each test.
    await page.goto('https://playwright.dev/');
  });

  test('main navigation', async ({ page }) => {
    // Assertions use the expect API.
    await expect(page).toHaveURL('https://playwright.dev/');
  });
});`;
                  }
                  onChange(nodeId, updates);
                }}
              >
                <option value="clone">Clone repository and then run</option>
                <option value="run">Run playwright script</option>
                <option value="upload">Upload a zip file</option>
              </Select>
            </div>
            
            {(config.action === "clone" || !config.action) && (
              <>
                <div className="bg-[var(--background)] border border-subtle rounded-lg p-4 space-y-4">
                  <div className="flex items-center justify-between border-b border-subtle pb-2">
                    <h4 className="text-sm font-medium text-[var(--foreground)]">Authentication</h4>
                    {isConnected ? (
                      <button 
                        onClick={() => onConnectOAuth?.()}
                        className="text-xs bg-[var(--control-bg)] hover:bg-[var(--surface-hover)] border border-[var(--border)] px-3 py-1 rounded-md text-[var(--foreground)] transition-colors font-medium"
                      >
                        Configure Connection
                      </button>
                    ) : (
                      <select
                        defaultValue=""
                        onChange={(e) => {
                           if (e.target.value) {
                               onChange(nodeId, { ...config, authProvider: e.target.value });
                               onConnectOAuth?.(e.target.value);
                           }
                           e.target.value = "";
                        }}
                        className="text-xs bg-[var(--control-bg)] hover:bg-[var(--surface-hover)] border border-[var(--border)] px-2 py-1 rounded-md text-[var(--foreground)] transition-colors font-medium appearance-none focus:outline-none focus:border-[var(--border-strong)] focus:ring-1 focus:ring-[var(--border-strong)]"
                        style={{ paddingRight: '1rem' }}
                      >
                        <option value="" disabled>Connect Provider...</option>
                        <option value="github">GitHub</option>
                        <option value="bitbucket" disabled>Bitbucket (coming soon)</option>
                      </select>
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                       <div className={cn("w-2 h-2 rounded-full", isConnected ? "bg-green-400" : "bg-red-400")}></div>
                       <span className="text-sm text-[var(--foreground)]">
                         {isConnected ? `Connected (${config.authProvider ? config.authProvider.charAt(0).toUpperCase() + config.authProvider.slice(1) : "GitHub"})` : "Not Connected"}
                       </span>
                    </div>
                  </div>
                  <p className="text-xs text-muted">Connect your account to allow this node to perform actions on your behalf.</p>
                </div>
                
                <div className="space-y-1.5 pt-2">
                  <label className="text-xs font-medium text-muted">Repository</label>
                  <Select
                    value={config.repository || ""}
                    onChange={(e) => onChange(nodeId, { ...config, repository: e.target.value })}
                    disabled={isLoadingRepos || !isConnected}
                  >
                    <option value="">{isLoadingRepos ? "Loading repositories..." : "Select Repository"}</option>
                    {repositories.map(repo => (
                      <option key={repo.id} value={repo.full_name}>{repo.full_name}</option>
                    ))}
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted">Branch</label>
                  <Select
                    value={config.branch || ""}
                    onChange={(e) => onChange(nodeId, { ...config, branch: e.target.value })}
                    disabled={isLoadingBranches || !config.repository}
                  >
                    <option value="">{isLoadingBranches ? "Loading branches..." : "Select Branch"}</option>
                    {branches.map(branch => (
                      <option key={branch.name} value={branch.name}>{branch.name}</option>
                    ))}
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted">Runtime</label>
                  <Select
                    value={config.testLanguage || "typescript"}
                    onChange={(e) => onChange(nodeId, { ...config, testLanguage: e.target.value })}
                    disabled={!config.repository}
                  >
                    <option value="typescript">TypeScript</option>
                    <option value="python">Python</option>
                  </Select>
                  <p className="text-[10px] text-muted">Choose the runtime image used for this repository run.</p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted">Folder</label>
                  <Input
                    value={config.folder || "/"}
                    onChange={(e) => onChange(nodeId, { ...config, folder: e.target.value })}
                    placeholder="/"
                    disabled={!config.repository}
                  />
                  <p className="text-[10px] text-muted">Specific directory within the repo to run tests from.</p>
                </div>
              </>
            )}

            {config.action === "run" && (
              <div className="flex flex-col gap-1.5 shrink-0">
                <div className="rounded-xl border border-subtle bg-[#1e1e1e] overflow-hidden resize-y min-h-[250px] h-[350px]">
                  <Editor
                    height="100%"
                    defaultLanguage="javascript"
                    theme="vs-dark"
                    value={config.testScript || ""}
                    onChange={(value) => onChange(nodeId, { ...config, testScript: value || "" })}
                    options={{
                      minimap: { enabled: false },
                      fontSize: 13,
                      fontFamily: "var(--font-mono)",
                      lineNumbers: "on",
                      scrollBeyondLastLine: false,
                      wordWrap: "on",
                      padding: { top: 16, bottom: 16 },
                      tabSize: 2,
                      dragAndDrop: true,
                      dropIntoEditor: { enabled: true }
                    }}
                  />
                </div>
                <p className="text-[10px] text-muted mt-1">
                  The test will run in a headless browser on our infrastructure. You can drag environment variables directly from the panel into the editor.
                </p>
                <p className="text-[10px] text-muted">Inline scripts always run in the TypeScript Playwright runner.</p>
              </div>
            )}

            {config.action === "upload" && (
              <>
                <div className="relative border-2 border-dashed border-subtle rounded-xl p-8 flex flex-col items-center justify-center gap-3 bg-surface/50 hover:bg-surface transition-colors cursor-pointer group">
                  <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center text-[var(--foreground)] group-hover:scale-110 transition-transform">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg>
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-medium text-[var(--foreground)]">Click to upload or drag and drop</p>
                    <p className="text-xs text-muted mt-1">ZIP files up to 50MB</p>
                  </div>
                  <input 
                    type="file" 
                    accept=".zip"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        onChange(nodeId, { ...config, zipFileName: file.name });
                      }
                    }}
                    id="zip-upload"
                  />
                  <label htmlFor="zip-upload" className="absolute inset-0 cursor-pointer" />
                </div>
                
                {config.zipFileName && (
                  <div className="flex items-center gap-2 p-2 bg-surface border border-subtle rounded-md">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg>
                    <span className="text-xs text-[var(--foreground)] truncate">{config.zipFileName}</span>
                  </div>
                )}

                <div className="bg-[var(--background)] border border-subtle rounded-lg p-3 space-y-3">
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-[var(--foreground)]">Upload Requirements</p>
                    <ul className="text-[11px] text-muted space-y-1.5 list-disc pl-4">
                      <li>Currently only supports <strong>TypeScript</strong>.</li>
                      <li>Zip the files from <strong>within</strong> the directory containing your config (do not zip the parent folder itself).</li>
                      <li><span className="text-red-400 font-medium">Do not include:</span> test-data, test-results, archives, reports, or auth files.</li>
                      <li><span className="text-red-400 font-medium">Do not include .env files.</span> Variables must be set via an connected Environment node.</li>
                    </ul>
                  </div>
                  
                  <div className="bg-[#18181b] border border-subtle rounded-md p-2 font-mono text-[10px] text-muted leading-relaxed">
                    <p className="text-[var(--foreground)] mb-1.5 font-medium font-sans">Expected ZIP Structure:</p>
                    <div>root.zip/</div>
                    <div>├── playwright.config.ts          <span className="text-green-400/80">(required)</span></div>
                    <div>├── playwright.service.config.ts  <span className="text-muted/80">(optional)</span></div>
                    <div>├── package.json                  <span className="text-green-400/80">(required)</span></div>
                    <div>├── package-lock.json             <span className="text-green-400/80">(required)</span></div>
                    <div>├── tests/</div>
                    <div>│   └── example.spec.ts</div>
                    <div>└── helpers/</div>
                    <div>    └── my-pom.ts</div>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {activeTab === "env" && (
          <div className="space-y-6">
            <div className="space-y-1.5">
              <label className="text-[10px] font-medium text-muted uppercase tracking-wider">Playwright Version</label>
              <Select 
                value={config.playwrightVersion || DEFAULT_PLAYWRIGHT_VERSION}
                onChange={(e) => onChange(nodeId, { ...config, playwrightVersion: e.target.value })}
                className="bg-[var(--background)] border-subtle text-sm"
              >
                {PLAYWRIGHT_VERSION_OPTIONS.map((version) => (
                  <option key={version.tag} value={version.tag}>
                    {version.label}
                  </option>
                ))}
              </Select>
              <p className="text-[10px] text-muted">Select the version of Playwright to use for this runner container.</p>
            </div>
            
            <div className="space-y-3">
              <label className="text-xs font-medium text-muted">Injected Environment Variables</label>
              <div 
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                className="min-h-[80px] border-2 border-dashed border-subtle rounded-xl p-4 flex flex-col gap-2 bg-surface/30 transition-colors hover:bg-surface/50 relative group"
              >
                {(!config.envVars || config.envVars.length === 0) && (
                  <div className="absolute inset-0 flex items-center justify-center text-xs text-muted pointer-events-none">
                    Drag variables from the Input panel here
                  </div>
                )}
                {config.envVars && config.envVars.length > 0 && (
                  <div className="flex flex-wrap gap-2 relative z-10">
                    {config.envVars.map((v: string) => (
                      <div key={v} className="bg-[#18181b] border border-subtle rounded px-2 py-1 flex items-center gap-2 group/tag cursor-default">
                        <span className="text-[10px] font-mono text-muted">env.{v}</span>
                        <button 
                          onClick={(e) => {
                             e.stopPropagation();
                             onChange(nodeId, { ...config, envVars: config.envVars.filter((ev: string) => ev !== v) });
                          }}
                          className="text-muted hover:text-red-400 opacity-0 group-hover/tag:opacity-100 transition-opacity"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <p className="text-[10px] text-muted leading-relaxed">
                These variables will be injected directly into the container environment when running your tests.
              </p>
            </div>
          </div>
        )}

        {activeTab === "resources" && (
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-medium text-muted uppercase tracking-wider">CPU</label>
              <Select 
                value={config.cpu || DEFAULT_CPU}
                onChange={(e) => onChange(nodeId, { ...config, cpu: parseInt(e.target.value) })}
                className="bg-[var(--background)] border-subtle text-sm"
              >
                <option value={1}>1 CPU</option>
                <option value={2}>2 CPUs</option>
                <option value={4}>4 CPUs</option>
                <option value={8}>8 CPUs</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-medium text-muted uppercase tracking-wider">Memory</label>
              <Select 
                value={config.memory || DEFAULT_MEMORY}
                onChange={(e) => onChange(nodeId, { ...config, memory: parseFloat(e.target.value) })}
                className="bg-[var(--background)] border-subtle text-sm"
              >
                <option value={0.5}>512 MB</option>
                <option value={1}>1 GB</option>
                <option value={2}>2 GB</option>
                <option value={4}>4 GB</option>
                <option value={8}>8 GB</option>
                <option value={16}>16 GB</option>
                <option value={32}>32 GB</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-medium text-muted uppercase tracking-wider">Workers (Max 100)</label>
              <Input 
                type="number"
                min={1}
                max={100}
                value={config.workers || 1}
                onChange={(e) => onChange(nodeId, { ...config, workers: Math.min(100, Math.max(1, parseInt(e.target.value) || 1)) })}
                className="bg-[var(--background)] border-subtle text-sm"
              />
            </div>
          </div>
        )}
      </div>

    </>
  );
};

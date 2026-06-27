import { useState } from 'react';
import {
  Search,
  CheckCircle2,
  AlertCircle,
  Settings,
  Plus,
  Maximize,
  Trash2,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button, Input, Select, Textarea, Badge } from '../components/ui';

import { MultiSelectDropdown } from '../components/MultiSelectDropdown';

export default function DesignSystem() {
  const navigate = useNavigate();
  const [selectedBrowsers, setSelectedBrowsers] = useState<string[]>([
    'chrome',
  ]);

  return (
    <div className="min-h-screen bg-background text-foreground font-sans">
      <div className="max-w-7xl mx-auto p-8 w-full space-y-16 pb-32">
        <header className="flex items-center justify-between border-b border-subtle pb-6">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-[var(--foreground)] mb-2">
              Design System
            </h1>
            <p className="text-muted text-sm">
              Component library for Playrunner prototype.
            </p>
          </div>
          <button
            onClick={() => navigate('/editor')}
            className="text-sm font-medium text-muted hover:text-[var(--foreground)] transition-colors"
          >
            ← Back to App
          </button>
        </header>

        {/* --- Buttons --- */}
        <section className="space-y-6">
          <div className="border-b border-subtle pb-2">
            <h2 className="text-xl font-medium text-[var(--foreground)] mb-1">
              Buttons
            </h2>
            <p className="text-sm text-muted">
              Primary, secondary, and tertiary actions.
            </p>
          </div>

          <div className="flex flex-wrap gap-6 items-end">
            <div className="space-y-2">
              <label className="text-xs font-semibold text-muted uppercase tracking-wider block">
                Primary
              </label>
              <Button variant="primary">Save changes</Button>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-muted uppercase tracking-wider block">
                Secondary
              </label>
              <Button variant="secondary">Cancel</Button>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-muted uppercase tracking-wider block">
                Tertiary / Ghost
              </label>
              <Button variant="tertiary">Learn more</Button>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-muted uppercase tracking-wider block">
                Danger
              </label>
              <Button variant="danger">Delete Project</Button>
            </div>
          </div>

          <div className="flex flex-wrap gap-6 items-end mt-4">
            <div className="space-y-2">
              <label className="text-xs font-semibold text-muted uppercase tracking-wider block">
                With Icon
              </label>
              <Button variant="secondary" className="gap-2">
                <Plus className="w-4 h-4" />
                Add Node
              </Button>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-muted uppercase tracking-wider block">
                Icon Only (Ghost)
              </label>
              <div className="flex gap-2">
                <Button variant="ghost" size="icon">
                  <Settings className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="icon">
                  <Maximize className="w-4 h-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="hover:text-red-400 hover:bg-red-500/10"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>
        </section>

        {/* --- Inputs & Forms --- */}
        <section className="space-y-8">
          <div className="border-b border-subtle pb-2">
            <h2 className="text-xl font-medium text-[var(--foreground)] mb-1">
              Inputs & Forms
            </h2>
            <p className="text-sm text-muted">
              Text fields, text areas, selects, and states.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-[var(--foreground)] block">
                  Standard Input
                </label>
                <Input placeholder="Enter project name..." />
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-[var(--foreground)] block">
                  Disabled Input
                </label>
                <Input value="user@example.com" disabled />
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-[var(--foreground)] block">
                  With Icon
                </label>
                <Input
                  placeholder="Search workflows..."
                  icon={<Search className="w-4 h-4" />}
                />
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-[var(--foreground)] block">
                  Select Box
                </label>
                <Select>
                  <option>Playwright</option>
                  <option>Cypress</option>
                  <option>Selenium</option>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-[var(--foreground)] block">
                  Multi-Select Checkboxes
                </label>
                <MultiSelectDropdown
                  options={[
                    { value: 'chrome', label: 'Chrome' },
                    { value: 'firefox', label: 'Firefox' },
                    { value: 'safari', label: 'Safari' },
                    { value: 'edge', label: 'Edge' },
                  ]}
                  selectedValues={selectedBrowsers}
                  onChange={setSelectedBrowsers}
                  placeholder="Select browsers"
                />
              </div>

              <div className="space-y-1.5 flex flex-col">
                <label className="text-sm font-medium text-[var(--foreground)] block">
                  Text Area
                </label>
                <Textarea
                  placeholder="Add a description..."
                  className="min-h-[96px]"
                />
              </div>
            </div>
          </div>
        </section>

        {/* --- Colors --- */}
        <section className="space-y-6">
          <div className="border-b border-subtle pb-2">
            <h2 className="text-xl font-medium text-[var(--foreground)] mb-1">
              Colors
            </h2>
            <p className="text-sm text-muted">
              Core theme colors including node elements.
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="space-y-2">
              <div className="h-16 rounded-lg bg-[var(--node-bg)] border border-[var(--node-border)]"></div>
              <div>
                <p className="text-sm font-medium text-[var(--foreground)]">
                  Node Background
                </p>
                <p className="text-xs text-[var(--muted)] font-mono">
                  var(--node-bg)
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <div className="h-16 rounded-lg bg-[var(--node-border)]"></div>
              <div>
                <p className="text-sm font-medium text-[var(--foreground)]">
                  Node Border
                </p>
                <p className="text-xs text-[var(--muted)] font-mono">
                  var(--node-border)
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <div className="h-16 rounded-lg bg-[var(--accent)] border border-[var(--border)]"></div>
              <div>
                <p className="text-sm font-medium text-[var(--foreground)]">
                  Accent
                </p>
                <p className="text-xs text-[var(--muted)] font-mono">
                  var(--accent)
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <div className="h-16 rounded-lg bg-[var(--surface)] border border-[var(--border)]"></div>
              <div>
                <p className="text-sm font-medium text-[var(--foreground)]">
                  Surface
                </p>
                <p className="text-xs text-[var(--muted)] font-mono">
                  var(--surface)
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <div className="h-16 rounded-lg bg-[var(--control-bg)] border border-[var(--border)]"></div>
              <div>
                <p className="text-sm font-medium text-[var(--foreground)]">
                  Control Background
                </p>
                <p className="text-xs text-[var(--muted)] font-mono">
                  var(--control-bg)
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* --- Typography --- */}
        <section className="space-y-6">
          <div className="border-b border-subtle pb-2">
            <h2 className="text-xl font-medium text-[var(--foreground)] mb-1">
              Typography
            </h2>
            <p className="text-sm text-muted">
              Font sans (Inter) and monospace (JetBrains Mono).
            </p>
          </div>

          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6 space-y-8">
            <div className="space-y-2">
              <span className="text-xs font-mono text-muted">
                text-3xl font-semibold tracking-tight
              </span>
              <h1 className="text-3xl font-semibold tracking-tight text-[var(--foreground)] leading-tight">
                Test Orchestration
              </h1>
            </div>

            <div className="space-y-2">
              <span className="text-xs font-mono text-muted">
                text-xl font-medium
              </span>
              <h2 className="text-xl font-medium text-[var(--foreground)] leading-snug">
                Connect your entire testing stack without code.
              </h2>
            </div>

            <div className="space-y-2">
              <span className="text-xs font-mono text-muted">
                text-sm text-muted leading-relaxed
              </span>
              <p className="text-sm text-muted leading-relaxed max-w-2xl">
                Playrunner is a no-code workflow builder for test orchestration.
                Design your testing pipelines using a visual editor. Drag and
                drop nodes to connect Playwright, Cypress, and Selenium testing
                suites together with automated reporting to Slack and Jira.
              </p>
            </div>

            <div className="space-y-2">
              <span className="text-xs font-mono text-muted">
                font-mono text-xs text-[var(--foreground)]
              </span>
              <div className="font-mono text-xs text-[var(--foreground)] bg-[var(--surface-hover)] p-3 rounded-lg border border-[var(--border)] w-fit">
                npm install @playrunner/cli --save-dev
              </div>
            </div>
          </div>
        </section>

        {/* --- Surfaces & Badges --- */}
        <section className="space-y-6">
          <div className="border-b border-subtle pb-2">
            <h2 className="text-xl font-medium text-[var(--foreground)] mb-1">
              Surfaces & Badges
            </h2>
            <p className="text-sm text-muted">Cards, containers, statuses.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-[var(--surface)] border border-[var(--border)] hover:border-[var(--border-strong)] transition-colors rounded-xl p-5 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded shrink-0 bg-[var(--surface-hover)] border border-[var(--border)] flex items-center justify-center">
                    <span className="text-[10px] font-mono font-medium tracking-wider">
                      PW
                    </span>
                  </div>
                  <h3 className="font-medium text-sm text-[var(--foreground)]">
                    E2E Tests
                  </h3>
                </div>
                <Badge variant="success">
                  <CheckCircle2 className="w-3 h-3" />
                  Passed
                </Badge>
              </div>
              <p className="text-xs text-muted leading-relaxed">
                Runs critical user paths in staging environment before
                deployment.
              </p>
            </div>

            <div className="bg-[var(--surface)] border border-[var(--border)] hover:border-[var(--border-strong)] transition-colors rounded-xl p-5 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded shrink-0 bg-[var(--surface-hover)] border border-[var(--border)] flex items-center justify-center">
                    <span className="text-[10px] font-mono font-medium tracking-wider">
                      API
                    </span>
                  </div>
                  <h3 className="font-medium text-sm text-[var(--foreground)]">
                    Payment Gateway
                  </h3>
                </div>
                <Badge variant="danger">
                  <AlertCircle className="w-3 h-3" />
                  Failed
                </Badge>
              </div>
              <p className="text-xs text-muted leading-relaxed">
                Validates Stripe webhook endpoints with simulated payload.
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

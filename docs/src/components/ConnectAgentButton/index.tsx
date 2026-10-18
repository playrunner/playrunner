import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import Link from '@docusaurus/Link';
import styles from './styles.module.css';

const setupPrompt = `Connect Playrunner so you can run tests in the background and use the results to verify your work.

First, set up the Playrunner CLI on my computer. Check that Node.js 20 or later and npm are available. If the CLI is missing, install it with npm install --global playrunner@latest. Verify the installation with playrunner --version and playrunner --help. If prerequisites are missing or you cannot run local commands, guide me through the steps in https://playrunner.dev/docs/cli/ and wait for me to complete them.

Check for Playrunner tools. If unavailable, follow https://playrunner.dev/docs/mcp/connect/ to add https://playrunner.cloud/mcp using Streamable HTTP and OAuth. Preserve existing settings and follow the client-specific instructions. If you cannot configure this client, show me the setup steps and wait for connection. Keep sign-in, consent and secrets in the browser, never this chat.

Once connected, call get_account first and help me complete any returned onboarding handoff. Discover existing projects and workflows. Use this project's context and ask only for missing choices: repository, environment, test scope and compute. Reuse a suitable workflow, or read get_authoring_guide before helping create one.

Help me prepare a first run. When I ask you to start it, retain the execution ID so you can continue other work and retrieve the results later. Report actual test evidence and artifact links, investigate failures and propose the next action.`;

export default function ConnectAgentButton({
  className,
}: {
  className?: string;
}): ReactNode {
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>(
    'idle',
  );

  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  useEffect(() => {
    if (copyState !== 'copied') return;
    const timeout = window.setTimeout(() => setCopyState('idle'), 2500);
    return () => window.clearTimeout(timeout);
  }, [copyState]);

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(setupPrompt);
      setCopyState('copied');
    } catch {
      promptRef.current?.focus();
      promptRef.current?.select();
      setCopyState('error');
    }
  }

  return (
    <>
      <button
        type="button"
        className={className}
        aria-haspopup="dialog"
        onClick={() => {
          setCopyState('idle');
          dialogRef.current?.showModal();
          setIsOpen(true);
        }}
      >
        Connect your AI agent <span aria-hidden="true">↗</span>
      </button>
      <dialog
        ref={dialogRef}
        className={styles.dialog}
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-description`}
        onClose={() => setIsOpen(false)}
        onClick={(event) => {
          if (event.target !== event.currentTarget) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < bounds.left ||
            event.clientX > bounds.right ||
            event.clientY < bounds.top ||
            event.clientY > bounds.bottom
          ) {
            dialogRef.current?.close();
          }
        }}
      >
        <button
          type="button"
          className={styles.closeButton}
          onClick={() => dialogRef.current?.close()}
          aria-label="Close setup prompt"
          title="Close"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m6 6 12 12M6 18 18 6" />
          </svg>
        </button>
        <p className={styles.eyebrow}>For your AI agent</p>
        <h2 id={`${id}-title`} className={styles.title}>
          Start with a prompt.
        </h2>
        <p id={`${id}-description`} className={styles.description}>
          Paste this into Codex, Claude, Cursor, Gemini CLI, Antigravity or Grok
          Build. Your agent will guide you through installing the Playrunner
          CLI, connecting Playrunner and preparing a first test run.
        </p>
        <div className={styles.promptPanel}>
          <div className={styles.promptHeader}>
            <label htmlFor={`${id}-prompt`}>Your setup prompt</label>
            <button
              type="button"
              className={`${styles.copyButton} ${copyState === 'copied' ? styles.copied : ''}`}
              onClick={copyPrompt}
              aria-label={
                copyState === 'copied' ? 'Prompt copied' : 'Copy setup prompt'
              }
              title={
                copyState === 'copied' ? 'Prompt copied' : 'Copy setup prompt'
              }
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                {copyState === 'copied' ? (
                  <path d="m5 12 4 4L19 6" />
                ) : (
                  <>
                    <rect x="8" y="8" width="12" height="12" rx="2" />
                    <path d="M16 8V4H4v12h4" />
                  </>
                )}
              </svg>
            </button>
          </div>
          <textarea
            ref={promptRef}
            id={`${id}-prompt`}
            className={styles.prompt}
            value={setupPrompt}
            readOnly
            spellCheck={false}
          />
        </div>
        <p className={styles.copyStatus} role="status" aria-live="polite">
          {copyState === 'copied'
            ? 'Prompt copied. Paste it into your agent to get started.'
            : copyState === 'error'
              ? 'Automatic copy is unavailable. The prompt is selected so you can copy it manually.'
              : 'Copy the prompt, then paste it into your agent’s chat.'}
        </p>
        <div className={styles.footer}>
          <p>
            <strong>First time?</strong> Your client may ask you to add the MCP
            server and authorise access in your browser.
          </p>
          <Link
            to="/docs/mcp/connect"
            onClick={() => dialogRef.current?.close()}
          >
            Connection guide <span aria-hidden="true">↗</span>
          </Link>
        </div>
      </dialog>
    </>
  );
}

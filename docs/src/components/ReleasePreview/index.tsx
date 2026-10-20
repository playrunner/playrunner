import { useEffect, useRef, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import Logo from '@site/static/img/playrunner-icon.svg';
import { OpenAIIcon } from '../../../../packages/openai/src/frontend/OpenAIIcon';
import PlaywrightLogo from '../../../../packages/playwright/assets/playwright.svg';
import styles from './styles.module.css';

const scenes = ['Change', 'Check', 'Catch', 'Verify'];
const SCENE_MS = 9000;

export default function ReleasePreview(): ReactNode {
  const previewRef = useRef<HTMLElement>(null);
  const [scene, setScene] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [visible, setVisible] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updateMotion = () => {
      setReducedMotion(preference.matches);
      if (preference.matches) setPlaying(false);
    };
    updateMotion();
    preference.addEventListener('change', updateMotion);
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { threshold: 0.25 },
    );
    if (previewRef.current) observer.observe(previewRef.current);
    const updateVisibility = () => setPageVisible(!document.hidden);
    updateVisibility();
    document.addEventListener('visibilitychange', updateVisibility);
    return () => {
      preference.removeEventListener('change', updateMotion);
      observer.disconnect();
      document.removeEventListener('visibilitychange', updateVisibility);
    };
  }, []);

  useEffect(() => {
    if (!playing || !visible || !pageVisible || reducedMotion) return;
    const timer = window.setTimeout(
      () => setScene((value) => (value + 1) % scenes.length),
      SCENE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [scene, playing, visible, pageVisible, reducedMotion]);

  return (
    <figure
      ref={previewRef}
      className={clsx(styles.preview, !playing && styles.paused)}
      aria-label="Illustrative demo: saved Playrunner checks protect existing customers during a billing change, with failure evidence and retained run history"
    >
      <div className={styles.topline}>
        <OpenAIIcon aria-hidden="true" />
        <span>Codex</span>
        <span className={styles.connection}>Playrunner connected</span>
      </div>
      <div className={styles.stage} aria-live={playing ? 'off' : 'polite'}>
        <div key={scene} className={styles.scene}>
          <div className={styles.sceneHeading}>
            <span className={styles.eyebrow}>
              Your AI builds. Playrunner checks.
            </span>
            <h2>
              {scene === 0 && 'Keep what works working.'}
              {scene === 1 && 'Same checks. New change.'}
              {scene === 2 && 'Show your agent what failed.'}
              {scene === 3 && 'A fix with proof.'}
            </h2>
          </div>
          {scene === 0 && (
            <div className={styles.conversation}>
              <div className={styles.userMessage}>
                <span>You</span>
                <p>
                  Add subscription billing. Keep existing customers’ payments
                  and account access working. Update the pricing page too.
                </p>
              </div>
              <div className={styles.node}>
                <Logo aria-hidden="true" />
                <div>
                  <strong>Agreed checks, saved in Playrunner</strong>
                  <span>Payments · Paid-customer access</span>
                  <span>
                    Last run: <b className={styles.passed}>PASS</b>
                  </span>
                </div>
              </div>
              <div className={styles.agentMessage}>
                <span>
                  <OpenAIIcon aria-hidden="true" /> Codex
                </span>
                <p>
                  Billing added. I’ll run our saved checks in Playrunner while I
                  update pricing.
                </p>
              </div>
            </div>
          )}
          {scene === 1 && (
            <div className={styles.workflow}>
              <div className={styles.workflowName}>
                Saved workflow · Staging · Customer sign-in
              </div>
              <div className={styles.node}>
                <OpenAIIcon aria-hidden="true" />
                <div>
                  <strong>Subscription billing added</strong>
                  <span>Existing customers should still pay and sign in</span>
                </div>
                <span className={styles.complete} aria-hidden="true">
                  ✓
                </span>
              </div>
              <div className={styles.connector} aria-hidden="true">
                <i />
              </div>
              <div className={clsx(styles.node, styles.running)}>
                <PlaywrightLogo aria-hidden="true" />
                <div>
                  <strong>Playwright checks running</strong>
                  <span>Reusing saved payments + access checks</span>
                </div>
                <span className={styles.spinner} aria-hidden="true" />
              </div>
              <p className={styles.workflowNote}>Meanwhile, in the same chat</p>
              <div className={styles.agentMessage}>
                <span>
                  <OpenAIIcon aria-hidden="true" /> Codex · Updating pricing
                </span>
                <p>
                  The checks are running. I’m updating the pricing page now.
                </p>
              </div>
            </div>
          )}
          {scene === 2 && (
            <div className={styles.conversation}>
              <div className={styles.result}>
                <span>
                  <Logo aria-hidden="true" /> Playrunner · Failure evidence
                </span>
                <strong>FAIL · Paid-customer access</strong>
                <dl className={styles.evidence}>
                  <dt>Customer</dt>
                  <dd>Existing customer · Already paid</dd>
                  <dt>Expected</dt>
                  <dd>Account dashboard</dd>
                  <dt>Actual</dt>
                  <dd>Redirected to Subscribe</dd>
                </dl>
                <small>Payments passed · Screenshot + report ready</small>
              </div>
              <div className={styles.agentMessage}>
                <span>
                  <OpenAIIcon aria-hidden="true" /> Codex · Updating pricing
                </span>
                <p>The saved check caught this while I was updating pricing.</p>
              </div>
            </div>
          )}
          {scene === 3 && (
            <div className={styles.conversation}>
              <div className={styles.agentMessage}>
                <span>
                  <OpenAIIcon aria-hidden="true" /> Codex
                </span>
                <p>
                  Fixed the access rule. I reran only the failed account-access
                  check.
                </p>
              </div>
              <div className={styles.result}>
                <span>
                  <Logo aria-hidden="true" /> Playrunner · Rerun complete
                </span>
                <strong>
                  <b>PASS · Account access</b>
                </strong>
                <p>Paid customers reach their dashboard.</p>
                <ol
                  className={styles.history}
                  aria-label="Account-access run history"
                >
                  <li>
                    <span>Before</span>
                    <b>PASS</b>
                  </li>
                  <li>
                    <span>Billing change</span>
                    <b className={styles.failed}>FAIL</b>
                  </li>
                  <li>
                    <span>After fix</span>
                    <b>PASS</b>
                  </li>
                </ol>
                <small>
                  Same saved check · Original failed report retained
                </small>
              </div>
              <div className={styles.handoff}>
                <span aria-hidden="true">↻</span> The checks and history stay
                with your project.
              </div>
            </div>
          )}
        </div>
      </div>
      <div className={styles.controls}>
        <div className={styles.steps} role="group" aria-label="Preview scenes">
          {scenes.map((label, index) => (
            <button
              key={label}
              type="button"
              aria-pressed={scene === index}
              aria-label={`Show ${label.toLowerCase()} scene`}
              onClick={() => {
                setScene(index);
                setPlaying(false);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {!reducedMotion && (
          <button
            className={styles.playButton}
            type="button"
            aria-label={playing ? 'Pause hero demo' : 'Play hero demo'}
            onClick={() => setPlaying((value) => !value)}
          >
            <span aria-hidden="true">{playing ? 'Ⅱ' : '▶'}</span>
          </button>
        )}
      </div>
      <figcaption>Illustrative demo · Sample results.</figcaption>
    </figure>
  );
}

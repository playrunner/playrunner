import { useEffect, useRef, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import Logo from '@site/static/img/playrunner-icon.svg';
import { OpenAIIcon } from '../../../../packages/openai/src/frontend/OpenAIIcon';
import PlaywrightLogo from '../../../../packages/playwright/assets/playwright.svg';
import styles from './styles.module.css';

const scenes = ['Ask', 'Run', 'Act'];
const SCENE_MS = 6500;

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
      aria-label="From chat to test results: an illustrative Playrunner demo"
    >
      <div className={styles.topline}>
        <Logo aria-hidden="true" />
        <span>Playrunner</span>
        <span className={styles.connection}>Connected</span>
      </div>
      <div className={styles.stage} aria-live={playing ? 'off' : 'polite'}>
        <div key={scene} className={styles.scene}>
          <div className={styles.sceneHeading}>
            <span className={styles.eyebrow}>Your agent. Real test runs.</span>
            <h2>
              {scene === 0 && 'Start with a conversation.'}
              {scene === 1 && 'Let Playrunner run it.'}
              {scene === 2 && 'Turn results into action.'}
            </h2>
          </div>
          {scene === 0 && (
            <div className={styles.conversation}>
              <div className={styles.userMessage}>
                <span>You</span>
                <p>I’ve updated checkout. Run the smoke tests.</p>
              </div>
              <div className={styles.agentMessage}>
                <span>
                  <OpenAIIcon aria-hidden="true" /> Your AI agent
                </span>
                <p>On it. I’ll start your saved workflow in Playrunner.</p>
              </div>
              <div className={styles.handoff}>
                <Logo aria-hidden="true" /> Sending to Playrunner{' '}
                <span aria-hidden="true">↗</span>
              </div>
            </div>
          )}
          {scene === 1 && (
            <div className={styles.workflow}>
              <div className={styles.workflowName}>Checkout smoke tests</div>
              <div className={styles.node}>
                <OpenAIIcon aria-hidden="true" />
                <div>
                  <strong>Agent starts workflow</strong>
                  <span>Request received</span>
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
                  <strong>Playwright runs tests</strong>
                  <span>Checking checkout…</span>
                </div>
                <span className={styles.spinner} aria-hidden="true" />
              </div>
              <div className={styles.connector} aria-hidden="true">
                <i />
              </div>
              <div className={styles.node}>
                <Logo aria-hidden="true" />
                <div>
                  <strong>Results back to chat</strong>
                  <span>Report and trace included</span>
                </div>
              </div>
              <p className={styles.workflowNote}>
                Your agent keeps working.
                <br />
                Playrunner handles the run.
              </p>
            </div>
          )}
          {scene === 2 && (
            <div className={styles.conversation}>
              <div className={styles.result}>
                <span>
                  <Logo aria-hidden="true" /> Playrunner
                </span>
                <strong>
                  <b>2 passed</b> · 1 failed
                </strong>
                <p>Checkout loses the delivery address.</p>
                <small>Report + trace ready</small>
              </div>
              <div className={styles.agentMessage}>
                <span>
                  <OpenAIIcon aria-hidden="true" /> Your AI agent
                </span>
                <p>I’ll inspect the trace, fix the regression, then rerun.</p>
              </div>
              <div className={styles.handoff}>
                <span aria-hidden="true">↻</span> Evidence. A fix. Another
                check.
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
              <span aria-hidden="true">{index + 1}</span>
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
      <figcaption>Illustrative demo · Your tests, your agent.</figcaption>
    </figure>
  );
}

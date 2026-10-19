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
      aria-label="Product direction: discover affected projects and test a shared component with Playrunner"
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
              Product direction · Illustrative demo
            </span>
            <h2>
              {scene === 0 && 'Start with a conversation.'}
              {scene === 1 && 'Codex keeps building.'}
              {scene === 2 && 'Turn results into action.'}
            </h2>
          </div>
          {scene === 0 && (
            <div className={styles.conversation}>
              <div className={styles.userMessage}>
                <span>You</span>
                <p>
                  Add flags to the country selector and let users choose their
                  account timezone.
                </p>
              </div>
              <div className={styles.agentMessage}>
                <span>
                  <OpenAIIcon aria-hidden="true" /> Codex
                </span>
                <p>
                  Flags added. I’ll use Playrunner to find affected projects and
                  test the selector while I build the timezone setting.
                </p>
              </div>
              <div className={styles.handoff}>
                <Logo aria-hidden="true" /> Playrunner: find affected projects{' '}
                <span aria-hidden="true">↗</span>
              </div>
            </div>
          )}
          {scene === 1 && (
            <div className={styles.workflow}>
              <div className={styles.workflowName}>
                Country selector · Focused regressions
              </div>
              <div className={styles.node}>
                <Logo aria-hidden="true" />
                <div>
                  <strong>Playrunner discovers affected projects</strong>
                  <span>5 projects use the country selector</span>
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
                  <strong>Runs country-selector tests</strong>
                  <span>18 focused tests across all 5 projects</span>
                </div>
                <span className={styles.spinner} aria-hidden="true" />
              </div>
              <p className={styles.workflowNote}>Meanwhile, in the same chat</p>
              <div className={styles.agentMessage}>
                <span>
                  <OpenAIIcon aria-hidden="true" /> Codex · Working
                </span>
                <p>
                  While those tests run, I’m building the account timezone
                  setting.
                </p>
              </div>
            </div>
          )}
          {scene === 2 && (
            <div className={styles.conversation}>
              <div className={styles.result}>
                <span>
                  <Logo aria-hidden="true" /> Playrunner
                </span>
                <strong>
                  <b>17 passed</b> · 1 failed
                </strong>
                <p>
                  Customer Portal: editing an address resets the saved country.
                </p>
                <small>
                  Country selector · 5 projects · Report + trace ready
                </small>
              </div>
              <div className={styles.agentMessage}>
                <span>
                  <OpenAIIcon aria-hidden="true" /> Codex
                </span>
                <p>
                  I’ll inspect the trace, fix the country reset, then rerun the
                  failed test.
                </p>
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
      <figcaption>
        Planned discovery and test selection · Sample results.
      </figcaption>
    </figure>
  );
}

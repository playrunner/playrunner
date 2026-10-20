import { useEffect, useRef, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import Logo from '@site/static/img/playrunner-icon.svg';
import { OpenAIIcon } from '../../../../packages/openai/src/frontend/OpenAIIcon';
import PlaywrightLogo from '../../../../packages/playwright/assets/playwright.svg';
import styles from './styles.module.css';

const scenes = ['Change', 'Run', 'Catch', 'Fix'];
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
      aria-label="Illustrative demo: Playrunner catches a booking regression while Codex keeps working, then verifies the fix"
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
              Keep building. Catch what breaks.
            </span>
            <h2>
              {scene === 0 && 'Make your next change.'}
              {scene === 1 && 'Codex keeps building.'}
              {scene === 2 && 'Catch what just broke.'}
              {scene === 3 && 'Fix it. Check it again.'}
            </h2>
          </div>
          {scene === 0 && (
            <div className={styles.conversation}>
              <div className={styles.node}>
                <Logo aria-hidden="true" />
                <div>
                  <strong>Saved booking check</strong>
                  <span>
                    <b className={styles.passed}>PASSED</b> before this change
                  </span>
                </div>
              </div>
              <div className={styles.userMessage}>
                <span>You</span>
                <p>Add a promo-code field to booking. Then update the FAQ.</p>
              </div>
              <div className={styles.agentMessage}>
                <span>
                  <OpenAIIcon aria-hidden="true" /> Codex
                </span>
                <p>
                  Field added. I’ll rerun our saved booking check in Playrunner
                  while I update the FAQ.
                </p>
              </div>
            </div>
          )}
          {scene === 1 && (
            <div className={styles.workflow}>
              <div className={styles.workflowName}>
                Same saved check · New change
              </div>
              <div className={styles.node}>
                <OpenAIIcon aria-hidden="true" />
                <div>
                  <strong>Promo-code field added</strong>
                  <span>Codex moves on to the FAQ</span>
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
                  <strong>Playrunner reruns booking check</strong>
                  <span>In the background · Desktop + mobile</span>
                </div>
                <span className={styles.spinner} aria-hidden="true" />
              </div>
              <p className={styles.workflowNote}>Meanwhile, in the same chat</p>
              <div className={styles.agentMessage}>
                <span>
                  <OpenAIIcon aria-hidden="true" /> Codex · Updating FAQ
                </span>
                <p>The booking check is running. I’m updating the FAQ now.</p>
              </div>
            </div>
          )}
          {scene === 2 && (
            <div className={styles.conversation}>
              <div className={styles.result}>
                <span>
                  <Logo aria-hidden="true" /> Playrunner · Mobile booking
                </span>
                <strong>
                  <b>PASSED</b> → FAILED
                </strong>
                <p>
                  The new promo-code field leaves Continue hidden behind the
                  footer on mobile.
                </p>
                <small>Same saved check · Screenshot + report ready</small>
              </div>
              <div className={styles.agentMessage}>
                <span>
                  <OpenAIIcon aria-hidden="true" /> Codex · Updating FAQ
                </span>
                <p>
                  Playrunner caught a booking regression while I was working on
                  the FAQ.
                </p>
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
                  I fixed the mobile layout and reran only the failed mobile
                  booking check.
                </p>
              </div>
              <div className={styles.result}>
                <span>
                  <Logo aria-hidden="true" /> Playrunner · Rerun complete
                </span>
                <strong>
                  <b>PASSED · Mobile booking</b>
                </strong>
                <p>Continue is visible. The booking completes.</p>
                <small>Same saved check · Verified after the fix</small>
              </div>
              <div className={styles.handoff}>
                <span aria-hidden="true">↻</span> Ready to reuse after your next
                change.
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

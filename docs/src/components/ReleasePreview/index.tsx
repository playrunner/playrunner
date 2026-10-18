import { useState, type ReactNode } from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import Logo from '@site/static/img/playrunner-icon.svg';
import { OpenAIIcon } from '../../../../packages/openai/src/frontend/OpenAIIcon';
import styles from './styles.module.css';

const checks = [
  { name: 'Customer can add to cart', focused: true },
  { name: 'Payment confirmation appears', focused: true, failure: true },
  { name: 'User can sign in', focused: false },
  { name: 'Invoice can be downloaded', focused: false },
  { name: 'Profile changes are saved', focused: false },
];

export default function ReleasePreview(): ReactNode {
  const [scope, setScope] = useState<'focused' | 'full'>('focused');
  const [verified, setVerified] = useState(false);
  const full = scope === 'full';
  const runCount = full
    ? checks.length
    : checks.filter((c) => c.focused).length;
  const passed = runCount - (verified ? 0 : 1);

  return (
    <figure
      className={styles.preview}
      aria-label="Interactive release check example"
    >
      <div className={styles.frame}>
        <div className={styles.topline}>
          <span className={styles.brand}>
            <Logo aria-hidden="true" /> Playrunner
            <span className={styles.separator}>/</span>
            <span>Release checks</span>
          </span>
          <span className={styles.example}>Interactive example</span>
        </div>

        <div className={styles.body}>
          <div className={styles.scopeHeader}>
            <span>01 / Agent starts a saved workflow</span>
            <span className={styles.environment}>Staging</span>
          </div>
          <div
            className={styles.scopePicker}
            role="group"
            aria-label="Example testing scope"
          >
            {(['focused', 'full'] as const).map((value) => (
              <button
                type="button"
                key={value}
                aria-pressed={scope === value}
                aria-controls="release-example-results"
                onClick={() => {
                  setScope(value);
                  setVerified(false);
                }}
              >
                <span aria-hidden="true">
                  {value === 'focused' ? '◎' : '▦'}
                </span>
                {value === 'focused' ? 'Focused checks' : 'Full regression'}
              </button>
            ))}
          </div>

          <div className={styles.parallelWork}>
            <span className={styles.parallelLabel}>02 / Work in parallel</span>
            <div className={styles.parallelLanes}>
              <div>
                <OpenAIIcon aria-hidden="true" />
                <div>
                  <strong>Agent keeps building</strong>
                  <span>Continues other work</span>
                </div>
              </div>
              <div>
                <Logo aria-hidden="true" />
                <div>
                  <strong>Playrunner tests</strong>
                  <span>Records the evidence</span>
                </div>
              </div>
            </div>
          </div>

          <div
            id="release-example-results"
            aria-live="polite"
            aria-atomic="true"
          >
            <div className={styles.workflowHeading}>
              <div>
                <strong>
                  {full ? 'Release regression' : 'Checkout checks'}
                </strong>
                <span>
                  Saved workflow ·{' '}
                  {full ? 'Your complete suite' : 'Your selected tests'}
                </span>
              </div>
              <span
                className={clsx(
                  styles.runBadge,
                  verified && styles.verifiedBadge,
                )}
              >
                {verified ? 'Rerun complete' : 'Run complete'}
              </span>
            </div>

            <div className={styles.summary}>
              <span>
                <i className={styles.passDot} />
                {passed} passed
              </span>
              {!verified && (
                <span>
                  <i className={styles.failDot} />1 failed
                </span>
              )}
              {!full && (
                <span>
                  <i className={styles.idleDot} />3 not run
                </span>
              )}
            </div>

            <ul className={styles.checks} aria-label="Example test results">
              {checks.map((check) => {
                const included = full || check.focused;
                const failed = included && check.failure && !verified;
                const status = !included
                  ? 'Not in this run'
                  : failed
                    ? 'Failed'
                    : 'Passed';
                return (
                  <li
                    key={check.name}
                    className={clsx(
                      !included && styles.outOfScope,
                      failed && styles.failedRow,
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={clsx(
                        styles.checkIcon,
                        included &&
                          (failed ? styles.failIcon : styles.passIcon),
                      )}
                    >
                      {!included ? '–' : failed ? '×' : '✓'}
                    </span>
                    <span>{check.name}</span>
                    <span className={styles.checkStatus}>{status}</span>
                  </li>
                );
              })}
            </ul>

            <div
              className={clsx(
                styles.evidence,
                verified && styles.verifiedEvidence,
              )}
            >
              <div className={styles.evidenceTitle}>
                <span>
                  {verified
                    ? '04 / Agent verifies the fix'
                    : '03 / Agent retrieves the results'}
                </span>
                <span aria-hidden="true">{verified ? '✓' : '↳'}</span>
              </div>
              <strong>
                {verified
                  ? 'Payment confirmation now passes.'
                  : 'Checkout needs attention.'}
              </strong>
              <p>
                {verified
                  ? full
                    ? 'All five checks in this example suite passed on the rerun.'
                    : 'Both checkout checks passed. The wider suite is still untested.'
                  : 'The confirmation did not appear after payment. The failed step and captured trace show where to investigate.'}
              </p>
              <div className={styles.evidenceLinks}>
                <Link to="/docs/tutorials/understanding-reports">
                  Report guide <span aria-hidden="true">↗</span>
                </Link>
                <span>Logs</span>
                <span>Trace</span>
              </div>
            </div>
          </div>

          <button
            className={styles.verifyButton}
            type="button"
            aria-controls="release-example-results"
            onClick={() => setVerified(!verified)}
          >
            {verified ? 'Replay the example' : 'Preview a verified fix'}
            <span aria-hidden="true">{verified ? '↺' : '→'}</span>
          </button>
        </div>
        <div className={styles.footer}>
          <span className={styles.footerIcon} aria-hidden="true">
            ≡
          </span>
          <span>Execution history and evidence, ready for your agent.</span>
        </div>
      </div>
      <figcaption>
        Illustrative workflow. The agent checks back to retrieve the results.
      </figcaption>
    </figure>
  );
}

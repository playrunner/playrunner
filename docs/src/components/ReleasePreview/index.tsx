import { useState, type ReactNode } from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import Logo from '@site/static/img/playrunner-icon.svg';
import { OpenAIIcon } from '../../../../packages/openai/src/frontend/OpenAIIcon';
import styles from './styles.module.css';

const checks = [
  { name: 'Checkout → Delivery country', focused: true },
  {
    name: 'Account settings → Save country',
    focused: true,
    failure: true,
  },
  { name: 'Sign-up → Select country', focused: true },
  { name: 'Sign in with email', focused: false },
  { name: 'Download an invoice', focused: false },
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
      aria-label="Change-aware regression testing product preview"
    >
      <div className={styles.previewLabel}>
        <span>Product preview</span>
        <span>Change-aware regression testing</span>
      </div>
      <p className={styles.availability}>
        Planned: select tests from your code changes and their dependencies.
      </p>
      <div className={styles.frame}>
        <div className={styles.topline}>
          <span className={styles.brand}>
            <Logo aria-hidden="true" /> Playrunner
            <span className={styles.separator}>/</span>
            <span>Change impact</span>
          </span>
          <span className={styles.example}>Example data</span>
        </div>

        <div className={styles.body}>
          <div className={styles.scopeHeader}>
            <span>01 / Your agent changes a shared dropdown</span>
            <span className={styles.environment}>Staging</span>
          </div>
          <div className={styles.changedComponent}>
            <span className={styles.changeIcon} aria-hidden="true">
              ±
            </span>
            <div>
              <code>shared/Dropdown.tsx</code>
              <span>Used in checkout, account settings and sign-up</span>
            </div>
          </div>
          <div className={styles.scopeHeader}>
            <span>02 / Check the journeys that use it</span>
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
                {value === 'focused' ? 'Affected journeys' : 'Full regression'}
              </button>
            ))}
          </div>

          <div className={styles.parallelWork}>
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
                  <strong>Playrunner checks</strong>
                  <span>Other paths, in parallel</span>
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
                  {full ? 'Full example suite' : 'Shared dropdown checks'}
                </strong>
                <span>
                  {full
                    ? 'All 5 journeys in this example'
                    : '3 journeys use the changed component'}
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
                  <i className={styles.idleDot} />
                  {checks.length - runCount} not run
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
                    ? '04 / The agent checks its fix'
                    : '03 / The finding your agent comes back to'}
                </span>
                <span aria-hidden="true">{verified ? '✓' : '↳'}</span>
              </div>
              <strong>
                {verified
                  ? 'Account settings works again.'
                  : 'Checkout works. Account settings broke.'}
              </strong>
              <p>
                {verified
                  ? full
                    ? 'All five journeys passed on the rerun in this example.'
                    : 'All three dropdown journeys passed on the rerun. The other two journeys were not checked.'
                  : 'The country saves in checkout, but account settings loses the selected value after Save. Both forms use the dropdown you changed.'}
              </p>
              <div className={styles.comparison}>
                <span>
                  Before the change <b>Passed</b>
                </span>
                <span aria-hidden="true">→</span>
                <span>
                  {verified ? 'After the fix' : 'After the change'}{' '}
                  <b className={clsx(!verified && styles.comparisonFailure)}>
                    {verified ? 'Passed' : 'Failed'}
                  </b>
                </span>
              </div>
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
            {verified ? 'Replay the example' : 'See the agent verify a fix'}
            <span aria-hidden="true">{verified ? '↺' : '→'}</span>
          </button>
        </div>
        <div className={styles.footer}>
          <span className={styles.footerIcon} aria-hidden="true">
            ≡
          </span>
          <span>Uncertain impact? Widen the checks or run the full suite.</span>
        </div>
      </div>
      <figcaption>
        Illustrative results. Today, your agent selects a saved workflow and
        checks back for its report.
      </figcaption>
    </figure>
  );
}

import type { ReactNode } from 'react';
import Link from '@docusaurus/Link';
import Layout from '@theme/Layout';

import styles from './pricing.module.css';

type FeatureProps = {
  children: ReactNode;
};

function CheckIcon() {
  return (
    <svg aria-hidden="true" className={styles.checkIcon} viewBox="0 0 20 20">
      <path d="m4 10.5 3.5 3.5L16 5.5" />
    </svg>
  );
}

function Feature({ children }: FeatureProps) {
  return (
    <li>
      <CheckIcon />
      <span>{children}</span>
    </li>
  );
}

export default function Pricing(): ReactNode {
  return (
    <Layout
      title="Pricing"
      description="Use and self-host Playrunner for free under the Playrunner Sustainable Use License, or join the free Playrunner Cloud beta."
    >
      <main className={styles.page}>
        <section className={styles.hero}>
          <div className="container">
            <div className={styles.heroContent}>
              <span className={styles.eyebrow}>Simple from the start</span>
              <h1>Run Playrunner your way, for free.</h1>
              <p>
                Download Playrunner, install it locally, or deploy it to your
                own cloud. There are no license fees for uses permitted by the
                Playrunner Sustainable Use License.
              </p>
              <div className={styles.heroActions}>
                <Link
                  className="button button--primary button--lg"
                  to="/docs/tutorials/getting-started"
                >
                  Get started locally
                </Link>
                <a
                  className="button button--secondary button--lg"
                  href="https://github.com/playrunner/playrunner"
                >
                  View on GitHub
                </a>
              </div>
            </div>
          </div>
        </section>

        <section className={styles.plansSection}>
          <div className="container">
            <div className={styles.sectionHeading}>
              <span className={styles.eyebrow}>Choose how you run</span>
              <h2>Start self-hosted or use Playrunner Cloud.</h2>
              <p>
                Run Playrunner on your own infrastructure, or use the managed
                Playrunner Cloud beta free as a beta tester.
              </p>
            </div>

            <div className={styles.planGrid}>
              <article className={`${styles.planCard} ${styles.featuredCard}`}>
                <div className={styles.planHeader}>
                  <div>
                    <span className={styles.status}>Available now</span>
                    <h2>Self-hosted</h2>
                    <p className={styles.planSummary}>
                      Full control on your laptop or infrastructure.
                    </p>
                  </div>
                  <div className={styles.price}>
                    <span className={styles.currency}>$</span>
                    <strong>0</strong>
                    <span className={styles.priceNote}>license fee</span>
                  </div>
                </div>

                <ul className={styles.featureList}>
                  <Feature>Download and install Playrunner locally</Feature>
                  <Feature>Deploy it in your own cloud environment</Feature>
                  <Feature>
                    Use it for personal, educational, evaluation, and
                    non-commercial purposes
                  </Feature>
                  <Feature>
                    Use it to support your organization&apos;s internal
                    operations
                  </Feature>
                  <Feature>
                    Keep control of your infrastructure and data
                  </Feature>
                </ul>

                <Link
                  className={`button button--primary button--block button--lg ${styles.planAction}`}
                  to="/docs/tutorials/getting-started"
                >
                  Install Playrunner
                </Link>
              </article>

              <article className={`${styles.planCard} ${styles.cloudCard}`}>
                <div className={styles.cloudGlow} aria-hidden="true" />
                <div className={styles.planHeader}>
                  <div>
                    <span className={`${styles.status} ${styles.betaStatus}`}>
                      Free beta
                    </span>
                    <h2>Playrunner Cloud</h2>
                    <p className={styles.planSummary}>
                      The convenience of Playrunner, hosted and managed by us.
                    </p>
                  </div>
                  <div className={styles.cloudMark} aria-hidden="true">
                    <svg viewBox="0 0 24 24">
                      <path d="M7 18h10a4 4 0 0 0 .7-7.94A6 6 0 0 0 6.2 8.4 4.8 4.8 0 0 0 7 18Z" />
                    </svg>
                  </div>
                </div>

                <ul className={styles.featureList}>
                  <Feature>Managed Playrunner hosting</Feature>
                  <Feature>Less infrastructure to operate yourself</Feature>
                  <Feature>
                    A faster path from setup to running workflows
                  </Feature>
                  <Feature>
                    Free access for beta testers during the beta
                  </Feature>
                </ul>

                <a
                  className={`button button--primary button--block button--lg ${styles.planAction}`}
                  href="https://playrunner.cloud"
                >
                  Open Playrunner Cloud
                </a>
              </article>
            </div>
          </div>
        </section>

        <section className={styles.licenseSection}>
          <div className="container">
            <div className={styles.licenseCard}>
              <div className={styles.licenseIcon} aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <path d="M12 3 5 6v5c0 4.6 2.9 8.4 7 10 4.1-1.6 7-5.4 7-10V6l-7-3Z" />
                  <path d="m9 12 2 2 4-4" />
                </svg>
              </div>
              <div className={styles.licenseCopy}>
                <span className={styles.eyebrow}>Sustainable Use</span>
                <h2>Free to use under the Sustainable Use License.</h2>
                <p>
                  Self-hosting is available under the Playrunner Sustainable Use
                  License. It permits internal business use and personal,
                  educational, evaluation, and other non-commercial uses. It
                  does not permit selling Playrunner, monetizing access to it,
                  or offering a service substantially based on it to third
                  parties without separate written permission.
                </p>
                <a
                  className={styles.licenseLink}
                  href="https://github.com/playrunner/playrunner/blob/main/LICENSE"
                >
                  Read the full license
                  <span aria-hidden="true">→</span>
                </a>
              </div>
            </div>
          </div>
        </section>

        <section className={styles.bottomCta}>
          <div className="container">
            <div className={styles.bottomCtaInner}>
              <div>
                <h2>Ready to run Playrunner?</h2>
                <p>
                  Start locally today. No account, subscription, or license fee
                  required for permitted use.
                </p>
              </div>
              <Link
                className="button button--primary button--lg"
                to="/docs/tutorials/getting-started"
              >
                Follow the getting started guide
              </Link>
            </div>
          </div>
        </section>
      </main>
    </Layout>
  );
}

import type { ReactNode } from 'react';
import Link from '@docusaurus/Link';
import Layout from '@theme/Layout';
import { PageMetadata } from '@docusaurus/theme-common';
import { JsonLd, faqPage } from '@site/src/components/StructuredData';

import styles from './pricing.module.css';

/**
 * Every answer below is also rendered on the page, in the FAQ section at the
 * bottom. Markup that is not visible to the reader is a violation.
 *
 * Scope: licensing and availability only. Anything that states or implies a
 * price, a billing model, or a compute allocation is parked in PARKED_FAQ
 * below until those decisions are actually made.
 */
const FAQ = [
  {
    question: 'Is Playrunner open source?',
    answer:
      'Playrunner is source-available, not open source. It is distributed under the Playrunner Sustainable Use License, which is not an OSI-approved license. You can read, modify, and self-host the code; you cannot resell it or offer it as a hosted service.',
  },
  {
    question: 'What am I allowed to do under the Sustainable Use License?',
    answer:
      "The license permits two categories of use: supporting your own organization's internal operations; and personal, educational, evaluation, or other non-commercial purposes. You cannot sell Playrunner, monetize access to it, or offer a service substantially based on it to third parties without separate written permission.",
  },
  {
    question: 'Can I use Playrunner today?',
    answer:
      'Yes, two ways. Run it yourself with Docker or in your own cloud account, with no license fee for any use the Sustainable Use License permits. Or use the managed Playrunner Cloud beta, which you can sign in to with GitHub or Google.',
  },
  {
    question: 'Do I need Playrunner Cloud to use the integrations?',
    answer:
      'No. Every integration node runs the same way on a self-hosted Playrunner deployment as it does on Playrunner Cloud, because integrations are bundled into the build rather than fetched at runtime. You connect your own Slack, Jira, GitHub, or OpenAI credentials either way.',
  },
];

/*
 * TODO(pricing): parked until the Playrunner Cloud pricing structure is
 * decided. Do NOT publish any of these as-is — each one states or implies a
 * commitment that has not been made:
 *
 *   - "How much does Playrunner cost?"
 *       Needs a settled answer for Cloud. The self-hosted half (no license fee
 *       for permitted use) is already covered by the license section.
 *
 *   - "Do I need a credit card to join the Playrunner Cloud beta?"
 *       Reads as a promise about billing during and after the beta.
 *
 *   - "Why is there no Playrunner Cloud pricing yet?"
 *       Good trust-building answer, but it commits publicly to the reasoning
 *       and to a rough timeline. Revisit once the model is chosen.
 *
 *   - "Are there limits during the beta?"
 *       Previously named a specific vCPU/memory allocation. That number is not
 *       settled and must not be published until it is.
 *
 *   - "Will self-hosting stay free when Cloud pricing launches?"
 *       Safe in substance, but presumes a launch shape that is undecided.
 *
 *   - "What happens to my beta account when pricing launches?"
 *       Describes migration and billing behaviour that has not been designed.
 *
 * When pricing firms up, rewrite these against the real model and move them
 * into FAQ above. They will flow into the FAQPage JSON-LD automatically, so
 * they must be rendered visibly on the page at the same time.
 */

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
      {/* Layout only forwards title and description to PageMetadata, so the
          page-specific image and keywords have to be set directly. */}
      <PageMetadata
        image="/img/og/og-pricing.png"
        keywords={[
          'playrunner pricing',
          'playwright orchestration pricing',
          'self-hosted playwright',
          'free playwright test orchestration',
        ]}
      />
      <JsonLd data={faqPage(FAQ)} />
      <main className={styles.page}>
        <section className={styles.hero}>
          <div className="container">
            <div className={styles.heroContent}>
              <span className={styles.eyebrow}>Simple from the start</span>
              <h1>Run Playrunner your way, for free.</h1>
              <p>
                Run Playrunner on your own infrastructure, or use the managed
                Playrunner Cloud beta. There are no license fees for uses
                permitted by the Playrunner Sustainable Use License.
              </p>
              <div className={styles.heroActions}>
                <a
                  className="button button--primary button--lg"
                  href="https://playrunner.cloud"
                >
                  Open Playrunner Cloud
                </a>
                <Link
                  className="button button--secondary button--lg"
                  to="/docs/start"
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
                    Use it for your own internal business operations, or for
                    personal, educational, evaluation, and other non-commercial
                    purposes
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
                  {/* TODO(pricing): no cost, billing, or compute-allocation
                      claims here until the Cloud pricing structure is
                      decided. */}
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

        <section className={styles.faq}>
          <div className="container">
            <div className={styles.faqInner}>
              <span className={styles.eyebrow}>Questions</span>
              <h2>Common questions about cost and licensing.</h2>
              <dl className={styles.faqList}>
                {FAQ.map(({ question, answer }) => (
                  <div className={styles.faqItem} key={question}>
                    <dt>{question}</dt>
                    <dd>{answer}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </section>

        <section className={styles.bottomCta}>
          <div className="container">
            <div className={styles.bottomCtaInner}>
              <div>
                <h2>Ready to run Playrunner?</h2>
                <p>
                  Start free on our cloud, or run it yourself. No subscription
                  or license fee required for permitted use.
                </p>
              </div>
              <a
                className="button button--primary button--lg"
                href="https://playrunner.cloud"
              >
                Start free on Playrunner Cloud
              </a>
            </div>
          </div>
        </section>
      </main>
    </Layout>
  );
}

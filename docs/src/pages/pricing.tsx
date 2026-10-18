import type { ReactNode } from 'react';
import Link from '@docusaurus/Link';
import Layout from '@theme/Layout';
import { PageMetadata } from '@docusaurus/theme-common';
import { JsonLd, faqPage } from '@site/src/components/StructuredData';

import styles from './pricing.module.css';

// Keep visible FAQ answers and FAQPage structured data in sync.
// Rates verified against Cloud credit-pricing.ts and billingData.ts, 2026-10-18.
const FAQ = [
  {
    question: 'How much does Playrunner Cloud cost?',
    answer:
      'The Hosted plan is US$30 per workspace per month, before tax, with 2,000 credits each paid billing period. Credits are shared by the workspace for hosted orchestration and Cloud runners. Additional credits cost US$10 for 1,000 credits.',
  },
  {
    question: 'How does the free trial work?',
    answer:
      'Eligible new subscribers receive a 14-day trial with 200 credits. A payment method is required. After the trial, the subscription is US$30 per month, before tax. Cancel through Stripe before the trial ends to avoid the subscription charge. A workspace that has already used its trial does not receive another one.',
  },
  {
    question: 'What uses credits?',
    answer:
      'Hosted orchestration uses 0.25 credits per active workflow minute, charged once per workflow. Cloud runners use 1 credit per minute at 2 vCPU and 4 GiB of memory, with resource-adjusted rates for other sizes. Each hosted node, shard, child runner and retry adds its own compute usage. Orchestration and runner charges are added together.',
  },
  {
    question: 'Can I use my own runners?',
    answer:
      'Yes. Your own runners have no Playrunner compute charge, but hosted orchestration still uses 0.25 credits per active workflow minute. You pay your own infrastructure costs. Fully self-hosting Playrunner has no Playrunner subscription or credit charges for uses permitted by the Sustainable Use License.',
  },
  {
    question: 'Do unused credits carry forward?',
    answer:
      'Trial credits expire at the end of the trial. Included monthly credits reset each paid billing period and are used before purchased credits. Purchased credits carry forward. Starting Cloud runs still requires an eligible subscription and enough available credits.',
  },
  {
    question: 'What happens when I run low on credits?',
    answer:
      'Buy 1,000 credits for US$10, or enable optional automatic top-ups with a spending limit. Credits are added after payment succeeds. Credits are reserved before work starts, and unused reservations are released. Without enough credits, new work is blocked and existing runs remain limited to their funded budget.',
  },
  {
    question: 'Is Playrunner open source?',
    answer:
      'Playrunner is source-available, not open source. It is distributed under the Playrunner Sustainable Use License, which is not an OSI-approved license. You can read, modify and self-host the code for permitted uses; selling it or offering a service substantially based on it requires separate written permission.',
  },
  {
    question: 'Are infrastructure and third-party services included?',
    answer:
      'Self-hosted infrastructure and compute on your own runners are your responsibility. Provider charges for services connected through your own accounts, such as AI model APIs, are separate from Playrunner Cloud pricing. All listed Cloud prices are in US dollars, before applicable tax.',
  },
];

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
      description="Self-host Playrunner with no license fee for permitted use, or choose Cloud at US$30/month with 2,000 credits. Eligible new subscribers get a 14-day trial."
    >
      {/* Use the shared brand image; the old pricing card advertised a free beta. */}
      <PageMetadata
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
              <h1>Your tests. Your compute. Your plan.</h1>
              <p>
                Self-host with no license fee for permitted use, or let
                Playrunner Cloud manage your workflows. One workspace
                subscription, with credits for the orchestration and compute you
                use.
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
                Keep everything on your infrastructure, or connect your team to
                managed orchestration with Cloud or your own runners.
              </p>
            </div>

            <div className={styles.planGrid}>
              <article className={styles.planCard}>
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
                  <Feature>
                    Your infrastructure and provider costs are separate
                  </Feature>
                </ul>

                <Link
                  className={`button button--primary button--block button--lg ${styles.planAction}`}
                  to="/docs/tutorials/getting-started"
                >
                  Install Playrunner
                </Link>
              </article>

              <article
                className={`${styles.planCard} ${styles.cloudCard} ${styles.featuredCard}`}
              >
                <div className={styles.cloudGlow} aria-hidden="true" />
                <div className={styles.planHeader}>
                  <div>
                    <span className={`${styles.status} ${styles.cloudStatus}`}>
                      Hosted plan
                    </span>
                    <h2>Playrunner Cloud</h2>
                    <p className={styles.planSummary}>
                      Managed workflows for your whole workspace.
                    </p>
                  </div>
                  <div className={styles.price}>
                    <span className={styles.currency}>US$</span>
                    <strong>30</strong>
                    <span className={styles.priceNote}>
                      per workspace / month
                    </span>
                    <span className={styles.taxNote}>before tax</span>
                  </div>
                </div>

                <ul className={styles.featureList}>
                  <Feature>2,000 shared credits each paid month</Feature>
                  <Feature>
                    14-day trial with 200 credits for eligible new subscribers
                  </Feature>
                  <Feature>
                    Hosted orchestration with Cloud or your own runners
                  </Feature>
                  <Feature>
                    US$10 for 1,000 extra credits, with optional auto top-up
                  </Feature>
                  <Feature>Usage reporting and billing management</Feature>
                </ul>

                <a
                  className={`button button--primary button--block button--lg ${styles.planAction}`}
                  href="https://playrunner.cloud"
                >
                  Start your Cloud trial
                </a>
                <p className={styles.trialNote}>
                  Payment method required. Then US$30/month before tax. Cancel
                  before your trial ends to avoid the subscription charge.
                </p>
              </article>
            </div>
          </div>
        </section>

        <section className={styles.usageSection} aria-labelledby="credit-rates">
          <div className="container">
            <div className={styles.sectionHeading}>
              <span className={styles.eyebrow}>How credits work</span>
              <h2 id="credit-rates">Pay for the work your workflows do.</h2>
              <p>
                Cloud usage combines hosted orchestration and any Cloud runner
                compute. Bringing your own runners removes the Playrunner
                compute charge; hosted orchestration still applies.
              </p>
            </div>
            <div className={styles.rateGrid}>
              <article className={styles.rateCard}>
                <span className={styles.eyebrow}>Coordinate the workflow</span>
                <h3>Hosted orchestration</h3>
                <p className={styles.rate}>
                  <strong>0.25</strong> credits / minute
                </p>
                <p>
                  Charged once per workflow while hosted orchestration is
                  active, including workflows using your own runners.
                </p>
                <small>Rounded up to 0.1 seconds. No minimum duration.</small>
              </article>
              <article className={styles.rateCard}>
                <span className={styles.eyebrow}>Run the tests</span>
                <h3>Cloud runner compute</h3>
                <p className={styles.rate}>
                  <strong>1</strong> credit / minute
                </p>
                <p>
                  Per runner at 2 vCPU / 4 GiB. Usage adds up across hosted
                  nodes, shards, child runners and retries.
                </p>
                <small>
                  Rounded up to 0.1 seconds, with a one-minute minimum per
                  started task. Other sizes have adjusted rates.
                </small>
              </article>
              <article className={styles.rateCard}>
                <span className={styles.eyebrow}>Keep running</span>
                <h3>Extra credits</h3>
                <p className={styles.rate}>
                  <strong>US$10</strong> / 1,000 credits
                </p>
                <p>
                  Top up when you need more. Purchased credits carry forward;
                  trial and included monthly credits expire.
                </p>
                <small>
                  Before tax. Optional auto top-up lets you set a spending
                  limit. An eligible subscription is still required.
                </small>
              </article>
            </div>
            <div className={styles.example}>
              <div>
                <span className={styles.eyebrow}>A practical example</span>
                <h3>A ten-minute workflow. Four standard runners.</h3>
                <p>
                  If the workflow is active for ten minutes and each 2 vCPU / 4
                  GiB runner runs for ten minutes, you use:
                </p>
              </div>
              <dl>
                <div>
                  <dt>Orchestration · 10 × 0.25</dt>
                  <dd>2.5 credits</dd>
                </div>
                <div>
                  <dt>Runner compute · 4 × 10 × 1</dt>
                  <dd>40 credits</dd>
                </div>
                <div className={styles.exampleTotal}>
                  <dt>Total</dt>
                  <dd>42.5 credits</dd>
                </div>
              </dl>
            </div>
            <p className={styles.usageNote}>
              Using your own runners for the same ten-minute workflow uses 2.5
              orchestration credits, plus your own infrastructure costs. Custom
              Cloud runner sizes use (9 × vCPU + memory GiB) ÷ 22 credits per
              billable minute.
            </p>
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
                  Try Cloud with 200 credits for 14 days, or self-host on your
                  own infrastructure.
                </p>
              </div>
              <a
                className="button button--primary button--lg"
                href="https://playrunner.cloud"
              >
                Explore Playrunner Cloud
              </a>
            </div>
          </div>
        </section>
      </main>
    </Layout>
  );
}

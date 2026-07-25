import { useEffect, type ReactNode } from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useBaseUrl from '@docusaurus/useBaseUrl';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import HomepageFeatures from '@site/src/components/HomepageFeatures';
import Heading from '@theme/Heading';
import Logo from '@site/static/img/playrunner-icon.svg';

import styles from './index.module.css';

type DocsCustomFields = {
  localDocsLandingPath?: string;
};

type JourneyStep = {
  title: string;
  description: string;
};

type GettingStartedLink = {
  title: string;
  description: string;
  to: string;
};

const journeySteps: JourneyStep[] = [
  {
    title: '1. Bring your existing tests',
    description:
      'Connect the repository and keep the Playwright tests and configuration your team already maintains.',
  },
  {
    title: '2. Choose where they run',
    description:
      'Use dedicated cloud runners or run the execution layer in your own environment.',
  },
  {
    title: '3. Define the workflow',
    description:
      'Connect triggers, conditions, parallel branches, environment data, tests, and downstream systems.',
  },
  {
    title: '4. Inspect the complete run',
    description:
      'Follow execution state and logs, then keep reports and artefacts attached to the workflow that produced them.',
  },
];

const gettingStartedLinks: GettingStartedLink[] = [
  {
    title: 'Try Playrunner locally',
    description:
      'Run the complete stack and use it with an existing Playwright project.',
    to: '/docs/tutorials/getting-started',
  },
  {
    title: 'Understand workflow execution',
    description:
      'See how Playrunner coordinates the API, orchestrator, runners, and run state.',
    to: '/docs/local-dev/workflow-execution',
  },
  {
    title: 'Compare runner options',
    description: 'Review local, cloud, and self-hosted execution architecture.',
    to: '/docs/runner-architecture',
  },
  {
    title: 'Browse integrations',
    description:
      'Connect Playwright runs to schedules, source control, messaging, and other systems.',
    to: '/docs/integration-packages',
  },
  {
    title: 'Contribute to the platform',
    description:
      'Extend runners, integrations, workflows, reporting, or the product itself.',
    to: '/docs/contributing',
  },
];

function HomepageHeader() {
  return (
    <header className={clsx('hero', styles.heroBanner)}>
      <div className="container">
        <Logo
          className={styles.heroLogo}
          role="img"
          aria-label="Playrunner logo"
        />
        <p className={styles.eyebrow}>For teams already using Playwright</p>
        <Heading as="h1" className={clsx('hero__title', styles.heroTitle)}>
          Orchestrate your Playwright suite on a canvas, not in YAML.
        </Heading>
        <p className={clsx('hero__subtitle', styles.heroSubtitle)}>
          Keep the tests and config you already maintain. Drag nodes to wire
          triggers, environments, parallel branches, runners, and GitHub, Slack,
          or Jira, then watch state and logs stream back as it runs, locally, on
          managed cloud runners, or your own infrastructure.
        </p>
        <div className={styles.heroActions}>
          <Link
            className="button button--primary button--lg"
            to="/docs/tutorials/getting-started"
          >
            Try Playrunner locally
          </Link>
          <Link
            className="button button--secondary button--lg"
            to="/docs/overview"
          >
            See how it works
          </Link>
        </div>
        <p className={styles.heroBoundary}>
          Not a test framework. Not a CI system. An orchestration layer for the
          Playwright suite and delivery systems you already use.
        </p>
      </div>
    </header>
  );
}

function MissionSection(): ReactNode {
  return (
    <section className={styles.section}>
      <div className={clsx('container', styles.sectionGrid)}>
        <div>
          <p className={styles.eyebrow}>The problem</p>
          <Heading as="h2" className={styles.sectionTitle}>
            Playwright runs the tests. Your team still has to run everything
            around them.
          </Heading>
        </div>
        <div>
          <p className={styles.leadText}>
            A reliable test run is more than a command. It needs compute,
            workflow state, conditions, parallelism, schedules, external
            triggers, credentials, logs, artefacts, reports, and integrations.
            Playrunner owns that orchestration so test teams do not have to turn
            a collection of scripts and CI jobs into an internal platform.
          </p>
        </div>
      </div>
    </section>
  );
}

function PlatformSection(): ReactNode {
  return (
    <section className={clsx(styles.section, styles.sectionTint)}>
      <div className={clsx('container', styles.inviteLayout)}>
        <div>
          <p className={styles.eyebrow}>What Playrunner replaces</p>
          <Heading as="h2" className={styles.sectionTitle}>
            One orchestration layer instead of another internal execution
            platform.
          </Heading>
        </div>
        <div>
          <p className={styles.bodyText}>
            Without a shared layer, runner provisioning, conditional execution,
            retries, schedules, API endpoints, webhooks, notifications, artefact
            storage, and reporting spread across CI configuration and team-owned
            services. Playrunner puts those responsibilities behind one workflow
            model while leaving your tests and CI system in place.
          </p>
        </div>
      </div>
    </section>
  );
}

function JourneySection(): ReactNode {
  return (
    <section className={styles.section}>
      <div className="container">
        <div className={styles.sectionHeader}>
          <p className={styles.eyebrow}>How it fits</p>
          <Heading as="h2" className={styles.sectionTitle}>
            Keep your suite. Change how it runs.
          </Heading>
          <p className={styles.bodyText}>
            Playrunner sits around Playwright rather than replacing it. Start
            with one workflow and move only the execution concerns you no longer
            want to own.
          </p>
        </div>
        <div className={styles.reasonGrid}>
          {journeySteps.map((step) => (
            <article className={styles.reasonCard} key={step.title}>
              <Heading as="h3" className={styles.cardTitle}>
                {step.title}
              </Heading>
              <p className={styles.cardText}>{step.description}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function ValidationSection(): ReactNode {
  return (
    <section className={clsx(styles.section, styles.sectionTint)}>
      <div className={clsx('container', styles.validationLayout)}>
        <div>
          <p className={styles.eyebrow}>Early teams wanted</p>
          <Heading as="h2" className={styles.sectionTitle}>
            Already running Playwright? Help us test whether Playrunner removes
            the hard parts.
          </Heading>
        </div>
        <div>
          <p className={styles.bodyText}>
            We are looking for a few teams maintaining Playwright runner
            infrastructure, CI glue, scheduled suites, or custom integrations.
            Try one real workflow, tell us where the setup is still too
            complicated, and help shape what Playrunner should own next.
          </p>
          <div className={styles.validationActions}>
            <Link
              className="button button--primary button--lg"
              to="/docs/tutorials/getting-started"
            >
              Try it with your suite
            </Link>
            <Link
              className="button button--secondary button--lg"
              to="https://discord.gg/4zPdBy3DwU"
            >
              Talk to us about your setup
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function GettingStartedSection(): ReactNode {
  return (
    <section className={styles.section}>
      <div className="container">
        <div className={styles.sectionHeader}>
          <p className={styles.eyebrow}>Go deeper</p>
          <Heading as="h2" className={styles.sectionTitle}>
            Evaluate the parts that matter to your team.
          </Heading>
          <p className={styles.bodyText}>
            Start locally, inspect the execution model, or go directly to the
            runner and integration architecture.
          </p>
        </div>
        <div className={styles.startList}>
          {gettingStartedLinks.map((item) => (
            <Link className={styles.startLink} key={item.title} to={item.to}>
              <span>
                <strong>{item.title}</strong>
                <span>{item.description}</span>
              </span>
              <span aria-hidden="true">→</span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function Home(): ReactNode {
  const { siteConfig } = useDocusaurusContext();
  const customFields = siteConfig.customFields as DocsCustomFields | undefined;
  const localDocsLandingPath =
    customFields?.localDocsLandingPath?.trim() || '/';
  const localDocsLandingUrl = useBaseUrl(localDocsLandingPath);
  const shouldRedirectToSetupDocs =
    localDocsLandingPath !== '/' && localDocsLandingPath !== '/playrunner/';

  useEffect(() => {
    if (!shouldRedirectToSetupDocs) {
      return;
    }

    window.location.replace(localDocsLandingUrl);
  }, [localDocsLandingUrl, shouldRedirectToSetupDocs]);

  if (shouldRedirectToSetupDocs) {
    return (
      <Layout
        title={`Hello from ${siteConfig.title}`}
        description="Description will go into a meta tag in <head />"
      >
        <main className="container margin-vert--xl">
          <p>Opening setup docs…</p>
        </main>
      </Layout>
    );
  }

  return (
    <Layout
      title="Visual orchestration for Playwright"
      description="Orchestrate the Playwright tests you already have on a visual workflow canvas. Triggers, environments, branches, and runners, without the CI glue."
    >
      <HomepageHeader />
      <main>
        <MissionSection />
        <HomepageFeatures />
        <PlatformSection />
        <JourneySection />
        <ValidationSection />
        <GettingStartedSection />
      </main>
    </Layout>
  );
}

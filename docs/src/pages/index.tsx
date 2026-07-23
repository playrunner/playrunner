import { useEffect, useState, type ReactNode } from 'react';
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

type GitHubRepositoryResponse = {
  stargazers_count?: number;
};

const githubRepositoryOwner = 'playrunner';
const githubRepositoryName = 'playrunner';
const githubRepositoryUrl = `https://github.com/${githubRepositoryOwner}/${githubRepositoryName}`;
const githubStargazersUrl = `${githubRepositoryUrl}/stargazers`;
const githubFallbackStarCount = '1';

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

function formatStarCount(count: number): string {
  if (count < 1000) {
    return count.toLocaleString('en-US');
  }

  if (count < 1_000_000) {
    const thousands = count / 1000;
    const displayValue =
      thousands >= 10 ? Math.floor(thousands) : Math.floor(thousands * 10) / 10;
    return `${displayValue.toLocaleString('en-US')}k+`;
  }

  const millions = count / 1_000_000;
  const displayValue =
    millions >= 10 ? Math.floor(millions) : Math.floor(millions * 10) / 10;
  return `${displayValue.toLocaleString('en-US')}m+`;
}

function GitHubIcon(): ReactNode {
  return (
    <svg
      className={styles.githubStarsIcon}
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="currentColor"
        d="M8 0C3.58 0 0 3.64 0 8.13c0 3.59 2.29 6.63 5.47 7.71.4.07.55-.18.55-.39 0-.19-.01-.83-.01-1.5-2.01.38-2.53-.5-2.69-.96-.09-.24-.48-.96-.82-1.15-.28-.15-.68-.53-.01-.54.63-.01 1.08.59 1.23.83.72 1.23 1.87.88 2.33.67.07-.53.28-.88.51-1.08-1.78-.21-3.64-.91-3.64-4.02 0-.89.31-1.61.82-2.18-.08-.21-.36-1.04.08-2.15 0 0 .67-.22 2.2.83A7.48 7.48 0 0 1 8 3.93c.68 0 1.36.09 2 .27 1.53-1.05 2.2-.83 2.2-.83.44 1.11.16 1.94.08 2.15.51.57.82 1.29.82 2.18 0 3.12-1.87 3.81-3.65 4.02.29.25.54.74.54 1.5 0 1.08-.01 1.95-.01 2.22 0 .21.15.46.55.39A8.06 8.06 0 0 0 16 8.13C16 3.64 12.42 0 8 0Z"
      />
    </svg>
  );
}

function GitHubStarsBadge(): ReactNode {
  const [starCount, setStarCount] = useState<string>(githubFallbackStarCount);

  useEffect(() => {
    const controller = new AbortController();

    async function loadStarCount() {
      try {
        const response = await fetch(
          `https://api.github.com/repos/${githubRepositoryOwner}/${githubRepositoryName}`,
          { signal: controller.signal },
        );

        if (!response.ok) {
          return;
        }

        const repository = (await response.json()) as GitHubRepositoryResponse;

        if (typeof repository.stargazers_count === 'number') {
          setStarCount(formatStarCount(repository.stargazers_count));
        }
      } catch {
        if (!controller.signal.aborted) {
          setStarCount(githubFallbackStarCount);
        }
      }
    }

    loadStarCount();

    return () => controller.abort();
  }, []);

  return (
    <div
      className={styles.githubStars}
      aria-label={`GitHub stars for ${githubRepositoryOwner}/${githubRepositoryName}`}
    >
      <a
        className={styles.githubStarsButton}
        href={githubRepositoryUrl}
        target="_blank"
        rel="noopener noreferrer"
      >
        <GitHubIcon />
        <span>Star</span>
      </a>
      <a
        className={styles.githubStarsCount}
        href={githubStargazersUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`${githubRepositoryOwner}/${githubRepositoryName} has ${starCount} GitHub stars`}
      >
        <span aria-live="polite">{starCount}</span>
      </a>
    </div>
  );
}

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
          Orchestration for the Playwright tests you already have.
        </Heading>
        <p className={clsx('hero__subtitle', styles.heroSubtitle)}>
          Playrunner coordinates when and where your existing tests run, how
          workflows branch, what triggers them, and where the results go. Keep
          Playwright. Replace the runner infrastructure, CI glue, and
          orchestration code your team has to maintain.
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
          <GitHubStarsBadge />
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
              to="https://discord.gg/23yz25kat"
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
      title="Orchestration for Playwright"
      description="Run and orchestrate existing Playwright tests without building and maintaining your own execution platform."
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

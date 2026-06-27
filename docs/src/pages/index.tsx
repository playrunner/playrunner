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

type ContributorReason = {
  title: string;
  description: string;
};

type GettingStartedLink = {
  title: string;
  description: string;
  to: string;
};

type AssistantFocus = {
  title: string;
  description: string;
};

type GitHubRepositoryResponse = {
  stargazers_count?: number;
};

const githubRepositoryOwner = 'playrunner';
const githubRepositoryName = 'playrunner';
const githubRepositoryUrl = `https://github.com/${githubRepositoryOwner}/${githubRepositoryName}`;
const githubStargazersUrl = `${githubRepositoryUrl}/stargazers`;
const githubFallbackStarCount = '1';

const contributorReasons: ContributorReason[] = [
  {
    title: 'Own meaningful work',
    description:
      'Take responsibility for a real part of an early developer tool instead of only picking around the edges.',
  },
  {
    title: 'Work on hard testing problems',
    description:
      'Help solve orchestration, debugging, CI/CD, reporting, and flaky-test problems that teams hit every day.',
  },
  {
    title: 'Build useful experience',
    description:
      'Go deep on Playwright, React, runners, infrastructure, workflow systems, and modern test automation.',
  },
  {
    title: 'Shape the platform',
    description:
      'Influence technical direction, architecture, integrations, and contributor experience while the project is still flexible.',
  },
];

const gettingStartedLinks: GettingStartedLink[] = [
  {
    title: 'Read the contributing guide',
    description:
      'Review how the project is organised and where help is most useful.',
    to: '/docs/contributing',
  },
  {
    title: 'Pick a good first issue',
    description: 'Find a scoped task and make your first contribution.',
    to: 'https://github.com/playrunner/playrunner/issues?q=is%3Aissue%20is%3Aopen%20label%3A%22good%20first%20issue%22',
  },
  {
    title: 'Look at the roadmap',
    description:
      'See the larger areas that need technical design and implementation.',
    to: '/docs/roadmap',
  },
  {
    title: 'Join the discussion',
    description:
      'Ask questions, propose ideas, and coordinate with other contributors.',
    to: 'https://github.com/playrunner/playrunner/discussions',
  },
  {
    title: 'Run the project locally',
    description:
      'Start the app, API, runners, and docs site from your own machine.',
    to: '/docs/tutorials/getting-started',
  },
];

const assistantFocus: AssistantFocus[] = [
  {
    title: 'Explain integrations',
    description:
      'Help people understand how GitHub, Jira, Playwright, schedules, and future packages fit together.',
  },
  {
    title: 'Ground answers in data',
    description:
      'Use stored workspace data, docs, and site state as the source of truth.',
  },
  {
    title: 'Stay available everywhere',
    description:
      'Let people ask from any page without leaving the context they are already in.',
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
        <p className={styles.eyebrow}>Open-source Playwright orchestration</p>
        <Heading as="h1" className={clsx('hero__title', styles.heroTitle)}>
          <span style={{ color: 'var(--ifm-color-primary)' }}>Playrunner</span>{' '}
          - help build the open-source orchestration layer for Playwright
        </Heading>
        <p className={clsx('hero__subtitle', styles.heroSubtitle)}>
          Playrunner helps teams run, debug, analyse, and improve Playwright
          test automation with better orchestration, visibility, integrations,
          and AI-assisted workflows.
        </p>
        <div className={styles.heroActions}>
          <Link
            className="button button--primary button--lg"
            to="/docs/contributing"
          >
            Start contributing
          </Link>
          <GitHubStarsBadge />
          <Link
            className="button button--secondary button--lg"
            to="/docs/overview"
          >
            Read the docs
          </Link>
        </div>
      </div>
    </header>
  );
}

function MissionSection(): ReactNode {
  return (
    <section className={styles.section}>
      <div className={clsx('container', styles.sectionGrid)}>
        <div>
          <p className={styles.eyebrow}>Why Playrunner exists</p>
          <Heading as="h2" className={styles.sectionTitle}>
            Make test orchestration open, extensible, and developer-friendly.
          </Heading>
        </div>
        <p className={styles.leadText}>
          Playwright is powerful, but teams still end up stitching together CI
          scripts, dashboards, reports, alerts, flaky-test handling, and ticket
          workflows themselves. Playrunner exists to make that orchestration
          layer open, extensible, and developer-friendly.
        </p>
      </div>
    </section>
  );
}

function AssistantSection(): ReactNode {
  return (
    <section className={clsx(styles.section, styles.sectionTint)}>
      <div className={clsx('container', styles.assistantLayout)}>
        <div>
          <p className={styles.eyebrow}>Playrunner AI Assistant</p>
          <Heading as="h2" className={styles.sectionTitle}>
            A platform-wide assistant grounded in the data.
          </Heading>
          <p className={styles.bodyText}>
            Playrunner should include an assistant people can call from across
            the platform to ask about integrations, workflows, docs, and site
            behavior. It should answer from the data Playrunner already stores
            so the guidance stays tied to the current workspace and connected
            integrations.
          </p>
          <div className={styles.assistantActions}>
            <Link
              className="button button--primary button--md"
              to="/docs/contributing"
            >
              Read the contributing guide
            </Link>
          </div>
        </div>

        <div className={styles.assistantCard}>
          <Heading as="h3" className={styles.cardTitle}>
            What it should do
          </Heading>
          <ul className={styles.assistantList}>
            {assistantFocus.map((item) => (
              <li className={styles.assistantItem} key={item.title}>
                <strong>{item.title}</strong>
                <span>{item.description}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function ContributorInviteSection(): ReactNode {
  return (
    <section className={clsx(styles.section, styles.sectionTint)}>
      <div className={clsx('container', styles.inviteLayout)}>
        <div>
          <p className={styles.eyebrow}>Contributors wanted</p>
          <Heading as="h2" className={styles.sectionTitle}>
            Join early and help shape the project
          </Heading>
        </div>
        <p className={styles.bodyText}>
          Playrunner is early, which means contributors can have real influence
          over the architecture, developer experience, integrations, and
          roadmap. Whether you want to work on frontend, runners, integrations,
          infrastructure, documentation, or the Playrunner AI Assistant, there
          is room to own a meaningful part of the project.
        </p>
      </div>
    </section>
  );
}

function WhyContributeSection(): ReactNode {
  return (
    <section className={styles.section}>
      <div className="container">
        <div className={styles.sectionHeader}>
          <p className={styles.eyebrow}>Why contribute</p>
          <Heading as="h2" className={styles.sectionTitle}>
            Build public, useful developer tooling.
          </Heading>
          <p className={styles.bodyText}>
            The project needs people who care about reliable test automation,
            practical developer experience, and tools that teams can understand
            and extend.
          </p>
        </div>
        <div className={styles.reasonGrid}>
          {contributorReasons.map((reason) => (
            <article className={styles.reasonCard} key={reason.title}>
              <Heading as="h3" className={styles.cardTitle}>
                {reason.title}
              </Heading>
              <p className={styles.cardText}>{reason.description}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function GettingStartedSection(): ReactNode {
  return (
    <section className={clsx(styles.section, styles.sectionTint)}>
      <div className="container">
        <div className={styles.sectionHeader}>
          <p className={styles.eyebrow}>Start here</p>
          <Heading as="h2" className={styles.sectionTitle}>
            Choose a first step and get involved.
          </Heading>
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
      title="Join the Playrunner project"
      description="Help build Playrunner, the open-source orchestration layer for Playwright test automation."
    >
      <HomepageHeader />
      <main>
        <MissionSection />
        <AssistantSection />
        <ContributorInviteSection />
        <HomepageFeatures />
        <WhyContributeSection />
        <GettingStartedSection />
      </main>
    </Layout>
  );
}

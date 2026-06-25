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

type ContributorReason = {
  title: string;
  description: string;
};

type GettingStartedLink = {
  title: string;
  description: string;
  to: string;
};

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

function HomepageHeader() {
  return (
    <header className={clsx('hero', styles.heroBanner)}>
      <div className={clsx('container', styles.heroInner)}>
        <Logo
          className={styles.heroLogo}
          role="img"
          aria-label="Playrunner logo"
        />
        <p className={styles.eyebrow}>Open-source Playwright orchestration</p>
        <Heading as="h1" className={clsx('hero__title', styles.heroTitle)}>
          <span style={{ color: 'var(--ifm-color-primary)' }}>Playrunner</span> - help build the open-source orchestration layer for Playwright
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
          infrastructure, documentation, or AI-assisted testing workflows, there
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
        <ContributorInviteSection />
        <HomepageFeatures />
        <WhyContributeSection />
        <GettingStartedSection />
      </main>
    </Layout>
  );
}

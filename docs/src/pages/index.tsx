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
    description: 'Connect the repo. Your tests and config stay as they are.',
  },
  {
    title: '2. Choose where they run',
    description:
      'Local Docker, managed cloud runners, or your own infrastructure.',
  },
  {
    title: '3. Define the workflow',
    description:
      'Wire triggers, conditions, branches, and downstream systems on the canvas.',
  },
  {
    title: '4. Inspect the complete run',
    description:
      'Follow state and logs live. Reports and artefacts stay attached to the run.',
  },
];

const gettingStartedLinks: GettingStartedLink[] = [
  {
    title: 'Try Playrunner locally',
    description: 'Run the full stack against a real Playwright project.',
    to: '/docs/tutorials/getting-started',
  },
  {
    title: 'Understand workflow execution',
    description: 'How the API, orchestrator, and runners coordinate a run.',
    to: '/docs/local-dev/workflow-execution',
  },
  {
    title: 'Compare runner options',
    description: 'Local, cloud, and self-hosted execution architecture.',
    to: '/docs/runner-architecture',
  },
  {
    title: 'Browse integrations',
    description: 'Schedules, source control, messaging, and more.',
    to: '/docs/integration-packages',
  },
  {
    title: 'Contribute to the platform',
    description: 'Extend runners, integrations, reporting, or the product.',
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
          Keep the tests and config you already maintain. Wire triggers,
          environments, branches, and runners on a canvas, then watch state and
          logs stream back as the run executes.
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
          Not a test framework. Not a CI system.
        </p>
      </div>
    </header>
  );
}

function CanvasShowcase(): ReactNode {
  return (
    <section className={styles.showcase}>
      <div className="container">
        <figure className={styles.showcaseFigure}>
          <img
            className={styles.showcaseImage}
            src={useBaseUrl('/img/workflow-canvas.png')}
            alt="A Playrunner workflow mid-run: a smoke test branches on failure into an OpenAI analysis and a Jira bug, and on success through Slack, a regression suite, a report, and a deploy webhook. Individual nodes carry amber warning markers showing their own execution status."
            width={3148}
            height={1554}
            loading="lazy"
          />
          <figcaption className={styles.showcaseCaption}>
            Live run state on the canvas. Every node reports its own outcome,
            and the branch the run actually took is drawn between them.
          </figcaption>
        </figure>
      </div>
    </section>
  );
}

function MissionSection(): ReactNode {
  return (
    <section className={styles.section}>
      <div className={clsx('container', styles.sectionGrid)}>
        <div>
          <p className={styles.eyebrow}>The problem</p>
          <Heading as="h2" className={styles.sectionTitle}>
            Playwright runs the tests. Your team runs everything around them.
          </Heading>
        </div>
        <div>
          <p className={styles.leadText}>
            A reliable run needs more than a command. It needs compute, state,
            conditions, schedules, credentials, artefacts, and reporting, and
            teams end up building that themselves, one script at a time.
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
            One orchestration layer instead of another internal platform.
          </Heading>
        </div>
        <div>
          <p className={styles.bodyText}>
            Runner provisioning, retries, schedules, webhooks, notifications,
            and reporting move behind a single workflow model. Your tests and
            your CI system stay where they are.
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
            Start with one workflow and move only the execution you no longer
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
        <figure className={clsx(styles.showcaseFigure, styles.showcaseInline)}>
          <img
            className={styles.showcaseImage}
            src={useBaseUrl('/img/workflow-canvas-branch.png')}
            alt="A regression test node on the canvas splitting into two paths: a red failure branch into an OpenAI analysis and a Jira bug, and a green success branch into a Slack alert and a deploy webhook."
            width={2444}
            height={1454}
            loading="lazy"
          />
          <figcaption className={styles.showcaseCaption}>
            One result, two paths. Failures go to triage, passes go to deploy,
            and the condition lives on the connection rather than in a script.
          </figcaption>
        </figure>
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
            Already running Playwright? Help us remove the hard parts.
          </Heading>
        </div>
        <div>
          <p className={styles.bodyText}>
            We want a few teams already maintaining runner infrastructure or CI
            glue. Run one real workflow, tell us where it is still too hard, and
            shape what we build next.
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
        <CanvasShowcase />
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

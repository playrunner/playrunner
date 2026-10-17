import { useEffect, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useBaseUrl from '@docusaurus/useBaseUrl';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';
import Logo from '@site/static/img/playrunner-icon.svg';
import { OpenAIIcon } from '../../../packages/openai/src/frontend/OpenAIIcon';
import { GithubIcon } from '../../../packages/github/src/frontend/GithubIcon';
import PlaywrightLogo from '../../../packages/playwright/assets/playwright.svg';
import SlackLogo from '../../../packages/slack/assets/slack.svg';
import JiraLogo from '../../../packages/jira/assets/jira.svg';
import {
  JsonLd,
  organization,
  softwareApplication,
  website,
} from '@site/src/components/StructuredData';
import CliShowcase from '@site/src/components/CliShowcase';
import styles from './index.module.css';

function Arrow(): ReactNode {
  return <span aria-hidden="true">↗</span>;
}

function AgentMark({ agent }: { agent: string }): ReactNode {
  return agent === 'Codex' ? (
    <OpenAIIcon className={styles.agentIcon} />
  ) : (
    <span className={styles.claudeMark} aria-hidden="true">
      ✳
    </span>
  );
}

function RunPreview(): ReactNode {
  const [agent, setAgent] = useState('Codex');
  return (
    <figure className={styles.runPreview}>
      <div className={styles.previewTopline}>
        <span>
          <span className={styles.statusDot} /> Agent → Playrunner
        </span>
        <span className={styles.exampleLabel}>Example workflow</span>
      </div>
      <div
        className={styles.agentPicker}
        role="group"
        aria-label="Preview an AI assistant"
      >
        {['Codex', 'Claude'].map((name) => (
          <button
            key={name}
            type="button"
            aria-pressed={agent === name}
            onClick={() => setAgent(name)}
          >
            <AgentMark agent={name} /> {name}
          </button>
        ))}
        <span className={styles.mcpLabel}>Connected via MCP</span>
      </div>
      <div className={styles.conversation} aria-live="polite">
        <p className={styles.prompt}>
          “Run the checkout tests on staging. Show me what failed before we
          ship.”
        </p>
        <div className={styles.agentReply}>
          <AgentMark agent={agent} />
          <div>
            <strong>{agent}</strong>
            <p>
              I’ll run the suite with Playrunner, then inspect the results and
              report.
            </p>
          </div>
        </div>
      </div>
      <div
        className={styles.executionFlow}
        aria-label="Playrunner runs the tests and returns evidence"
      >
        <div>
          <span className={styles.flowIcon}>
            <Logo />
          </span>
          <strong>Playrunner</strong>
          <small>Orchestrate</small>
        </div>
        <span className={styles.connector} aria-hidden="true">
          →
        </span>
        <div>
          <span className={styles.flowIcon}>
            <PlaywrightLogo />
          </span>
          <strong>Playwright</strong>
          <small>Run real tests</small>
        </div>
        <span className={styles.connector} aria-hidden="true">
          →
        </span>
        <div>
          <span
            className={clsx(styles.flowIcon, styles.reportIcon)}
            aria-hidden="true"
          >
            ≡
          </span>
          <strong>Evidence</strong>
          <small>Inspect results</small>
        </div>
      </div>
      <div className={styles.runResult}>
        <div className={styles.resultHeader}>
          <span>checkout.spec.ts</span>
          <span className={styles.failed}>1 failed</span>
        </div>
        <div className={styles.resultRow}>
          <span className={styles.passed}>✓</span> Customer can add to cart{' '}
          <span>passed</span>
        </div>
        <div className={styles.resultRow}>
          <span className={styles.passed}>✓</span> Shipping total is correct{' '}
          <span>passed</span>
        </div>
        <div className={styles.resultRow}>
          <span className={styles.failed}>×</span> Payment confirmation appears{' '}
          <span className={styles.failed}>failed</span>
        </div>
        <div className={styles.resultFooter}>
          <span>Logs + Playwright report</span>
          <span>Ready for review</span>
        </div>
      </div>
      <figcaption>
        From test execution to evidence your agent can act on.
      </figcaption>
    </figure>
  );
}

function Hero(): ReactNode {
  return (
    <header className={styles.hero}>
      <div className={clsx(styles.container, styles.heroGrid)}>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>
            <span className={styles.statusDot} /> Testing for the age of AI
            agents
          </p>
          <Heading as="h1">
            Build with AI.
            <br />
            <span>
              Ship with
              <br className={styles.desktopBreak} /> confidence.
            </span>
          </Heading>
          <p className={styles.heroDescription}>
            Give Codex and Claude the power to run real Playwright tests,
            inspect failures, and bring back the evidence. Know what works
            before your users do.
          </p>
          <div className={styles.actions}>
            <Link
              className={clsx('button', styles.primaryButton)}
              to="/docs/mcp/connect"
            >
              Connect your AI agent <Arrow />
            </Link>
            <Link
              className={clsx('button', styles.secondaryButton)}
              to="#cli-in-action"
            >
              Watch the CLI in action <span aria-hidden="true">↓</span>
            </Link>
          </div>
          <p className={styles.heroNote}>
            Your tests. Your agent. Cloud or your own compute.
          </p>
          <div className={styles.agentSupport}>
            <span>Works with</span>
            <span>
              <AgentMark agent="Codex" /> Codex
            </span>
            <span>
              <AgentMark agent="Claude" /> Claude
            </span>
            <Link className={styles.moreClients} to="/docs/cli">
              + command line
            </Link>
          </div>
        </div>
        <RunPreview />
      </div>
      <div className={clsx(styles.container, styles.foundationStrip)}>
        <span>Built around your existing stack</span>
        <span>
          <PlaywrightLogo /> Playwright
        </span>
        <span>
          <GithubIcon /> GitHub
        </span>
        <span>
          <SlackLogo /> Slack
        </span>
        <span>
          <JiraLogo /> Jira
        </span>
        <Link to="/docs/integration-packages">
          Explore integrations <Arrow />
        </Link>
      </div>
    </header>
  );
}

const steps = [
  {
    number: '01',
    title: 'Bring your agent',
    description:
      'Connect your assistant through MCP. Give it access to your Playrunner projects, environments, and saved workflows.',
  },
  {
    number: '02',
    title: 'Run the real thing',
    description:
      'Use your existing Playwright suite against the environment that matters. Run on Cloud or a connected machine.',
  },
  {
    number: '03',
    title: 'Close the loop',
    description:
      'Review failures and reports with your agent. Make the fix, run the relevant tests again, and decide when to ship.',
  },
];

function HowItWorks(): ReactNode {
  return (
    <section className={styles.section}>
      <div className={styles.container}>
        <div className={styles.sectionIntro}>
          <p className={styles.eyebrow}>
            From generated code to tested software
          </p>
          <Heading as="h2" id="how-it-works">
            Your agent writes the code.
            <br />
            <span>Give it a way to prove it works.</span>
          </Heading>
          <p>
            A conversation starts the run. Real tests tell you what happened.
          </p>
        </div>
        <div className={styles.steps}>
          {steps.map((step) => (
            <article key={step.number}>
              <span className={styles.stepNumber}>{step.number}</span>
              <Heading as="h3">{step.title}</Heading>
              <p>{step.description}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function AgentConnections(): ReactNode {
  return (
    <section className={clsx(styles.section, styles.connectionsSection)}>
      <div className={styles.container}>
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>Stay in your flow</p>
            <Heading as="h2">
              Your favourite agent.
              <br />
              <span>Now with a testing team.</span>
            </Heading>
          </div>
          <p>
            Keep working where you already build. Playrunner connects your AI
            assistant to test execution and the results behind every run.
          </p>
        </div>
        <div className={styles.connections}>
          <article className={styles.connectionCard}>
            <div className={styles.connectionTop}>
              <AgentMark agent="Codex" />
              <span>MCP + skill</span>
            </div>
            <Heading as="h3">Codex</Heading>
            <p>
              Go from a coding task to a real test run. Create workflows, run
              your suite, and inspect the outcome from the same conversation.
            </p>
            <Link to="/docs/mcp/connect">
              Connect Codex <Arrow />
            </Link>
          </article>
          <article className={styles.connectionCard}>
            <div className={styles.connectionTop}>
              <AgentMark agent="Claude" />
              <span>MCP connection</span>
            </div>
            <Heading as="h3">Claude</Heading>
            <p>
              Bring test execution into your Claude workflow. Connect
              Playrunner’s remote MCP server to run tests and review the
              evidence.
            </p>
            <Link to="/docs/mcp/connect">
              Connect Claude <Arrow />
            </Link>
          </article>
          <article className={styles.connectionCard}>
            <div className={styles.connectionTop}>
              <span className={styles.codeMark} aria-hidden="true">
                ⌘
              </span>
              <span>Your tools, too</span>
            </div>
            <Heading as="h3">MCP & CLI</Heading>
            <p>
              Use another compatible MCP client, work from your terminal, or
              make test runs part of your existing development pipeline.
            </p>
            <Link to="/docs/mcp">
              Explore the developer tools <Arrow />
            </Link>
          </article>
        </div>
      </div>
    </section>
  );
}

function Evidence(): ReactNode {
  return (
    <section className={styles.section}>
      <div className={clsx(styles.container, styles.evidenceGrid)}>
        <div className={styles.evidenceCopy}>
          <p className={styles.eyebrow}>Confidence comes from evidence</p>
          <Heading as="h2">
            “Done” is a claim.
            <br />
            <span>Test results are proof.</span>
          </Heading>
          <p>
            Make real execution part of your agent’s development loop. Keep the
            context you need to understand a failure and verify the next fix.
          </p>
          <Link className={styles.textLink} to="/docs/mcp/tools">
            See what your agent can do <Arrow />
          </Link>
        </div>
        <div className={styles.evidenceList}>
          <article>
            <span aria-hidden="true">01 /</span>
            <div>
              <Heading as="h3">See what actually ran</Heading>
              <p>
                Execution state, test events, and logs show what happened beyond
                the agent’s response.
              </p>
            </div>
          </article>
          <article>
            <span aria-hidden="true">02 /</span>
            <div>
              <Heading as="h3">Investigate with context</Heading>
              <p>
                Playwright reports and captured artefacts stay attached to the
                run, ready for inspection.
              </p>
            </div>
          </article>
          <article>
            <span aria-hidden="true">03 /</span>
            <div>
              <Heading as="h3">Keep the release decision yours</Heading>
              <p>
                Review the results, coverage, and remaining failures before
                deciding what is ready to ship.
              </p>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}

function Infrastructure(): ReactNode {
  return (
    <section className={clsx(styles.section, styles.infrastructureSection)}>
      <div className={styles.container}>
        <div className={styles.sectionIntro}>
          <p className={styles.eyebrow}>Serious testing. Less setup.</p>
          <Heading as="h2">
            The execution layer
            <br />
            <span>your agent was missing.</span>
          </Heading>
        </div>
        <div className={styles.infrastructureGrid}>
          <Link to="/docs/integration-packages/playwright#suite-sharding">
            <span className={styles.featureSymbol} aria-hidden="true">
              ⤨
            </span>
            <Heading as="h3">Scale the run</Heading>
            <p>
              Automatic sharding distributes your suite across runners and
              brings the results back into one report.
            </p>
            <span className={styles.featureLink}>
              Explore sharding <Arrow />
            </span>
          </Link>
          <Link to="/docs/cli/local-workers">
            <span className={styles.featureSymbol} aria-hidden="true">
              ⌁
            </span>
            <Heading as="h3">Run where it matters</Heading>
            <p>
              Use managed Cloud compute or connect your own machine. Keep
              execution history and reports together.
            </p>
            <span className={styles.featureLink}>
              Choose your compute <Arrow />
            </span>
          </Link>
          <Link to="/docs/tutorials/authentication-profiles">
            <span className={styles.featureSymbol} aria-hidden="true">
              ◎
            </span>
            <Heading as="h3">Test beyond the login</Heading>
            <p>
              Reuse Authentication Profiles to test signed-in journeys, with
              browser sign-in handled on your device.
            </p>
            <span className={styles.featureLink}>
              Explore authentication <Arrow />
            </span>
          </Link>
        </div>
        <div className={styles.canvasNote}>
          <Logo />
          <p>
            Need more control? The visual workflow editor is there when you want
            to connect steps, inspect a run, or refine the flow.
          </p>
          <Link to="/docs/overview">
            Explore the platform <Arrow />
          </Link>
        </div>
      </div>
    </section>
  );
}

function FinalCallToAction(): ReactNode {
  return (
    <section className={styles.finalCta}>
      <div className={styles.container}>
        <p className={styles.eyebrow}>Build faster. Verify before you ship.</p>
        <Heading as="h2">
          Give your next release
          <br />
          <span>a little more confidence.</span>
        </Heading>
        <p>Connect your agent. Run your tests. See the evidence.</p>
        <div className={styles.actions}>
          <Link
            className={clsx('button', styles.primaryButton)}
            to="/docs/mcp/connect"
          >
            Connect your AI agent <Arrow />
          </Link>
          <Link
            className={clsx('button', styles.secondaryButton)}
            to="https://playrunner.cloud"
          >
            Explore Playrunner Cloud <Arrow />
          </Link>
        </div>
        <Link
          className={styles.selfHostLink}
          to="/docs/tutorials/getting-started"
        >
          Prefer to self-host? Start locally →
        </Link>
      </div>
    </section>
  );
}

export default function Home(): ReactNode {
  const { siteConfig } = useDocusaurusContext();
  const customFields = siteConfig.customFields as
    | { localDocsLandingPath?: string }
    | undefined;
  const localDocsLandingPath =
    customFields?.localDocsLandingPath?.trim() || '/';
  const localDocsLandingUrl = useBaseUrl(localDocsLandingPath);
  const shouldRedirectToSetupDocs =
    localDocsLandingPath !== '/' && localDocsLandingPath !== '/playrunner/';
  useEffect(() => {
    if (shouldRedirectToSetupDocs) window.location.replace(localDocsLandingUrl);
  }, [localDocsLandingUrl, shouldRedirectToSetupDocs]);
  if (shouldRedirectToSetupDocs) {
    return (
      <Layout
        title="Opening setup docs"
        description="Redirecting to the local Playrunner setup documentation."
      >
        <main className="container margin-vert--xl">
          <p>Opening setup docs…</p>
        </main>
      </Layout>
    );
  }
  const hasSearch = Boolean(
    (siteConfig.themeConfig as { algolia?: unknown } | undefined)?.algolia,
  );
  return (
    <Layout
      title="Build with AI. Ship with confidence."
      description="Connect Codex, Claude, and your AI agents to real Playwright test runs. Inspect failures, review the evidence, and ship with confidence using Playrunner."
      wrapperClassName={styles.landing}
    >
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@graph': [organization, website(hasSearch), softwareApplication],
        }}
      />
      <main>
        <Hero />
        <HowItWorks />
        <CliShowcase />
        <AgentConnections />
        <Evidence />
        <Infrastructure />
        <FinalCallToAction />
      </main>
    </Layout>
  );
}

import { useEffect, type ReactNode } from 'react';
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
import WorkflowShowcase from '@site/src/components/WorkflowShowcase';
import ReleasePreview from '@site/src/components/ReleasePreview';
import styles from './index.module.css';

function Arrow(): ReactNode {
  return <span aria-hidden="true">↗</span>;
}

function AgentMark({ agent }: { agent: string }): ReactNode {
  // Official client marks: geminicli.com/icon.png and antigravity.google/favicon.svg.
  const clientIcon = useBaseUrl(
    agent === 'Gemini CLI'
      ? '/img/clients/gemini-cli.png'
      : '/img/clients/antigravity.svg',
  );
  if (agent === 'Codex') {
    return <OpenAIIcon className={styles.agentIcon} />;
  }
  if (agent === 'Gemini CLI' || agent === 'Antigravity') {
    return <img className={styles.agentIcon} src={clientIcon} alt="" />;
  }
  return (
    <span className={styles.claudeMark} aria-hidden="true">
      ✳
    </span>
  );
}

function Hero(): ReactNode {
  return (
    <header className={styles.hero}>
      <div className={clsx(styles.container, styles.heroGrid)}>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>
            <span className={styles.statusDot} /> Testing infrastructure for AI
            agents
          </p>
          <Heading as="h1">
            Build with AI.
            <br />
            <span>
              Ship with
              <br /> confidence.
            </span>
          </Heading>
          <p className={styles.heroPromise}>
            Your agent keeps building. Playrunner keeps testing.
          </p>
          <p className={styles.heroDescription}>
            Let your AI agent start a focused check or full regression, continue
            working, then retrieve the results to investigate failures and
            verify fixes.
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
            Your Playwright tests. Saved workflows. Cloud or your own compute.
          </p>
          <div className={styles.agentSupport}>
            <span>Connect via MCP</span>
            <span>
              <AgentMark agent="Codex" /> Codex
            </span>
            <span>
              <AgentMark agent="Claude" /> Claude
            </span>
            <Link to="/docs/mcp/connect#gemini-cli">
              <AgentMark agent="Gemini CLI" /> Gemini CLI
            </Link>
            <Link to="/docs/mcp/connect#google-antigravity">
              <AgentMark agent="Antigravity" /> Antigravity
            </Link>
            <Link className={styles.moreClients} to="/docs/cli">
              + command line
            </Link>
          </div>
        </div>
        <ReleasePreview />
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
    title: 'Delegate the tests',
    description:
      'Your agent starts a saved workflow through MCP or the CLI. Reuse configured environments and Authentication Profiles instead of rebuilding the setup for every task.',
  },
  {
    number: '02',
    title: 'Keep the agent moving',
    description:
      'Playrunner runs the tests on Cloud or your connected machine. Your agent can continue other work while execution status, logs and results are recorded.',
  },
  {
    number: '03',
    title: 'Return to the evidence',
    description:
      'The agent checks the run for results and report links, investigates failures, then reruns the workflow to verify its fix. Evidence stays attached to each execution.',
  },
];

function HowItWorks(): ReactNode {
  return (
    <section className={styles.section}>
      <div className={styles.container}>
        <div className={styles.sectionIntro}>
          <p className={styles.eyebrow}>Delegate. Continue. Verify.</p>
          <Heading as="h2" id="how-it-works">
            Testing that outlives a tool call.
            <br />
            <span>Evidence your agent can come back to.</span>
          </Heading>
          <p>
            Start the run, keep working, then check the result. Playrunner keeps
            the testing context and evidence outside the conversation.
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
    <section
      className={clsx(styles.section, styles.connectionsSection)}
      aria-labelledby="agent-connections"
    >
      <div className={styles.container}>
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>
              One MCP connection. Your choice of agent.
            </p>
            <Heading as="h2" id="agent-connections">
              Your favourite agent.
              <br />
              <span>A testing workflow it can reuse.</span>
            </Heading>
          </div>
          <p>
            Bring testing to Codex, Claude, Gemini CLI, Antigravity, or another
            compatible MCP client. The same saved workflows. The same evidence.
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
              <AgentMark agent="Gemini CLI" />
              <span>Remote MCP</span>
            </div>
            <Heading as="h3">Gemini CLI</Heading>
            <p>
              Bring Playrunner’s testing tools to Google’s terminal agent.
              Configure the remote server and browser sign-in to get started.
            </p>
            <Link to="/docs/mcp/connect#gemini-cli">
              Set up Gemini CLI <Arrow />
            </Link>
          </article>
          <article className={styles.connectionCard}>
            <div className={styles.connectionTop}>
              <AgentMark agent="Antigravity" />
              <span>Remote MCP</span>
            </div>
            <Heading as="h3">Antigravity</Heading>
            <p>
              Add Playrunner as a custom MCP server in Google Antigravity. Give
              your agent access to saved workflows and test evidence.
            </p>
            <Link to="/docs/mcp/connect#google-antigravity">
              Set up Antigravity <Arrow />
            </Link>
          </article>
          <article className={styles.connectionCard}>
            <div className={styles.connectionTop}>
              <span className={styles.codeMark} aria-hidden="true">
                ⌘
              </span>
              <span>An open protocol</span>
            </div>
            <Heading as="h3">More MCP clients</Heading>
            <p>
              Use a client with remote Streamable HTTP and OAuth support.
              Connect once and give it the same Playrunner tools.
            </p>
            <Link to="/docs/mcp/connect#add-the-hosted-server">
              See connection requirements <Arrow />
            </Link>
          </article>
          <article className={styles.connectionCard}>
            <div className={styles.connectionTop}>
              <Logo className={styles.agentIcon} aria-hidden="true" />
              <span>Terminal & automation</span>
            </div>
            <Heading as="h3">Playrunner CLI</Heading>
            <p>
              Give shell-capable agents a command-line route to Playrunner.
              Start workflows, check execution status, and retrieve reports.
            </p>
            <Link to="/docs/cli">
              Explore the CLI <Arrow />
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
      description="Testing infrastructure for AI agents. Connect Codex, Claude, Gemini CLI, Antigravity, and compatible MCP clients to saved Playwright workflows and test evidence."
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
        <WorkflowShowcase />
        <FinalCallToAction />
      </main>
    </Layout>
  );
}

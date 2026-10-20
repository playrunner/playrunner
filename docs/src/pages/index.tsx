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
import ConnectAgentButton from '@site/src/components/ConnectAgentButton';
import styles from './index.module.css';

function Arrow(): ReactNode {
  return <span aria-hidden="true">↗</span>;
}

function AgentMark({ agent }: { agent: string }): ReactNode {
  // Client marks are saved locally from each provider's official website.
  const clientIcons: Record<string, string> = {
    'Gemini CLI': '/img/clients/gemini-cli.png',
    Antigravity: '/img/clients/antigravity.svg',
    Cursor: '/img/clients/cursor.svg',
    Grok: '/img/clients/grok.svg',
  };
  const clientIcon = useBaseUrl(clientIcons[agent] || '/');
  if (agent === 'Codex') {
    return <OpenAIIcon className={styles.agentIcon} />;
  }
  if (clientIcons[agent]) {
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
            <span className={styles.statusDot} /> A safety net for your AI agent
          </p>
          <Heading as="h1">
            Your AI builds.
            <br />
            <span>Playrunner protects what works.</span>
          </Heading>
          <p className={styles.heroPromise}>
            Give your agent the confidence to keep building.
          </p>
          <p className={styles.heroDescription}>
            Connect your agent to saved tests, ready-to-run environments and
            evidence it can return to. Keep checking the payments, bookings and
            customer journeys people depend on as your application grows.
          </p>
          <div className={styles.actions}>
            <ConnectAgentButton
              className={clsx('button', styles.primaryButton)}
            />
            <Link
              className={clsx('button', styles.secondaryButton)}
              to="#safety-net"
            >
              See how it works <span aria-hidden="true">↓</span>
            </Link>
          </div>
          <p className={styles.heroNote}>
            Repeatable tests. Detailed reports. A lasting test history.
          </p>
          <div className={styles.agentSupport}>
            <span>Works with</span>
            <span>
              <AgentMark agent="Codex" /> Codex
            </span>
            <span>
              <AgentMark agent="Claude" /> Claude
            </span>
            <Link to="/docs/mcp/connect#add-the-hosted-server">
              <AgentMark agent="Cursor" /> Cursor
            </Link>
            <Link to="/docs/mcp/connect#gemini-cli">
              <AgentMark agent="Gemini CLI" /> Gemini CLI
            </Link>
            <Link to="/docs/mcp/connect#google-antigravity">
              <AgentMark agent="Antigravity" /> Antigravity
            </Link>
            <Link to="/docs/mcp/connect#add-the-hosted-server">
              <AgentMark agent="Grok" /> Grok
            </Link>
            <Link className={styles.moreClients} to="/docs/cli">
              + command line
            </Link>
          </div>
        </div>
        <div className={styles.heroVisual}>
          <ReleasePreview />
        </div>
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

function SafetyNet(): ReactNode {
  return (
    <section
      className={styles.section}
      id="vibe-coders"
      aria-labelledby="safety-net"
    >
      <div className={clsx(styles.container, styles.evidenceGrid)}>
        <div className={styles.evidenceCopy}>
          <p className={styles.eyebrow}>The vision · Protection that grows</p>
          <Heading as="h2" id="safety-net">
            A new feature today.
            <br />
            <span>A safety net for tomorrow.</span>
          </Heading>
          <p>
            You’ve built something people depend on. Now you want to improve it
            without losing customer updates, stopping payments or breaking the
            booking flow.
          </p>
          <p>
            We’re building towards a growing set of agreed checks your agent
            carries into every change. Protection that lasts beyond one task,
            one conversation or one developer.
          </p>
          <div className={styles.actions}>
            <ConnectAgentButton
              className={clsx('button', styles.primaryButton)}
            />
            <Link
              className={clsx('button', styles.secondaryButton)}
              to="/docs/tutorials/run-your-first-test"
            >
              Run your first test <Arrow />
            </Link>
          </div>
        </div>
        <div className={styles.evidenceList}>
          <article>
            <span aria-hidden="true">01 /</span>
            <div>
              <Heading as="h3">Remember what must keep working</Heading>
              <p>
                Turn important journeys into saved tests. Reuse the same steps
                and pass/fail criteria as the application changes.
              </p>
            </div>
          </article>
          <article>
            <span aria-hidden="true">02 /</span>
            <div>
              <Heading as="h3">Give your agent evidence to act on</Heading>
              <p>
                Run the checks through Playrunner. Return the failing step,
                expected result and captured evidence so your agent can
                investigate and verify its fix.
              </p>
            </div>
          </article>
          <article>
            <span aria-hidden="true">03 /</span>
            <div>
              <Heading as="h3">Carry the history forward</Heading>
              <p>
                Keep earlier failures and subsequent runs available. Your next
                conversation—and the next person on your team—can pick up with
                the evidence intact.
              </p>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}

function AgentTestingWorkflow(): ReactNode {
  return (
    <section className={styles.section} aria-labelledby="agent-testing">
      <div className={styles.container}>
        <div className={styles.sectionIntro}>
          <p className={styles.eyebrow}>
            Built on Playwright. Ready for your agent.
          </p>
          <Heading as="h2" id="agent-testing">
            Your agent’s testing setup.
            <br />
            <span>Ready for the next conversation.</span>
          </Heading>
          <p>
            Playwright executes the tests. Playrunner brings the saved
            workflows, environments, authentication and run history together so
            your agent can operate them from one place.
          </p>
        </div>
        <div className={styles.agentWorkflow}>
          <article className={styles.workflowAgent}>
            <OpenAIIcon aria-hidden="true" />
            <Heading as="h3">Your AI agent</Heading>
            <p>Build. Request checks. Investigate. Fix.</p>
          </article>
          <span className={styles.workflowArrow} aria-hidden="true">
            ↔
          </span>
          <article className={styles.workflowPlatform}>
            <div className={styles.workflowBrand}>
              <Logo aria-hidden="true" />
              <Heading as="h3">Playrunner</Heading>
            </div>
            <div className={styles.workflowContext}>
              <span>Saved workflows</span>
              <span>Environments</span>
              <span>Authentication</span>
              <span>Run history</span>
            </div>
            <div className={styles.workflowExecutor}>
              <PlaywrightLogo aria-hidden="true" />
              <span>
                <strong>Playwright</strong> executes your tests
              </span>
            </div>
            <p>Results, logs and reports come back to your agent.</p>
          </article>
        </div>
      </div>
    </section>
  );
}

const discoverySteps = [
  {
    number: '01',
    title: 'Discover the affected projects',
    description:
      'Your agent would use Playrunner to find which connected projects use the component it changed.',
  },
  {
    number: '02',
    title: 'Test that component across them',
    description:
      'Run the component’s relevant checks across those projects while your agent continues another task. Keep the run focused on the change.',
  },
  {
    number: '03',
    title: 'Return the evidence to your agent',
    description:
      'Identify the affected project and failing step, with reports and traces to help your agent investigate, fix and check again.',
  },
];

function CrossProjectDiscovery(): ReactNode {
  return (
    <section
      className={styles.section}
      id="how-it-works"
      aria-labelledby="cross-project-discovery"
    >
      <div className={styles.container}>
        <div className={styles.sectionIntro}>
          <p className={styles.eyebrow}>
            Cross-project discovery · Product direction
          </p>
          <Heading as="h2" id="cross-project-discovery">
            One shared component.
            <br />
            <span>Every project that uses it.</span>
          </Heading>
          <p>
            Working across several projects? We’re building towards Playrunner
            discovering where a shared component is used and selecting its
            relevant tests. Change a country selector, discover five projects
            that use it, and check that control in each one.
          </p>
        </div>
        <div className={styles.steps}>
          {discoverySteps.map((step) => (
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
            Bring testing to Codex, Claude, Cursor, Gemini CLI, Antigravity,
            Grok, or another compatible MCP client. The same saved workflows.
            The same evidence.
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
              <AgentMark agent="Cursor" />
              <span>Remote MCP</span>
            </div>
            <Heading as="h3">Cursor</Heading>
            <p>
              Bring testing into your editor. Add Playrunner’s remote MCP server
              to Cursor and authorise access to your saved workflows and test
              reports.
            </p>
            <Link to="/docs/mcp/connect#add-the-hosted-server">
              Connect Cursor <Arrow />
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
              <AgentMark agent="Grok" />
              <span>Custom MCP</span>
            </div>
            <Heading as="h3">Grok</Heading>
            <p>
              Add Playrunner as a custom connector in Grok, or a remote MCP
              server in Grok Build. Use the connection to request test runs and
              inspect their results.
            </p>
            <Link to="/docs/mcp/connect#add-the-hosted-server">
              Connect Grok <Arrow />
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

function TokenEfficiency(): ReactNode {
  return (
    <section
      className={clsx(styles.section, styles.tokenSection)}
      aria-labelledby="agent-token-cost"
    >
      <div className={styles.container}>
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>
              Make your agent’s token budget go further
            </p>
            <Heading as="h2" id="agent-token-cost">
              Less repeated setup.
              <br />
              <span>More room for the fix.</span>
            </Heading>
          </div>
          <p>
            Every instruction and tool response your agent processes adds to its
            context. Playrunner can reduce repeated work by keeping test setup,
            execution history and reports ready to reuse.
          </p>
        </div>

        <div className={styles.tokenHandoff}>
          <div className={styles.savedContext}>
            <div className={styles.tokenPanelLabel}>
              <Logo aria-hidden="true" /> Saved in Playrunner
            </div>
            <h3>The testing context carries over.</h3>
            <div className={styles.savedItems}>
              <span>Workflow</span>
              <span>Environment</span>
              <span>Authentication Profile</span>
              <span>Reports &amp; traces</span>
            </div>
            <p>Set it up once. Reuse it in the next run or conversation.</p>
          </div>
          <span className={styles.handoffArrow} aria-hidden="true">
            →
          </span>
          <div className={styles.agentHandoff}>
            <div className={styles.tokenPanelLabel}>
              <OpenAIIcon aria-hidden="true" /> Your agent’s next run
              <span>Illustrative handoff</span>
            </div>
            <ol className={styles.handoffSteps}>
              <li>
                <span>01</span> Start the saved workflow.
              </li>
              <li>
                <span>02</span> Read new run events.
              </li>
              <li>
                <span>03</span> Open the evidence to investigate.
              </li>
            </ol>
          </div>
        </div>

        <div className={clsx(styles.steps, styles.tokenReasons)}>
          <article>
            <span className={styles.stepNumber}>01 / Reuse the setup</span>
            <Heading as="h3">Replay established checks.</Heading>
            <p>
              Start a saved workflow by its ID. Reuse the setup and run
              established tests without asking the model to reason through every
              browser step again.
            </p>
          </article>
          <article>
            <span className={styles.stepNumber}>02 / Read new information</span>
            <Heading as="h3">Avoid reading the same log twice.</Heading>
            <p>
              Cloud run updates let your agent pick up where its last check
              ended, without fetching earlier events again. Choose when to check
              back; every poll still has a cost.
            </p>
          </article>
          <article>
            <span className={styles.stepNumber}>
              03 / Keep evidence available
            </span>
            <Heading as="h3">Open reports when they help.</Heading>
            <p>
              Reports and captured traces stay attached to the run. Your agent
              can follow those links when investigating, rather than copying
              whole report files into every conversation.
            </p>
          </article>
        </div>

        <div className={styles.tokenMeasurement}>
          <p>
            Actual token savings depend on your agent and workflow. Run updates
            can include logs. Test execution and any AI analysis steps have
            their own costs.
          </p>
          <details>
            <summary>How to measure the saving</summary>
            <p>
              Compare the same task, tests and failure using the same model:
              your current testing approach versus Playrunner. Record actual
              input, output and cached-token usage, including setup, polling and
              diagnosis. Compare first-run and repeat-run costs separately, and
              include Playrunner compute and any AI-step costs in the total.
            </p>
          </details>
        </div>
      </div>
    </section>
  );
}

function BusinessCritical(): ReactNode {
  return (
    <section className={styles.section} aria-labelledby="business-critical">
      <div className={clsx(styles.container, styles.evidenceGrid)}>
        <div className={styles.evidenceCopy}>
          <p className={styles.eyebrow}>
            From your first customer to enterprise
          </p>
          <Heading as="h2" id="business-critical">
            Protect the journeys
            <br />
            <span>your business runs on.</span>
          </Heading>
          <p>
            A booking flow. A customer payment. Two systems keeping thousands of
            records in sync. Give your agent repeatable checks for the behaviour
            your business relies on.
          </p>
          <p>
            For teams, the evidence is the handover. Developers can investigate
            failures, QA can review coverage, and release owners can see what
            passed, what failed and what wasn’t tested.
          </p>
          <Link
            className={styles.textLink}
            to="/docs/tutorials/understanding-reports"
          >
            Explore reports and history <Arrow />
          </Link>
        </div>
        <figure className={styles.businessExample}>
          <figcaption>Example · Two-way customer sync</figcaption>
          <div className={styles.connectedSystems}>
            <div>
              <span>01</span>
              <strong>Your CRM</strong>
            </div>
            <span className={styles.workflowArrow} aria-hidden="true">
              ↔
            </span>
            <div>
              <span>02</span>
              <strong>Policy platform</strong>
            </div>
          </div>
          <Heading as="h3">Both systems. Same customer.</Heading>
          <ul className={styles.businessChecks}>
            <li>
              <span aria-hidden="true">↗</span> A customer update reaches the
              other system.
            </li>
            <li>
              <span aria-hidden="true">↔</span> Conflicting edits preserve the
              right information.
            </li>
            <li>
              <span aria-hidden="true">↻</span> A retried sync creates no
              duplicate records.
            </li>
          </ul>
          <p>Agreed checks. Inspectable results. A record of every run.</p>
        </figure>
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
        <p className={styles.eyebrow}>Keep building on what works</p>
        <Heading as="h2">
          Give your AI agent
          <br />
          <span>a safety net.</span>
        </Heading>
        <p>
          Start with one journey your customers depend on. Keep the checks and
          evidence ready for every change that follows.
        </p>
        <div className={styles.actions}>
          <ConnectAgentButton
            className={clsx('button', styles.primaryButton)}
          />
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
      title="Your AI builds. Playrunner protects what works."
      description="Give your AI agent a safety net: saved testing workflows, repeatable Playwright checks, detailed reports and a lasting run history. From your first customer to the systems running your business."
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
        <SafetyNet />
        <AgentTestingWorkflow />
        <BusinessCritical />
        <TokenEfficiency />
        <CliShowcase />
        <AgentConnections />
        <Infrastructure />
        <CrossProjectDiscovery />
        <WorkflowShowcase />
        <FinalCallToAction />
      </main>
    </Layout>
  );
}

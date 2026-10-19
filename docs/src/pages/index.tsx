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
            <span className={styles.statusDot} /> Regression testing for AI
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
            Catch what your change breaks elsewhere.
          </p>
          <p className={styles.heroDescription}>
            A change can work perfectly in one place and break another.
            Playrunner checks the wider impact with focused regression tests,
            giving your agent real-time feedback while it keeps working.
          </p>
          <p className={styles.nextStep}>
            <span>Where we’re going</span> Follow the change. Find the affected
            journeys. Give your agent the failure it needs to fix.
          </p>
          <div className={styles.actions}>
            <ConnectAgentButton
              className={clsx('button', styles.primaryButton)}
            />
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

function VibeCoders(): ReactNode {
  return (
    <section className={styles.section} aria-labelledby="vibe-coders">
      <div className={clsx(styles.container, styles.evidenceGrid)}>
        <div className={styles.evidenceCopy}>
          <p className={styles.eyebrow}>Vibe Coders</p>
          <Heading as="h2" id="vibe-coders">
            Keep the vibe.
            <br />
            <span>Check the result.</span>
          </Heading>
          <p>
            You bring the idea. Your AI agent helps build it. Playrunner gives
            you a way to check that the important parts still work as your app
            changes—from signing in to saving a customer’s details.
          </p>
          <p>
            Start with one journey that matters. Ask your agent to help write a
            Playwright test, run it with Playrunner, and show you the result.
            Save the workflow so you can check it again after the next change.
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
              <Heading as="h3">Describe what should work</Heading>
              <p>
                “A new customer can sign up, log in, and save their profile.”
                Give your agent a clear outcome to turn into a repeatable test.
              </p>
            </div>
          </article>
          <article>
            <span aria-hidden="true">02 /</span>
            <div>
              <Heading as="h3">Make checking part of building</Heading>
              <p>
                Ask your connected agent to run the saved workflow after a
                change. Review failures together and rerun the check after a
                fix.
              </p>
            </div>
          </article>
          <article>
            <span aria-hidden="true">03 /</span>
            <div>
              <Heading as="h3">See the evidence before you ship</Heading>
              <p>
                Review what passed, what failed, and what wasn’t tested. Open
                the report and captured traces to decide what needs attention.
              </p>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}

const steps = [
  {
    number: '01',
    title: 'Follow the change',
    description:
      'The plan: trace a change through shared components, dependencies and connected projects to find the journeys it could affect.',
  },
  {
    number: '02',
    title: 'Check the paths it touches',
    description:
      'Select regressions for the affected journeys and run them in parallel with your agent’s work. Widen the run when impact is unclear; keep full regression available when the release needs it.',
  },
  {
    number: '03',
    title: 'Tell the agent what broke',
    description:
      'Show your agent where a regression happened, with the failing step and evidence from before and after the change, so it can investigate and verify a fix.',
  },
];

function HowItWorks(): ReactNode {
  return (
    <section className={styles.section}>
      <div className={styles.container}>
        <div className={styles.sectionIntro}>
          <p className={styles.eyebrow}>
            Where we’re taking Playrunner · Product direction
          </p>
          <Heading as="h2" id="how-it-works">
            One small change.
            <br />
            <span>More than one place to break.</span>
          </Heading>
          <p>
            A fix can affect journeys your agent never touched—even in another
            project. We’re building towards checks that follow those
            connections, so you can catch that breakage without running the
            whole suite for every small fix.
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
        <p>Help your agent check beyond the screen it’s working on.</p>
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
      title="Build with AI. Ship with confidence."
      description="Catch what your change breaks elsewhere. Run saved regression workflows with your AI agent, and explore Playrunner’s direction for change-aware testing."
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
        <VibeCoders />
        <HowItWorks />
        <TokenEfficiency />
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

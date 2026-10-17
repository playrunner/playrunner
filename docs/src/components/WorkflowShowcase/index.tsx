import { useState } from 'react';
import Link from '@docusaurus/Link';
import Heading from '@theme/Heading';
import useBaseUrl from '@docusaurus/useBaseUrl';
import { OpenAIIcon } from '../../../../packages/openai/src/frontend/OpenAIIcon';
import PlaywrightLogo from '../../../../packages/playwright/assets/playwright.svg';
import SlackLogo from '../../../../packages/slack/assets/slack.svg';
import JiraLogo from '../../../../packages/jira/assets/jira.svg';
// Use the editor's dimensions, port positions and connector paths.
import { getNodeDimensions } from '../../../../apps/runners/shared/workflow-geometry';
import {
  getPortCoordinates,
  renderCurve,
} from '../../../../apps/frontend/src/components/workflow/geometry';
import styles from './styles.module.css';

type Integration = 'playwright' | 'openai' | 'slack' | 'jira';
type Node = {
  id: string;
  nodeType: Integration;
  label: string;
  detail: string;
  x: number;
  y: number;
};
type Edge = {
  from: string;
  to: string;
  type: 'failure' | 'success' | 'sequential';
};
const icons = {
  playwright: PlaywrightLogo,
  openai: OpenAIIcon,
  slack: SlackLogo,
  jira: JiraLogo,
};
const examples: {
  title: string;
  subtitle: string;
  description: string;
  guide: string;
  nodes: Node[];
  edges: Edge[];
}[] = [
  {
    title: 'Make failures actionable',
    subtitle: 'Playwright → OpenAI → Slack + Jira',
    description:
      'When a test fails, summarise the evidence with OpenAI. Send the summary to Slack and create a Jira bug so the team can investigate.',
    guide: '/docs/use-cases/ai-triage-for-playwright-test-failures',
    nodes: [
      {
        id: 'tests',
        nodeType: 'playwright',
        label: 'Run checkout tests',
        detail: 'Playwright',
        x: 50,
        y: 172,
      },
      {
        id: 'ai',
        nodeType: 'openai',
        label: 'Summarise failures',
        detail: 'OpenAI · structured output',
        x: 350,
        y: 172,
      },
      {
        id: 'slack',
        nodeType: 'slack',
        label: 'Notify the team',
        detail: 'Slack · #qa-alerts',
        x: 670,
        y: 44,
      },
      {
        id: 'jira',
        nodeType: 'jira',
        label: 'Create a bug',
        detail: 'Jira · engineering',
        x: 670,
        y: 320,
      },
    ],
    edges: [
      { from: 'tests', to: 'ai', type: 'failure' },
      { from: 'ai', to: 'slack', type: 'sequential' },
      { from: 'ai', to: 'jira', type: 'sequential' },
    ],
  },
  {
    title: 'Keep the team in the loop',
    subtitle: 'Route passing and failing runs',
    description:
      'Send passing runs to a quiet channel and failed runs to the people who need to know. Success and failure connections choose the path.',
    guide: '/docs/use-cases/slack-alerts-for-failed-playwright-tests',
    nodes: [
      {
        id: 'tests',
        nodeType: 'playwright',
        label: 'Run regression tests',
        detail: 'Playwright',
        x: 180,
        y: 172,
      },
      {
        id: 'passed',
        nodeType: 'slack',
        label: 'Share passing runs',
        detail: 'Slack · #qa-runs',
        x: 600,
        y: 44,
      },
      {
        id: 'failed',
        nodeType: 'slack',
        label: 'Flag failed runs',
        detail: 'Slack · #qa-alerts',
        x: 600,
        y: 320,
      },
    ],
    edges: [
      { from: 'tests', to: 'passed', type: 'success' },
      { from: 'tests', to: 'failed', type: 'failure' },
    ],
  },
  {
    title: 'Turn a failure into a ticket',
    subtitle: 'Playwright → Jira → Slack',
    description:
      'Create a Jira bug when your suite fails, then share the ticket with the team. Keep the handoff connected to the test run that started it.',
    guide: '/docs/use-cases/create-jira-bugs-from-failed-playwright-tests',
    nodes: [
      {
        id: 'tests',
        nodeType: 'playwright',
        label: 'Run smoke tests',
        detail: 'Playwright',
        x: 50,
        y: 172,
      },
      {
        id: 'jira',
        nodeType: 'jira',
        label: 'Create a bug',
        detail: 'Jira · test failure',
        x: 350,
        y: 172,
      },
      {
        id: 'slack',
        nodeType: 'slack',
        label: 'Share the ticket',
        detail: 'Slack · #engineering',
        x: 670,
        y: 172,
      },
    ],
    edges: [
      { from: 'tests', to: 'jira', type: 'failure' },
      { from: 'jira', to: 'slack', type: 'sequential' },
    ],
  },
];

function WorkflowNode({ node, edges }: { node: Node; edges: Edge[] }) {
  const Icon = icons[node.nodeType];
  const { width, height } = getNodeDimensions(node);
  const href = useBaseUrl(`/docs/integration-packages/${node.nodeType}/`);
  const input = edges.some((edge) => edge.to === node.id);
  const output = edges.some((edge) => edge.from === node.id);
  return (
    <a
      href={href}
      className={styles.node}
      aria-label={`${node.label}: explore ${node.nodeType} integration`}
    >
      <title>{node.detail} — open integration guide</title>
      <rect
        className={styles.nodeBody}
        x={node.x}
        y={node.y}
        width={width}
        height={height}
        rx="12"
      />
      <svg
        x={node.x + (width - 64) / 2}
        y={node.y + (height - 64) / 2}
        width="64"
        height="64"
        viewBox="0 0 64 64"
        aria-hidden="true"
      >
        <Icon width="64" height="64" />
      </svg>
      {input && (
        <circle
          className={styles.port}
          cx={node.x}
          cy={node.y + height / 2}
          r="9"
        />
      )}
      {output && (
        <circle
          className={styles.port}
          cx={node.x + width}
          cy={node.y + height / 2}
          r="9"
        />
      )}
      <text
        className={styles.nodeLabel}
        x={node.x + width / 2}
        y={node.y + height + 28}
      >
        {node.label}
      </text>
      <text
        className={styles.nodeDetail}
        x={node.x + width / 2}
        y={node.y + height + 51}
      >
        {node.detail}
      </text>
    </a>
  );
}

export default function WorkflowShowcase() {
  const [selected, setSelected] = useState(0);
  const example = examples[selected];
  return (
    <section
      className={styles.section}
      aria-labelledby="workflow-showcase-heading"
    >
      <div className={styles.container}>
        <p className={styles.eyebrow}>Your tools. One connected workflow.</p>
        <Heading as="h2" id="workflow-showcase-heading">
          Great tests don’t stop at a result.
          <br />
          <span>Connect what happens next.</span>
        </Heading>
        <p className={styles.intro}>
          Bring your tests, AI and team tools together. Let your agent build the
          flow, then inspect every connection in Playrunner.
        </p>
        <div className={styles.showcase}>
          <div
            className={styles.choices}
            role="group"
            aria-label="Choose an integration workflow"
          >
            {examples.map((item, index) => (
              <button
                type="button"
                key={item.title}
                aria-pressed={selected === index}
                aria-controls="workflow-example"
                onClick={() => setSelected(index)}
              >
                <span className={styles.number}>0{index + 1}</span>
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.subtitle}</small>
                </span>
              </button>
            ))}
            <Link className={styles.browse} to="/docs/integration-packages">
              Explore all integrations <span aria-hidden="true">↗</span>
            </Link>
          </div>
          <div className={styles.canvas} id="workflow-example">
            <div className={styles.canvasHeader}>
              <span>
                <i /> Workflow preview
              </span>
              <span>Connected with Playrunner</span>
            </div>
            <div
              className={styles.graphScroll}
              role="region"
              aria-label="Workflow diagram; scroll horizontally on small screens"
              tabIndex={0}
            >
              <svg
                key={selected}
                className={styles.graph}
                viewBox="0 0 900 530"
                role="group"
                aria-label={example.subtitle}
              >
                {example.edges.map((edge) => {
                  const source = example.nodes.find(
                    (node) => node.id === edge.from,
                  )!;
                  const target = example.nodes.find(
                    (node) => node.id === edge.to,
                  )!;
                  const start = getPortCoordinates(source, 'right');
                  const end = getPortCoordinates(target, 'left');
                  const path = renderCurve(
                    start.x,
                    start.y,
                    end.x,
                    end.y,
                    'right',
                    'left',
                    'bezier',
                  );
                  const labelX = (start.x + end.x) / 2;
                  const labelY = (start.y + end.y) / 2 - 16;
                  const label =
                    edge.type === 'failure'
                      ? 'On failure'
                      : edge.type === 'success'
                        ? 'On success'
                        : 'Then';
                  return (
                    <g
                      key={`${edge.from}-${edge.to}`}
                      className={styles[edge.type]}
                      aria-hidden="true"
                    >
                      <path d={path} className={styles.edge} />
                      <path d={path} className={styles.pulse} />
                      <rect
                        className={styles.edgeLabelBg}
                        x={labelX - 43}
                        y={labelY - 14}
                        width="86"
                        height="23"
                        rx="6"
                      />
                      <text
                        className={styles.edgeLabel}
                        x={labelX}
                        y={labelY + 2}
                      >
                        {label}
                      </text>
                    </g>
                  );
                })}
                {example.nodes.map((node) => (
                  <WorkflowNode
                    key={node.id}
                    node={node}
                    edges={example.edges}
                  />
                ))}
              </svg>
            </div>
            <div className={styles.caption} aria-live="polite">
              <p>{example.description}</p>
              <Link to={example.guide}>
                Build this workflow <span aria-hidden="true">↗</span>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

import { useEffect, useRef, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import Heading from '@theme/Heading';
import styles from './styles.module.css';

type Scene = {
  title: string;
  command: string;
  output: string[];
  surface: string;
  heading: string;
  detail: string;
  status: string;
};
type Demo = {
  id: string;
  label: string;
  title: string;
  description: string;
  prerequisite: string;
  guide: string;
  scenes: Scene[];
};

// Commands and output follow packages/cli/src/{companion,run,worker}.ts.
// Browser cards and test events are illustrative, not recordings of a live run.
const demos: Demo[] = [
  {
    id: 'authentication',
    label: 'Authentication Profile',
    title: 'A real sign-in. A reusable session.',
    description:
      'Pair your computer from the terminal, create a profile with your agent or in Cloud, then capture your browser session for authenticated tests.',
    prerequisite:
      'Start with the CLI installed, Chrome available, and a Playrunner Cloud account.',
    guide: '/docs/cli/authentication-companion',
    scenes: [
      {
        title: 'Pair your computer',
        command: 'playrunner login',
        output: [
          'Pairing code: DEMO-1234',
          'Paired demo-laptop with Playrunner Cloud. Run "playrunner auth connect" to accept authentication requests.',
        ],
        surface: 'Browser · Playrunner Cloud',
        heading: 'Approve your device',
        detail:
          'Check the matching pairing code in the browser and approve this computer.',
        status: 'Device paired',
      },
      {
        title: 'Create the profile',
        command: 'playrunner auth connect',
        output: ['Playrunner authentication companion is connected.'],
        surface: 'Cloud or your AI assistant',
        heading: 'Create “Staging customer”',
        detail:
          'Set the login URL and success condition. Select your online device, then request authentication. Keep this terminal running.',
        status: 'Profile ready to authenticate',
      },
      {
        title: 'Sign in with Chrome',
        command: 'playrunner auth connect',
        output: ['Playrunner authentication companion is connected.'],
        surface: 'Chrome · Your application',
        heading: 'Complete your normal sign-in',
        detail:
          'Chrome opens on your paired computer. Complete sign-in and MFA in the browser, then press Enter in the companion terminal.',
        status: 'Waiting for your sign-in',
      },
      {
        title: 'Reuse the captured session',
        command: 'playrunner auth connect',
        output: [
          'Playrunner authentication companion is connected.',
          'Authentication Profile capture completed.',
        ],
        surface: 'Cloud · Authentication Profiles',
        heading: 'Staging customer',
        detail:
          'Attach the authenticated profile to a Playwright step. Run the workflow to verify the session against your application.',
        status: 'Authenticated',
      },
    ],
  },
  {
    id: 'workflow',
    label: 'Run a workflow',
    title: 'One command. Follow the whole run.',
    description:
      'Start a saved workflow from your terminal or CI, stream its progress, and wait for the outcome. Then inspect the test evidence in Playrunner.',
    prerequisite:
      'Set PLAYRUNNER_API_KEY in your environment and WORKFLOW_ID to a saved workflow. Test events below are sample data.',
    guide: '/docs/cli/run-workflow',
    scenes: [
      {
        title: 'Start a saved workflow',
        command:
          'playrunner "$WORKFLOW_ID" \\\n  --url https://playrunner.cloud \\\n  --timeout 10m',
        output: ['Workflow started: demo-execution'],
        surface: 'Playrunner · Execution',
        heading: 'Checkout smoke tests',
        detail:
          'The CLI starts the saved workflow and waits for completion by default.',
        status: 'Execution started',
      },
      {
        title: 'Follow the test events',
        command:
          'playrunner "$WORKFLOW_ID" \\\n  --url https://playrunner.cloud \\\n  --timeout 10m',
        output: [
          'Workflow started: demo-execution',
          '✓ Customer can add to cart',
          '✓ Shipping total is correct',
        ],
        surface: 'Playwright · Sample events',
        heading: 'Tests running',
        detail:
          'Progress messages from the workflow stream back to your terminal as the run proceeds.',
        status: 'Execution in progress',
      },
      {
        title: 'Wait for the outcome',
        command:
          'playrunner "$WORKFLOW_ID" \\\n  --url https://playrunner.cloud \\\n  --timeout 10m',
        output: [
          'Workflow started: demo-execution',
          '✓ Customer can add to cart',
          '✓ Shipping total is correct',
          '✓ Payment confirmation appears',
          'Workflow completed: demo-execution',
        ],
        surface: 'Terminal · Exit status',
        heading: 'Workflow completed',
        detail:
          'Completed workflows exit with code 0. Failed or cancelled workflows, errors, and timeouts return a non-zero code.',
        status: 'Exit code 0',
      },
      {
        title: 'Review the evidence',
        command:
          'playrunner "$WORKFLOW_ID" \\\n  --url https://playrunner.cloud \\\n  --timeout 10m',
        output: [
          'Workflow started: demo-execution',
          '✓ Customer can add to cart',
          '✓ Shipping total is correct',
          '✓ Payment confirmation appears',
          'Workflow completed: demo-execution',
        ],
        surface: 'Playrunner · Reports',
        heading: 'Review before you release',
        detail:
          'Open the run in Playrunner to inspect test results, logs, and reports. A completed workflow alone is not proof that every test passed.',
        status: 'Evidence ready for review',
      },
    ],
  },
  {
    id: 'worker',
    label: 'Use your own compute',
    title: 'Your machine. Connected to your agent.',
    description:
      'Let your laptop, server, or VM run the tests while Playrunner Cloud coordinates the workflow and keeps the reports together.',
    prerequisite:
      'Requires CLI 0.3.0+, Node.js 20+, Docker running, and a paired device. Use a supported TypeScript workflow with sharding disabled.',
    guide: '/docs/cli/local-workers',
    scenes: [
      {
        title: 'Prepare the runner',
        command: 'playrunner worker prepare',
        output: [],
        surface: 'Docker · Local machine',
        heading: 'Build the test runner',
        detail:
          'Prepare the local Docker image. Wait for the build to finish before connecting the worker.',
        status: 'Runner image prepared',
      },
      {
        title: 'Connect your compute',
        command:
          'playrunner worker connect \\\n  --url https://playrunner.cloud \\\n  --cpu 2 --memory 4',
        output: [
          'Local test worker connected to https://playrunner.cloud; one test step at a time, 2 CPU / 4 GiB.',
        ],
        surface: 'Playrunner · Your machines',
        heading: 'demo-laptop',
        detail:
          'Your paired computer appears online with its resource limits. Keep the terminal and Docker running.',
        status: 'Online · 2 CPU / 4 GiB',
      },
      {
        title: 'Choose the machine',
        command:
          'playrunner worker connect \\\n  --url https://playrunner.cloud \\\n  --cpu 2 --memory 4',
        output: [
          'Local test worker connected to https://playrunner.cloud; one test step at a time, 2 CPU / 4 GiB.',
        ],
        surface: 'Your AI assistant or Cloud',
        heading: 'Run on demo-laptop',
        detail:
          'Explicitly select the online machine in Cloud or ask your agent to use it. A connected worker is not selected automatically.',
        status: 'Machine selected',
      },
      {
        title: 'Keep the results together',
        command:
          'playrunner worker connect \\\n  --url https://playrunner.cloud \\\n  --cpu 2 --memory 4',
        output: [
          'Local test worker connected to https://playrunner.cloud; one test step at a time, 2 CPU / 4 GiB.',
        ],
        surface: 'Playrunner Cloud · Execution',
        heading: 'Local compute. Shared evidence.',
        detail:
          'Tests execute on your machine. Live logs, test metrics, reports, and captured artefacts remain available in Cloud.',
        status: 'Reports available in Cloud',
      },
    ],
  },
];

const SCENE_MS = 7000;

function Walkthrough({ demo }: { demo: Demo }): ReactNode {
  const playerRef = useRef<HTMLDivElement>(null);
  const [elapsed, setElapsed] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [visible, setVisible] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  const duration = demo.scenes.length * SCENE_MS;
  const finished = elapsed >= duration;
  const sceneIndex = Math.min(
    Math.floor(elapsed / SCENE_MS),
    demo.scenes.length - 1,
  );
  const scene = demo.scenes[sceneIndex];
  const sceneElapsed = finished ? SCENE_MS : elapsed % SCENE_MS;
  const previousScene = demo.scenes[sceneIndex - 1];
  const continuingCommand = previousScene?.command === scene.command;
  const previousLines = continuingCommand ? previousScene.output.length : 0;
  const typingDuration = continuingCommand
    ? 0
    : Math.min(scene.command.length * 24, 2000);
  const typedLength =
    reducedMotion || continuingCommand
      ? scene.command.length
      : Math.floor((sceneElapsed / typingDuration) * scene.command.length);
  const visibleLines = reducedMotion
    ? scene.output.length
    : previousLines +
      Math.max(0, Math.floor((sceneElapsed - typingDuration) / 550));

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updateMotion = () => {
      setReducedMotion(preference.matches);
      if (preference.matches) setPlaying(false);
    };
    updateMotion();
    preference.addEventListener('change', updateMotion);
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { threshold: 0.15 },
    );
    if (playerRef.current) observer.observe(playerRef.current);
    const updateVisibility = () => setPageVisible(!document.hidden);
    updateVisibility();
    document.addEventListener('visibilitychange', updateVisibility);
    return () => {
      preference.removeEventListener('change', updateMotion);
      observer.disconnect();
      document.removeEventListener('visibilitychange', updateVisibility);
    };
  }, []);

  useEffect(() => {
    if (!playing || !visible || !pageVisible || finished || reducedMotion)
      return;
    let previous = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const delta = now - previous;
      previous = now;
      setElapsed((value) => Math.min(value + delta, duration));
    }, 50);
    return () => window.clearInterval(timer);
  }, [playing, visible, pageVisible, finished, reducedMotion, duration]);

  function selectScene(index: number) {
    setElapsed(index * SCENE_MS + SCENE_MS - 500);
    setPlaying(false);
  }

  return (
    <div ref={playerRef} className={styles.walkthrough}>
      <div
        className={styles.sceneButtons}
        role="group"
        aria-label="Walkthrough steps"
      >
        {demo.scenes.map((step, index) => (
          <button
            key={step.title}
            type="button"
            aria-pressed={index === sceneIndex}
            onClick={() => selectScene(index)}
          >
            <span>{String(index + 1).padStart(2, '0')}</span>
            {step.title}
          </button>
        ))}
      </div>
      <div className={styles.stage}>
        <div className={styles.terminal}>
          <div className={styles.terminalBar}>
            <span className={styles.windowDots} aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span>Terminal</span>
            <span>playrunner CLI</span>
          </div>
          <div className={styles.terminalBody} aria-hidden="true">
            <p className={styles.terminalComment}># {scene.title}</p>
            <pre className={styles.command}>
              <span className={styles.prompt}>$ </span>
              {scene.command.slice(0, typedLength)}
              {playing && !finished && !reducedMotion && (
                <span className={styles.cursor}>▍</span>
              )}
            </pre>
            <div className={styles.output}>
              {scene.output.slice(0, visibleLines).map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          </div>
          <div className={styles.terminalFoot}>
            <span className={styles.activityDot} /> Commands you can use. Sample
            output.
          </div>
        </div>
        <div className={styles.contextCard}>
          <div className={styles.contextBar}>
            <span aria-hidden="true">↗</span>
            {scene.surface}
          </div>
          <div className={styles.contextBody} key={scene.title}>
            <span className={styles.sceneNumber}>
              STEP {sceneIndex + 1} / {demo.scenes.length}
            </span>
            <Heading as="h3">{scene.heading}</Heading>
            <p>{scene.detail}</p>
            <span className={styles.status}>
              <span aria-hidden="true">
                {sceneIndex === demo.scenes.length - 1 ? '✓' : '→'}
              </span>
              {scene.status}
            </span>
          </div>
        </div>
      </div>
      <div className={styles.controls}>
        {!reducedMotion && (
          <button
            type="button"
            onClick={() => {
              if (finished) setElapsed(0);
              setPlaying(finished || !playing);
            }}
            aria-label={
              finished ? 'Replay demo' : playing ? 'Pause demo' : 'Play demo'
            }
          >
            <span aria-hidden="true">{playing && !finished ? 'Ⅱ' : '▶'}</span>
            {finished ? 'Replay' : playing ? 'Pause' : 'Play'}
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            setElapsed(0);
            setPlaying(!reducedMotion);
          }}
          aria-label="Restart demo"
        >
          ↺ <span>Restart</span>
        </button>
        {!reducedMotion && (
          <input
            aria-label="Demo timeline"
            type="range"
            min="0"
            max={duration}
            step="100"
            value={elapsed}
            aria-valuetext={`Step ${sceneIndex + 1}: ${scene.title}`}
            onChange={(event) => {
              setElapsed(Number(event.target.value));
              setPlaying(false);
            }}
          />
        )}
        <span className={styles.time}>
          {reducedMotion
            ? 'Select a step to explore'
            : `${Math.floor(elapsed / 1000)}s / ${duration / 1000}s`}
        </span>
      </div>
      <div className={styles.demoNotes}>
        <p>{demo.prerequisite}</p>
        <Link to={demo.guide}>
          Read the full guide <span aria-hidden="true">↗</span>
        </Link>
      </div>
      <details className={styles.transcript}>
        <summary>Read the walkthrough transcript</summary>
        <ol>
          {demo.scenes.map((step) => (
            <li key={step.title}>
              <strong>{step.title}</strong>
              <pre>
                <code>{step.command}</code>
              </pre>
              <p>{step.detail}</p>
              {step.output.length > 0 && <pre>{step.output.join('\n')}</pre>}
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}

export default function CliShowcase(): ReactNode {
  const [demoIndex, setDemoIndex] = useState(0);
  const demo = demos[demoIndex];
  return (
    <section className={styles.section} aria-labelledby="cli-in-action">
      <div className={styles.container}>
        <div className={styles.intro}>
          <p className={styles.eyebrow}>
            For you. For your agent. For your terminal.
          </p>
          <Heading as="h2" id="cli-in-action">
            A few commands.
            <br />
            <span>A lot more confidence.</span>
          </Heading>
          <p>
            See how the Playrunner CLI connects browser sessions, test
            workflows, and your own compute.
          </p>
        </div>
        <div
          className={styles.demoPicker}
          role="group"
          aria-label="Choose a CLI demo"
        >
          {demos.map((item, index) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={demoIndex === index}
              onClick={() => setDemoIndex(index)}
            >
              <span aria-hidden="true">{['◎', '▷', '⌁'][index]}</span>
              {item.label}
            </button>
          ))}
        </div>
        <div className={styles.demoHeading}>
          <div>
            <Heading as="h3">{demo.title}</Heading>
            <p>{demo.description}</p>
          </div>
          <span className={styles.demoBadge}>
            Animated walkthrough · Sample data
          </span>
        </div>
        <Walkthrough key={demo.id} demo={demo} />
        <div className={styles.install}>
          <code>npm install --global playrunner@latest</code>
          <Link to="/docs/cli">
            Explore the CLI <span aria-hidden="true">↗</span>
          </Link>
        </div>
      </div>
    </section>
  );
}

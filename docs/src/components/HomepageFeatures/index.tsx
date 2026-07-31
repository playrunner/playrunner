import type { ReactNode } from 'react';
import Heading from '@theme/Heading';
import styles from './styles.module.css';

type Capability = {
  title: string;
  description: string;
};

const capabilities: Capability[] = [
  {
    title: 'Existing Playwright suites',
    description: 'Your tests and config, unchanged. No framework to adopt.',
  },
  {
    title: 'Dedicated runners',
    description: 'Provision on demand: local, managed cloud, or self-hosted.',
  },
  {
    title: 'Workflow orchestration',
    description:
      'Conditions, parallel branches, shared environment data, dependent steps.',
  },
  {
    title: 'Schedules and triggers',
    description: 'Start on a schedule, an API call, or a webhook.',
  },
  {
    title: 'Artefacts and reporting',
    description: 'Logs, Playwright reports, and artefacts stay with the run.',
  },
  {
    title: 'Extensible integrations',
    description: 'Package-based plugins, plus a growing marketplace.',
  },
];

function CapabilityCard({ title, description }: Capability) {
  return (
    <article className={styles.areaCard}>
      <Heading as="h3" className={styles.areaTitle}>
        {title}
      </Heading>
      <p className={styles.areaDescription}>{description}</p>
    </article>
  );
}

export default function HomepageFeatures(): ReactNode {
  return (
    <section className={styles.features} aria-labelledby="capabilities-title">
      <div className="container">
        <div className={styles.sectionHeader}>
          <p className={styles.eyebrow}>The orchestration layer</p>
          <Heading
            as="h2"
            className={styles.sectionTitle}
            id="capabilities-title"
          >
            The operational pieces around a Playwright run.
          </Heading>
          <p className={styles.sectionCopy}>
            Use the parts you need. The workflow model stays the same as you
            grow.
          </p>
        </div>
        <div className={styles.areaGrid}>
          {capabilities.map((capability) => (
            <CapabilityCard key={capability.title} {...capability} />
          ))}
        </div>
      </div>
    </section>
  );
}

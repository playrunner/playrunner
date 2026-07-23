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
    description:
      'Run the tests and configuration you already maintain without adopting another test framework.',
  },
  {
    title: 'Dedicated runners',
    description:
      'Execute locally, on managed cloud runners, or inside infrastructure your team controls.',
  },
  {
    title: 'Workflow orchestration',
    description:
      'Model conditions, parallel branches, shared environment data, and dependent steps explicitly.',
  },
  {
    title: 'Schedules and triggers',
    description:
      'Start workflows on a schedule, through an API or webhook, or from an external system.',
  },
  {
    title: 'Artefacts and reporting',
    description:
      'Keep execution logs, Playwright reports, and run artefacts connected to the workflow.',
  },
  {
    title: 'Extensible integrations',
    description:
      'Add systems and execution behavior through package-based plugins and a growing marketplace.',
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
            Use the parts you need now. Keep the workflow model consistent as
            execution grows across teams, environments, and external systems.
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

import type { ReactNode } from 'react';
import Heading from '@theme/Heading';
import styles from './styles.module.css';

type ContributionArea = {
  title: string;
  description: string;
};

const contributionAreas: ContributionArea[] = [
  {
    title: 'Frontend and UX',
    description:
      'Help build a clean, modern interface for test runs, traces, workflows, and results.',
  },
  {
    title: 'Playwright runners',
    description:
      'Improve how tests are executed, scheduled, reported, retried, and analysed.',
  },
  {
    title: 'Integrations',
    description:
      'Build connections with GitHub, Jira, Slack, CI/CD systems, and developer workflows.',
  },
  {
    title: 'Flaky test analysis',
    description: 'Help detect, explain, and reduce unreliable tests.',
  },
  {
    title: 'Documentation and examples',
    description:
      'Make it easier for teams and new contributors to understand and adopt Playrunner.',
  },
  {
    title: 'Playrunner AI Assistant',
    description:
      'Build a grounded assistant that can explain integrations, docs, workflows, and site behavior across the platform.',
  },
];

function ContributionAreaCard({ title, description }: ContributionArea) {
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
    <section
      className={styles.features}
      aria-labelledby="contribution-areas-title"
    >
      <div className="container">
        <div className={styles.sectionHeader}>
          <p className={styles.eyebrow}>Where to help</p>
          <Heading
            as="h2"
            className={styles.sectionTitle}
            id="contribution-areas-title"
          >
            Contribution areas
          </Heading>
          <p className={styles.sectionCopy}>
            There are useful entry points across the product, runner stack,
            documentation, and integration surface.
          </p>
        </div>
        <div className={styles.areaGrid}>
          {contributionAreas.map((area) => (
            <ContributionAreaCard key={area.title} {...area} />
          ))}
        </div>
      </div>
    </section>
  );
}

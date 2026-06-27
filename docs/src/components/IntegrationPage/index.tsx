import type { ReactNode } from 'react';
import Link from '@docusaurus/Link';
import GcpLogo from '../../../../packages/gcp/assets/gcp.svg';
import GitHubLogo from '../../../../packages/github/assets/github.svg';
import JiraLogo from '../../../../packages/jira/assets/jira.svg';
import PlaywrightLogo from '../../../../packages/playwright/assets/playwright.svg';
import styles from './styles.module.css';

type IconKind =
  | 'environment'
  | 'gcp'
  | 'github'
  | 'javascript'
  | 'jira'
  | 'playwright'
  | 'schedule';

type Fact = {
  label: string;
  value: string;
};

function IntegrationIcon({ icon }: { icon: IconKind }) {
  return (
    <div className={`${styles.iconTile} ${styles[`${icon}Icon`]}`}>
      {renderIntegrationIcon(icon)}
    </div>
  );
}

function renderIntegrationIcon(icon: IconKind) {
  switch (icon) {
    case 'github':
      return <GitHubLogo aria-hidden="true" />;
    case 'gcp':
      return <GcpLogo aria-hidden="true" />;
    case 'jira':
      return <JiraLogo aria-hidden="true" />;
    case 'playwright':
      return <PlaywrightLogo aria-hidden="true" />;
    case 'environment':
      return (
        <svg
          aria-hidden="true"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
        >
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
    case 'javascript':
      return (
        <svg
          aria-hidden="true"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
        >
          <path d="m18 16 4-4-4-4" />
          <path d="m6 8-4 4 4 4" />
          <path d="m14.5 4-5 16" />
        </svg>
      );
    case 'schedule':
      return (
        <svg
          aria-hidden="true"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
        >
          <circle cx="12" cy="13" r="8" />
          <path d="M12 9v4l2 2" />
          <path d="M5 3 2 6" />
          <path d="m22 6-3-3" />
          <path d="M6.38 18.7 4 21" />
          <path d="M17.64 18.67 20 21" />
        </svg>
      );
    default:
      return null;
  }
}

export function IntegrationHero({
  name,
  packageName,
  description,
  icon,
  installCommand,
  npmUrl,
  badges = [],
  facts = [],
}: {
  name: string;
  packageName: string;
  description: string;
  icon: IconKind;
  installCommand: string;
  npmUrl: string;
  badges?: string[];
  facts?: Fact[];
}) {
  return (
    <section className={styles.hero}>
      <div className={styles.heroBody}>
        <IntegrationIcon icon={icon} />
        <div className={styles.heroCopy}>
          <p className={styles.packageName}>{packageName}</p>
          <h1>{name} Integration</h1>
          <p>{description}</p>
        </div>
      </div>

      <div className={styles.heroActions}>
        <a className={styles.primaryAction} href={npmUrl}>
          View on npm
        </a>
        <code className={styles.installCommand}>{installCommand}</code>
        {badges.length > 0 ? (
          <div className={styles.actionBadges}>
            {badges.map((badge) => (
              <span key={badge}>{badge}</span>
            ))}
          </div>
        ) : null}
      </div>

      {facts.length > 0 ? (
        <div className={styles.factGrid}>
          {facts.map((fact) => (
            <div key={fact.label} className={styles.fact}>
              <span>{fact.label}</span>
              <strong>{fact.value}</strong>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function IntegrationDirectoryHero({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className={styles.directoryHero}>
      <p>Playrunner integrations</p>
      <h1>{title}</h1>
      <div>{children}</div>
    </section>
  );
}

export function IntegrationDirectory({
  children,
}: {
  children: ReactNode;
}) {
  return <div className={styles.directory}>{children}</div>;
}

export function IntegrationDirectoryItem({
  name,
  packageName,
  description,
  icon,
  href,
  installCommand,
}: {
  name: string;
  packageName: string;
  description: string;
  icon: IconKind;
  href: string;
  installCommand: string;
}) {
  return (
    <Link className={styles.directoryItem} to={href}>
      <IntegrationIcon icon={icon} />
      <span>{packageName}</span>
      <h2>{name}</h2>
      <p>{description}</p>
      <code>{installCommand}</code>
    </Link>
  );
}

export function IntegrationGrid({ children }: { children: ReactNode }) {
  return <div className={styles.grid}>{children}</div>;
}

export function IntegrationCard({
  eyebrow,
  title,
  children,
}: {
  eyebrow?: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className={styles.card}>
      {eyebrow ? <span>{eyebrow}</span> : null}
      <h2>{title}</h2>
      <div>{children}</div>
    </section>
  );
}

export function IntegrationCallout({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <aside className={styles.callout}>
      <h2>{title}</h2>
      <div>{children}</div>
    </aside>
  );
}

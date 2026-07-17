import React, { type ReactNode } from 'react';
import clsx from 'clsx';
import { ThemeClassNames } from '@docusaurus/theme-common';
import type { Props } from '@theme/DocCard/Heading/Icon';
import AwsLogo from '../../../../../../apps/frontend/public/images/integrations/aws.svg';
import AzureLogo from '../../../../../../apps/frontend/public/images/integrations/azure.svg';
import GcpLogo from '../../../../../../packages/gcp/assets/gcp.svg';

import styles from './styles.module.css';

type CloudIconKind = 'aws' | 'azure' | 'gcp' | 'local';

function getItemText(item: Props['item']): string {
  const parts: string[] = [];

  if ('label' in item && typeof item.label === 'string') {
    parts.push(item.label);
  }

  if ('href' in item && typeof item.href === 'string') {
    parts.push(item.href);
  }

  if ('docId' in item && typeof item.docId === 'string') {
    parts.push(item.docId);
  }

  return parts.join(' ').toLowerCase();
}

function getCloudIconKind(item: Props['item']): CloudIconKind | null {
  const key = getItemText(item);

  if (key.includes('runner-architecture/gcp') || key.includes(' gcp ')) {
    return 'gcp';
  }

  if (key.includes('runner-architecture/aws') || key.includes(' aws ')) {
    return 'aws';
  }

  if (key.includes('runner-architecture/azure') || key.includes(' azure ')) {
    return 'azure';
  }

  if (key.includes('runner-architecture/local') || key.includes(' local ')) {
    return 'local';
  }

  return null;
}

function LocalIcon(): ReactNode {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8" />
      <path d="M12 16v4" />
    </svg>
  );
}

function renderCloudIcon(kind: CloudIconKind): ReactNode {
  switch (kind) {
    case 'aws':
      return <AwsLogo aria-hidden="true" />;
    case 'azure':
      return <AzureLogo aria-hidden="true" />;
    case 'gcp':
      return <GcpLogo aria-hidden="true" />;
    case 'local':
      return <LocalIcon />;
    default:
      return null;
  }
}

export default function DocCardHeadingIcon({ item, icon }: Props): ReactNode {
  const cloudIconKind = getCloudIconKind(item);

  return (
    <span
      className={clsx(
        ThemeClassNames.docs.docCard.icon,
        styles.cardTitleIcon,
        cloudIconKind && styles.cloudProviderIcon,
        cloudIconKind && styles[`${cloudIconKind}Icon`],
      )}
    >
      {cloudIconKind ? renderCloudIcon(cloudIconKind) : icon}
    </span>
  );
}

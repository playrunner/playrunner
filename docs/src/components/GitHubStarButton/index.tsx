import React, { type ReactNode } from 'react';
import clsx from 'clsx';

import styles from './styles.module.css';

const REPO_URL = 'https://github.com/playrunner/playrunner';

type Props = {
  className?: string;
};

// Stars are the metric we're chasing on the repo, so the ask sits at the foot
// of the sidebar on every docs page and blog post — visible the whole time
// someone is reading, without interrupting them.
export default function GitHubStarButton({ className }: Props): ReactNode {
  return (
    <div className={clsx(styles.container, className)}>
      <a
        className={styles.button}
        href={REPO_URL}
        target="_blank"
        rel="noopener noreferrer"
      >
        <svg
          className={styles.star}
          viewBox="0 0 16 16"
          width="16"
          height="16"
          aria-hidden="true"
        >
          <path
            fill="currentColor"
            d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.75.75 0 0 1-1.088.79L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z"
          />
        </svg>
        Star us on GitHub
      </a>
    </div>
  );
}

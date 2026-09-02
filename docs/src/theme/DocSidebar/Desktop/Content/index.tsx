import React, { type ReactNode } from 'react';
import Content from '@theme-original/DocSidebar/Desktop/Content';
import type ContentType from '@theme/DocSidebar/Desktop/Content';
import type { WrapperProps } from '@docusaurus/types';

import GitHubStarButton from '@site/src/components/GitHubStarButton';

type Props = WrapperProps<typeof ContentType>;

// The desktop doc sidebar is a flex column whose <nav> grows to fill it, so a
// sibling appended here lands at the bottom rather than after the last link.
export default function ContentWrapper(props: Props): ReactNode {
  return (
    <>
      <Content {...props} />
      <GitHubStarButton />
    </>
  );
}

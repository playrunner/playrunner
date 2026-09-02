import React, { type ReactNode } from 'react';
import Content from '@theme-original/BlogSidebar/Content';
import type ContentType from '@theme/BlogSidebar/Content';
import type { WrapperProps } from '@docusaurus/types';

import GitHubStarButton from '@site/src/components/GitHubStarButton';

type Props = WrapperProps<typeof ContentType>;

// Wrapping Content rather than BlogSidebar/Desktop keeps the button inside the
// sidebar's <nav>; wrapping Desktop would drop it outside the <aside>, into
// the page grid. This also puts it at the foot of the mobile blog drawer.
export default function ContentWrapper(props: Props): ReactNode {
  return (
    <>
      <Content {...props} />
      <GitHubStarButton />
    </>
  );
}

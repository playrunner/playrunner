import Head from '@docusaurus/Head';
import type { ReactNode } from 'react';

/**
 * Schema.org JSON-LD helpers.
 *
 * These are injected per page via <Head> rather than through a swizzled
 * SiteMetadata or a plugin's injectHtmlTags, both of which emit on every
 * route. Docusaurus already emits BlogPosting on blog posts, Blog on the blog
 * index, and BreadcrumbList on docs pages — duplicating any of those is worse
 * than omitting them, so only add schemas the theme does not already provide.
 */

export const SITE_URL = 'https://playrunner.dev';

const ORGANIZATION_ID = `${SITE_URL}/#organization`;
const WEBSITE_ID = `${SITE_URL}/#website`;

export function JsonLd({ data }: { data: unknown }): ReactNode {
  return (
    <Head>
      <script type="application/ld+json">{JSON.stringify(data)}</script>
    </Head>
  );
}

export const organization = {
  '@type': 'Organization',
  '@id': ORGANIZATION_ID,
  name: 'Playrunner',
  legalName: 'Concept AI PTY LTD',
  url: `${SITE_URL}/`,
  logo: `${SITE_URL}/img/icons/icon-512.png`,
  description:
    'Playrunner is a visual orchestration layer for Playwright test suites.',
  sameAs: [
    'https://github.com/playrunner/playrunner',
    'https://www.npmjs.com/org/playrunner',
    'https://discord.gg/4zPdBy3DwU',
  ],
};

/**
 * `hasSearch` gates the SearchAction. The /search route only exists when
 * Algolia DocSearch is configured, and advertising a sitelinks searchbox that
 * resolves to a 404 is worse than advertising none.
 */
export const website = (hasSearch: boolean) => ({
  '@type': 'WebSite',
  '@id': WEBSITE_ID,
  url: `${SITE_URL}/`,
  name: 'Playrunner',
  description:
    'Run Playwright at scale, without building the platform around it.',
  publisher: { '@id': ORGANIZATION_ID },
  inLanguage: 'en',
  ...(hasSearch
    ? {
        potentialAction: {
          '@type': 'SearchAction',
          target: {
            '@type': 'EntryPoint',
            urlTemplate: `${SITE_URL}/search?q={search_term_string}`,
          },
          'query-input': 'required name=search_term_string',
        },
      }
    : {}),
});

/**
 * Deliberately carries no aggregateRating or review. Playrunner has no
 * collected reviews, and fabricating them to win a star rating is a
 * manual-action risk.
 */
export const softwareApplication = {
  '@type': 'SoftwareApplication',
  '@id': `${SITE_URL}/#software`,
  name: 'Playrunner',
  applicationCategory: 'DeveloperApplication',
  applicationSubCategory: 'Test automation orchestration',
  operatingSystem: 'Linux, macOS, Windows (via Docker)',
  url: `${SITE_URL}/`,
  description:
    'Visual orchestration for Playwright test suites. Build workflows on a canvas instead of writing CI YAML, and run them locally, on managed cloud runners, or on your own infrastructure.',
  publisher: { '@id': ORGANIZATION_ID },
  offers: {
    '@type': 'Offer',
    price: '0',
    priceCurrency: 'USD',
    description:
      'Free to self-host under the Playrunner Sustainable Use License. Playrunner Cloud, the hosted version, is in beta.',
  },
};

export type FaqItem = { question: string; answer: string };

/**
 * Every question passed here must also be visible in the page body — FAQ
 * markup that is not rendered to the reader is a structured-data violation.
 */
export const faqPage = (items: FaqItem[]) => ({
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: items.map(({ question, answer }) => ({
    '@type': 'Question',
    name: question,
    acceptedAnswer: { '@type': 'Answer', text: answer },
  })),
});

export type Crumb = { name: string; url: string };

/**
 * Only needed on src/pages routes. Docs pages get BreadcrumbList from
 * @theme/DocBreadcrumbs automatically.
 */
export const breadcrumbs = (items: Crumb[]) => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: items.map(({ name, url }, index) => ({
    '@type': 'ListItem',
    position: index + 1,
    name,
    item: `${SITE_URL}${url}`,
  })),
});

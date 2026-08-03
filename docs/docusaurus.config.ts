import { themes as prismThemes } from 'prism-react-renderer';
import type { Config } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

// GitHub Pages serves production from the custom-domain root. Keep the existing
// project path for the local Docusaurus development server.
const baseUrl = process.env.NODE_ENV === 'production' ? '/' : '/playrunner/';

const algoliaAppId = process.env.ALGOLIA_APP_ID;
const algoliaApiKey = process.env.ALGOLIA_SEARCH_API_KEY;
const algoliaIndexName = process.env.ALGOLIA_INDEX_NAME;
const algoliaValues = [algoliaAppId, algoliaApiKey, algoliaIndexName];

if (algoliaValues.some(Boolean) && !algoliaValues.every(Boolean)) {
  throw new Error(
    'Algolia DocSearch requires ALGOLIA_APP_ID, ALGOLIA_SEARCH_API_KEY, and ALGOLIA_INDEX_NAME.',
  );
}

const algolia =
  algoliaAppId && algoliaApiKey && algoliaIndexName
    ? {
        appId: algoliaAppId,
        apiKey: algoliaApiKey,
        indexName: algoliaIndexName,
        contextualSearch: true,
        searchPagePath: 'search',
      }
    : undefined;

const config: Config = {
  title: 'Playrunner',
  tagline: 'Orchestration for Playwright test automation.',
  favicon: 'img/favicon.svg',
  customFields: {
    localDocsLandingPath: process.env.DOCS_LANDING_PATH || '/',
  },

  // Future flags, see https://docusaurus.io/docs/api/docusaurus-config#future
  future: {
    v4: true,
  },

  url: 'https://playrunner.dev',
  baseUrl,
  trailingSlash: true,

  // GitHub pages deployment config
  organizationName: 'playrunner',
  projectName: 'playrunner',

  onBrokenLinks: 'warn',

  markdown: {
    mermaid: true,
  },

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  themes: ['@docusaurus/theme-mermaid'],

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          editUrl: 'https://github.com/playrunner/playrunner/tree/main/docs/',
          routeBasePath: 'docs',
        },
        blog: {
          showReadingTime: true,
          feedOptions: {
            type: ['rss', 'atom'],
            xslt: true,
          },
          editUrl: 'https://github.com/playrunner/playrunner/tree/main/docs/',
          onInlineTags: 'warn',
          onInlineAuthors: 'warn',
          onUntruncatedBlogPosts: 'warn',
        },
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: 'img/playrunner-icon.svg',
    ...(algolia ? { algolia } : {}),
    colorMode: {
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'Playrunner',
      logo: {
        alt: 'Playrunner Logo',
        src: 'img/playrunner-icon.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'tutorialSidebar',
          position: 'left',
          label: 'Docs',
        },
        { to: '/pricing', label: 'Pricing', position: 'left' },
        { to: '/blog', label: 'Blog', position: 'left' },
        ...(algolia ? ([{ type: 'search', position: 'right' }] as const) : []),
        {
          href: 'https://www.npmjs.com/org/playrunner',
          position: 'right',
          className: 'header-npm-link',
          'aria-label': 'View Playrunner packages on npm',
        },
        {
          href: 'https://github.com/playrunner/playrunner',
          position: 'right',
          className: 'header-github-link',
          'aria-label': 'View Playrunner on GitHub',
        },
        {
          href: 'https://discord.gg/4zPdBy3DwU',
          position: 'right',
          className: 'header-discord-link',
          'aria-label': 'Join our Discord',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Tutorials',
          items: [
            { label: 'Getting Started', to: '/docs/tutorials/getting-started' },
            {
              label: 'Create Your First Workflow',
              to: '/docs/tutorials/create-your-first-workflow',
            },
            { label: 'Connect GitHub', to: '/docs/tutorials/connect-github' },
            {
              label: 'Run Your First Test',
              to: '/docs/tutorials/run-your-first-test',
            },
          ],
        },
        {
          title: 'Development',
          items: [
            { label: 'Overview', to: '/docs/local-dev' },
            {
              label: 'Integrations',
              to: '/docs/local-dev/integrations',
            },
            { label: 'Getting Started', to: '/docs/tutorials/getting-started' },
            {
              label: 'Services & Ports',
              to: '/docs/local-dev/services-and-ports',
            },
            { label: 'Troubleshooting', to: '/docs/local-dev/troubleshooting' },
          ],
        },
        {
          title: 'Discuss',
          items: [
            { label: 'Blog', to: '/blog' },
            { label: 'Discord', href: 'https://discord.gg/4zPdBy3DwU' },
          ],
        },
        {
          title: 'Resources',
          items: [
            { label: 'Documentation', to: '/docs/overview' },
            {
              label: 'npm packages',
              href: 'https://www.npmjs.com/org/playrunner',
            },
            {
              label: 'GitHub',
              href: 'https://github.com/playrunner/playrunner',
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Concept AI PTY LTD. Playrunner is distributed under the <a href="https://github.com/playrunner/playrunner/blob/main/LICENSE">Playrunner Sustainable Use License</a>.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'json', 'typescript', 'docker'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;

import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

const config: Config = {
  title: 'Playrunner',
  tagline: 'Automate your Playwright tests with visual workflows.',
  favicon: 'img/favicon.svg',
  customFields: {
    localDocsLandingPath: process.env.DOCS_LANDING_PATH || '/',
  },

  // Future flags, see https://docusaurus.io/docs/api/docusaurus-config#future
  future: {
    v4: true,
  },

  // Production URL (update if/when hosted)
  url: 'https://playrunner.github.io',
  baseUrl: '/playrunner/',

  // GitHub pages deployment config
  organizationName: 'playrunner',
  projectName: 'playrunner',

  onBrokenLinks: 'warn',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          editUrl:
            'https://github.com/playrunner/playrunner/tree/main/docs/',
          routeBasePath: 'docs',
        },
        blog: {
          showReadingTime: true,
          feedOptions: {
            type: ['rss', 'atom'],
            xslt: true,
          },
          editUrl:
            'https://github.com/playrunner/playrunner/tree/main/docs/',
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
        {to: '/blog', label: 'Blog', position: 'left'},
        {
          href: 'https://github.com/playrunner/playrunner',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Tutorials',
          items: [
            {label: 'Getting Started', to: '/docs/tutorials/getting-started'},
            {label: 'Create Your First Workflow', to: '/docs/tutorials/create-your-first-workflow'},
            {label: 'Connect GitHub', to: '/docs/tutorials/connect-github'},
            {label: 'Run Your First Test', to: '/docs/tutorials/run-your-first-test'},
          ],
        },
        {
          title: 'Development',
          items: [
            {label: 'Overview', to: '/docs/local-dev'},
            {label: 'Getting Started', to: '/docs/tutorials/getting-started'},
            {label: 'Services & Ports', to: '/docs/local-dev/services-and-ports'},
            {label: 'Troubleshooting', to: '/docs/local-dev/troubleshooting'},
          ],
        },
        {
          title: 'Blog',
          items: [
            {label: 'Blog', to: '/blog'},
          ],
        },
        {
          title: 'More',
          items: [
            {
              label: 'GitHub',
              href: 'https://github.com/playrunner/playrunner',
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Concept AI PTY LTD. Playrunner is distributed under the Playrunner Sustainable Use License.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'json', 'typescript', 'docker'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;

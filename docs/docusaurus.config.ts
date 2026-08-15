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

// Search Console HTML-tag verification. Supplied as a GitHub Actions var, the
// same way the Algolia credentials are, so the token stays out of the repo.
// The tag is belt-and-braces alongside whichever method verified the property
// first: DNS TXT records are lost in a nameserver change and the HTML-file
// method breaks whenever build output moves, but this survives both.
const googleSiteVerification = process.env.GOOGLE_SITE_VERIFICATION;

// Google Analytics 4, via @docusaurus/plugin-google-gtag (already a
// preset-classic dependency, so nothing extra to install). The plugin emits
// the gtag snippet itself, plus preconnect hints — do not also paste the
// snippet from the GA4 console into headTags, or the tag fires twice.
//
// The measurement ID is not a secret: it is visible in the HTML of every page
// that loads gtag. It lives here so a deploy works without anyone remembering
// to set a repo var. GA_MEASUREMENT_ID can still override it for a staging or
// fork build.
//
// `||` rather than `??` on purpose: GitHub Actions expands an unset `vars.X`
// to an empty string, not undefined, and `'' ?? fallback` yields '' — which
// would silently disable analytics in CI while working fine locally.
//
// The plugin no-ops unless NODE_ENV is production, so `npm run start` never
// reports. Configured in the classic preset options rather than themeConfig:
// Docusaurus throws if `gtag` appears in themeConfig.
const gaMeasurementId = process.env.GA_MEASUREMENT_ID || 'G-38TB3C8Z1E';

// Confirmed 2026-08-14: the project owns https://x.com/playrunner_ (note the
// trailing underscore — plain @playrunner belongs to someone else).
const twitterHandle: string | undefined = '@playrunner_';

const config: Config = {
  title: 'Playrunner',
  tagline: 'Orchestrate your Playwright suite on a canvas, not in YAML.',
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

  onBrokenLinks: 'throw',
  onBrokenAnchors: 'throw',

  markdown: {
    mermaid: true,
  },

  headTags: [
    // Docusaurus only emits the single `favicon` link above, so the rest of
    // the icon set is declared here. Note these hrefs are NOT run through
    // baseUrl, so they resolve correctly in production ('/') and 404 on the
    // dev server ('/playrunner/'). Cosmetic, and dev-only.
    {
      tagName: 'link',
      attributes: {
        rel: 'icon',
        type: 'image/png',
        sizes: '32x32',
        href: '/img/icons/favicon-32.png',
      },
    },
    {
      tagName: 'link',
      attributes: {
        rel: 'icon',
        type: 'image/png',
        sizes: '16x16',
        href: '/img/icons/favicon-16.png',
      },
    },
    {
      tagName: 'link',
      attributes: {
        rel: 'apple-touch-icon',
        sizes: '180x180',
        href: '/img/icons/apple-touch-icon.png',
      },
    },
    {
      tagName: 'link',
      attributes: { rel: 'manifest', href: '/site.webmanifest' },
    },
  ],

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
          // Surfaces a "Last updated" line to readers, and is also what
          // populates route.metadata.lastUpdatedAt — without it the sitemap's
          // `lastmod` resolves to null on every URL and is omitted entirely.
          showLastUpdateTime: true,
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
        ...(gaMeasurementId
          ? {
              gtag: {
                trackingID: gaMeasurementId,
                // Truncates the visitor IP before it is stored. Does not remove
                // the need for a cookie-consent banner in the EU/UK — GA4 still
                // sets cookies — but it is the right default regardless.
                anonymizeIP: true,
              },
            }
          : {}),
        sitemap: {
          // lastmod resolves through git history, so the deploy workflow needs
          // `fetch-depth: 0`. Under the default depth-1 checkout every file
          // reports the same commit date and the signal is worthless.
          lastmod: 'date',
          // changefreq and priority are ignored by Google and flagged as a
          // "useless option" in the plugin source. Emitting nothing is tidier
          // than emitting a number nobody reads.
          changefreq: null,
          priority: null,
          ignorePatterns: [
            // Thin, auto-generated aggregation pages. These stay crawlable —
            // they are only dropped from the sitemap. Blocking them in
            // robots.txt would stop Google ever seeing their canonical tags.
            '/blog/archive/',
            '/blog/authors/**',
            '/blog/tags/**',
            '/search/',
          ],
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    // Must be a raster image. The previous value was an SVG, which X,
    // LinkedIn, Facebook and Slack all refuse to render — combined with
    // twitter:card=summary_large_image that produced a blank card on every
    // page. Regenerate with `node scripts/build-og.mjs`.
    image: 'img/og/playrunner-og.png',
    metadata: [
      {
        name: 'keywords',
        content: [
          'playwright orchestration',
          'playwright test automation',
          'visual workflow builder',
          'e2e test orchestration',
          'playwright runners',
          'test automation platform',
          'playwright ci alternative',
        ].join(', '),
      },
      { property: 'og:site_name', content: 'Playrunner' },
      // Deliberately no site-wide og:type. Docusaurus emits none, and a
      // blanket 'website' would mislabel every blog post.
      ...(twitterHandle
        ? [
            { name: 'twitter:site', content: twitterHandle },
            { name: 'twitter:creator', content: twitterHandle },
          ]
        : []),
      ...(googleSiteVerification
        ? [
            {
              name: 'google-site-verification',
              content: googleSiteVerification,
            },
          ]
        : []),
      {
        name: 'theme-color',
        media: '(prefers-color-scheme: light)',
        content: '#0f766e',
      },
      {
        name: 'theme-color',
        media: '(prefers-color-scheme: dark)',
        content: '#0b0f14',
      },
    ],
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
          href: 'https://www.youtube.com/@playrunnerdev',
          position: 'right',
          className: 'header-youtube-link',
          'aria-label': 'Watch Playrunner on YouTube',
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
        {
          href: 'https://playrunner.cloud',
          label: 'Sign in',
          position: 'right',
          className: 'header-signin-link',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          // Site-wide footer links are how pages under src/pages earn internal
          // links: they never appear in the autogenerated docs sidebar.
          title: 'Use Cases',
          items: [
            { label: 'All use cases', to: '/docs/use-cases' },
            {
              label: 'Slack alerts on failure',
              to: '/docs/use-cases/slack-alerts-for-failed-playwright-tests',
            },
            {
              label: 'Jira bugs on failure',
              to: '/docs/use-cases/create-jira-bugs-from-failed-playwright-tests',
            },
            {
              label: 'AI failure triage',
              to: '/docs/use-cases/ai-triage-for-playwright-test-failures',
            },
            {
              label: 'Scheduled runs',
              to: '/docs/use-cases/scheduled-playwright-test-runs',
            },
          ],
        },
        {
          title: 'Tutorials',
          items: [
            { label: 'Start here', to: '/docs/start' },
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
            {
              label: 'YouTube',
              href: 'https://www.youtube.com/@playrunnerdev',
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

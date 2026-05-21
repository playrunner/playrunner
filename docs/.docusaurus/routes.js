import React from 'react';
import ComponentCreator from '@docusaurus/ComponentCreator';

export default [
  {
    path: '/central-station/__docusaurus/debug',
    component: ComponentCreator('/central-station/__docusaurus/debug', 'd80'),
    exact: true
  },
  {
    path: '/central-station/__docusaurus/debug/config',
    component: ComponentCreator('/central-station/__docusaurus/debug/config', 'b4b'),
    exact: true
  },
  {
    path: '/central-station/__docusaurus/debug/content',
    component: ComponentCreator('/central-station/__docusaurus/debug/content', '976'),
    exact: true
  },
  {
    path: '/central-station/__docusaurus/debug/globalData',
    component: ComponentCreator('/central-station/__docusaurus/debug/globalData', 'ece'),
    exact: true
  },
  {
    path: '/central-station/__docusaurus/debug/metadata',
    component: ComponentCreator('/central-station/__docusaurus/debug/metadata', 'c77'),
    exact: true
  },
  {
    path: '/central-station/__docusaurus/debug/registry',
    component: ComponentCreator('/central-station/__docusaurus/debug/registry', '6db'),
    exact: true
  },
  {
    path: '/central-station/__docusaurus/debug/routes',
    component: ComponentCreator('/central-station/__docusaurus/debug/routes', 'f37'),
    exact: true
  },
  {
    path: '/central-station/blog',
    component: ComponentCreator('/central-station/blog', 'd3a'),
    exact: true
  },
  {
    path: '/central-station/blog/archive',
    component: ComponentCreator('/central-station/blog/archive', '1ae'),
    exact: true
  },
  {
    path: '/central-station/blog/authors',
    component: ComponentCreator('/central-station/blog/authors', '37b'),
    exact: true
  },
  {
    path: '/central-station/blog/authors/all-sebastien-lorber-articles',
    component: ComponentCreator('/central-station/blog/authors/all-sebastien-lorber-articles', '804'),
    exact: true
  },
  {
    path: '/central-station/blog/authors/yangshun',
    component: ComponentCreator('/central-station/blog/authors/yangshun', '974'),
    exact: true
  },
  {
    path: '/central-station/blog/first-blog-post',
    component: ComponentCreator('/central-station/blog/first-blog-post', '3de'),
    exact: true
  },
  {
    path: '/central-station/blog/long-blog-post',
    component: ComponentCreator('/central-station/blog/long-blog-post', '9f4'),
    exact: true
  },
  {
    path: '/central-station/blog/mdx-blog-post',
    component: ComponentCreator('/central-station/blog/mdx-blog-post', 'f16'),
    exact: true
  },
  {
    path: '/central-station/blog/tags',
    component: ComponentCreator('/central-station/blog/tags', 'e23'),
    exact: true
  },
  {
    path: '/central-station/blog/tags/docusaurus',
    component: ComponentCreator('/central-station/blog/tags/docusaurus', '7a7'),
    exact: true
  },
  {
    path: '/central-station/blog/tags/facebook',
    component: ComponentCreator('/central-station/blog/tags/facebook', 'e22'),
    exact: true
  },
  {
    path: '/central-station/blog/tags/hello',
    component: ComponentCreator('/central-station/blog/tags/hello', '5ba'),
    exact: true
  },
  {
    path: '/central-station/blog/tags/hola',
    component: ComponentCreator('/central-station/blog/tags/hola', 'bc7'),
    exact: true
  },
  {
    path: '/central-station/blog/welcome',
    component: ComponentCreator('/central-station/blog/welcome', '026'),
    exact: true
  },
  {
    path: '/central-station/markdown-page',
    component: ComponentCreator('/central-station/markdown-page', '4b9'),
    exact: true
  },
  {
    path: '/central-station/docs',
    component: ComponentCreator('/central-station/docs', 'e7a'),
    routes: [
      {
        path: '/central-station/docs',
        component: ComponentCreator('/central-station/docs', '055'),
        routes: [
          {
            path: '/central-station/docs',
            component: ComponentCreator('/central-station/docs', 'c0b'),
            routes: [
              {
                path: '/central-station/docs/gcp-architecture',
                component: ComponentCreator('/central-station/docs/gcp-architecture', 'eed'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/central-station/docs/local-dev/',
                component: ComponentCreator('/central-station/docs/local-dev/', '4ad'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/central-station/docs/local-dev/connecting-integrations',
                component: ComponentCreator('/central-station/docs/local-dev/connecting-integrations', '5b6'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/central-station/docs/local-dev/connection-nodes',
                component: ComponentCreator('/central-station/docs/local-dev/connection-nodes', '9cb'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/central-station/docs/local-dev/docker-images',
                component: ComponentCreator('/central-station/docs/local-dev/docker-images', '250'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/central-station/docs/local-dev/environment-variables',
                component: ComponentCreator('/central-station/docs/local-dev/environment-variables', 'e73'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/central-station/docs/local-dev/firebase-and-data',
                component: ComponentCreator('/central-station/docs/local-dev/firebase-and-data', 'e63'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/central-station/docs/local-dev/services-and-ports',
                component: ComponentCreator('/central-station/docs/local-dev/services-and-ports', '65f'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/central-station/docs/local-dev/troubleshooting',
                component: ComponentCreator('/central-station/docs/local-dev/troubleshooting', 'a01'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/central-station/docs/local-dev/workflow-execution',
                component: ComponentCreator('/central-station/docs/local-dev/workflow-execution', '7a3'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/central-station/docs/overview',
                component: ComponentCreator('/central-station/docs/overview', 'cbe'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/central-station/docs/tutorials/',
                component: ComponentCreator('/central-station/docs/tutorials/', '6ff'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/central-station/docs/tutorials/connect-github',
                component: ComponentCreator('/central-station/docs/tutorials/connect-github', '809'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/central-station/docs/tutorials/create-your-first-workflow',
                component: ComponentCreator('/central-station/docs/tutorials/create-your-first-workflow', '379'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/central-station/docs/tutorials/getting-started',
                component: ComponentCreator('/central-station/docs/tutorials/getting-started', '3ad'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/central-station/docs/tutorials/run-your-first-test',
                component: ComponentCreator('/central-station/docs/tutorials/run-your-first-test', '3b6'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/central-station/docs/tutorials/understanding-reports',
                component: ComponentCreator('/central-station/docs/tutorials/understanding-reports', '050'),
                exact: true,
                sidebar: "tutorialSidebar"
              }
            ]
          }
        ]
      }
    ]
  },
  {
    path: '/central-station/',
    component: ComponentCreator('/central-station/', '826'),
    exact: true
  },
  {
    path: '*',
    component: ComponentCreator('*'),
  },
];

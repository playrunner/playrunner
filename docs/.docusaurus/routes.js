import React from 'react';
import ComponentCreator from '@docusaurus/ComponentCreator';

export default [
  {
    path: '/playrunner/__docusaurus/debug',
    component: ComponentCreator('/playrunner/__docusaurus/debug', 'e37'),
    exact: true
  },
  {
    path: '/playrunner/__docusaurus/debug/config',
    component: ComponentCreator('/playrunner/__docusaurus/debug/config', '568'),
    exact: true
  },
  {
    path: '/playrunner/__docusaurus/debug/content',
    component: ComponentCreator('/playrunner/__docusaurus/debug/content', '231'),
    exact: true
  },
  {
    path: '/playrunner/__docusaurus/debug/globalData',
    component: ComponentCreator('/playrunner/__docusaurus/debug/globalData', '878'),
    exact: true
  },
  {
    path: '/playrunner/__docusaurus/debug/metadata',
    component: ComponentCreator('/playrunner/__docusaurus/debug/metadata', 'baa'),
    exact: true
  },
  {
    path: '/playrunner/__docusaurus/debug/registry',
    component: ComponentCreator('/playrunner/__docusaurus/debug/registry', '6eb'),
    exact: true
  },
  {
    path: '/playrunner/__docusaurus/debug/routes',
    component: ComponentCreator('/playrunner/__docusaurus/debug/routes', '585'),
    exact: true
  },
  {
    path: '/playrunner/blog',
    component: ComponentCreator('/playrunner/blog', 'c4d'),
    exact: true
  },
  {
    path: '/playrunner/blog/archive',
    component: ComponentCreator('/playrunner/blog/archive', '239'),
    exact: true
  },
  {
    path: '/playrunner/blog/authors',
    component: ComponentCreator('/playrunner/blog/authors', '405'),
    exact: true
  },
  {
    path: '/playrunner/blog/authors/all-sebastien-lorber-articles',
    component: ComponentCreator('/playrunner/blog/authors/all-sebastien-lorber-articles', 'c2f'),
    exact: true
  },
  {
    path: '/playrunner/blog/authors/yangshun',
    component: ComponentCreator('/playrunner/blog/authors/yangshun', '14f'),
    exact: true
  },
  {
    path: '/playrunner/blog/first-blog-post',
    component: ComponentCreator('/playrunner/blog/first-blog-post', '7f2'),
    exact: true
  },
  {
    path: '/playrunner/blog/long-blog-post',
    component: ComponentCreator('/playrunner/blog/long-blog-post', 'ba6'),
    exact: true
  },
  {
    path: '/playrunner/blog/mdx-blog-post',
    component: ComponentCreator('/playrunner/blog/mdx-blog-post', '28d'),
    exact: true
  },
  {
    path: '/playrunner/blog/tags',
    component: ComponentCreator('/playrunner/blog/tags', 'b7c'),
    exact: true
  },
  {
    path: '/playrunner/blog/tags/docusaurus',
    component: ComponentCreator('/playrunner/blog/tags/docusaurus', '7a3'),
    exact: true
  },
  {
    path: '/playrunner/blog/tags/facebook',
    component: ComponentCreator('/playrunner/blog/tags/facebook', '023'),
    exact: true
  },
  {
    path: '/playrunner/blog/tags/hello',
    component: ComponentCreator('/playrunner/blog/tags/hello', 'b40'),
    exact: true
  },
  {
    path: '/playrunner/blog/tags/hola',
    component: ComponentCreator('/playrunner/blog/tags/hola', 'ab8'),
    exact: true
  },
  {
    path: '/playrunner/blog/welcome',
    component: ComponentCreator('/playrunner/blog/welcome', 'bd6'),
    exact: true
  },
  {
    path: '/playrunner/markdown-page',
    component: ComponentCreator('/playrunner/markdown-page', '00b'),
    exact: true
  },
  {
    path: '/playrunner/docs',
    component: ComponentCreator('/playrunner/docs', '7a1'),
    routes: [
      {
        path: '/playrunner/docs',
        component: ComponentCreator('/playrunner/docs', 'dc3'),
        routes: [
          {
            path: '/playrunner/docs',
            component: ComponentCreator('/playrunner/docs', '8ea'),
            routes: [
              {
                path: '/playrunner/docs/category/cloud-architecture',
                component: ComponentCreator('/playrunner/docs/category/cloud-architecture', '0c4'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/playrunner/docs/cloud-architecture/aws',
                component: ComponentCreator('/playrunner/docs/cloud-architecture/aws', '734'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/playrunner/docs/cloud-architecture/azure',
                component: ComponentCreator('/playrunner/docs/cloud-architecture/azure', 'aaa'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/playrunner/docs/cloud-architecture/gcp/',
                component: ComponentCreator('/playrunner/docs/cloud-architecture/gcp/', 'a2c'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/playrunner/docs/cloud-architecture/gcp/setup',
                component: ComponentCreator('/playrunner/docs/cloud-architecture/gcp/setup', 'bd0'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/playrunner/docs/contributing',
                component: ComponentCreator('/playrunner/docs/contributing', '85b'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/playrunner/docs/integration-packages/',
                component: ComponentCreator('/playrunner/docs/integration-packages/', 'f08'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/playrunner/docs/integration-packages/github',
                component: ComponentCreator('/playrunner/docs/integration-packages/github', '647'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/playrunner/docs/integration-packages/javascript',
                component: ComponentCreator('/playrunner/docs/integration-packages/javascript', '436'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/playrunner/docs/integration-packages/jira',
                component: ComponentCreator('/playrunner/docs/integration-packages/jira', '588'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/playrunner/docs/local-dev/',
                component: ComponentCreator('/playrunner/docs/local-dev/', 'cb6'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/playrunner/docs/local-dev/connecting-integrations',
                component: ComponentCreator('/playrunner/docs/local-dev/connecting-integrations', '515'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/playrunner/docs/local-dev/connection-nodes',
                component: ComponentCreator('/playrunner/docs/local-dev/connection-nodes', '0b3'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/playrunner/docs/local-dev/docker-images',
                component: ComponentCreator('/playrunner/docs/local-dev/docker-images', '723'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/playrunner/docs/local-dev/environment-variables',
                component: ComponentCreator('/playrunner/docs/local-dev/environment-variables', '0d6'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/playrunner/docs/local-dev/postgres-prisma-and-local-auth',
                component: ComponentCreator('/playrunner/docs/local-dev/postgres-prisma-and-local-auth', '087'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/playrunner/docs/local-dev/remote-debugging',
                component: ComponentCreator('/playrunner/docs/local-dev/remote-debugging', '26f'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/playrunner/docs/local-dev/services-and-ports',
                component: ComponentCreator('/playrunner/docs/local-dev/services-and-ports', 'caf'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/playrunner/docs/local-dev/troubleshooting',
                component: ComponentCreator('/playrunner/docs/local-dev/troubleshooting', 'c1f'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/playrunner/docs/local-dev/workflow-execution',
                component: ComponentCreator('/playrunner/docs/local-dev/workflow-execution', '095'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/playrunner/docs/overview',
                component: ComponentCreator('/playrunner/docs/overview', '925'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/playrunner/docs/roadmap',
                component: ComponentCreator('/playrunner/docs/roadmap', '32f'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/playrunner/docs/tutorials/',
                component: ComponentCreator('/playrunner/docs/tutorials/', 'd0b'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/playrunner/docs/tutorials/connect-github',
                component: ComponentCreator('/playrunner/docs/tutorials/connect-github', '9df'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/playrunner/docs/tutorials/create-your-first-workflow',
                component: ComponentCreator('/playrunner/docs/tutorials/create-your-first-workflow', '0b7'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/playrunner/docs/tutorials/getting-started',
                component: ComponentCreator('/playrunner/docs/tutorials/getting-started', 'bdf'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/playrunner/docs/tutorials/run-your-first-test',
                component: ComponentCreator('/playrunner/docs/tutorials/run-your-first-test', '864'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/playrunner/docs/tutorials/understanding-reports',
                component: ComponentCreator('/playrunner/docs/tutorials/understanding-reports', '499'),
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
    path: '/playrunner/',
    component: ComponentCreator('/playrunner/', '6a1'),
    exact: true
  },
  {
    path: '*',
    component: ComponentCreator('*'),
  },
];

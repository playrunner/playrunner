import React from 'react';
import ComponentCreator from '@docusaurus/ComponentCreator';

export default [
  {
    path: '/playrunner/__docusaurus/debug/',
    component: ComponentCreator('/playrunner/__docusaurus/debug/', '7f9'),
    exact: true
  },
  {
    path: '/playrunner/__docusaurus/debug/config/',
    component: ComponentCreator('/playrunner/__docusaurus/debug/config/', '14b'),
    exact: true
  },
  {
    path: '/playrunner/__docusaurus/debug/content/',
    component: ComponentCreator('/playrunner/__docusaurus/debug/content/', '0b2'),
    exact: true
  },
  {
    path: '/playrunner/__docusaurus/debug/globalData/',
    component: ComponentCreator('/playrunner/__docusaurus/debug/globalData/', '5e9'),
    exact: true
  },
  {
    path: '/playrunner/__docusaurus/debug/metadata/',
    component: ComponentCreator('/playrunner/__docusaurus/debug/metadata/', '8ed'),
    exact: true
  },
  {
    path: '/playrunner/__docusaurus/debug/registry/',
    component: ComponentCreator('/playrunner/__docusaurus/debug/registry/', 'f64'),
    exact: true
  },
  {
    path: '/playrunner/__docusaurus/debug/routes/',
    component: ComponentCreator('/playrunner/__docusaurus/debug/routes/', 'f71'),
    exact: true
  },
  {
    path: '/playrunner/blog/',
    component: ComponentCreator('/playrunner/blog/', 'b3f'),
    exact: true
  },
  {
    path: '/playrunner/blog/archive/',
    component: ComponentCreator('/playrunner/blog/archive/', '2b1'),
    exact: true
  },
  {
    path: '/playrunner/blog/authors/',
    component: ComponentCreator('/playrunner/blog/authors/', '42f'),
    exact: true
  },
  {
    path: '/playrunner/blog/authors/all-sebastien-lorber-articles/',
    component: ComponentCreator('/playrunner/blog/authors/all-sebastien-lorber-articles/', '1e5'),
    exact: true
  },
  {
    path: '/playrunner/blog/authors/yangshun/',
    component: ComponentCreator('/playrunner/blog/authors/yangshun/', 'bf2'),
    exact: true
  },
  {
    path: '/playrunner/blog/first-blog-post/',
    component: ComponentCreator('/playrunner/blog/first-blog-post/', '963'),
    exact: true
  },
  {
    path: '/playrunner/blog/long-blog-post/',
    component: ComponentCreator('/playrunner/blog/long-blog-post/', '52a'),
    exact: true
  },
  {
    path: '/playrunner/blog/mdx-blog-post/',
    component: ComponentCreator('/playrunner/blog/mdx-blog-post/', '369'),
    exact: true
  },
  {
    path: '/playrunner/blog/tags/',
    component: ComponentCreator('/playrunner/blog/tags/', 'fd9'),
    exact: true
  },
  {
    path: '/playrunner/blog/tags/docusaurus/',
    component: ComponentCreator('/playrunner/blog/tags/docusaurus/', 'ebb'),
    exact: true
  },
  {
    path: '/playrunner/blog/tags/facebook/',
    component: ComponentCreator('/playrunner/blog/tags/facebook/', '4fa'),
    exact: true
  },
  {
    path: '/playrunner/blog/tags/hello/',
    component: ComponentCreator('/playrunner/blog/tags/hello/', 'ea8'),
    exact: true
  },
  {
    path: '/playrunner/blog/tags/hola/',
    component: ComponentCreator('/playrunner/blog/tags/hola/', 'a51'),
    exact: true
  },
  {
    path: '/playrunner/blog/welcome/',
    component: ComponentCreator('/playrunner/blog/welcome/', '1b1'),
    exact: true
  },
  {
    path: '/playrunner/markdown-page/',
    component: ComponentCreator('/playrunner/markdown-page/', 'bda'),
    exact: true
  },
  {
    path: '/playrunner/docs/',
    component: ComponentCreator('/playrunner/docs/', '33a'),
    routes: [
      {
        path: '/playrunner/docs/',
        component: ComponentCreator('/playrunner/docs/', '67c'),
        routes: [
          {
            path: '/playrunner/docs/',
            component: ComponentCreator('/playrunner/docs/', '9ac'),
            routes: [
              {
                path: '/playrunner/docs/category/cloud-architecture/',
                component: ComponentCreator('/playrunner/docs/category/cloud-architecture/', 'c4c'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/playrunner/docs/cloud-architecture/aws/',
                component: ComponentCreator('/playrunner/docs/cloud-architecture/aws/', 'd96'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/playrunner/docs/cloud-architecture/azure/',
                component: ComponentCreator('/playrunner/docs/cloud-architecture/azure/', 'edf'),
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
                path: '/playrunner/docs/cloud-architecture/gcp/oauth/',
                component: ComponentCreator('/playrunner/docs/cloud-architecture/gcp/oauth/', '8a9'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/playrunner/docs/cloud-architecture/gcp/project-region/',
                component: ComponentCreator('/playrunner/docs/cloud-architecture/gcp/project-region/', '831'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/playrunner/docs/cloud-architecture/gcp/setup/',
                component: ComponentCreator('/playrunner/docs/cloud-architecture/gcp/setup/', 'cc8'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/playrunner/docs/cloud-architecture/gcp/terraform/',
                component: ComponentCreator('/playrunner/docs/cloud-architecture/gcp/terraform/', '0b0'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/playrunner/docs/cloud-architecture/local/',
                component: ComponentCreator('/playrunner/docs/cloud-architecture/local/', 'a94'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/playrunner/docs/contributing/',
                component: ComponentCreator('/playrunner/docs/contributing/', '4ea'),
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
                path: '/playrunner/docs/integration-packages/environment/',
                component: ComponentCreator('/playrunner/docs/integration-packages/environment/', '1c9'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/playrunner/docs/integration-packages/gcp/',
                component: ComponentCreator('/playrunner/docs/integration-packages/gcp/', '1f2'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/playrunner/docs/integration-packages/github/',
                component: ComponentCreator('/playrunner/docs/integration-packages/github/', 'cbb'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/playrunner/docs/integration-packages/javascript/',
                component: ComponentCreator('/playrunner/docs/integration-packages/javascript/', '82b'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/playrunner/docs/integration-packages/jira/',
                component: ComponentCreator('/playrunner/docs/integration-packages/jira/', '8b2'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/playrunner/docs/integration-packages/orchestrator/',
                component: ComponentCreator('/playrunner/docs/integration-packages/orchestrator/', '285'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/playrunner/docs/integration-packages/playwright/',
                component: ComponentCreator('/playrunner/docs/integration-packages/playwright/', '8fd'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/playrunner/docs/integration-packages/schedule/',
                component: ComponentCreator('/playrunner/docs/integration-packages/schedule/', '2d0'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/playrunner/docs/integration-packages/slack/',
                component: ComponentCreator('/playrunner/docs/integration-packages/slack/', 'ea1'),
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
                path: '/playrunner/docs/local-dev/connecting-integrations/',
                component: ComponentCreator('/playrunner/docs/local-dev/connecting-integrations/', '89c'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/playrunner/docs/local-dev/connection-nodes/',
                component: ComponentCreator('/playrunner/docs/local-dev/connection-nodes/', 'ddd'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/playrunner/docs/local-dev/docker-images/',
                component: ComponentCreator('/playrunner/docs/local-dev/docker-images/', 'fca'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/playrunner/docs/local-dev/environment-variables/',
                component: ComponentCreator('/playrunner/docs/local-dev/environment-variables/', '4b1'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/playrunner/docs/local-dev/integrations/',
                component: ComponentCreator('/playrunner/docs/local-dev/integrations/', '03a'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/playrunner/docs/local-dev/integrations/api-contributions/',
                component: ComponentCreator('/playrunner/docs/local-dev/integrations/api-contributions/', '5b4'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/playrunner/docs/local-dev/integrations/build-validation-deployment/',
                component: ComponentCreator('/playrunner/docs/local-dev/integrations/build-validation-deployment/', '6b8'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/playrunner/docs/local-dev/integrations/frontend-contributions/',
                component: ComponentCreator('/playrunner/docs/local-dev/integrations/frontend-contributions/', 'cad'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/playrunner/docs/local-dev/integrations/package-architecture/',
                component: ComponentCreator('/playrunner/docs/local-dev/integrations/package-architecture/', '9f6'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/playrunner/docs/local-dev/postgres-prisma-and-local-auth/',
                component: ComponentCreator('/playrunner/docs/local-dev/postgres-prisma-and-local-auth/', 'ae2'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/playrunner/docs/local-dev/remote-debugging/',
                component: ComponentCreator('/playrunner/docs/local-dev/remote-debugging/', 'e59'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/playrunner/docs/local-dev/services-and-ports/',
                component: ComponentCreator('/playrunner/docs/local-dev/services-and-ports/', 'cc3'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/playrunner/docs/local-dev/troubleshooting/',
                component: ComponentCreator('/playrunner/docs/local-dev/troubleshooting/', 'e95'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/playrunner/docs/local-dev/workflow-execution/',
                component: ComponentCreator('/playrunner/docs/local-dev/workflow-execution/', '316'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/playrunner/docs/overview/',
                component: ComponentCreator('/playrunner/docs/overview/', '3d4'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/playrunner/docs/roadmap/',
                component: ComponentCreator('/playrunner/docs/roadmap/', '991'),
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
                path: '/playrunner/docs/tutorials/connect-github/',
                component: ComponentCreator('/playrunner/docs/tutorials/connect-github/', 'df5'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/playrunner/docs/tutorials/create-your-first-workflow/',
                component: ComponentCreator('/playrunner/docs/tutorials/create-your-first-workflow/', '97e'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/playrunner/docs/tutorials/getting-started/',
                component: ComponentCreator('/playrunner/docs/tutorials/getting-started/', 'd4b'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/playrunner/docs/tutorials/run-your-first-test/',
                component: ComponentCreator('/playrunner/docs/tutorials/run-your-first-test/', 'd27'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/playrunner/docs/tutorials/understanding-reports/',
                component: ComponentCreator('/playrunner/docs/tutorials/understanding-reports/', '772'),
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

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
    component: ComponentCreator('/playrunner/blog/', '93a'),
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
    path: '/playrunner/blog/introducing-playrunner/',
    component: ComponentCreator('/playrunner/blog/introducing-playrunner/', 'a1a'),
    exact: true
  },
  {
    path: '/playrunner/blog/tags/',
    component: ComponentCreator('/playrunner/blog/tags/', 'fd9'),
    exact: true
  },
  {
    path: '/playrunner/blog/tags/contributors/',
    component: ComponentCreator('/playrunner/blog/tags/contributors/', 'd2b'),
    exact: true
  },
  {
    path: '/playrunner/blog/tags/playwright/',
    component: ComponentCreator('/playrunner/blog/tags/playwright/', '712'),
    exact: true
  },
  {
    path: '/playrunner/blog/tags/release/',
    component: ComponentCreator('/playrunner/blog/tags/release/', '190'),
    exact: true
  },
  {
    path: '/playrunner/markdown-page/',
    component: ComponentCreator('/playrunner/markdown-page/', 'bda'),
    exact: true
  },
  {
    path: '/playrunner/docs/',
    component: ComponentCreator('/playrunner/docs/', 'c42'),
    routes: [
      {
        path: '/playrunner/docs/',
        component: ComponentCreator('/playrunner/docs/', '999'),
        routes: [
          {
            path: '/playrunner/docs/',
            component: ComponentCreator('/playrunner/docs/', 'a56'),
            routes: [
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
                path: '/playrunner/docs/integration-packages/huggingface/',
                component: ComponentCreator('/playrunner/docs/integration-packages/huggingface/', 'c1f'),
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
                path: '/playrunner/docs/integration-packages/openai/',
                component: ComponentCreator('/playrunner/docs/integration-packages/openai/', '35f'),
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
                path: '/playrunner/docs/runner-architecture/',
                component: ComponentCreator('/playrunner/docs/runner-architecture/', 'a68'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/playrunner/docs/runner-architecture/aws/',
                component: ComponentCreator('/playrunner/docs/runner-architecture/aws/', '309'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/playrunner/docs/runner-architecture/azure/',
                component: ComponentCreator('/playrunner/docs/runner-architecture/azure/', 'fc9'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/playrunner/docs/runner-architecture/gcp/',
                component: ComponentCreator('/playrunner/docs/runner-architecture/gcp/', '47f'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/playrunner/docs/runner-architecture/gcp/oauth/',
                component: ComponentCreator('/playrunner/docs/runner-architecture/gcp/oauth/', '374'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/playrunner/docs/runner-architecture/gcp/project-region/',
                component: ComponentCreator('/playrunner/docs/runner-architecture/gcp/project-region/', '19e'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/playrunner/docs/runner-architecture/gcp/setup/',
                component: ComponentCreator('/playrunner/docs/runner-architecture/gcp/setup/', '35f'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/playrunner/docs/runner-architecture/gcp/terraform/',
                component: ComponentCreator('/playrunner/docs/runner-architecture/gcp/terraform/', '8ff'),
                exact: true,
                sidebar: "tutorialSidebar"
              },
              {
                path: '/playrunner/docs/runner-architecture/local/',
                component: ComponentCreator('/playrunner/docs/runner-architecture/local/', '8ce'),
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

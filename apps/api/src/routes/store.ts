import crypto from 'crypto';
import { Prisma } from '../generated/prisma/client.cts';
import { Request, Response, Router } from 'express';
import { prisma } from '../lib/prisma';
import {
  assertWorkflowSchedulesCanBeSaved,
  deleteWorkflowSchedules,
  reconcileWorkflowSchedules,
} from '../services/schedules';
import {
  deleteConnection,
  getPublicConnection,
  listPublicConnections,
  saveConnection,
} from '../services/connections';

export const storeRouter = Router();

function getUserId(req: Request) {
  if (!req.authUser?.providerUserId) {
    throw new Error('Missing authenticated user.');
  }

  return req.authUser.providerUserId;
}

function toJsonValue(value: unknown) {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return Prisma.JsonNull;
  }

  return value as Prisma.InputJsonValue;
}

function toOptionalString(value: unknown) {
  return typeof value === 'string' ? value : undefined;
}

function toNullableString(value: unknown) {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  return typeof value === 'string' ? value : undefined;
}

function toOptionalNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function toOptionalDate(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) {
    return undefined;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function sendError(res: Response, error: unknown) {
  console.error('Store route error:', error);
  const statusCode =
    typeof (error as { statusCode?: unknown })?.statusCode === 'number'
      ? ((error as { statusCode: number }).statusCode ?? 500)
      : 500;
  res.status(statusCode).json({
    error: error instanceof Error ? error.message : 'Internal server error.',
  });
}

function createRouteHandler(
  handler: (req: Request, res: Response) => Promise<void> | void,
) {
  return (req: Request, res: Response) => {
    Promise.resolve(handler(req, res)).catch((error) => sendError(res, error));
  };
}

function serializeProject(project: {
  id: string;
  userId: string;
  title: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: project.id,
    userId: project.userId,
    title: project.title,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

function serializeWorkflow(workflow: {
  id: string;
  userId: string;
  projectId: string | null;
  title: string | null;
  nodes: Prisma.JsonValue | null;
  connections: Prisma.JsonValue | null;
  cloudProvider: string | null;
  concurrency: number | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: workflow.id,
    userId: workflow.userId,
    projectId: workflow.projectId,
    title: workflow.title,
    nodes: workflow.nodes,
    connections: workflow.connections,
    cloudProvider: workflow.cloudProvider,
    concurrency: workflow.concurrency,
    createdAt: workflow.createdAt,
    updatedAt: workflow.updatedAt,
  };
}

function serializeEnvironment(environment: {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  variables: Prisma.JsonValue;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: environment.id,
    userId: environment.userId,
    name: environment.name,
    description: environment.description,
    variables: environment.variables,
    createdAt: environment.createdAt,
    updatedAt: environment.updatedAt,
  };
}

storeRouter.get(
  '/projects',
  createRouteHandler(async (req, res) => {
    const userId = getUserId(req);
    const projects = await prisma.project.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
    });

    res.json({ projects: projects.map(serializeProject) });
  }),
);

storeRouter.get(
  '/projects/:id',
  createRouteHandler(async (req, res) => {
    const userId = getUserId(req);
    const project = await prisma.project.findFirst({
      where: {
        id: req.params.id,
        userId,
      },
    });

    res.json({ project: project ? serializeProject(project) : null });
  }),
);

storeRouter.post(
  '/projects',
  createRouteHandler(async (req, res) => {
    const userId = getUserId(req);
    const project = await prisma.project.create({
      data: {
        id: crypto.randomUUID(),
        userId,
        title: toNullableString(req.body?.title) ?? null,
        createdAt: toOptionalDate(req.body?.createdAt),
      },
    });

    res.status(201).json({ project: serializeProject(project) });
  }),
);

storeRouter.put(
  '/projects/:id',
  createRouteHandler(async (req, res) => {
    const userId = getUserId(req);
    const existing = await prisma.project.findFirst({
      where: {
        id: req.params.id,
        userId,
      },
    });
    const title = toNullableString(req.body?.title);

    if (!existing) {
      const project = await prisma.project.create({
        data: {
          id: req.params.id,
          userId,
          title: title ?? null,
          createdAt: toOptionalDate(req.body?.createdAt),
        },
      });
      res.status(201).json({ project: serializeProject(project) });
      return;
    }

    const project = await prisma.project.update({
      where: { id: existing.id },
      data: title !== undefined ? { title } : {},
    });

    res.json({ project: serializeProject(project) });
  }),
);

storeRouter.delete(
  '/projects/:id',
  createRouteHandler(async (req, res) => {
    const userId = getUserId(req);
    await prisma.project.deleteMany({
      where: {
        id: req.params.id,
        userId,
      },
    });
    res.status(204).end();
  }),
);

storeRouter.get(
  '/workflows',
  createRouteHandler(async (req, res) => {
    const userId = getUserId(req);
    const projectId =
      typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
    const workflows = await prisma.workflow.findMany({
      where: {
        userId,
        ...(projectId ? { projectId } : {}),
      },
      orderBy: { updatedAt: 'desc' },
    });

    res.json({ workflows: workflows.map(serializeWorkflow) });
  }),
);

storeRouter.get(
  '/workflows/:id',
  createRouteHandler(async (req, res) => {
    const userId = getUserId(req);
    const workflow = await prisma.workflow.findFirst({
      where: {
        id: req.params.id,
        userId,
      },
    });

    res.json({ workflow: workflow ? serializeWorkflow(workflow) : null });
  }),
);

storeRouter.post(
  '/workflows',
  createRouteHandler(async (req, res) => {
    const userId = getUserId(req);
    const nodes = toJsonValue(req.body?.nodes);
    const connections = toJsonValue(req.body?.connections);
    const cloudProvider = toNullableString(req.body?.cloudProvider) ?? null;

    assertWorkflowSchedulesCanBeSaved({
      cloudProvider,
      nodes,
    });

    const workflow = await prisma.workflow.create({
      data: {
        id: crypto.randomUUID(),
        userId,
        projectId: toNullableString(req.body?.projectId) ?? null,
        title: toNullableString(req.body?.title) ?? null,
        nodes,
        connections,
        cloudProvider,
        concurrency: toOptionalNumber(req.body?.concurrency),
        createdAt: toOptionalDate(req.body?.createdAt),
      },
    });

    await reconcileWorkflowSchedules({
      cloudProvider: workflow.cloudProvider,
      nodes: workflow.nodes,
      req,
      userId,
      workflowId: workflow.id,
    });

    res.status(201).json({ workflow: serializeWorkflow(workflow) });
  }),
);

storeRouter.put(
  '/workflows/:id',
  createRouteHandler(async (req, res) => {
    const userId = getUserId(req);
    const existing = await prisma.workflow.findFirst({
      where: {
        id: req.params.id,
        userId,
      },
    });

    const projectId = toNullableString(req.body?.projectId);
    const title = toNullableString(req.body?.title);
    const cloudProvider = toNullableString(req.body?.cloudProvider);
    const concurrency = toOptionalNumber(req.body?.concurrency);
    const nodes = toJsonValue(req.body?.nodes);
    const connections = toJsonValue(req.body?.connections);
    const nextCloudProvider = cloudProvider ?? existing?.cloudProvider ?? null;
    const nextNodes = nodes !== undefined ? nodes : existing?.nodes;

    assertWorkflowSchedulesCanBeSaved({
      cloudProvider: nextCloudProvider,
      nodes: nextNodes,
    });

    if (!existing) {
      const workflow = await prisma.workflow.create({
        data: {
          id: req.params.id,
          userId,
          projectId: projectId ?? null,
          title: title ?? null,
          nodes,
          connections,
          cloudProvider: cloudProvider ?? null,
          concurrency,
          createdAt: toOptionalDate(req.body?.createdAt),
        },
      });

      await reconcileWorkflowSchedules({
        cloudProvider: workflow.cloudProvider,
        nodes: workflow.nodes,
        req,
        userId,
        workflowId: workflow.id,
      });

      res.status(201).json({ workflow: serializeWorkflow(workflow) });
      return;
    }

    const data: Record<string, unknown> = {};
    if (projectId !== undefined) {
      data.projectId = projectId;
    }
    if (title !== undefined) {
      data.title = title;
    }
    if (cloudProvider !== undefined) {
      data.cloudProvider = cloudProvider;
    }
    if (concurrency !== undefined) {
      data.concurrency = concurrency;
    }
    if (nodes !== undefined) {
      data.nodes = nodes;
    }
    if (connections !== undefined) {
      data.connections = connections;
    }

    const workflow = await prisma.workflow.update({
      where: { id: existing.id },
      data,
    });

    await reconcileWorkflowSchedules({
      cloudProvider: workflow.cloudProvider,
      nodes: workflow.nodes,
      req,
      userId,
      workflowId: workflow.id,
    });

    res.json({ workflow: serializeWorkflow(workflow) });
  }),
);

storeRouter.delete(
  '/workflows/:id',
  createRouteHandler(async (req, res) => {
    const userId = getUserId(req);
    await deleteWorkflowSchedules({
      req,
      userId,
      workflowId: req.params.id,
    });
    await prisma.workflow.deleteMany({
      where: {
        id: req.params.id,
        userId,
      },
    });
    res.status(204).end();
  }),
);

storeRouter.get(
  '/integrations',
  createRouteHandler(async (req, res) => {
    const userId = getUserId(req);
    const integrations = await listPublicConnections(userId, 'integration');

    res.json({
      integrations: integrations.reduce<Record<string, unknown>>(
        (accumulator, integration) => {
          accumulator[integration.provider] = integration;
          return accumulator;
        },
        {},
      ),
    });
  }),
);

storeRouter.get(
  '/integrations/:provider',
  createRouteHandler(async (req, res) => {
    const userId = getUserId(req);
    const integration = await getPublicConnection(
      userId,
      'integration',
      req.params.provider,
    );

    res.json({
      integration,
    });
  }),
);

storeRouter.put(
  '/integrations/:provider',
  createRouteHandler(async (req, res) => {
    const userId = getUserId(req);
    const integration = await saveConnection(
      userId,
      'integration',
      req.params.provider,
      req.body,
    );

    res.json({ integration });
  }),
);

storeRouter.delete(
  '/integrations/:provider',
  createRouteHandler(async (req, res) => {
    const userId = getUserId(req);
    await deleteConnection(userId, 'integration', req.params.provider);
    res.status(204).end();
  }),
);

storeRouter.get(
  '/cloud-credentials/:provider',
  createRouteHandler(async (req, res) => {
    const userId = getUserId(req);
    const cloudCredential = await getPublicConnection(
      userId,
      'cloud',
      req.params.provider,
    );

    res.json({
      cloudCredential,
    });
  }),
);

storeRouter.put(
  '/cloud-credentials/:provider',
  createRouteHandler(async (req, res) => {
    const userId = getUserId(req);
    const cloudCredential = await saveConnection(
      userId,
      'cloud',
      req.params.provider,
      req.body,
    );

    res.json({ cloudCredential });
  }),
);

storeRouter.delete(
  '/cloud-credentials/:provider',
  createRouteHandler(async (req, res) => {
    const userId = getUserId(req);
    await deleteConnection(userId, 'cloud', req.params.provider);
    res.status(204).end();
  }),
);

storeRouter.get(
  '/environments',
  createRouteHandler(async (req, res) => {
    const userId = getUserId(req);
    const environments = await prisma.environment.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
    });

    res.json({ environments: environments.map(serializeEnvironment) });
  }),
);

storeRouter.put(
  '/environments/:id',
  createRouteHandler(async (req, res) => {
    const userId = getUserId(req);
    const existing = await prisma.environment.findFirst({
      where: {
        id: req.params.id,
        userId,
      },
    });
    const name = toOptionalString(req.body?.name) || 'Environment';
    const description = toNullableString(req.body?.description);
    const variables = toJsonValue(req.body?.variables) ?? [];

    if (!existing) {
      const environment = await prisma.environment.create({
        data: {
          id: req.params.id,
          userId,
          name,
          description: description ?? null,
          variables,
          createdAt: toOptionalDate(req.body?.createdAt),
        },
      });
      res.status(201).json({ environment: serializeEnvironment(environment) });
      return;
    }

    const data: Record<string, unknown> = {
      variables,
    };
    if (typeof req.body?.name === 'string') {
      data.name = req.body.name;
    }
    if (description !== undefined) {
      data.description = description;
    }

    const environment = await prisma.environment.update({
      where: { id: existing.id },
      data,
    });

    res.json({ environment: serializeEnvironment(environment) });
  }),
);

storeRouter.delete(
  '/environments/:id',
  createRouteHandler(async (req, res) => {
    const userId = getUserId(req);
    await prisma.environment.deleteMany({
      where: {
        id: req.params.id,
        userId,
      },
    });
    res.status(204).end();
  }),
);

storeRouter.put(
  '/secrets/:secretKey',
  createRouteHandler(async (req, res) => {
    const userId = getUserId(req);
    const secret = await prisma.environmentSecret.upsert({
      where: {
        userId_key: {
          userId,
          key: req.params.secretKey,
        },
      },
      update: {
        value: toOptionalString(req.body?.value) || '',
        description: toNullableString(req.body?.description) ?? null,
      },
      create: {
        userId,
        key: req.params.secretKey,
        value: toOptionalString(req.body?.value) || '',
        description: toNullableString(req.body?.description) ?? null,
      },
    });

    res.json({
      secret: {
        id: secret.id,
        userId: secret.userId,
        secretKey: secret.key,
        value: secret.value,
        description: secret.description,
        createdAt: secret.createdAt,
        updatedAt: secret.updatedAt,
      },
    });
  }),
);

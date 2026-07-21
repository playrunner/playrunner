import crypto from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { Prisma } from '../generated/prisma/client.cts';
import { Request, Router } from 'express';
import { getPublicApiBaseUrl } from '../config';
import { prisma } from '../lib/prisma';
import { apiRuntime } from '../runtime';
import { state } from '../state';
import { getPublicConnection } from '../services/connections';

export const schedulerRouter = Router();

const oidcClient = new OAuth2Client();
const PLAYRUNNER_SCHEDULER_JOB_NAME_HEADER = 'X-Playrunner-Scheduler-JobName';

function getBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  return authHeader.slice('Bearer '.length).trim() || null;
}

function buildTriggerUrl(req: Request, scheduleId: string): string {
  return `${getPublicApiBaseUrl(req)}/api/scheduler/trigger/${encodeURIComponent(
    scheduleId,
  )}`;
}

function parseScheduledTime(req: Request): Date {
  const raw =
    req.get('X-CloudScheduler-ScheduleTime') ||
    (typeof req.body?.scheduledTime === 'string'
      ? req.body.scheduledTime
      : null);
  const parsed = raw ? new Date(raw) : null;

  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date();
}

function defaultSchedulerServiceAccountEmail(projectId: string): string {
  return `playrunner-scheduler@${projectId}.iam.gserviceaccount.com`;
}

function getSchedulerJobId(jobName: string): string {
  const normalized = jobName.trim();
  const match = normalized.match(/\/jobs\/([^/]+)$/);

  return match?.[1] || normalized;
}

function schedulerJobNameMatches(
  receivedJobName: string,
  expectedJobName: string,
): boolean {
  const normalizedReceived = receivedJobName.trim();
  const normalizedExpected = expectedJobName.trim();

  return (
    normalizedReceived === normalizedExpected ||
    getSchedulerJobId(normalizedReceived) ===
      getSchedulerJobId(normalizedExpected)
  );
}

function createExecutionRequest(req: Request, userId: string): Request {
  const baseUrl = getPublicApiBaseUrl(req);
  const url = new URL(baseUrl);

  return {
    authUser: {
      provider: 'scheduler',
      providerUserId: userId,
    },
    get(name: string) {
      if (name.toLowerCase() === 'host') {
        return url.host;
      }

      return req.get(name);
    },
    protocol: url.protocol.replace(/:$/g, ''),
  } as Request;
}

async function verifySchedulerIdentity({
  expectedEmail,
  req,
  scheduleId,
}: {
  expectedEmail: string;
  req: Request;
  scheduleId: string;
}) {
  const token = getBearerToken(req);
  if (!token) {
    return false;
  }

  const audience = buildTriggerUrl(req, scheduleId);
  const ticket = await oidcClient.verifyIdToken({
    audience,
    idToken: token,
  });
  const payload = ticket.getPayload();

  return payload?.email === expectedEmail && payload.email_verified !== false;
}

schedulerRouter.post('/trigger/:scheduleId', async (req, res) => {
  const schedule = await prisma.workflowSchedule.findUnique({
    where: { id: req.params.scheduleId },
    include: { workflow: true },
  });

  if (!schedule) {
    res.status(404).json({ error: 'Schedule not found.' });
    return;
  }

  const credential = await getPublicConnection(schedule.userId, 'cloud', 'gcp');
  const credentialData = credential?.config;
  const schedulerServiceAccountEmail =
    typeof credentialData?.schedulerServiceAccountEmail === 'string'
      ? credentialData.schedulerServiceAccountEmail.trim()
      : '';
  const selectedProject =
    typeof credentialData?.selectedProject === 'string'
      ? credentialData.selectedProject.trim()
      : '';
  const expectedSchedulerServiceAccountEmail =
    schedulerServiceAccountEmail ||
    (selectedProject
      ? defaultSchedulerServiceAccountEmail(selectedProject)
      : '');

  if (!expectedSchedulerServiceAccountEmail) {
    res.status(500).json({
      error:
        'Cloud Scheduler service account email is not configured and no selected GCP project is saved.',
    });
    return;
  }

  const jobName =
    req.get(PLAYRUNNER_SCHEDULER_JOB_NAME_HEADER) ||
    req.get('X-CloudScheduler-JobName');
  if (
    jobName &&
    schedule.gcpJobName &&
    !schedulerJobNameMatches(jobName, schedule.gcpJobName)
  ) {
    console.warn('Scheduler job name mismatch:', {
      expectedJobName: schedule.gcpJobName,
      receivedJobName: jobName,
      scheduleId: schedule.id,
    });
    res.status(403).json({ error: 'Scheduler job name mismatch.' });
    return;
  }

  try {
    const verified = await verifySchedulerIdentity({
      expectedEmail: expectedSchedulerServiceAccountEmail,
      req,
      scheduleId: schedule.id,
    });
    if (!verified) {
      res.status(401).json({ error: 'Invalid scheduler identity.' });
      return;
    }
  } catch (error) {
    console.error('Scheduler identity verification failed:', error);
    res.status(401).json({ error: 'Invalid scheduler identity.' });
    return;
  }

  if (!schedule.enabled || schedule.provider !== 'GCP') {
    res.status(200).json({ ignored: true, reason: 'Schedule is disabled.' });
    return;
  }

  if (schedule.workflow.cloudProvider !== 'GCP') {
    await prisma.workflowSchedule.update({
      where: { id: schedule.id },
      data: {
        enabled: false,
        lastError: 'Schedule trigger ignored because workflow is not on GCP.',
      },
    });
    res.status(200).json({
      ignored: true,
      reason: 'Workflow is not configured for GCP.',
    });
    return;
  }

  const scheduledTime = parseScheduledTime(req);
  let triggerRecord: {
    executionId: string | null;
    id: string;
    status: string;
  } | null = null;

  try {
    triggerRecord = await prisma.workflowScheduleTrigger.create({
      data: {
        scheduleId: schedule.id,
        scheduledTime,
        status: 'starting',
      },
      select: {
        executionId: true,
        id: true,
        status: true,
      },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      const existing = await prisma.workflowScheduleTrigger.findUnique({
        where: {
          scheduleId_scheduledTime: {
            scheduleId: schedule.id,
            scheduledTime,
          },
        },
        select: {
          executionId: true,
          id: true,
          status: true,
        },
      });
      res.status(202).json({
        deduped: true,
        executionId: existing?.executionId ?? null,
        status: existing?.status ?? 'starting',
      });
      return;
    }

    throw error;
  }

  const testId = crypto.randomUUID();
  state.testCloudProviders[testId] = 'GCP';

  await prisma.workflowScheduleTrigger.update({
    where: { id: triggerRecord.id },
    data: { executionId: testId },
  });

  let result;

  try {
    result = await apiRuntime.workflowExecution.execute({
      body: {
        cloudProvider: 'GCP',
        concurrency: schedule.workflow.concurrency ?? undefined,
        connections: schedule.workflow.connections ?? [],
        nodes: schedule.workflow.nodes ?? [],
        scheduledTime: scheduledTime.toISOString(),
        scheduler: {
          scheduleId: schedule.id,
          scheduleNodeId: schedule.scheduleNodeId,
        },
        workflowId: schedule.workflowId,
        workflow: {
          definition: {
            id: schedule.workflowId,
            name: schedule.workflow.title || 'Untitled Workflow',
          },
          run: {
            runner: 'GCP',
            trigger: 'schedule',
          },
        },
      },
      req: createExecutionRequest(req, schedule.userId),
      testId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.$transaction([
      prisma.workflowSchedule.update({
        where: { id: schedule.id },
        data: {
          lastError: message,
          lastTriggerTime: scheduledTime,
        },
      }),
      prisma.workflowScheduleTrigger.update({
        where: { id: triggerRecord.id },
        data: {
          executionId: testId,
          status: 'failed',
        },
      }),
    ]);
    res.status(500).json({
      error: message,
      executionId: testId,
      scheduleId: schedule.id,
    });
    return;
  }

  if (result.status >= 200 && result.status < 300) {
    await prisma.$transaction([
      prisma.workflowSchedule.update({
        where: { id: schedule.id },
        data: {
          lastError: null,
          lastTriggerTime: scheduledTime,
        },
      }),
      prisma.workflowScheduleTrigger.update({
        where: { id: triggerRecord.id },
        data: {
          executionId: testId,
          status: 'started',
        },
      }),
    ]);
    res.status(202).json({
      executionId: testId,
      scheduleId: schedule.id,
      status: 'started',
    });
    return;
  }

  const message =
    typeof result.body?.error === 'string'
      ? result.body.error
      : `Workflow start failed with status ${result.status}.`;
  await prisma.$transaction([
    prisma.workflowSchedule.update({
      where: { id: schedule.id },
      data: {
        lastError: message,
        lastTriggerTime: scheduledTime,
      },
    }),
    prisma.workflowScheduleTrigger.update({
      where: { id: triggerRecord.id },
      data: {
        executionId: testId,
        status: 'failed',
      },
    }),
  ]);
  res.status(result.status).json({
    error: message,
    executionId: testId,
    scheduleId: schedule.id,
  });
});

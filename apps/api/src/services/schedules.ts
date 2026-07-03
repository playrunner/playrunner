import { Prisma, type WorkflowSchedule } from '@prisma/client';
import type { Request } from 'express';
import { getPublicApiBaseUrl } from '../config';
import { prisma } from '../lib/prisma';
import { apiRuntime } from '../runtime';
import type { SchedulerProvisionRequest } from '../runtime/contracts';

type ScheduleFrequency = 'day' | 'hour' | 'minute' | 'month' | 'week';

type ScheduleConfig = {
  cron?: unknown;
  dayOfMonth?: unknown;
  daysOfWeek?: unknown;
  enabled?: unknown;
  frequency?: unknown;
  interval?: unknown;
  minuteOfHour?: unknown;
  time?: unknown;
  timezone?: unknown;
};

type WorkflowNode = {
  config?: {
    schedule?: ScheduleConfig;
  };
  id?: unknown;
  nodeType?: unknown;
};

type ScheduleDefinition = {
  cron: string;
  enabled: boolean;
  provider: string;
  scheduleNodeId: string;
  timezone: string;
};

type WorkflowScheduleRecord = Pick<
  WorkflowSchedule,
  | 'cron'
  | 'enabled'
  | 'gcpJobName'
  | 'id'
  | 'provider'
  | 'scheduleNodeId'
  | 'timezone'
  | 'userId'
  | 'workflowId'
>;

export class ScheduleValidationError extends Error {
  statusCode = 400;
}

function normalizeProvider(provider: string | null | undefined): string {
  return (provider || 'LOCAL_RUNNER').toUpperCase();
}

function asNodeArray(nodes: Prisma.JsonValue | unknown): WorkflowNode[] {
  return Array.isArray(nodes) ? (nodes as WorkflowNode[]) : [];
}

function asPositiveInteger(value: unknown, fallback: number): number {
  const numberValue =
    typeof value === 'string' && value.trim()
      ? Number(value)
      : typeof value === 'number'
        ? value
        : NaN;

  return Number.isInteger(numberValue) && numberValue > 0
    ? numberValue
    : fallback;
}

function asIntegerInRange(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const numberValue =
    typeof value === 'string' && value.trim()
      ? Number(value)
      : typeof value === 'number'
        ? value
        : NaN;

  if (!Number.isInteger(numberValue)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, numberValue));
}

function parseTime(value: unknown): { hours: number; minutes: number } | null {
  if (typeof value !== 'string') {
    return null;
  }

  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) {
    return null;
  }

  return {
    hours: Number(match[1]),
    minutes: Number(match[2]),
  };
}

function getFrequency(value: unknown): ScheduleFrequency {
  if (
    value === 'minute' ||
    value === 'hour' ||
    value === 'day' ||
    value === 'week' ||
    value === 'month'
  ) {
    return value;
  }

  return 'day';
}

function computeCron(schedule: ScheduleConfig, strict: boolean): string {
  const frequency = getFrequency(schedule.frequency);
  const interval = asPositiveInteger(schedule.interval, 1);
  const minuteOfHour = asIntegerInRange(schedule.minuteOfHour, 0, 0, 59);
  const time = parseTime(schedule.time) || { hours: 9, minutes: 0 };
  const dayOfMonth = asIntegerInRange(schedule.dayOfMonth, 1, 1, 31);
  const daysOfWeek = Array.isArray(schedule.daysOfWeek)
    ? schedule.daysOfWeek
        .map((day) => asIntegerInRange(day, -1, 0, 6))
        .filter((day) => day >= 0)
    : [1, 2, 3, 4, 5];
  const uniqueDaysOfWeek = Array.from(new Set(daysOfWeek)).sort();

  if (
    strict &&
    (frequency === 'day' || frequency === 'week' || frequency === 'month') &&
    !parseTime(schedule.time)
  ) {
    throw new ScheduleValidationError(
      'Schedule time must use HH:mm format before it can be enabled.',
    );
  }

  switch (frequency) {
    case 'minute': {
      const normalizedInterval = Math.min(interval, 59);
      return normalizedInterval === 1
        ? '* * * * *'
        : `*/${normalizedInterval} * * * *`;
    }
    case 'hour': {
      const normalizedInterval = Math.min(interval, 23);
      return normalizedInterval === 1
        ? `${minuteOfHour} * * * *`
        : `${minuteOfHour} */${normalizedInterval} * * *`;
    }
    case 'day':
      return `${time.minutes} ${time.hours} * * *`;
    case 'week':
      if (strict && uniqueDaysOfWeek.length === 0) {
        throw new ScheduleValidationError(
          'Choose at least one weekday before enabling this schedule.',
        );
      }
      return `${time.minutes} ${time.hours} * * ${uniqueDaysOfWeek.join(',') || '1'}`;
    case 'month':
      return `${time.minutes} ${time.hours} ${dayOfMonth} * *`;
  }
}

function normalizeTimezone(value: unknown, strict: boolean): string {
  const timezone = typeof value === 'string' ? value.trim() : '';
  if (strict && !timezone) {
    throw new ScheduleValidationError(
      'Schedule timezone is required before a schedule can be enabled.',
    );
  }

  return timezone || 'UTC';
}

function extractScheduleDefinitions({
  cloudProvider,
  nodes,
}: {
  cloudProvider: string | null | undefined;
  nodes: Prisma.JsonValue | unknown;
}): ScheduleDefinition[] {
  const provider = normalizeProvider(cloudProvider);

  return asNodeArray(nodes)
    .filter(
      (node) => node.nodeType === 'schedule' && typeof node.id === 'string',
    )
    .flatMap((node) => {
      const schedule = node.config?.schedule;
      if (!schedule || typeof schedule !== 'object') {
        return [];
      }

      const requestedEnabled = schedule.enabled === true;
      if (requestedEnabled && provider === 'LOCAL_RUNNER') {
        throw new ScheduleValidationError(
          'Schedules require a cloud runner. Select GCP Runner to enable.',
        );
      }
      if (requestedEnabled && provider !== 'GCP') {
        throw new ScheduleValidationError(
          'GCP Runner is currently the only supported scheduler provider.',
        );
      }

      const strict = requestedEnabled;
      return [
        {
          cron: computeCron(schedule, strict),
          enabled: requestedEnabled,
          provider,
          scheduleNodeId: node.id,
          timezone: normalizeTimezone(schedule.timezone, strict),
        },
      ];
    });
}

export function assertWorkflowSchedulesCanBeSaved({
  cloudProvider,
  nodes,
}: {
  cloudProvider: string | null | undefined;
  nodes: Prisma.JsonValue | unknown;
}) {
  extractScheduleDefinitions({ cloudProvider, nodes });
}

function toScheduleState(schedule: WorkflowScheduleRecord) {
  return {
    cron: schedule.cron,
    enabled: schedule.enabled,
    gcpJobName: schedule.gcpJobName,
    id: schedule.id,
    provider: schedule.provider,
    scheduleNodeId: schedule.scheduleNodeId,
    timezone: schedule.timezone,
    userId: schedule.userId,
    workflowId: schedule.workflowId,
  };
}

function buildTriggerPayload(schedule: WorkflowScheduleRecord) {
  return {
    scheduleId: schedule.id,
    scheduleNodeId: schedule.scheduleNodeId,
    workflowId: schedule.workflowId,
  };
}

function buildTriggerUrl(req: Request, scheduleId: string): string {
  return `${getPublicApiBaseUrl(req)}/api/scheduler/trigger/${encodeURIComponent(
    scheduleId,
  )}`;
}

async function getGcpCredential(userId: string): Promise<Record<string, any>> {
  const credential = await prisma.cloudCredential.findUnique({
    where: {
      userId_provider: {
        userId,
        provider: 'gcp',
      },
    },
  });

  if (!credential || typeof credential.data !== 'object' || !credential.data) {
    throw new ScheduleValidationError(
      'GCP credentials required. Connect GCP from the GCP Runner menu or Integrations.',
    );
  }

  return credential.data as Record<string, any>;
}

async function buildProvisionRequest({
  credentials,
  req,
  schedule,
}: {
  credentials: Record<string, any>;
  req: Request;
  schedule: WorkflowScheduleRecord;
}): Promise<SchedulerProvisionRequest> {
  const triggerUrl = buildTriggerUrl(req, schedule.id);

  return {
    credentials,
    schedule: toScheduleState(schedule),
    triggerPayload: buildTriggerPayload(schedule),
    triggerUrl,
  };
}

async function updateScheduleError(scheduleId: string, error: unknown) {
  await prisma.workflowSchedule.update({
    where: { id: scheduleId },
    data: {
      lastError: error instanceof Error ? error.message : String(error),
    },
  });
}

export async function reconcileWorkflowSchedules({
  cloudProvider,
  nodes,
  req,
  userId,
  workflowId,
}: {
  cloudProvider: string | null | undefined;
  nodes: Prisma.JsonValue | unknown;
  req: Request;
  userId: string;
  workflowId: string;
}) {
  const definitions = extractScheduleDefinitions({ cloudProvider, nodes });
  const existing = await prisma.workflowSchedule.findMany({
    where: {
      userId,
      workflowId,
    },
  });
  const existingByNodeId = new Map(
    existing.map((schedule) => [schedule.scheduleNodeId, schedule]),
  );
  const desiredNodeIds = new Set(
    definitions.map((definition) => definition.scheduleNodeId),
  );
  let gcpCredential: Record<string, any> | null = null;

  const getCredential = async () => {
    if (!gcpCredential) {
      gcpCredential = await getGcpCredential(userId);
    }
    return gcpCredential;
  };

  for (const removed of existing) {
    if (desiredNodeIds.has(removed.scheduleNodeId)) {
      continue;
    }

    if (removed.provider === 'GCP' && removed.gcpJobName) {
      const credentials = await getCredential();
      await apiRuntime.scheduler.delete(
        await buildProvisionRequest({
          credentials,
          req,
          schedule: removed,
        }),
      );
    }

    await prisma.workflowSchedule.delete({ where: { id: removed.id } });
  }

  for (const definition of definitions) {
    const previous = existingByNodeId.get(definition.scheduleNodeId);
    const schedule = await prisma.workflowSchedule.upsert({
      where: {
        workflowId_scheduleNodeId: {
          workflowId,
          scheduleNodeId: definition.scheduleNodeId,
        },
      },
      create: {
        cron: definition.cron,
        enabled: definition.enabled,
        provider: definition.provider,
        scheduleNodeId: definition.scheduleNodeId,
        timezone: definition.timezone,
        userId,
        workflowId,
      },
      update: {
        cron: definition.cron,
        enabled: definition.enabled,
        provider: definition.provider,
        timezone: definition.timezone,
      },
    });

    if (definition.enabled && definition.provider === 'GCP') {
      try {
        const credentials = await getCredential();
        const result = await apiRuntime.scheduler.upsert(
          await buildProvisionRequest({
            credentials,
            req,
            schedule,
          }),
        );
        await prisma.workflowSchedule.update({
          where: { id: schedule.id },
          data: {
            gcpJobName: result.gcpJobName ?? schedule.gcpJobName,
            lastError: null,
          },
        });
      } catch (error) {
        await updateScheduleError(schedule.id, error);
        throw error;
      }
      continue;
    }

    if (previous?.provider === 'GCP' && previous.gcpJobName) {
      try {
        const credentials = await getCredential();
        const pausedSchedule = {
          ...schedule,
          enabled: false,
          gcpJobName: previous.gcpJobName,
          provider: 'GCP',
        };
        await apiRuntime.scheduler.pause(
          await buildProvisionRequest({
            credentials,
            req,
            schedule: pausedSchedule,
          }),
        );
        await prisma.workflowSchedule.update({
          where: { id: schedule.id },
          data: {
            gcpJobName: previous.gcpJobName,
            lastError: null,
          },
        });
      } catch (error) {
        await updateScheduleError(schedule.id, error);
        throw error;
      }
    }
  }
}

export async function deleteWorkflowSchedules({
  req,
  userId,
  workflowId,
}: {
  req: Request;
  userId: string;
  workflowId: string;
}) {
  const schedules = await prisma.workflowSchedule.findMany({
    where: {
      userId,
      workflowId,
    },
  });
  let gcpCredential: Record<string, any> | null = null;

  const getCredential = async () => {
    if (!gcpCredential) {
      gcpCredential = await getGcpCredential(userId);
    }
    return gcpCredential;
  };

  for (const schedule of schedules) {
    if (schedule.provider !== 'GCP' || !schedule.gcpJobName) {
      continue;
    }

    const credentials = await getCredential();
    await apiRuntime.scheduler.delete(
      await buildProvisionRequest({
        credentials,
        req,
        schedule,
      }),
    );
  }
}

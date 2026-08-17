import type { Prisma } from '../generated/prisma/client.cts';
import { prisma } from '../lib/prisma';

export class WorkflowAccessError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(message);
  }
}

export const workflowAccessInclude = (userId: string) =>
  ({
    teamShares: {
      where: {
        team: { memberships: { some: { userId } } },
      },
      include: { team: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    },
  }) satisfies Prisma.WorkflowInclude;

export function accessibleWorkflowWhere(
  userId: string,
): Prisma.WorkflowWhereInput {
  return {
    OR: [
      { userId },
      {
        teamShares: {
          some: { team: { memberships: { some: { userId } } } },
        },
      },
    ],
  };
}

export async function getAccessibleWorkflow(
  userId: string,
  workflowId: string,
) {
  return prisma.workflow.findFirst({
    where: { id: workflowId, ...accessibleWorkflowWhere(userId) },
    include: workflowAccessInclude(userId),
  });
}

export async function requireAccessibleWorkflow(
  userId: string,
  workflowId: string,
) {
  const workflow = await getAccessibleWorkflow(userId, workflowId);
  if (!workflow) {
    throw new WorkflowAccessError(
      'Workflow not found or you no longer have access.',
      404,
      'workflow_not_found',
    );
  }
  return workflow;
}

export async function requireWorkflowOwner(userId: string, workflowId: string) {
  const workflow = await prisma.workflow.findFirst({
    where: { id: workflowId, userId },
    include: {
      teamShares: {
        include: { team: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'asc' },
      },
    },
  });
  if (!workflow) {
    throw new WorkflowAccessError(
      'Only the workflow owner can change this workflow.',
      403,
      'workflow_owner_required',
    );
  }
  return workflow;
}

export function serializeWorkflowAccess(
  workflow: {
    userId: string;
    teamShares?: Array<{
      permission: string;
      team: { id: string; name: string };
    }>;
  },
  actorUserId: string,
) {
  const isOwner = workflow.userId === actorUserId;
  return {
    canEdit: isOwner,
    canRun: isOwner || Boolean(workflow.teamShares?.length),
    ownerUserId: workflow.userId,
    permission: isOwner ? 'owner' : 'view_run',
    sharedTeams: (workflow.teamShares ?? []).map((share) => ({
      id: share.team.id,
      name: share.team.name,
      permission: share.permission,
    })),
  };
}

export async function replaceWorkflowTeamShares(
  userId: string,
  workflowId: string,
  rawTeamIds: unknown,
) {
  await requireWorkflowOwner(userId, workflowId);
  if (
    !Array.isArray(rawTeamIds) ||
    rawTeamIds.some((id) => typeof id !== 'string')
  ) {
    throw new WorkflowAccessError(
      'teamIds must be an array of team IDs.',
      400,
      'invalid_team_ids',
    );
  }
  const teamIds = [
    ...new Set(rawTeamIds.map((id) => id.trim()).filter(Boolean)),
  ];
  const memberships = await prisma.teamMembership.findMany({
    where: { userId, teamId: { in: teamIds } },
    select: { teamId: true },
  });
  if (memberships.length !== teamIds.length) {
    throw new WorkflowAccessError(
      'A workflow can only be shared with teams you belong to.',
      403,
      'team_membership_required',
    );
  }

  await prisma.$transaction([
    prisma.workflowTeamShare.deleteMany({
      where: { workflowId, teamId: { notIn: teamIds } },
    }),
    ...teamIds.map((teamId) =>
      prisma.workflowTeamShare.upsert({
        where: { workflowId_teamId: { workflowId, teamId } },
        create: {
          workflowId,
          teamId,
          permission: 'view_run',
          createdByUserId: userId,
        },
        update: { permission: 'view_run' },
      }),
    ),
  ]);

  return requireWorkflowOwner(userId, workflowId);
}

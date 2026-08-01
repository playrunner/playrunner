import type { AuthUser } from '../auth/auth.types';
import { prisma } from '../lib/prisma';
import {
  createInvitationToken,
  getInvitationStatus,
  hashInvitationToken,
  isValidEmail,
  normalizeEmail,
  TEAM_INVITATION_TTL_MS,
  verifiedEmailMatches,
} from './team-invitations';

export class TeamServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(message);
  }
}

function invitationExpiry() {
  return new Date(Date.now() + TEAM_INVITATION_TTL_MS);
}

function publicInvitationPath(token: string) {
  return `/teams/invitations/${encodeURIComponent(token)}`;
}

function actorEmail(actor: AuthUser) {
  return actor.email ? normalizeEmail(actor.email) : null;
}

function actorDisplayName(actor: AuthUser) {
  return actor.name?.trim() || actor.username?.trim() || actor.email || null;
}

async function requireOwner(teamId: string, userId: string) {
  const membership = await prisma.teamMembership.findUnique({
    where: { teamId_userId: { teamId, userId } },
  });
  if (!membership || membership.role !== 'owner') {
    throw new TeamServiceError(
      'Only a team owner can manage invitations and members.',
      403,
      'owner_required',
    );
  }

  return membership;
}

async function expirePendingInvitations(teamId?: string) {
  await prisma.teamInvitation.updateMany({
    where: {
      ...(teamId ? { teamId } : {}),
      status: 'pending',
      expiresAt: { lte: new Date() },
    },
    data: { status: 'expired' },
  });
}

function serializeInvitation(invitation: {
  acceptedAt: Date | null;
  createdAt: Date;
  email: string;
  expiresAt: Date;
  id: string;
  revokedAt: Date | null;
  status: string;
}) {
  return {
    acceptedAt: invitation.acceptedAt,
    createdAt: invitation.createdAt,
    email: invitation.email,
    expiresAt: invitation.expiresAt,
    id: invitation.id,
    revokedAt: invitation.revokedAt,
    status: getInvitationStatus(invitation.status, invitation.expiresAt),
  };
}

export async function listTeams(actor: AuthUser) {
  await expirePendingInvitations();
  const memberships = await prisma.teamMembership.findMany({
    where: { userId: actor.providerUserId },
    orderBy: { createdAt: 'asc' },
    include: {
      team: {
        include: {
          memberships: { orderBy: { createdAt: 'asc' } },
          invitations: { orderBy: { createdAt: 'desc' } },
        },
      },
    },
  });

  return memberships.map((currentMembership) => ({
    createdAt: currentMembership.team.createdAt,
    id: currentMembership.team.id,
    name: currentMembership.team.name,
    currentUserRole: currentMembership.role,
    members: currentMembership.team.memberships.map((membership) => ({
      createdAt: membership.createdAt,
      displayName: membership.displayName,
      email: membership.email,
      id: membership.id,
      role: membership.role,
      userId: membership.userId,
    })),
    invitations:
      currentMembership.role === 'owner'
        ? currentMembership.team.invitations.map(serializeInvitation)
        : [],
  }));
}

export async function createTeam(actor: AuthUser, rawName: string) {
  const name = rawName.trim();
  if (!name || name.length > 80) {
    throw new TeamServiceError(
      'Team name must be between 1 and 80 characters.',
      400,
      'invalid_team_name',
    );
  }

  const email = actorEmail(actor);
  const team = await prisma.team.create({
    data: {
      name,
      createdByUserId: actor.providerUserId,
      memberships: {
        create: {
          displayName: actorDisplayName(actor),
          email,
          normalizedEmail: email,
          role: 'owner',
          userId: actor.providerUserId,
        },
      },
    },
  });

  return team;
}

async function ensureEmailIsNotMember(teamId: string, normalizedEmail: string) {
  const member = await prisma.teamMembership.findUnique({
    where: { teamId_normalizedEmail: { teamId, normalizedEmail } },
  });
  if (member) {
    throw new TeamServiceError(
      'That email address already belongs to a team member.',
      409,
      'already_member',
    );
  }
}

export async function createTeamInvitation(
  actor: AuthUser,
  teamId: string,
  rawEmail: string,
) {
  await requireOwner(teamId, actor.providerUserId);
  if (!isValidEmail(rawEmail)) {
    throw new TeamServiceError(
      'Enter a valid email address.',
      400,
      'invalid_email',
    );
  }

  const normalizedEmail = normalizeEmail(rawEmail);
  await ensureEmailIsNotMember(teamId, normalizedEmail);
  const existing = await prisma.teamInvitation.findUnique({
    where: { teamId_normalizedEmail: { teamId, normalizedEmail } },
  });
  if (
    existing &&
    getInvitationStatus(existing.status, existing.expiresAt) === 'pending'
  ) {
    throw new TeamServiceError(
      'A pending invitation already exists for that email address.',
      409,
      'duplicate_invitation',
    );
  }
  if (existing?.status === 'accepted') {
    throw new TeamServiceError(
      'That invitation has already been accepted.',
      409,
      'already_accepted',
    );
  }

  const token = createInvitationToken();
  const data = {
    createdByUserId: actor.providerUserId,
    email: normalizedEmail,
    expiresAt: invitationExpiry(),
    normalizedEmail,
    status: 'pending',
    tokenHash: hashInvitationToken(token),
    acceptedAt: null,
    acceptedByUserId: null,
    revokedAt: null,
  };
  const invitation = existing
    ? await prisma.teamInvitation.update({ where: { id: existing.id }, data })
    : await prisma.teamInvitation.create({
        data: { ...data, teamId },
      });

  return {
    ...serializeInvitation(invitation),
    invitationPath: publicInvitationPath(token),
  };
}

export async function resendTeamInvitation(
  actor: AuthUser,
  teamId: string,
  invitationId: string,
) {
  await requireOwner(teamId, actor.providerUserId);
  const invitation = await prisma.teamInvitation.findFirst({
    where: { id: invitationId, teamId },
  });
  if (!invitation) {
    throw new TeamServiceError(
      'Invitation not found.',
      404,
      'invitation_not_found',
    );
  }
  if (
    getInvitationStatus(invitation.status, invitation.expiresAt) !== 'pending'
  ) {
    throw new TeamServiceError(
      'Only pending invitations can be resent.',
      409,
      'invitation_not_pending',
    );
  }

  const token = createInvitationToken();
  const updated = await prisma.teamInvitation.update({
    where: { id: invitation.id },
    data: {
      expiresAt: invitationExpiry(),
      tokenHash: hashInvitationToken(token),
    },
  });
  return {
    ...serializeInvitation(updated),
    invitationPath: publicInvitationPath(token),
  };
}

export async function revokeTeamInvitation(
  actor: AuthUser,
  teamId: string,
  invitationId: string,
) {
  await requireOwner(teamId, actor.providerUserId);
  const result = await prisma.teamInvitation.updateMany({
    where: { id: invitationId, teamId, status: 'pending' },
    data: { revokedAt: new Date(), status: 'revoked' },
  });
  if (result.count !== 1) {
    throw new TeamServiceError(
      'Only a pending invitation can be revoked.',
      409,
      'invitation_not_pending',
    );
  }
}

export async function removeTeamMember(
  actor: AuthUser,
  teamId: string,
  membershipId: string,
) {
  await requireOwner(teamId, actor.providerUserId);
  const member = await prisma.teamMembership.findFirst({
    where: { id: membershipId, teamId },
  });
  if (!member) {
    throw new TeamServiceError('Member not found.', 404, 'member_not_found');
  }
  if (member.role === 'owner') {
    throw new TeamServiceError(
      'The team owner cannot be removed. A team must always have an owner.',
      409,
      'owner_cannot_be_removed',
    );
  }

  await prisma.teamMembership.delete({ where: { id: member.id } });
}

export async function getInvitationPreview(token: string) {
  const invitation = await prisma.teamInvitation.findUnique({
    where: { tokenHash: hashInvitationToken(token) },
    include: { team: true },
  });
  if (!invitation) {
    throw new TeamServiceError(
      'This invitation link is invalid.',
      404,
      'invalid_invitation',
    );
  }

  const status = getInvitationStatus(invitation.status, invitation.expiresAt);
  if (status === 'expired' && invitation.status === 'pending') {
    await prisma.teamInvitation.update({
      where: { id: invitation.id },
      data: { status: 'expired' },
    });
  }

  return {
    email: invitation.email,
    expiresAt: invitation.expiresAt,
    status,
    teamName: invitation.team.name,
  };
}

export async function acceptTeamInvitation(actor: AuthUser, token: string) {
  const invitation = await prisma.teamInvitation.findUnique({
    where: { tokenHash: hashInvitationToken(token) },
  });
  if (!invitation) {
    throw new TeamServiceError(
      'This invitation link is invalid.',
      404,
      'invalid_invitation',
    );
  }

  const status = getInvitationStatus(invitation.status, invitation.expiresAt);
  if (status === 'accepted') {
    throw new TeamServiceError(
      'This invitation has already been used.',
      409,
      'invitation_already_used',
    );
  }
  if (status === 'revoked') {
    throw new TeamServiceError(
      'This invitation has been revoked.',
      410,
      'invitation_revoked',
    );
  }
  if (status === 'expired') {
    await expirePendingInvitations(invitation.teamId);
    throw new TeamServiceError(
      'This invitation has expired.',
      410,
      'invitation_expired',
    );
  }
  if (
    !verifiedEmailMatches(
      actor.email,
      actor.emailVerified,
      invitation.normalizedEmail,
    )
  ) {
    throw new TeamServiceError(
      'Sign in with the verified email address that received this invitation.',
      403,
      'invitation_email_mismatch',
    );
  }

  await prisma.$transaction(async (transaction) => {
    const claimed = await transaction.teamInvitation.updateMany({
      where: {
        id: invitation.id,
        status: 'pending',
        expiresAt: { gt: new Date() },
      },
      data: {
        acceptedAt: new Date(),
        acceptedByUserId: actor.providerUserId,
        status: 'accepted',
      },
    });
    if (claimed.count !== 1) {
      throw new TeamServiceError(
        'This invitation has already been used.',
        409,
        'invitation_already_used',
      );
    }

    await transaction.teamMembership.upsert({
      where: {
        teamId_userId: {
          teamId: invitation.teamId,
          userId: actor.providerUserId,
        },
      },
      update: {
        displayName: actorDisplayName(actor),
        email: normalizeEmail(actor.email ?? ''),
        normalizedEmail: normalizeEmail(actor.email ?? ''),
      },
      create: {
        displayName: actorDisplayName(actor),
        email: normalizeEmail(actor.email ?? ''),
        normalizedEmail: normalizeEmail(actor.email ?? ''),
        role: 'member',
        teamId: invitation.teamId,
        userId: actor.providerUserId,
      },
    });
  });

  return { teamId: invitation.teamId };
}

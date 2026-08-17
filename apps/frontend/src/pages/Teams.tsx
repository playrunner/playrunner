import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Clock3,
  Loader2,
  MailPlus,
  GitBranch,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UserRound,
  Users,
} from 'lucide-react';
import { IntegrationCopyableCode } from '@playrunner/integration-sdk';
import { Badge, Button, Input, SearchableMultiSelect } from '../components/ui';
import { DbAPI } from '../lib/db';

type TeamMember = {
  createdAt: string;
  displayName: string | null;
  email: string | null;
  id: string;
  role: 'owner' | 'member';
  userId: string;
};

type TeamInvitation = {
  acceptedAt: string | null;
  createdAt: string;
  email: string;
  expiresAt: string;
  id: string;
  revokedAt: string | null;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
};

type Team = {
  createdAt: string;
  currentUserRole: 'owner' | 'member';
  id: string;
  invitations: TeamInvitation[];
  members: TeamMember[];
  name: string;
  sharedWorkflows: SharedWorkflow[];
};

type SharedWorkflow = {
  id: string;
  ownerUserId: string;
  permission: 'view_run';
  title: string | null;
  updatedAt: string;
};

type OwnedWorkflow = SharedWorkflow & {
  access: {
    sharedTeams: Array<{ id: string; name: string; permission: string }>;
  };
};

type CreatedInvitation = TeamInvitation & { invitationPath: string };

function invitationBadge(status: TeamInvitation['status']) {
  if (status === 'accepted') return <Badge variant="success">Accepted</Badge>;
  if (status === 'pending') return <Badge variant="default">Pending</Badge>;
  if (status === 'revoked') return <Badge variant="danger">Revoked</Badge>;
  return <Badge variant="outline">Expired</Badge>;
}

function invitationUrl(path: string) {
  return new URL(path, window.location.origin).toString();
}

export default function Teams() {
  const navigate = useNavigate();
  const [teams, setTeams] = useState<Team[]>([]);
  const [ownedWorkflows, setOwnedWorkflows] = useState<OwnedWorkflow[]>([]);
  const [teamWorkflowSelections, setTeamWorkflowSelections] = useState<
    Record<string, string[]>
  >({});
  const [teamName, setTeamName] = useState('');
  const [inviteEmails, setInviteEmails] = useState<Record<string, string>>({});
  const [latestInvitation, setLatestInvitation] =
    useState<CreatedInvitation | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [busyAction, setBusyAction] = useState('');
  const [error, setError] = useState<string | null>(null);

  const loadTeams = useCallback(async () => {
    try {
      const [nextTeams, workflows] = await Promise.all([
        DbAPI.getTeams(),
        DbAPI.getWorkflows(''),
      ]);
      const typedTeams = nextTeams as Team[];
      const typedWorkflows = workflows as OwnedWorkflow[];
      setTeams(typedTeams);
      setOwnedWorkflows(typedWorkflows);
      setTeamWorkflowSelections(
        Object.fromEntries(
          typedTeams.map((team) => [
            team.id,
            typedWorkflows
              .filter((workflow) =>
                workflow.access.sharedTeams.some(
                  (sharedTeam) => sharedTeam.id === team.id,
                ),
              )
              .map((workflow) => workflow.id),
          ]),
        ),
      );
      setError(null);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Failed to load teams.',
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTeams();
  }, [loadTeams]);

  const createTeam = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusyAction('create-team');
    setError(null);
    try {
      await DbAPI.createTeam(teamName);
      setTeamName('');
      await loadTeams();
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : 'Failed to create the team.',
      );
    } finally {
      setBusyAction('');
    }
  };

  const inviteMember = async (
    event: FormEvent<HTMLFormElement>,
    teamId: string,
  ) => {
    event.preventDefault();
    const email = inviteEmails[teamId] ?? '';
    setBusyAction(`invite-${teamId}`);
    setError(null);
    try {
      const invitation = (await DbAPI.createTeamInvitation(
        teamId,
        email,
      )) as CreatedInvitation;
      setLatestInvitation(invitation);
      setInviteEmails((current) => ({ ...current, [teamId]: '' }));
      await loadTeams();
    } catch (inviteError) {
      setError(
        inviteError instanceof Error
          ? inviteError.message
          : 'Failed to create the invitation.',
      );
    } finally {
      setBusyAction('');
    }
  };

  const resendInvitation = async (teamId: string, invitationId: string) => {
    setBusyAction(`resend-${invitationId}`);
    setError(null);
    try {
      const invitation = (await DbAPI.resendTeamInvitation(
        teamId,
        invitationId,
      )) as CreatedInvitation;
      setLatestInvitation(invitation);
      await loadTeams();
    } catch (resendError) {
      setError(
        resendError instanceof Error
          ? resendError.message
          : 'Failed to resend the invitation.',
      );
    } finally {
      setBusyAction('');
    }
  };

  const revokeInvitation = async (teamId: string, invitationId: string) => {
    setBusyAction(`revoke-${invitationId}`);
    setError(null);
    try {
      await DbAPI.revokeTeamInvitation(teamId, invitationId);
      setLatestInvitation((current) =>
        current?.id === invitationId ? null : current,
      );
      await loadTeams();
    } catch (revokeError) {
      setError(
        revokeError instanceof Error
          ? revokeError.message
          : 'Failed to revoke the invitation.',
      );
    } finally {
      setBusyAction('');
    }
  };

  const removeMember = async (teamId: string, member: TeamMember) => {
    if (!window.confirm(`Remove ${member.email || member.displayName}?`))
      return;
    setBusyAction(`remove-${member.id}`);
    setError(null);
    try {
      await DbAPI.removeTeamMember(teamId, member.id);
      await loadTeams();
    } catch (removeError) {
      setError(
        removeError instanceof Error
          ? removeError.message
          : 'Failed to remove the member.',
      );
    } finally {
      setBusyAction('');
    }
  };

  const deleteTeam = async (team: Team) => {
    if (
      !window.confirm(
        `Delete team "${team.name}"? Memberships, invitations, and workflow shares will be removed. The underlying workflows and connections will not be deleted.`,
      )
    ) {
      return;
    }
    setBusyAction(`delete-team-${team.id}`);
    setError(null);
    try {
      await DbAPI.deleteTeam(team.id);
      setLatestInvitation(null);
      await loadTeams();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : 'Failed to delete the team.',
      );
    } finally {
      setBusyAction('');
    }
  };

  const updateTeamWorkflowShares = async (
    teamId: string,
    nextWorkflowIds: string[],
  ) => {
    const previousWorkflowIds = teamWorkflowSelections[teamId] ?? [];
    const previousSet = new Set(previousWorkflowIds);
    const nextSet = new Set(nextWorkflowIds);
    const changedWorkflows = ownedWorkflows.filter(
      (workflow) => previousSet.has(workflow.id) !== nextSet.has(workflow.id),
    );

    if (changedWorkflows.length === 0) return;

    setTeamWorkflowSelections((current) => ({
      ...current,
      [teamId]: nextWorkflowIds,
    }));
    setBusyAction(`share-team-${teamId}`);
    setError(null);
    try {
      await Promise.all(
        changedWorkflows.map((workflow) => {
          const existingTeamIds = workflow.access.sharedTeams.map(
            (team) => team.id,
          );
          const nextTeamIds = nextSet.has(workflow.id)
            ? [...new Set([...existingTeamIds, teamId])]
            : existingTeamIds.filter((id) => id !== teamId);
          return DbAPI.updateWorkflowTeamShares(workflow.id, nextTeamIds);
        }),
      );
      await loadTeams();
    } catch (shareError) {
      setTeamWorkflowSelections((current) => ({
        ...current,
        [teamId]: previousWorkflowIds,
      }));
      setError(
        shareError instanceof Error
          ? shareError.message
          : 'Failed to update workflow sharing.',
      );
    } finally {
      setBusyAction('');
    }
  };

  return (
    <main className="flex-1 max-w-7xl mx-auto p-8 w-full space-y-6">
      <header className="border-b border-subtle pb-6">
        <h1 className="text-3xl font-semibold tracking-tight text-[var(--foreground)]">
          Teams
        </h1>
        <p className="text-sm text-muted mt-2 leading-relaxed">
          Create shared workspaces, invite collaborators, and manage access.
        </p>
      </header>

      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-500"
        >
          {error}
        </div>
      ) : null}

      <section className="bg-surface border border-subtle rounded-xl shadow-sm overflow-hidden">
        <div className="p-6 border-b border-subtle">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-surface-hover border border-subtle flex items-center justify-center text-muted">
              <Plus className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-xl font-medium text-[var(--foreground)]">
                Create a team
              </h2>
              <p className="text-sm text-muted leading-relaxed mt-1">
                You become the owner and can invite or remove members.
              </p>
            </div>
          </div>
        </div>
        <form
          className="flex flex-col gap-3 p-6 sm:flex-row"
          onSubmit={createTeam}
        >
          <label className="sr-only" htmlFor="team-name">
            Team name
          </label>
          <Input
            id="team-name"
            value={teamName}
            onChange={(event) => setTeamName(event.target.value)}
            placeholder="Team name"
            maxLength={80}
            required
          />
          <Button
            type="submit"
            className="shrink-0 gap-2"
            disabled={busyAction === 'create-team'}
          >
            {busyAction === 'create-team' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            Create team
          </Button>
        </form>
      </section>

      {latestInvitation ? (
        <section className="bg-surface border border-subtle rounded-xl shadow-sm p-6">
          <div className="flex items-start gap-3">
            <div className="h-9 w-9 shrink-0 rounded-lg bg-surface-hover border border-subtle flex items-center justify-center text-muted">
              <MailPlus className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-xl font-medium text-[var(--foreground)]">
                Invitation ready
              </h2>
              <p className="text-sm text-muted leading-relaxed mt-1">
                Share this single-use link with {latestInvitation.email}. A new
                link replaces the previous one when you resend.
              </p>
              <IntegrationCopyableCode
                value={invitationUrl(latestInvitation.invitationPath)}
                label="Copy team invitation link"
              />
            </div>
          </div>
        </section>
      ) : null}

      {isLoading ? (
        <div className="flex items-center justify-center p-12 text-muted">
          <Loader2
            className="h-5 w-5 animate-spin"
            aria-label="Loading teams"
          />
        </div>
      ) : teams.length === 0 ? (
        <section className="bg-surface border border-subtle rounded-xl shadow-sm p-8 text-center">
          <Users className="mx-auto h-6 w-6 text-muted" />
          <h2 className="mt-4 text-xl font-medium text-[var(--foreground)]">
            No teams yet
          </h2>
          <p className="mt-2 text-sm text-muted leading-relaxed">
            Create your first team to start collaborating.
          </p>
        </section>
      ) : (
        teams.map((team) => (
          <section
            key={team.id}
            data-testid="team-card"
            className="bg-surface border border-subtle rounded-xl shadow-sm overflow-hidden"
          >
            <div className="flex items-center justify-between gap-4 p-6 border-b border-subtle">
              <div>
                <h2 className="text-xl font-medium text-[var(--foreground)]">
                  {team.name}
                </h2>
                <p className="text-sm text-muted leading-relaxed mt-1">
                  {team.members.length} member
                  {team.members.length === 1 ? '' : 's'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge
                  variant={
                    team.currentUserRole === 'owner' ? 'success' : 'default'
                  }
                >
                  {team.currentUserRole === 'owner' ? (
                    <ShieldCheck className="h-3 w-3" />
                  ) : null}
                  {team.currentUserRole}
                </Badge>
                {team.currentUserRole === 'owner' ? (
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    className="gap-1.5"
                    disabled={busyAction === `delete-team-${team.id}`}
                    onClick={() => void deleteTeam(team)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete team
                  </Button>
                ) : null}
              </div>
            </div>

            {team.currentUserRole === 'owner' ? (
              <div className="p-6 border-b border-subtle">
                <h3 className="text-sm font-medium text-[var(--foreground)]">
                  Invite a member
                </h3>
                <p className="text-xs text-muted leading-relaxed mt-1">
                  Membership is granted only after the recipient signs in with
                  this verified email address.
                </p>
                <form
                  className="mt-4 flex flex-col gap-3 sm:flex-row"
                  onSubmit={(event) => void inviteMember(event, team.id)}
                >
                  <label
                    className="sr-only"
                    htmlFor={`invite-email-${team.id}`}
                  >
                    Email address
                  </label>
                  <Input
                    id={`invite-email-${team.id}`}
                    type="email"
                    value={inviteEmails[team.id] ?? ''}
                    onChange={(event) =>
                      setInviteEmails((current) => ({
                        ...current,
                        [team.id]: event.target.value,
                      }))
                    }
                    placeholder="colleague@example.com"
                    required
                  />
                  <Button
                    type="submit"
                    className="shrink-0 gap-2"
                    disabled={busyAction === `invite-${team.id}`}
                  >
                    <MailPlus className="h-4 w-4" />
                    Send invitation
                  </Button>
                </form>
              </div>
            ) : null}

            <div className="grid grid-cols-1 gap-6 border-b border-subtle p-6 lg:grid-cols-2">
              <div>
                <h3 className="text-sm font-medium text-[var(--foreground)]">
                  Share your workflows
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-muted">
                  Team members receive view and run access. Linked global
                  environments and required connections stay server-side.
                </p>
                <div className="mt-3">
                  {ownedWorkflows.length === 0 ? (
                    <div className="rounded-xl border border-subtle bg-[var(--background)] p-4 text-sm text-muted">
                      You do not own any workflows yet.
                    </div>
                  ) : (
                    <SearchableMultiSelect
                      options={ownedWorkflows.map((workflow) => ({
                        value: workflow.id,
                        label: workflow.title || 'Untitled Workflow',
                      }))}
                      selectedValues={teamWorkflowSelections[team.id] ?? []}
                      onChange={(workflowIds) =>
                        void updateTeamWorkflowShares(team.id, workflowIds)
                      }
                      placeholder="Select workflows"
                      searchPlaceholder="Search workflows..."
                      emptyMessage="No workflows match your search."
                      ariaLabel={`Workflows shared with ${team.name}`}
                      disabled={busyAction === `share-team-${team.id}`}
                      expandOnOpen
                    />
                  )}
                </div>
              </div>

              <div>
                <h3 className="text-sm font-medium text-[var(--foreground)]">
                  Team workflows
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-muted">
                  Workflows currently available to every member of this team.
                </p>
                <div className="mt-3 space-y-2">
                  {team.sharedWorkflows.length === 0 ? (
                    <div className="rounded-xl border border-subtle bg-[var(--background)] p-4 text-sm text-muted">
                      No workflows shared with this team.
                    </div>
                  ) : (
                    team.sharedWorkflows.map((workflow) => (
                      <button
                        key={workflow.id}
                        type="button"
                        className="flex w-full items-center justify-between gap-3 rounded-xl border border-subtle bg-[var(--background)] p-4 text-left hover:border-[var(--border-strong)]"
                        onClick={() => navigate(`/workflow/${workflow.id}`)}
                      >
                        <span className="flex min-w-0 items-center gap-3">
                          <GitBranch className="h-4 w-4 shrink-0 text-muted" />
                          <span className="truncate text-sm font-medium text-[var(--foreground)]">
                            {workflow.title || 'Untitled Workflow'}
                          </span>
                        </span>
                        <Badge variant="outline">View &amp; run</Badge>
                      </button>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-6 p-6 lg:grid-cols-2">
              <div>
                <h3 className="text-sm font-medium text-[var(--foreground)]">
                  Members
                </h3>
                <div className="mt-3 space-y-2">
                  {team.members.map((member) => (
                    <div
                      key={member.id}
                      className="flex items-center justify-between gap-3 rounded-xl border border-subtle bg-[var(--background)] p-4"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <UserRound className="h-4 w-4 shrink-0 text-muted" />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-[var(--foreground)]">
                            {member.displayName ||
                              member.email ||
                              'Team member'}
                          </p>
                          {member.email ? (
                            <p className="truncate text-xs text-muted">
                              {member.email}
                            </p>
                          ) : null}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={
                            member.role === 'owner' ? 'success' : 'default'
                          }
                        >
                          {member.role}
                        </Badge>
                        {team.currentUserRole === 'owner' &&
                        member.role !== 'owner' ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={`Remove ${member.email || member.displayName || 'member'}`}
                            title="Remove member"
                            disabled={busyAction === `remove-${member.id}`}
                            onClick={() => void removeMember(team.id, member)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {team.currentUserRole === 'owner' ? (
                <div>
                  <h3 className="text-sm font-medium text-[var(--foreground)]">
                    Invitations
                  </h3>
                  <div className="mt-3 space-y-2">
                    {team.invitations.length === 0 ? (
                      <div className="rounded-xl border border-subtle bg-[var(--background)] p-4 text-sm text-muted">
                        No invitations sent.
                      </div>
                    ) : (
                      team.invitations.map((invitation) => (
                        <div
                          key={invitation.id}
                          className="rounded-xl border border-subtle bg-[var(--background)] p-4"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-[var(--foreground)]">
                                {invitation.email}
                              </p>
                              <p className="mt-1 flex items-center gap-1 text-xs text-muted">
                                <Clock3 className="h-3 w-3" />
                                Expires{' '}
                                {new Date(
                                  invitation.expiresAt,
                                ).toLocaleDateString()}
                              </p>
                            </div>
                            {invitationBadge(invitation.status)}
                          </div>
                          {invitation.status === 'pending' ? (
                            <div className="mt-3 flex gap-2">
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                className="gap-1.5"
                                disabled={
                                  busyAction === `resend-${invitation.id}`
                                }
                                onClick={() =>
                                  void resendInvitation(team.id, invitation.id)
                                }
                              >
                                <RefreshCw className="h-3.5 w-3.5" />
                                Resend
                              </Button>
                              <Button
                                type="button"
                                variant="danger"
                                size="sm"
                                disabled={
                                  busyAction === `revoke-${invitation.id}`
                                }
                                onClick={() =>
                                  void revokeInvitation(team.id, invitation.id)
                                }
                              >
                                Revoke
                              </Button>
                            </div>
                          ) : null}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          </section>
        ))
      )}
    </main>
  );
}

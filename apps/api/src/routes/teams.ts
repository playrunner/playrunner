import { Response, Router } from 'express';
import {
  acceptTeamInvitation,
  createTeam,
  createTeamInvitation,
  deleteTeam,
  listTeams,
  removeTeamMember,
  resendTeamInvitation,
  revokeTeamInvitation,
  TeamServiceError,
} from '../services/teams';

export const teamsRouter = Router();

function handleTeamError(error: unknown, res: Response) {
  if (error instanceof TeamServiceError) {
    res.status(error.statusCode).json({
      code: error.code,
      error: error.message,
    });
    return;
  }

  console.error('Team request failed:', error);
  res.status(500).json({ error: 'The team request could not be completed.' });
}

teamsRouter.get('/', async (req, res) => {
  try {
    res.json({ teams: await listTeams(req.authUser!) });
  } catch (error) {
    handleTeamError(error, res);
  }
});

teamsRouter.post('/', async (req, res) => {
  try {
    const name = typeof req.body?.name === 'string' ? req.body.name : '';
    const team = await createTeam(req.authUser!, name);
    res.status(201).json({ team });
  } catch (error) {
    handleTeamError(error, res);
  }
});

teamsRouter.delete('/:teamId', async (req, res) => {
  try {
    await deleteTeam(req.authUser!, req.params.teamId);
    res.status(204).send();
  } catch (error) {
    handleTeamError(error, res);
  }
});

teamsRouter.post('/:teamId/invitations', async (req, res) => {
  try {
    const email = typeof req.body?.email === 'string' ? req.body.email : '';
    const invitation = await createTeamInvitation(
      req.authUser!,
      req.params.teamId,
      email,
    );
    res.status(201).json({ invitation });
  } catch (error) {
    handleTeamError(error, res);
  }
});

teamsRouter.post(
  '/:teamId/invitations/:invitationId/resend',
  async (req, res) => {
    try {
      const invitation = await resendTeamInvitation(
        req.authUser!,
        req.params.teamId,
        req.params.invitationId,
      );
      res.json({ invitation });
    } catch (error) {
      handleTeamError(error, res);
    }
  },
);

teamsRouter.delete('/:teamId/invitations/:invitationId', async (req, res) => {
  try {
    await revokeTeamInvitation(
      req.authUser!,
      req.params.teamId,
      req.params.invitationId,
    );
    res.status(204).send();
  } catch (error) {
    handleTeamError(error, res);
  }
});

teamsRouter.delete('/:teamId/members/:membershipId', async (req, res) => {
  try {
    await removeTeamMember(
      req.authUser!,
      req.params.teamId,
      req.params.membershipId,
    );
    res.status(204).send();
  } catch (error) {
    handleTeamError(error, res);
  }
});

teamsRouter.post('/invitations/:token/accept', async (req, res) => {
  try {
    const result = await acceptTeamInvitation(req.authUser!, req.params.token);
    res.json(result);
  } catch (error) {
    handleTeamError(error, res);
  }
});

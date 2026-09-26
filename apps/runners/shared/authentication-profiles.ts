export const MAX_AUTHENTICATION_STATE_BYTES = 5 * 1024 * 1024;

export type AuthenticationProfileSelection = {
  profileId: string;
  environmentVariable?: string;
};

export function normalizeAuthenticationProfiles(config: {
  authenticationProfiles?: unknown;
  authenticationProfileId?: unknown;
}): AuthenticationProfileSelection[] {
  const raw =
    config.authenticationProfiles ??
    (typeof config.authenticationProfileId === 'string' &&
    config.authenticationProfileId.trim()
      ? [{ profileId: config.authenticationProfileId }]
      : []);
  if (!Array.isArray(raw) || raw.length > 10) {
    throw new Error('Select at most 10 Authentication Profiles.');
  }
  const ids = new Set<string>();
  const variables = new Set<string>();
  return raw.map((entry, index) => {
    if (
      !entry ||
      typeof entry.profileId !== 'string' ||
      !entry.profileId.trim()
    ) {
      throw new Error('Authentication Profile selection is invalid.');
    }
    const profileId = entry.profileId.trim();
    if (ids.has(profileId))
      throw new Error('Select each Authentication Profile only once.');
    ids.add(profileId);
    if (
      entry.environmentVariable !== undefined &&
      typeof entry.environmentVariable !== 'string'
    ) {
      throw new Error('Authentication Profile session variable is invalid.');
    }
    const environmentVariable = entry.environmentVariable?.trim() || undefined;
    if (index > 0 && !environmentVariable) {
      throw new Error(
        'Additional Authentication Profiles require a session variable.',
      );
    }
    if (environmentVariable) {
      // Restrict file aliases to session variables, never process/runtime controls.
      if (
        !/^[A-Za-z_][A-Za-z0-9_]*_STORAGE_STATE$/.test(environmentVariable) ||
        /^PLAYRUNNER_/i.test(environmentVariable) ||
        environmentVariable.length > 255
      ) {
        throw new Error(
          'Session variables must end in _STORAGE_STATE and cannot start with PLAYRUNNER_.',
        );
      }
      if (variables.has(environmentVariable))
        throw new Error('Session variables must be unique.');
      variables.add(environmentVariable);
    }
    return {
      profileId,
      ...(environmentVariable ? { environmentVariable } : {}),
    };
  });
}

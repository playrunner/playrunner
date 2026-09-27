/** Public selectors/options and private credentials travel only in the encrypted grant. */
export type TotpSettings = {
  allowedOrigins: string[];
  usernameSelector: string;
  usernameSubmitSelector?: string;
  passwordSelector: string;
  submitSelector: string;
  totpSelector: string;
  totpSubmitSelector: string;
  digits: 6 | 8;
  period: number;
  algorithm: 'sha1' | 'sha256' | 'sha512';
};
export type TotpCredentials = {
  username: string;
  password: string;
  secret: string;
};
export type TotpLogin = {
  kind: 'totp_login';
  startUrl: string;
  successCondition: {
    type: 'url_exact' | 'url_prefix' | 'element_visible';
    value: string;
  };
  settings: TotpSettings;
  credentials: TotpCredentials;
};

export function normalizeTotpSettings(value: unknown): TotpSettings {
  const fail = () => {
    throw new Error('TOTP sign-in settings are invalid.');
  };
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return fail();
  const input = value as Record<string, unknown>;
  const selector = (key: string, optional = false) => {
    if (optional && !input[key]) return undefined;
    if (
      typeof input[key] !== 'string' ||
      !(input[key] as string).trim() ||
      (input[key] as string).length > 512
    )
      return fail();
    return (input[key] as string).trim();
  };
  if (
    !Array.isArray(input.allowedOrigins) ||
    !input.allowedOrigins.length ||
    input.allowedOrigins.length > 10
  )
    return fail();
  const allowedOrigins = input.allowedOrigins.map((origin) => {
    try {
      const url = new URL(origin);
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.origin !== origin
      )
        return fail();
      return url.origin;
    } catch {
      return fail();
    }
  });
  const digits = input.digits ?? 6;
  const period = input.period ?? 30;
  const algorithm = input.algorithm ?? 'sha1';
  if (
    (digits !== 6 && digits !== 8) ||
    !Number.isInteger(period) ||
    Number(period) < 15 ||
    Number(period) > 120 ||
    !['sha1', 'sha256', 'sha512'].includes(String(algorithm))
  )
    return fail();
  return {
    allowedOrigins,
    usernameSelector: selector('usernameSelector')!,
    usernameSubmitSelector: selector('usernameSubmitSelector', true),
    passwordSelector: selector('passwordSelector')!,
    submitSelector: selector('submitSelector')!,
    totpSelector: selector('totpSelector')!,
    totpSubmitSelector: selector('totpSubmitSelector')!,
    digits,
    period: Number(period),
    algorithm: algorithm as TotpSettings['algorithm'],
  };
}
export function normalizeTotpCredentials(value: unknown): TotpCredentials {
  const fail = () => {
    throw new Error(
      'Provide the username, password and enrolled Base32 TOTP secret.',
    );
  };
  if (!value || typeof value !== 'object') return fail();
  const data = value as Record<string, unknown>;
  for (const key of ['username', 'password', 'secret'])
    if (
      typeof data[key] !== 'string' ||
      !data[key] ||
      (data[key] as string).length > 4096
    )
      return fail();
  const secret = (data.secret as string).replace(/\s/g, '').toUpperCase();
  if (!/^[A-Z2-7]{26,}={0,6}$/.test(secret)) return fail();
  return {
    username: data.username as string,
    password: data.password as string,
    secret,
  };
}

export interface AuthUser {
  provider: 'firebase' | 'supabase' | 'auth0' | 'clerk' | string;
  providerUserId: string;
  email?: string;
  emailVerified?: boolean;
  name?: string;
}

export interface TokenVerifier {
  verify(token: string): Promise<AuthUser>;
}

declare module 'express-serve-static-core' {
  interface Request {
    authUser?: AuthUser;
  }
}

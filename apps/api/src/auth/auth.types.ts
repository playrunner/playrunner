import { Request } from 'express';

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

declare global {
  namespace Express {
    interface Request {
      authUser?: AuthUser;
    }
  }
}

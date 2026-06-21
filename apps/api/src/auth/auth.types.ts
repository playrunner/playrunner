export interface AuthUser {
  provider: 'local' | string;
  providerUserId: string;
  email?: string;
  emailVerified?: boolean;
  name?: string;
  username?: string;
}

export interface TokenVerifier {
  verify(token: string): Promise<AuthUser>;
}

declare module 'express-serve-static-core' {
  interface Request {
    authUser?: AuthUser;
  }
}

import { createRemoteJWKSet, jwtVerify, decodeJwt } from 'jose';
import { AuthUser, TokenVerifier } from '../auth.types';

// Firebase Auth public JWKS endpoint
const FIREBASE_JWKS_URI = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const JWKS = createRemoteJWKSet(new URL(FIREBASE_JWKS_URI));

export class FirebaseVerifier implements TokenVerifier {
  async verify(token: string): Promise<AuthUser> {
    const unverifiedPayload = decodeJwt(token);
    const projectId = unverifiedPayload.aud;
    
    if (!projectId || typeof projectId !== 'string') {
      throw new Error('Firebase token missing audience (project ID)');
    }

    const { payload } = await jwtVerify(token, JWKS, {
      issuer: `https://securetoken.google.com/${projectId}`,
      audience: projectId,
      algorithms: ['RS256'],
    });

    if (!payload.sub) {
      throw new Error('Firebase token missing sub claim');
    }

    return {
      provider: 'firebase',
      providerUserId: payload.sub,
      email: payload.email as string | undefined,
      emailVerified: payload.email_verified as boolean | undefined,
      name: payload.name as string | undefined,
    };
  }
}

import { decodeJwt } from 'jose';
import { AuthUser } from './auth.types';
import { FirebaseVerifier } from './providers';

const firebaseVerifier = new FirebaseVerifier();

export async function verifyToken(token: string): Promise<AuthUser> {
  // Decode without verifying JUST to inspect the issuer/provider
  const decoded = decodeJwt(token);

  if (!decoded || !decoded.iss) {
    throw new Error('Token is missing issuer (iss) claim or is malformed');
  }

  // Route to the correct provider verifier based on issuer
  if (decoded.iss.startsWith('https://securetoken.google.com/')) {
    return firebaseVerifier.verify(token);
  }
  
  // Future providers (Supabase, Auth0, Clerk, etc.) would be routed here
  
  throw new Error(`Unsupported token issuer: ${decoded.iss}`);
}

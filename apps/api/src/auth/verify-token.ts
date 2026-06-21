import { decodeJwt } from 'jose';
import { AuthUser } from './auth.types';
import { getLocalAuthIssuer, verifyLocalAuthToken } from './local-auth';

export async function verifyToken(token: string): Promise<AuthUser> {
  let decoded;
  try {
    decoded = decodeJwt(token);
  } catch {
    throw new Error('Token is malformed');
  }

  if (!decoded || !decoded.iss) {
    throw new Error('Token is missing issuer (iss) claim or is malformed');
  }

  if (decoded.iss === getLocalAuthIssuer()) {
    return verifyLocalAuthToken(token);
  }

  throw new Error(`Unsupported token issuer: ${decoded.iss}`);
}

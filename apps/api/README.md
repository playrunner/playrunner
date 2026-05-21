# API Server

This is the Node.js Express API for Central Station.

## Authentication Architecture

The API uses a **stateless, provider-agnostic JWT verification** system. It does not rely on heavy backend SDKs like Firebase Admin or Supabase SDK for authentication. Instead, it cryptographically verifies tokens using public JWKS (JSON Web Key Sets).

### How it works:

1. **Frontend Authentication:** The frontend authenticates directly with the provider (e.g., Firebase) and obtains a JWT ID token.
2. **API Requests:** The frontend attaches the token to API requests using the `Authorization: Bearer <token>` header.
3. **Stateless Verification:**
   - The `requireAuth` middleware decodes the token header/payload (without verifying) *only* to identify the `iss` (issuer).
   - Based on the issuer, it routes the token to the correct verifier (e.g., `FirebaseVerifier`).
   - The verifier fetches the provider's public certificates (cached securely via `jose`) and cryptographically verifies the token's signature, audience, expiration, and algorithm.
4. **Identity Injection:** The verified identity is mapped to a neutral `AuthUser` object and attached to `req.authUser`.
5. **Authorization:** Internal roles, permissions, or team memberships are **not** determined by the provider. They must be resolved separately within the API by querying the application database using `req.authUser.providerUserId`.

### Adding a new Provider (e.g., Supabase)

To add a new provider:
1. Create a new verifier in `src/auth/providers/` that implements the `TokenVerifier` interface.
2. Use `jose.createRemoteJWKSet` with the new provider's JWKS endpoint.
3. Update `src/auth/verify-token.ts` to map the provider's issuer URL to your new verifier.

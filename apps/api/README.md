# API Server

This is the Node.js Express API for Central Station.

## Authentication Architecture

The API uses a **stateless local JWT verification** system for local development. The setup flow writes a username, password hash, and JWT secret into `apps/api/.env`, and the API verifies bearer tokens against that local configuration.

### How it works:

1. **Frontend Authentication:** The frontend submits the setup-configured username and password to `POST /api/auth/login` and receives a JWT.
2. **API Requests:** The frontend attaches the token to API requests using the `Authorization: Bearer <token>` header.
3. **Stateless Verification:**
   - The `requireAuth` middleware decodes the token header/payload (without verifying) *only* to identify the `iss` (issuer).
   - Local tokens are verified with the shared JWT secret configured by setup.
   - The verifier checks the signature, audience, issuer, and expiration using `jose`.
4. **Identity Injection:** The verified identity is mapped to a neutral `AuthUser` object and attached to `req.authUser`.
5. **Authorization:** Internal roles, permissions, or team memberships are **not** determined by the provider. They must be resolved separately within the API by querying the application database using `req.authUser.providerUserId`.

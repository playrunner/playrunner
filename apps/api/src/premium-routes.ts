import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import type { Express } from 'express';

export async function loadPremiumApiRoutes(app: Express): Promise<void> {
  const premiumRoutesEntry = resolvePremiumRoutesEntry();
  if (!premiumRoutesEntry) {
    return;
  }

  const premiumModule = await import(pathToFileURL(premiumRoutesEntry).href);
  if (typeof premiumModule.registerPremiumApiRoutes !== 'function') {
    return;
  }

  await premiumModule.registerPremiumApiRoutes(app);
}

function resolvePremiumRoutesEntry(): string | null {
  const configuredPath = process.env.PREMIUM_API_ROUTES_PATH;
  const candidates = [
    configuredPath,
    path.resolve(__dirname, '../../../premium/api/src/register-routes.ts'),
    path.resolve(__dirname, '../../../../premium/api/src/register-routes.ts'),
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const configPath = path.resolve(__dirname, '..', '..', 'config', 'playwright-runner-versions.json');

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const versions = Array.isArray(config.versions) ? config.versions : [];
const latestVersions = versions.filter((version) => version.publishAsLatest);

if (!config.defaultTag) {
  throw new Error(`Missing defaultTag in ${configPath}`);
}

if (!versions.length) {
  throw new Error(`No Playwright runner versions defined in ${configPath}`);
}

if (!versions.some((version) => version.tag === config.defaultTag)) {
  throw new Error(`defaultTag ${config.defaultTag} is not present in versions in ${configPath}`);
}

if (latestVersions.length !== 1) {
  throw new Error(`Expected exactly one version with publishAsLatest=true in ${configPath}`);
}

const command = process.argv[2];

switch (command) {
  case 'default-tag':
    console.log(config.defaultTag);
    break;
  case 'latest-tag':
    console.log(latestVersions[0].tag);
    break;
  case 'tags':
    for (const version of versions) {
      console.log(version.tag);
    }
    break;
  case 'json':
    console.log(JSON.stringify(config));
    break;
  default:
    console.error('Usage: node infra/scripts/playwright-runner-config.mjs <default-tag|latest-tag|tags|json>');
    process.exit(1);
}

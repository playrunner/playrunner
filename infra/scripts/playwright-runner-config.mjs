import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const configPath = path.resolve(
  __dirname,
  "..",
  "..",
  "config",
  "playwright-runner-versions.json",
);

const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const versions = Array.isArray(config.versions) ? config.versions : [];
const latestVersions = versions.filter((version) => version.publishAsLatest);

for (const version of versions) {
  for (const field of ["label", "npmVersion", "pythonVersion", "tag"]) {
    if (typeof version[field] !== "string" || !version[field].trim()) {
      throw new Error(
        `Missing ${field} for a Playwright runner version in ${configPath}`,
      );
    }
  }
}

if (!config.defaultTag) {
  throw new Error(`Missing defaultTag in ${configPath}`);
}

if (!versions.length) {
  throw new Error(`No Playwright runner versions defined in ${configPath}`);
}

if (!versions.some((version) => version.tag === config.defaultTag)) {
  throw new Error(
    `defaultTag ${config.defaultTag} is not present in versions in ${configPath}`,
  );
}

if (latestVersions.length !== 1) {
  throw new Error(
    `Expected exactly one version with publishAsLatest=true in ${configPath}`,
  );
}

const command = process.argv[2];
const requestedTag = process.argv[3];

function printPackageVersion(field) {
  const version = versions.find((candidate) => candidate.tag === requestedTag);
  if (!version) {
    throw new Error(
      `Unknown Playwright runner tag: ${requestedTag || "(missing)"}`,
    );
  }
  console.log(version[field]);
}

switch (command) {
  case "default-tag":
    console.log(config.defaultTag);
    break;
  case "latest-tag":
    console.log(latestVersions[0].tag);
    break;
  case "tags":
    for (const version of versions) {
      console.log(version.tag);
    }
    break;
  case "json":
    console.log(JSON.stringify(config));
    break;
  case "npm-version":
    printPackageVersion("npmVersion");
    break;
  case "python-version":
    printPackageVersion("pythonVersion");
    break;
  default:
    console.error(
      "Usage: node infra/scripts/playwright-runner-config.mjs <default-tag|latest-tag|tags|json|npm-version TAG|python-version TAG>",
    );
    process.exit(1);
}

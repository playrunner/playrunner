import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..", "..");
const apiDir = path.join(repoRoot, "apps", "api");
const apiEnvPath = path.join(apiDir, ".env");
const terraformDir = path.join(repoRoot, "infra", "gcp");
const defaultTerraformTfvarsPath = path.join(terraformDir, "terraform.tfvars");
const DEFAULT_API_SERVICE_NAME = "playrunner-api";
const DEFAULT_ORCHESTRATOR_SERVICE_NAME = "playrunner-orchestrator";
const DEFAULT_ORCHESTRATOR_MIN_INSTANCE_COUNT = 1;
const DEFAULT_ORCHESTRATOR_MAX_INSTANCE_COUNT = 10;
const DEFAULT_ORCHESTRATOR_CPU_IDLE = false;
const DEFAULT_PLAYWRIGHT_RUNNER_REPOSITORY = "playwright-runner";
const DEFAULT_SCHEDULER_SERVICE_ACCOUNT_ID = "playrunner-scheduler";
const DEFAULT_WORKFLOW_EVENTS_TOPIC_NAME = "playrunner-workflow-events";

const args = process.argv.slice(2);
const command = args.shift();
const flags = parseFlags(args);

function parseFlags(rest) {
  const out = {};
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    if (!token.startsWith("--")) continue;
    const eq = token.indexOf("=");
    if (eq !== -1) {
      out[token.slice(2, eq)] = token.slice(eq + 1);
    } else {
      const next = rest[i + 1];
      if (next && !next.startsWith("--")) {
        out[token.slice(2)] = next;
        i++;
      } else {
        out[token.slice(2)] = "true";
      }
    }
  }
  return out;
}

function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf8");
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile(apiEnvPath);

if (!process.env.DATABASE_URL) {
  fail(
    `DATABASE_URL is not set. Expected it in environment or ${path.relative(repoRoot, apiEnvPath)}.`,
  );
}

const requireFromApi = createRequire(path.join(apiDir, "package.json"));
let PrismaClient;
let PrismaPg;
let unregisterTypeScript;
try {
  unregisterTypeScript = requireFromApi("tsx/cjs/api").register();
  ({ PrismaPg } = requireFromApi("@prisma/adapter-pg"));
  ({ PrismaClient } = requireFromApi("./src/generated/prisma/client.cts"));
} catch (error) {
  fail(
    `Failed to load the generated Prisma client from ${path.relative(repoRoot, apiDir)}. Run "npm install" and "npm run prisma:generate" in apps/api first. (${error.message})`,
  );
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

try {
  const credential = await loadCredential();
  emit(command, normalizeConfig(credential));
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
} finally {
  await prisma.$disconnect().catch(() => {});
  unregisterTypeScript?.();
}

async function loadCredential() {
  const where = { kind: "cloud", provider: "gcp" };
  if (flags["user-id"]) where.userId = flags["user-id"];

  const records = await prisma.connection.findMany({ where });
  if (records.length === 0) {
    throw new Error(
      "No GCP cloud credential found. Connect GCP in the Integrations modal first.",
    );
  }
  if (records.length > 1 && !flags["user-id"]) {
    const ids = records.map((r) => r.userId).join(", ");
    throw new Error(
      `Multiple GCP credentials found for users [${ids}]. Pass --user-id <id> to disambiguate.`,
    );
  }
  return records[0].config || {};
}

function emit(cmd, data) {
  switch (cmd) {
    case "project-id":
      printRequired(data.selectedProject, "selectedProject");
      break;
    case "region":
      printRequired(data.cloudRunLocation, "cloudRunLocation");
      break;
    case "orchestrator-service-name":
      printRequired(data.orchestratorServiceName, "orchestratorServiceName");
      break;
    case "orchestrator-min-instance-count":
      printNonNegativeInteger(
        data.orchestratorMinInstanceCount,
        "orchestratorMinInstanceCount",
      );
      break;
    case "orchestrator-max-instance-count":
      printPositiveInteger(
        data.orchestratorMaxInstanceCount,
        "orchestratorMaxInstanceCount",
      );
      break;
    case "orchestrator-cpu-idle":
      printBoolean(data.orchestratorCpuIdle, "orchestratorCpuIdle");
      break;
    case "orchestrator-image-uri-template":
      printRequired(
        data.orchestratorImageUriTemplate,
        "orchestratorImageUriTemplate",
      );
      break;
    case "playwright-image-uri-template":
      printRequired(
        data.playwrightImageUriTemplate,
        "playwrightImageUriTemplate",
      );
      break;
    case "scheduler-service-account-email":
      printRequired(
        data.schedulerServiceAccountEmail,
        "schedulerServiceAccountEmail",
      );
      break;
    case "terraform-tfvars":
      process.stdout.write(renderTerraformTfvars(data));
      break;
    case "write-terraform-tfvars":
      writeTerraformTfvars(data);
      break;
    case "json":
      process.stdout.write(JSON.stringify(publicConfig(data)));
      break;
    default:
      fail(
        "Usage: node infra/gcp/scripts/gcp-settings.mjs <project-id|region|orchestrator-service-name|orchestrator-min-instance-count|orchestrator-max-instance-count|orchestrator-cpu-idle|orchestrator-image-uri-template|playwright-image-uri-template|scheduler-service-account-email|terraform-tfvars|write-terraform-tfvars|json> [--user-id <id>] [--out <path>] [--force]",
      );
  }
}

function normalizeConfig(data) {
  const selectedProject = normalizeString(data.selectedProject);
  const cloudRunLocation = normalizeString(data.cloudRunLocation);
  const orchestratorServiceName =
    normalizeString(data.orchestratorServiceName) ||
    DEFAULT_ORCHESTRATOR_SERVICE_NAME;

  return {
    selectedProject,
    cloudRunLocation,
    orchestratorServiceName,
    orchestratorMinInstanceCount: normalizeNonNegativeIntegerValue(
      data.orchestratorMinInstanceCount,
      DEFAULT_ORCHESTRATOR_MIN_INSTANCE_COUNT,
    ),
    orchestratorMaxInstanceCount: normalizePositiveIntegerValue(
      data.orchestratorMaxInstanceCount,
      DEFAULT_ORCHESTRATOR_MAX_INSTANCE_COUNT,
    ),
    orchestratorCpuIdle: normalizeBooleanValue(
      data.orchestratorCpuIdle,
      DEFAULT_ORCHESTRATOR_CPU_IDLE,
    ),
    orchestratorImageUriTemplate:
      normalizeString(data.orchestratorImageUriTemplate) ||
      buildOrchestratorTemplate(cloudRunLocation, orchestratorServiceName),
    playwrightImageUriTemplate:
      normalizeString(data.playwrightImageUriTemplate) ||
      buildPlaywrightTemplate(cloudRunLocation),
    schedulerServiceAccountEmail:
      normalizeString(data.schedulerServiceAccountEmail) ||
      buildSchedulerServiceAccountEmail(selectedProject),
  };
}

function publicConfig(data) {
  return {
    selectedProject: data.selectedProject || null,
    cloudRunLocation: data.cloudRunLocation || null,
    orchestratorServiceName: data.orchestratorServiceName || null,
    orchestratorMinInstanceCount: data.orchestratorMinInstanceCount ?? null,
    orchestratorMaxInstanceCount: data.orchestratorMaxInstanceCount ?? null,
    orchestratorCpuIdle: data.orchestratorCpuIdle ?? null,
    orchestratorImageUriTemplate: data.orchestratorImageUriTemplate || null,
    playwrightImageUriTemplate: data.playwrightImageUriTemplate || null,
    schedulerServiceAccountEmail: data.schedulerServiceAccountEmail || null,
  };
}

function renderTerraformTfvars(data) {
  const projectId = requireValue(data.selectedProject, "selectedProject");
  const region = requireValue(data.cloudRunLocation, "cloudRunLocation");

  return [
    "# Generated from the GCP settings saved by Playrunner.",
    "# Re-run `./infra/gcp/scripts/setup-terraform.sh` after changing the selected project or region.",
    `project_id = ${hclString(projectId)}`,
    `region     = ${hclString(region)}`,
    "",
    "# Terraform combines this service account ID with project_id to create:",
    `# ${buildSchedulerServiceAccountEmail(projectId)}`,
    `scheduler_service_account_id = ${hclString(DEFAULT_SCHEDULER_SERVICE_ACCOUNT_ID)}`,
    "",
    "# Defaults used by Playrunner runtime and setup scripts.",
    `api_service_name           = ${hclString(DEFAULT_API_SERVICE_NAME)}`,
    `workflow_events_topic_name = ${hclString(DEFAULT_WORKFLOW_EVENTS_TOPIC_NAME)}`,
    "",
  ].join("\n");
}

function writeTerraformTfvars(data) {
  const outPath = flags.out
    ? path.resolve(repoRoot, flags.out)
    : defaultTerraformTfvarsPath;

  if (fs.existsSync(outPath) && flags.force !== "true") {
    throw new Error(
      `${path.relative(repoRoot, outPath)} already exists. Pass --force to overwrite it.`,
    );
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, renderTerraformTfvars(data), "utf8");
  process.stdout.write(`Wrote ${path.relative(repoRoot, outPath)}\n`);
}

function buildOrchestratorTemplate(region, serviceName) {
  if (!region) return "";
  return `${region}-docker.pkg.dev/{projectId}/orchestrator/${serviceName || DEFAULT_ORCHESTRATOR_SERVICE_NAME}:latest`;
}

function buildPlaywrightTemplate(region) {
  if (!region) return "";
  return `${region}-docker.pkg.dev/{projectId}/${DEFAULT_PLAYWRIGHT_RUNNER_REPOSITORY}/playrunner-playwright-runner-{runtime}:{version}`;
}

function buildSchedulerServiceAccountEmail(projectId) {
  if (!projectId) return "";
  return `${DEFAULT_SCHEDULER_SERVICE_ACCOUNT_ID}@${projectId}.iam.gserviceaccount.com`;
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function requireValue(value, label) {
  const trimmed = normalizeString(value);
  if (!trimmed) {
    throw new Error(
      `GCP setting "${label}" is empty. Save it in the Integrations modal first.`,
    );
  }
  return trimmed;
}

function hclString(value) {
  return JSON.stringify(value);
}

function normalizePositiveIntegerValue(value, fallback) {
  const numberValue =
    typeof value === "string" && value.trim()
      ? Number(value)
      : typeof value === "number"
        ? value
        : NaN;
  return Number.isInteger(numberValue) && numberValue > 0
    ? numberValue
    : fallback;
}

function normalizeNonNegativeIntegerValue(value, fallback) {
  const numberValue =
    typeof value === "string" && value.trim()
      ? Number(value)
      : typeof value === "number"
        ? value
        : NaN;
  return Number.isInteger(numberValue) && numberValue >= 0
    ? numberValue
    : fallback;
}

function normalizeBooleanValue(value, fallback) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return fallback;
}

function printRequired(value, label) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) {
    throw new Error(
      `GCP setting "${label}" is empty. Save it in the Integrations modal first.`,
    );
  }
  process.stdout.write(trimmed);
}

function printPositiveInteger(value, label) {
  const numberValue =
    typeof value === "string" && value.trim()
      ? Number(value)
      : typeof value === "number"
        ? value
        : NaN;
  if (!Number.isInteger(numberValue) || numberValue <= 0) {
    throw new Error(
      `GCP setting "${label}" must be a positive integer. Save it in the Integrations modal first.`,
    );
  }
  process.stdout.write(String(numberValue));
}

function printNonNegativeInteger(value, label) {
  const numberValue =
    typeof value === "string" && value.trim()
      ? Number(value)
      : typeof value === "number"
        ? value
        : NaN;
  if (!Number.isInteger(numberValue) || numberValue < 0) {
    throw new Error(
      `GCP setting "${label}" must be a non-negative integer. Save it in the Integrations modal first.`,
    );
  }
  process.stdout.write(String(numberValue));
}

function printBoolean(value, label) {
  if (typeof value === "boolean") {
    process.stdout.write(String(value));
    return;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "false") {
      process.stdout.write(normalized);
      return;
    }
  }
  throw new Error(
    `GCP setting "${label}" must be true or false. Save it in the Integrations modal first.`,
  );
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

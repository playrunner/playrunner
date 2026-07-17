import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SURFACES = new Set(["frontend", "api", "orchestrator"]);
const INTEGRATION_ID_PATTERN = /^[a-z][a-z0-9._-]{0,127}$/;

export class IntegrationCompositionError extends Error {
  constructor(message) {
    super(message);
    this.name = "IntegrationCompositionError";
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function assertPackageName(packageName, appManifestPath) {
  const parts = packageName.split("/");
  const validParts = packageName.startsWith("@")
    ? parts.length === 2 && parts[0].length > 1
    : parts.length === 1;

  if (
    !validParts ||
    parts.some(
      (part) =>
        !part ||
        part === "." ||
        part === ".." ||
        part.includes("\\") ||
        /\s/.test(part),
    )
  ) {
    throw new IntegrationCompositionError(
      `Invalid dependency package name ${JSON.stringify(packageName)} in ${appManifestPath}.`,
    );
  }
}

async function readJson(filePath, description) {
  let source;
  try {
    source = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") {
      throw new IntegrationCompositionError(
        `${description} was not found at ${filePath}.`,
      );
    }
    throw error;
  }

  try {
    return JSON.parse(source.replace(/^\uFEFF/, ""));
  } catch (error) {
    throw new IntegrationCompositionError(
      `${description} at ${filePath} is not valid JSON: ${error.message}`,
    );
  }
}

async function findInstalledPackageManifest(appDirectory, packageName) {
  const packagePathParts = packageName.split("/");
  let directory = appDirectory;

  while (true) {
    const candidate = path.join(
      directory,
      "node_modules",
      ...packagePathParts,
      "package.json",
    );

    try {
      await fs.access(candidate);
      return candidate;
    } catch (error) {
      if (!error || error.code !== "ENOENT") {
        throw error;
      }
    }

    const parent = path.dirname(directory);
    if (parent === directory) {
      return undefined;
    }
    directory = parent;
  }
}

function assertIntegrationId(value, packageName) {
  if (typeof value !== "string" || !INTEGRATION_ID_PATTERN.test(value)) {
    throw new IntegrationCompositionError(
      `Installed package ${JSON.stringify(packageName)} has invalid playrunner.integration.id. Expected a lowercase identifier beginning with a letter and containing only letters, numbers, dots, underscores, or hyphens.`,
    );
  }
}

function assertSurfaceEntrypoint(value, packageName, surface) {
  if (typeof value !== "string") {
    throw new IntegrationCompositionError(
      `Installed package ${JSON.stringify(packageName)} has invalid playrunner.integration.${surface}. Expected "." or an exported subpath beginning with "./".`,
    );
  }

  if (value === ".") {
    return;
  }

  if (
    !value.startsWith("./") ||
    value.length === 2 ||
    value.includes("\\") ||
    value.includes("*") ||
    value
      .slice(2)
      .split("/")
      .some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new IntegrationCompositionError(
      `Installed package ${JSON.stringify(packageName)} has invalid playrunner.integration.${surface} entrypoint ${JSON.stringify(value)}. Expected "." or an exact exported subpath beginning with "./".`,
    );
  }
}

function selectedExport(exportsField, entrypoint) {
  if (entrypoint === ".") {
    if (typeof exportsField === "string" || Array.isArray(exportsField)) {
      return exportsField;
    }

    if (!isRecord(exportsField)) {
      return undefined;
    }

    const keys = Object.keys(exportsField);
    const isSubpathMap = keys.some((key) => key.startsWith("."));
    return isSubpathMap ? exportsField["."] : exportsField;
  }

  if (!isRecord(exportsField) || !hasOwn(exportsField, entrypoint)) {
    return undefined;
  }

  return exportsField[entrypoint];
}

function hasRuntimeExportTarget(value, underTypesCondition = false) {
  if (typeof value === "string") {
    return !underTypesCondition && value.startsWith("./");
  }

  if (Array.isArray(value)) {
    return value.some((candidate) =>
      hasRuntimeExportTarget(candidate, underTypesCondition),
    );
  }

  if (!isRecord(value)) {
    return false;
  }

  return Object.entries(value).some(([condition, target]) =>
    hasRuntimeExportTarget(
      target,
      underTypesCondition || condition === "types",
    ),
  );
}

function assertPackageExport(manifest, packageName, entrypoint) {
  const definition = selectedExport(manifest.exports, entrypoint);
  if (definition === undefined) {
    throw new IntegrationCompositionError(
      `Installed integration package ${JSON.stringify(packageName)} declares entrypoint ${JSON.stringify(entrypoint)} but does not export it from package.json.`,
    );
  }

  if (!hasRuntimeExportTarget(definition)) {
    throw new IntegrationCompositionError(
      `Installed integration package ${JSON.stringify(packageName)} export ${JSON.stringify(entrypoint)} does not define a runtime target.`,
    );
  }
}

function readIntegrationMetadata(manifest, packageName, surface) {
  if (!hasOwn(manifest, "playrunner")) {
    return undefined;
  }

  if (!isRecord(manifest.playrunner)) {
    throw new IntegrationCompositionError(
      `Installed package ${JSON.stringify(packageName)} has invalid playrunner metadata. Expected an object.`,
    );
  }

  if (!hasOwn(manifest.playrunner, "integration")) {
    return undefined;
  }

  const integration = manifest.playrunner.integration;
  if (!isRecord(integration)) {
    throw new IntegrationCompositionError(
      `Installed package ${JSON.stringify(packageName)} has invalid playrunner.integration metadata. Expected an object.`,
    );
  }

  assertIntegrationId(integration.id, packageName);

  if (!hasOwn(integration, surface)) {
    return undefined;
  }

  const entrypoint = integration[surface];
  assertSurfaceEntrypoint(entrypoint, packageName, surface);
  assertPackageExport(manifest, packageName, entrypoint);

  return {
    integrationId: integration.id,
    entrypoint,
  };
}

function importSpecifier(packageName, entrypoint) {
  return entrypoint === "."
    ? packageName
    : `${packageName}${entrypoint.slice(1)}`;
}

function renderComposition(entries, surface) {
  const imports = entries.map(
    (entry, index) =>
      `import integrationContribution${index} from ${JSON.stringify(importSpecifier(entry.packageName, entry.entrypoint))};`,
  );
  const renderedEntries = entries.map(
    (entry, index) => `  {
    packageName: ${JSON.stringify(entry.packageName)},
    integrationId: ${JSON.stringify(entry.integrationId)},
    contribution: integrationContribution${index},
  },`,
  );

  return [
    "// This file is generated by infra/scripts/generate-integration-composition.mjs.",
    `// It contains the build-time ${surface} integration composition. Do not edit it by hand.`,
    "",
    ...imports,
    ...(imports.length ? [""] : []),
    "export const discoveredIntegrationContributions = [",
    ...renderedEntries,
    "] as const;",
    "",
  ].join("\n");
}

async function writeFileAtomically(outputPath, contents) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const temporaryPath = path.join(
    path.dirname(outputPath),
    `.${path.basename(outputPath)}.${process.pid}.${Date.now()}.tmp`,
  );

  try {
    await fs.writeFile(temporaryPath, contents, "utf8");
    await fs.rename(temporaryPath, outputPath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true });
    throw error;
  }
}

export async function generateIntegrationComposition({
  appDirectory,
  surface,
  outputPath,
}) {
  if (!SURFACES.has(surface)) {
    throw new IntegrationCompositionError(
      `Invalid integration surface ${JSON.stringify(surface)}. Expected frontend, api, or orchestrator.`,
    );
  }

  const resolvedAppDirectory = path.resolve(appDirectory);
  const resolvedOutputPath = path.resolve(outputPath);
  const appManifestPath = path.join(resolvedAppDirectory, "package.json");
  const appManifest = await readJson(
    appManifestPath,
    "Application package.json",
  );

  if (!isRecord(appManifest)) {
    throw new IntegrationCompositionError(
      `Application package.json at ${appManifestPath} must contain an object.`,
    );
  }

  const dependencies = isRecord(appManifest.dependencies)
    ? appManifest.dependencies
    : {};
  const optionalDependencies = isRecord(appManifest.optionalDependencies)
    ? appManifest.optionalDependencies
    : {};
  const packageNames = [
    ...new Set([
      ...Object.keys(dependencies),
      ...Object.keys(optionalDependencies),
    ]),
  ].sort();
  const entries = [];

  for (const packageName of packageNames) {
    assertPackageName(packageName, appManifestPath);
    const manifestPath = await findInstalledPackageManifest(
      resolvedAppDirectory,
      packageName,
    );

    if (!manifestPath) {
      if (hasOwn(optionalDependencies, packageName)) {
        continue;
      }
      throw new IntegrationCompositionError(
        `Required direct dependency ${JSON.stringify(packageName)} is not installed for ${resolvedAppDirectory}. Run the application's package installation before generating integration composition.`,
      );
    }

    const manifest = await readJson(
      manifestPath,
      `Installed package ${JSON.stringify(packageName)} package.json`,
    );
    if (!isRecord(manifest)) {
      throw new IntegrationCompositionError(
        `Installed package manifest at ${manifestPath} must contain an object.`,
      );
    }
    if (manifest.name !== packageName) {
      throw new IntegrationCompositionError(
        `Direct dependency ${JSON.stringify(packageName)} resolved to a package named ${JSON.stringify(manifest.name)} at ${manifestPath}.`,
      );
    }

    const metadata = readIntegrationMetadata(manifest, packageName, surface);
    if (!metadata) {
      continue;
    }

    entries.push({
      packageName,
      integrationId: metadata.integrationId,
      entrypoint: metadata.entrypoint,
    });
  }

  entries.sort((left, right) => {
    if (left.packageName < right.packageName) return -1;
    if (left.packageName > right.packageName) return 1;
    return 0;
  });

  const integrationIds = new Map();
  for (const entry of entries) {
    const existingPackage = integrationIds.get(entry.integrationId);
    if (existingPackage) {
      throw new IntegrationCompositionError(
        `Duplicate integration id ${JSON.stringify(entry.integrationId)} for ${surface} contributions from ${JSON.stringify(existingPackage)} and ${JSON.stringify(entry.packageName)}.`,
      );
    }
    integrationIds.set(entry.integrationId, entry.packageName);
  }

  const source = renderComposition(entries, surface);
  await writeFileAtomically(resolvedOutputPath, source);

  return {
    appDirectory: resolvedAppDirectory,
    outputPath: resolvedOutputPath,
    surface,
    entries,
  };
}

async function runCli() {
  const [appDirectory, surface, outputPath, ...extraArguments] =
    process.argv.slice(2);
  if (!appDirectory || !surface || !outputPath || extraArguments.length) {
    throw new IntegrationCompositionError(
      "Usage: node infra/scripts/generate-integration-composition.mjs <app-directory> <frontend|api|orchestrator> <output-path>",
    );
  }

  const result = await generateIntegrationComposition({
    appDirectory,
    surface,
    outputPath,
  });
  console.log(
    `Generated ${result.surface} integration composition with ${result.entries.length} contribution(s) at ${result.outputPath}.`,
  );
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

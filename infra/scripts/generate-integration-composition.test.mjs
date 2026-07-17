import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, test } from "node:test";
import {
  generateIntegrationComposition,
  IntegrationCompositionError,
} from "./generate-integration-composition.mjs";

const fixtureDirectories = [];

afterEach(async () => {
  await Promise.all(
    fixtureDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

async function createFixture(appManifest) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "playrunner-integration-composition-"),
  );
  fixtureDirectories.push(directory);
  const appDirectory = path.join(directory, "app");
  await fs.mkdir(appDirectory, { recursive: true });
  await writeJson(path.join(appDirectory, "package.json"), appManifest);
  return {
    appDirectory,
    directory,
    outputPath: path.join(appDirectory, ".generated", "composition.ts"),
  };
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function installPackage(
  appDirectory,
  packageName,
  {
    integration,
    exports = {
      ".": "./src/frontend.js",
      "./api": "./src/api.js",
      "./orchestrator": "./src/orchestrator.js",
    },
    name = packageName,
    playrunner,
  } = {},
) {
  const manifest = {
    name,
    version: "1.0.0",
    exports,
  };

  if (playrunner !== undefined) {
    manifest.playrunner = playrunner;
  } else if (integration !== undefined) {
    manifest.playrunner = { integration };
  }

  await writeJson(
    path.join(
      appDirectory,
      "node_modules",
      ...packageName.split("/"),
      "package.json",
    ),
    manifest,
  );
}

describe("generateIntegrationComposition", () => {
  test("emits sorted literal imports for marked direct production dependencies only", async () => {
    const fixture = await createFixture({
      name: "fixture-app",
      dependencies: {
        "@vendor/zeta": "1.0.0",
        "@vendor/unmarked": "1.0.0",
        "@vendor/alpha": "1.0.0",
      },
      optionalDependencies: {
        "@vendor/optional": "1.0.0",
        "@vendor/missing-optional": "1.0.0",
      },
      devDependencies: {
        "@vendor/dev-only": "1.0.0",
      },
    });

    await installPackage(fixture.appDirectory, "@vendor/zeta", {
      integration: { id: "zeta", orchestrator: "./orchestrator" },
    });
    await installPackage(fixture.appDirectory, "@vendor/alpha", {
      integration: { id: "alpha", orchestrator: "." },
    });
    await installPackage(fixture.appDirectory, "@vendor/optional", {
      integration: { id: "optional", orchestrator: "./orchestrator" },
    });
    await installPackage(fixture.appDirectory, "@vendor/unmarked");
    await installPackage(fixture.appDirectory, "@vendor/dev-only", {
      integration: { id: "dev-only", orchestrator: "./orchestrator" },
    });
    await installPackage(fixture.appDirectory, "@vendor/transitive", {
      integration: { id: "transitive", orchestrator: "./orchestrator" },
    });

    const result = await generateIntegrationComposition({
      appDirectory: fixture.appDirectory,
      surface: "orchestrator",
      outputPath: fixture.outputPath,
    });
    const output = await fs.readFile(fixture.outputPath, "utf8");

    assert.deepEqual(
      result.entries.map(({ packageName, integrationId, entrypoint }) => ({
        packageName,
        integrationId,
        entrypoint,
      })),
      [
        {
          packageName: "@vendor/alpha",
          integrationId: "alpha",
          entrypoint: ".",
        },
        {
          packageName: "@vendor/optional",
          integrationId: "optional",
          entrypoint: "./orchestrator",
        },
        {
          packageName: "@vendor/zeta",
          integrationId: "zeta",
          entrypoint: "./orchestrator",
        },
      ],
    );
    assert.match(output, /^\/\/ This file is generated/m);
    assert.ok(
      output.indexOf('from "@vendor/alpha"') <
        output.indexOf('from "@vendor/optional/orchestrator"'),
    );
    assert.ok(
      output.indexOf('from "@vendor/optional/orchestrator"') <
        output.indexOf('from "@vendor/zeta/orchestrator"'),
    );
    assert.match(output, /export const discoveredIntegrationContributions/);
    assert.doesNotMatch(output, /dev-only|transitive|unmarked/);
  });

  test("uses the requested package-owned surface and ignores marked packages without it", async () => {
    const fixture = await createFixture({
      dependencies: {
        "@vendor/api": "1.0.0",
        "@vendor/frontend-only": "1.0.0",
      },
    });
    await installPackage(fixture.appDirectory, "@vendor/api", {
      integration: { id: "api", api: "./api", frontend: "." },
    });
    await installPackage(fixture.appDirectory, "@vendor/frontend-only", {
      integration: { id: "frontend-only", frontend: "." },
    });

    await generateIntegrationComposition({
      appDirectory: fixture.appDirectory,
      surface: "api",
      outputPath: fixture.outputPath,
    });
    const output = await fs.readFile(fixture.outputPath, "utf8");

    assert.match(output, /from "@vendor\/api\/api"/);
    assert.doesNotMatch(output, /frontend-only/);
  });

  test("composes every surface from one self-contained package", async () => {
    const fixture = await createFixture({
      dependencies: { "@playrunner/xyz": "1.0.0" },
    });
    await installPackage(fixture.appDirectory, "@playrunner/xyz", {
      integration: {
        id: "xyz",
        frontend: ".",
        api: "./api",
        orchestrator: "./orchestrator",
      },
    });

    const expectedSpecifiers = {
      frontend: "@playrunner/xyz",
      api: "@playrunner/xyz/api",
      orchestrator: "@playrunner/xyz/orchestrator",
    };

    for (const [surface, expectedSpecifier] of Object.entries(
      expectedSpecifiers,
    )) {
      await generateIntegrationComposition({
        appDirectory: fixture.appDirectory,
        surface,
        outputPath: fixture.outputPath,
      });
      const output = await fs.readFile(fixture.outputPath, "utf8");

      assert.match(
        output,
        new RegExp(`from ${JSON.stringify(expectedSpecifier)}`),
      );
      assert.match(output, /integrationId: "xyz"/);
    }
  });

  test("finds direct dependencies installed in a hoisted ancestor node_modules", async () => {
    const fixture = await createFixture({
      dependencies: { "@vendor/hoisted": "1.0.0" },
    });
    await installPackage(fixture.directory, "@vendor/hoisted", {
      integration: { id: "hoisted", orchestrator: "./orchestrator" },
    });

    const result = await generateIntegrationComposition({
      appDirectory: fixture.appDirectory,
      surface: "orchestrator",
      outputPath: fixture.outputPath,
    });

    assert.deepEqual(
      result.entries.map((entry) => entry.packageName),
      ["@vendor/hoisted"],
    );
  });

  test("rejects a missing required dependency while allowing an absent optional dependency", async () => {
    const fixture = await createFixture({
      dependencies: { "@vendor/required": "1.0.0" },
      optionalDependencies: { "@vendor/optional": "1.0.0" },
    });

    await assert.rejects(
      generateIntegrationComposition({
        appDirectory: fixture.appDirectory,
        surface: "orchestrator",
        outputPath: fixture.outputPath,
      }),
      /Required direct dependency "@vendor\/required" is not installed/,
    );
  });

  test("rejects duplicate integration ids before writing output", async () => {
    const fixture = await createFixture({
      dependencies: {
        "@vendor/one": "1.0.0",
        "@vendor/two": "1.0.0",
      },
    });
    await installPackage(fixture.appDirectory, "@vendor/one", {
      integration: { id: "duplicate", orchestrator: "./orchestrator" },
    });
    await installPackage(fixture.appDirectory, "@vendor/two", {
      integration: { id: "duplicate", orchestrator: "./orchestrator" },
    });

    await assert.rejects(
      generateIntegrationComposition({
        appDirectory: fixture.appDirectory,
        surface: "orchestrator",
        outputPath: fixture.outputPath,
      }),
      /Duplicate integration id "duplicate".*"@vendor\/one".*"@vendor\/two"/,
    );
    await assert.rejects(fs.access(fixture.outputPath), /ENOENT/);
  });

  test("rejects malformed package-owned metadata", async () => {
    const cases = [
      {
        integration: { id: "", orchestrator: "./orchestrator" },
        expected: /invalid playrunner\.integration\.id/,
      },
      {
        integration: { id: "UPPERCASE", orchestrator: "./orchestrator" },
        expected: /invalid playrunner\.integration\.id/,
      },
      {
        integration: { id: "valid", orchestrator: "../orchestrator" },
        expected: /invalid playrunner\.integration\.orchestrator entrypoint/,
      },
      {
        integration: { id: "valid", orchestrator: "./wildcard/*" },
        expected: /invalid playrunner\.integration\.orchestrator entrypoint/,
      },
      {
        playrunner: { integration: [] },
        expected: /invalid playrunner\.integration metadata/,
      },
    ];

    for (const [index, testCase] of cases.entries()) {
      const fixture = await createFixture({
        dependencies: { [`@vendor/case-${index}`]: "1.0.0" },
      });
      await installPackage(fixture.appDirectory, `@vendor/case-${index}`, {
        integration: testCase.integration,
        playrunner: testCase.playrunner,
      });

      await assert.rejects(
        generateIntegrationComposition({
          appDirectory: fixture.appDirectory,
          surface: "orchestrator",
          outputPath: fixture.outputPath,
        }),
        testCase.expected,
      );
    }
  });

  test("rejects missing, mismatched, and types-only package exports", async () => {
    const cases = [
      {
        exports: { ".": "./src/index.js" },
        expected: /does not export it from package\.json/,
      },
      {
        exports: { "./orchestrator": { types: "./src/index.d.ts" } },
        expected: /does not define a runtime target/,
      },
    ];

    for (const [index, testCase] of cases.entries()) {
      const fixture = await createFixture({
        dependencies: { [`@vendor/export-${index}`]: "1.0.0" },
      });
      await installPackage(fixture.appDirectory, `@vendor/export-${index}`, {
        integration: {
          id: `export-${index}`,
          orchestrator: "./orchestrator",
        },
        exports: testCase.exports,
      });

      await assert.rejects(
        generateIntegrationComposition({
          appDirectory: fixture.appDirectory,
          surface: "orchestrator",
          outputPath: fixture.outputPath,
        }),
        testCase.expected,
      );
    }
  });

  test("rejects an installed package whose manifest name does not match the direct dependency", async () => {
    const fixture = await createFixture({
      dependencies: { "@vendor/expected": "1.0.0" },
    });
    await installPackage(fixture.appDirectory, "@vendor/expected", {
      name: "@vendor/different",
      integration: { id: "different", orchestrator: "./orchestrator" },
    });

    await assert.rejects(
      generateIntegrationComposition({
        appDirectory: fixture.appDirectory,
        surface: "orchestrator",
        outputPath: fixture.outputPath,
      }),
      /resolved to a package named "@vendor\/different"/,
    );
  });

  test("rejects an unsupported surface", async () => {
    const fixture = await createFixture({});

    await assert.rejects(
      generateIntegrationComposition({
        appDirectory: fixture.appDirectory,
        surface: "runtime",
        outputPath: fixture.outputPath,
      }),
      (error) =>
        error instanceof IntegrationCompositionError &&
        /Expected frontend, api, or orchestrator/.test(error.message),
    );
  });
});

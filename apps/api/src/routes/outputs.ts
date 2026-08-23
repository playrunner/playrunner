import { Router } from 'express';
import express from 'express';
import path from 'path';
import fs from 'fs';
import {
  EXECUTION_TOKEN_HEADER,
  executionEvents,
} from '../services/execution-events';
import { state } from '../state';
import { apiRuntime } from '../runtime';
import { loadWorkflowHistory } from '../services/workflow-history';
import {
  encodeRelativeOutputPath,
  findSafeOutputMedia,
  isSafeOutputPathSegment,
} from './output-paths';
import {
  extractOutputArchiveAtomically,
  OutputArchiveValidationError,
} from './output-archive';
import { writeOutputArtifactManifest } from './output-artifacts';

export const outputsRouter = Router();

function getStringHeader(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

outputsRouter.get('/:testId/diagnostics/history', async (req, res) => {
  const { testId } = req.params;
  const executionToken = getStringHeader(req.headers[EXECUTION_TOKEN_HEADER]);
  if (!executionToken) {
    return res
      .status(401)
      .json({ error: `Missing ${EXECUTION_TOKEN_HEADER} header.` });
  }

  const execution = await executionEvents.verifyExecutionToken(
    testId,
    executionToken,
  );
  if (!execution) {
    return res.status(403).json({ error: 'Invalid execution token.' });
  }
  if (!execution.workflowId) {
    return res.status(200).json({ runs: [] });
  }

  const history = await loadWorkflowHistory({
    currentExecutionId: execution.id,
    userId: execution.userId,
    workflowId: execution.workflowId,
  });
  return res.status(200).json(history);
});

outputsRouter.get(
  '/:testId/:nodeId/blob-report/:fileName',
  async (req, res) => {
    const { fileName, nodeId, testId } = req.params;
    const executionToken = getStringHeader(req.headers[EXECUTION_TOKEN_HEADER]);
    if (!executionToken) {
      return res
        .status(401)
        .json({ error: `Missing ${EXECUTION_TOKEN_HEADER} header.` });
    }
    const execution = await executionEvents.verifyExecutionToken(
      testId,
      executionToken,
    );
    if (!execution) {
      return res.status(403).json({ error: 'Invalid execution token.' });
    }
    if (
      !isSafeOutputPathSegment(testId) ||
      !isSafeOutputPathSegment(nodeId) ||
      !isSafeOutputPathSegment(fileName) ||
      !fileName.endsWith('.zip')
    ) {
      return res.status(400).json({ error: 'Invalid blob report file name.' });
    }
    const filePath = path.join(
      __dirname,
      '../../public/outputs',
      testId,
      nodeId,
      'blob-report',
      fileName,
    );
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Blob report not found.' });
    }
    return res.sendFile(filePath);
  },
);

// Endpoint to receive outputs from runner
outputsRouter.post(
  '/:testId/:nodeId',
  express.raw({ type: '*/*', limit: '100mb' }),
  async (req, res) => {
    const { nodeId, testId } = req.params;
    const bucketName = (req.query as any)?.bucketName as string | undefined;
    const executionToken = getStringHeader(req.headers[EXECUTION_TOKEN_HEADER]);

    if (!isSafeOutputPathSegment(testId) || !isSafeOutputPathSegment(nodeId)) {
      return res.status(400).json({ error: 'Invalid output path.' });
    }

    if (!executionToken) {
      return res
        .status(401)
        .json({ error: `Missing ${EXECUTION_TOKEN_HEADER} header.` });
    }

    const execution = await executionEvents.verifyExecutionToken(
      testId,
      executionToken,
    );
    if (!execution) {
      return res.status(403).json({ error: 'Invalid execution token.' });
    }

    console.log(
      `Received outputs for node ${nodeId}, test ${testId}, size: ${req.body?.length || 0} bytes`,
    );

    const outputRoot = path.join(__dirname, '../../public/outputs');
    let outputsDir: string;
    try {
      outputsDir = extractOutputArchiveAtomically(
        req.body,
        outputRoot,
        testId,
        nodeId,
      );
      console.log(`Extracted outputs for node ${nodeId}, test ${testId}`);
    } catch (err) {
      console.error('Failed to extract outputs:', err);
      return res
        .status(err instanceof OutputArchiveValidationError ? 400 : 500)
        .json({
          error:
            err instanceof OutputArchiveValidationError
              ? err.message
              : 'Failed to extract outputs',
        });
    }

    const outputData: any = {};
    try {
      const artifactManifest = writeOutputArtifactManifest({
        nodeId,
        outputsDir,
        testId,
      });
      outputData.artifactManifestUrl =
        artifactManifest.artifacts.artifactManifest;
      outputData.artifacts = artifactManifest.artifacts;
    } catch (err) {
      console.error(
        `Failed to index output artifacts for ${testId}/${nodeId}:`,
        err,
      );
      return res
        .status(500)
        .json({ error: 'Failed to index output artifacts.' });
    }
    if (
      fs.existsSync(path.join(outputsDir, 'playwright-report', 'index.html'))
    ) {
      outputData.reportUrl = `/outputs/${testId}/${nodeId}/playwright-report/index.html`;
    }
    const reportDataPath = path.join(
      outputsDir,
      'playwright-report',
      'report.json',
    );
    const reportSummaryPath = path.join(
      outputsDir,
      'playwright-report',
      'report-summary.json',
    );
    if (fs.existsSync(reportDataPath)) {
      outputData.reportDataUrl = `/outputs/${testId}/${nodeId}/playwright-report/report.json`;
    }
    if (fs.existsSync(reportSummaryPath)) {
      try {
        outputData.report = JSON.parse(
          fs.readFileSync(reportSummaryPath, 'utf8'),
        );
      } catch (err) {
        console.error(
          `Failed to parse report summary for ${testId}/${nodeId}:`,
          err,
        );
      }
    }

    try {
      const mediaFiles = findSafeOutputMedia(outputsDir);
      if (mediaFiles.length > 0) {
        outputData.media = mediaFiles.map(
          (file) =>
            `/outputs/${testId}/${nodeId}/${encodeRelativeOutputPath(outputsDir, file)}`,
        );
      }
    } catch (err) {
      console.error(
        `Failed to inspect output media for ${testId}/${nodeId}:`,
        err,
      );
      return res.status(500).json({ error: 'Failed to inspect output media.' });
    }

    try {
      await apiRuntime.outputSync.sync({
        bucketName,
        cloudProvider: state.testCloudProviders[testId] || 'LOCAL_RUNNER',
        nodeId,
        outputsDir,
        testId,
      });
    } catch (err: any) {
      console.error(`Output sync error for ${testId}/${nodeId}:`, err.message);
      return res.status(500).json({ error: err.message });
    }

    const outputEventPublishedByRunner =
      state.testCloudProviders[testId] === 'LOCAL_RUNNER' &&
      !!process.env.PUBSUB_EMULATOR_HOST?.trim();

    if (!outputEventPublishedByRunner) {
      try {
        await executionEvents.appendEvent(execution.id, {
          executionId: execution.id,
          nodeId,
          output: outputData,
          testId,
          timestamp: new Date().toISOString(),
          type: 'node_output',
        });
      } catch (err) {
        console.error(
          `Failed to persist node output event for ${testId}/${nodeId}:`,
          err,
        );
        return res
          .status(500)
          .json({ error: 'Failed to persist node output event.' });
      }
    }

    res
      .status(200)
      .json({ message: 'Outputs processed successfully', output: outputData });
  },
);

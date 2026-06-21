import { Router } from 'express';
import express from 'express';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import {
  EXECUTION_TOKEN_HEADER,
  executionEvents,
} from '../services/execution-events';
import { state } from '../state';
import { apiRuntime } from '../runtime';

export const outputsRouter = Router();

function getStringHeader(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

// Endpoint to receive outputs from runner
outputsRouter.post(
  '/:testId/:nodeId',
  express.raw({ type: '*/*', limit: '100mb' }),
  async (req, res) => {
    const { nodeId, testId } = req.params;
    const bucketName = (req.query as any)?.bucketName as string | undefined;
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

    console.log(
      `Received outputs for node ${nodeId}, test ${testId}, size: ${req.body?.length || 0} bytes`,
    );

    const outputsDir = path.join(
      __dirname,
      '../../public/outputs',
      testId,
      nodeId,
    );
    fs.mkdirSync(outputsDir, { recursive: true });

    if (req.body && req.body.length > 0) {
      try {
        await new Promise<void>((resolve, reject) => {
          const extractProcess = spawn('tar', ['-xzf', '-'], {
            cwd: outputsDir,
          });
          extractProcess.stdin.write(req.body);
          extractProcess.stdin.end();
          extractProcess.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`Tar extraction failed with code ${code}`));
          });
        });
        console.log(`Extracted outputs for node ${nodeId}, test ${testId}`);
      } catch (err) {
        console.error('Failed to extract outputs:', err);
        return res.status(500).json({ error: 'Failed to extract outputs' });
      }
    }

    const outputData: any = {};
    if (
      fs.existsSync(path.join(outputsDir, 'playwright-report', 'index.html'))
    ) {
      outputData.reportUrl = `/outputs/${testId}/${nodeId}/playwright-report/index.html`;
    }

    const testResultsDir = path.join(outputsDir, 'test-results');
    if (fs.existsSync(testResultsDir)) {
      const findVideos = (dir: string): string[] => {
        let results: string[] = [];
        const list = fs.readdirSync(dir);
        list.forEach((file) => {
          const fileRoute = path.join(dir, file);
          const stat = fs.statSync(fileRoute);
          if (stat && stat.isDirectory()) {
            results = results.concat(findVideos(fileRoute));
          } else if (file.endsWith('.webm') || file.endsWith('.png')) {
            results.push(fileRoute);
          }
        });
        return results;
      };
      const mediaFiles = findVideos(testResultsDir);
      if (mediaFiles.length > 0) {
        outputData.media = mediaFiles.map(
          (v) => `/outputs/${testId}/${nodeId}/${path.relative(outputsDir, v)}`,
        );
      }
    }

    try {
      await apiRuntime.outputSync.sync({
        bucketName,
        cloudProvider: state.testCloudProviders[testId] || 'LOCAL-DEV',
        nodeId,
        outputsDir,
        testId,
      });
    } catch (err: any) {
      console.error(`Output sync error for ${testId}/${nodeId}:`, err.message);
      return res.status(500).json({ error: err.message });
    }

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

    res
      .status(200)
      .json({ message: 'Outputs processed successfully', output: outputData });
  },
);

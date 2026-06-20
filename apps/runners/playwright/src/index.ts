import { PubSub } from '@google-cloud/pubsub';
import { spawn } from 'child_process';
import path from 'path';
import crypto from 'crypto';

import fs from 'fs';

const pubsub = new PubSub();
const topicName = process.env.PUBSUB_TOPIC || 'orchestrator-logs';

async function publishLog(message: string, level: 'info' | 'error' = 'info') {
  const payload = JSON.stringify({ message: `[Playwright Runner] ${message}`, level, timestamp: new Date() });
  try {
    const topic = pubsub.topic(topicName);
    await topic.publishMessage({ data: Buffer.from(payload) });
    console.log(message);
  } catch {
    console.log(`[Local Fallback] ${message}`);
  }
}

async function runTypescriptTest(workingDir: string): Promise<void> {
  await publishLog(`Executing TypeScript Playwright flow in ${workingDir}...`);
  
  if (fs.existsSync(path.join(workingDir, 'package.json'))) {
    await publishLog('Installing npm dependencies...');
    await new Promise<void>((resolve, reject) => {
      const install = spawn('npm', ['install'], { cwd: workingDir });
      install.stdout.on('data', data => console.log(`[npm]: ${data.toString().trim()}`));
      install.stderr.on('data', data => console.error(`[npm error]: ${data.toString().trim()}`));
      install.on('close', code => code === 0 ? resolve() : reject(new Error(`npm install failed with code ${code}`)));
    });
  }

  const args = ['playwright', 'test'];
  let configMsg = 'default config';
  if (fs.existsSync(path.join(workingDir, 'playwright.service.config.ts'))) {
    args.push('--config', 'playwright.service.config.ts');
    configMsg = 'playwright.service.config.ts';
  }

  await publishLog(`Running npx playwright test using ${configMsg}...`);
  await new Promise<void>((resolve, reject) => {
    const testProc = spawn('npx', args, { cwd: workingDir });
    testProc.stdout.on('data', data => console.log(`[playwright]: ${data.toString().trim()}`));
    testProc.stderr.on('data', data => console.error(`[playwright error]: ${data.toString().trim()}`));
    testProc.on('close', code => code === 0 ? resolve() : reject(new Error(`Tests failed with code ${code}`)));
  });
}

async function runPythonTest(workingDir: string): Promise<void> {
  await publishLog(`Executing Python Playwright flow in ${workingDir}...`);

  await publishLog('Running pytest...');
  await new Promise<void>((resolve, reject) => {
    const testProc = spawn('pytest', [], { cwd: workingDir });
    testProc.stdout.on('data', data => console.log(`[pytest]: ${data.toString().trim()}`));
    testProc.stderr.on('data', data => console.error(`[pytest error]: ${data.toString().trim()}`));
    testProc.on('close', code => code === 0 ? resolve() : reject(new Error(`Tests failed with code ${code}`)));
  });
}

async function uploadOutputs(
  workingDir: string,
  nodeId: string,
  testId: string,
  editorApiUrl: string,
  bucketName?: string,
  accessToken?: string,
  gcpProject?: string,
  cloudProvider: string = 'LOCAL-DEV'
) {
  if (!nodeId || !testId) {
    await publishLog('Missing nodeId or testId, skipping output upload.');
    return;
  }
  
  await publishLog(`Preparing test outputs for node ${nodeId}...`);
  
  const hasPlaywrightReport = fs.existsSync(path.join(workingDir, 'playwright-report'));
  const hasTestResults = fs.existsSync(path.join(workingDir, 'test-results'));
  
  if (!hasPlaywrightReport && !hasTestResults) {
    await publishLog('No playwright-report or test-results directory found. Skipping output upload.');
    return;
  }
  
  try {
    if (cloudProvider === 'GCP' && bucketName && accessToken && gcpProject) {
      const outputData: any = {};
      
      if (hasPlaywrightReport) {
        outputData.reportUrl = `/outputs/${testId}/${nodeId}/playwright-report/index.html`;
      }
      
      if (hasTestResults) {
        const findVideos = (dir: string): string[] => {
          let results: string[] = [];
          const list = fs.readdirSync(dir);
          list.forEach(file => {
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
        const mediaFiles = findVideos(path.join(workingDir, 'test-results'));
        if (mediaFiles.length > 0) {
          outputData.media = mediaFiles.map(v => `/outputs/${testId}/${nodeId}/${path.relative(workingDir, v)}`);
        }
      }

      await publishLog(`Uploading outputs directly to GCS bucket ${bucketName}...`);
      const [{ Storage }, { OAuth2Client }] = await Promise.all([
        import('@google-cloud/storage'),
        import('google-auth-library'),
      ]);
      const oauth2Client = new OAuth2Client();
      oauth2Client.setCredentials({ access_token: accessToken });
      
      const authClient = {
        getRequestHeaders: async (url?: string) => {
          const headers = await oauth2Client.getRequestHeaders(url);
          const plainHeaders: Record<string, string> = {};
          if (headers && typeof (headers as any).forEach === 'function') {
            (headers as any).forEach((value: string, key: string) => { plainHeaders[key] = value; });
          } else if (headers) {
            Object.assign(plainHeaders, headers);
          }
          return plainHeaders;
        },
        request: async (opts: any) => {
          if (opts.uri && !opts.url) opts.url = opts.uri;
          const res = await oauth2Client.request(opts);
          if (res && res.headers && typeof (res.headers as any).forEach === 'function') {
            const plainHeaders: Record<string, string> = {};
            (res.headers as any).forEach((value: string, key: string) => { plainHeaders[key] = value; });
            return new Proxy(res, { get(target, prop) { if (prop === 'headers') return plainHeaders; const value = target[prop as keyof typeof target]; if (typeof value === 'function') return value.bind(target); return value; } });
          }
          return res;
        }
      };
      
      const storage = new Storage({ projectId: gcpProject, authClient: authClient as any });
      const bucket = storage.bucket(bucketName);
      
      const uploadDirToGcs = async (localDir: string, gcsPrefix: string) => {
        const files = fs.readdirSync(localDir);
        for (const file of files) {
          const localPath = path.join(localDir, file);
          const gcsPath = `${gcsPrefix}/${file}`;
          if (fs.statSync(localPath).isDirectory()) {
            await uploadDirToGcs(localPath, gcsPath);
          } else {
            await bucket.upload(localPath, { destination: gcsPath });
          }
        }
      };
      
      if (hasPlaywrightReport) await uploadDirToGcs(path.join(workingDir, 'playwright-report'), `${testId}/${nodeId}/playwright-report`);
      if (hasTestResults) await uploadDirToGcs(path.join(workingDir, 'test-results'), `${testId}/${nodeId}/test-results`);

      // Broadcast node_output event via PubSub so API can send it via SSE.
      const eventPayload = JSON.stringify({ type: 'node_output', nodeId, testId, output: outputData });
      const topic = pubsub.topic(topicName);
      await topic.publishMessage({ data: Buffer.from(eventPayload) });
    } else {
      await publishLog(`Uploading outputs to editor API at ${editorApiUrl} for local execution.`);
      const outputDirs = [];
      if (hasPlaywrightReport) outputDirs.push('playwright-report');
      if (hasTestResults) outputDirs.push('test-results');

      const archiveBuffer = await new Promise<Buffer>((resolve, reject) => {
        const tarProcess = spawn('tar', ['-czf', '-', ...outputDirs], { cwd: workingDir });
        const chunks: Buffer[] = [];

        tarProcess.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
        tarProcess.stderr.on('data', data => console.error(`[tar error]: ${data.toString().trim()}`));
        tarProcess.on('close', code => {
          if (code === 0) resolve(Buffer.concat(chunks));
          else reject(new Error(`tar failed with code ${code}`));
        });
        tarProcess.on('error', reject);
      });

      const uploadUrl = new URL(`/api/outputs/${testId}/${nodeId}`, editorApiUrl);
      if (bucketName) uploadUrl.searchParams.set('bucketName', bucketName);

      const response = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/gzip'
        },
        body: new Uint8Array(archiveBuffer)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Editor API upload failed (${response.status}): ${errorText}`);
      }
    }

    await publishLog('Outputs processed successfully.');
  } catch (err: any) {
    await publishLog(`Failed to process outputs: ${err.message}`, 'error');
  }
}

async function run() {
  let payload: any = null;
  if (process.env.PAYLOAD) {
    try {
      payload = JSON.parse(process.env.PAYLOAD);
    } catch {
      await publishLog('Failed to parse PAYLOAD environment variable.', 'error');
    }
  }

  const testId = payload?.data?.testId || crypto.randomUUID();
  const cloudProvider = payload?.data?.cloudProvider || 'LOCAL-DEV';
  const envType = cloudProvider === 'GCP' ? 'GCP Cloud Run' : 'Local Docker';
  await publishLog(`Playwright runner container started in ${envType}. Test ID: ${testId}`);

  let workingDir = __dirname;
  let isCloned = false;

  if (payload?.data?.action === 'clone' || (!payload?.data?.action && payload?.data?.repository)) {
    if (payload?.data?.repository) {
      const repo = payload.data.repository;
      const branch = payload.data.branch || 'main';
      const token = payload?.github?.accessToken;
      
      await publishLog(`Cloning repository ${repo} on branch ${branch}...`);
      
      const cloneUrl = token ? `https://x-access-token:${token}@github.com/${repo}.git` : `https://github.com/${repo}.git`;
      
      try {
        await new Promise<void>((resolve, reject) => {
          const gitProcess = spawn('git', ['clone', '--depth', '1', '-b', branch, '--single-branch', cloneUrl, '/app/repo']);
          
          gitProcess.stdout.on('data', (data) => console.log(`[Git]: ${data.toString().trim()}`));
          gitProcess.stderr.on('data', (data) => console.error(`[Git Error]: ${data.toString().trim()}`));
          
          gitProcess.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`Git clone failed with code ${code}`));
          });
        });
        await publishLog(`Repository cloned successfully.`);
        workingDir = path.join('/app/repo', payload?.data?.folder || '/');
        isCloned = true;
      } catch (err: any) {
        await publishLog(`Clone Error: ${err.message}`, 'error');
        process.exit(1);
      }
    } else {
      await publishLog('Missing repository for cloning.', 'error');
      process.exit(1);
    }
  }
  
  // Auto-detect language if cloned
  let testLanguage = payload?.data?.testLanguage || 'typescript'; 
  
  if (isCloned) {
    if (fs.existsSync(path.join(workingDir, 'requirements.txt')) || fs.existsSync(path.join(workingDir, 'pytest.ini'))) {
      testLanguage = 'python';
    } else {
      testLanguage = 'typescript';
    }
  } else {
    // If not cloned, default to whatever was hardcoded or configured
    testLanguage = payload?.data?.testLanguage || 'typescript';
  }
  
  let testFailed = false;
  try {
    if (testLanguage === 'python') {
      await runPythonTest(workingDir);
    } else {
      await runTypescriptTest(workingDir);
    }
    
    await publishLog('Job complete.');
  } catch (err: any) {
    testFailed = true;
    await publishLog(`Playwright Error: ${err.message}`, 'error');
  }

  // Upload outputs regardless of failure
  await uploadOutputs(
    workingDir, 
    payload?.data?.nodeId, 
    testId, 
    payload?.data?.editorApiUrl, 
    payload?.data?.bucketName,
    payload?.settings?.gcp?.accessToken,
    payload?.settings?.gcp?.selectedProject || process.env.GCP_PROJECT,
    cloudProvider
  );

  // Cloud Run Jobs must exit successfully (0) to be marked as completed,
  // except we do want it to show failure if it failed.
  process.exit(testFailed ? 1 : 0);
}

run();

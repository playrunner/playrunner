import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { NodeExecutionContext } from '@playrunner/integration-sdk/orchestrator';
import contribution, { extractVerificationCode } from './index';

function context(
  action: 'send' | 'wait',
  config: Record<string, unknown>,
): NodeExecutionContext {
  return {
    executionId: 'execution-1',
    workflowId: 'workflow-1',
    node: { id: 'resend-1', nodeType: 'resend', config: { action, ...config } },
    settings: { apiKey: 're_test' },
    env: { RECIPIENT_EMAIL: 'person@example.com' },
    nodeOutputs: {},
    workflow: {},
    renderTemplate: (value) =>
      value
        .replace('{{recipient}}', 'person@example.com')
        .replace('{{env.RECIPIENT_EMAIL}}', 'person@example.com'),
    log: async () => {},
    signal: new AbortController().signal,
  };
}

const sendExecutor = contribution.executors.find(
  (executor) => executor.action === 'send',
)!;
const waitExecutor = contribution.executors.find(
  (executor) => executor.action === 'wait',
)!;

test('registers one Resend node type with operation executors', () => {
  assert.equal(contribution.id, 'resend');
  assert.deepEqual(
    contribution.executors.map(({ action, nodeType }) => ({
      action,
      nodeType,
    })),
    [
      { action: 'send', nodeType: 'resend' },
      { action: 'wait', nodeType: 'resend' },
    ],
  );
  assert.equal(sendExecutor.default, true);
});

test('sends templated email and returns the provider email id', async () => {
  const originalFetch = globalThis.fetch;
  let request: RequestInit | undefined;
  globalThis.fetch = async (_input, init) => {
    request = init;
    return new Response(JSON.stringify({ id: 'email-123' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  try {
    const result = await sendExecutor.execute(
      context('send', {
        from: 'Playrunner <automation@example.com>',
        to: '{{recipient}}, second@example.com',
        subject: 'Hello',
        text: 'Welcome',
        tags: '{"kind":"login"}',
      }),
    );
    assert.deepEqual(result.output, {
      result: { status: 'success', emailId: 'email-123' },
    });
    const body = JSON.parse(String(request?.body));
    assert.deepEqual(body.to, ['person@example.com', 'second@example.com']);
    assert.deepEqual(body.tags, [{ name: 'kind', value: 'login' }]);
    assert.equal(
      (request?.headers as Record<string, string>)['Idempotency-Key'],
      'execution-1:resend-1',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('renders a dropped environment template in recipient fields', async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> = {};
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    return Response.json({ id: 'email-env' });
  };
  try {
    await sendExecutor.execute(
      context('send', {
        from: 'automation@example.com',
        to: '{{env.RECIPIENT_EMAIL}}',
        subject: 'Hello',
        text: 'Welcome',
      }),
    );
    assert.deepEqual(requestBody.to, ['person@example.com']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('keeps template content mutually exclusive from text and html', async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> = {};
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ id: 'email-456' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  try {
    await sendExecutor.execute(
      context('send', {
        from: 'automation@example.com',
        to: 'person@example.com',
        subject: 'Hello',
        contentMode: 'template',
        templateId: 'login-code',
        templateVariables: '{"code":"123456"}',
        text: 'must not be sent',
        html: '<p>must not be sent</p>',
      }),
    );
    assert.deepEqual(requestBody.template, {
      id: 'login-code',
      variables: { code: '123456' },
    });
    assert.equal('text' in requestBody, false);
    assert.equal('html' in requestBody, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('waits for a matching message, extracts its code, and retrieves attachments', async () => {
  const originalFetch = globalThis.fetch;
  const paths: string[] = [];
  globalThis.fetch = async (input) => {
    const path = new URL(String(input)).pathname;
    paths.push(path);
    if (path.endsWith('/attachments/attachment-1')) {
      return Response.json({
        id: 'attachment-1',
        filename: 'receipt.pdf',
        content_type: 'application/pdf',
        size: 1234,
        download_url: 'https://inbound-cdn.resend.test/receipt',
        expires_at: '2026-08-04T11:00:00Z',
      });
    }
    if (path.endsWith('/receiving/email-1')) {
      return Response.json({
        id: 'email-1',
        text: 'Your verification code is 482193.',
        html: null,
        headers: { from: 'Security <security@example.com>' },
        message_id: 'message-1',
        attachments: [{ id: 'attachment-1' }],
      });
    }
    return Response.json({
      object: 'list',
      has_more: false,
      data: [
        {
          id: 'email-1',
          created_at: new Date().toISOString(),
          from: 'security@example.com',
          to: ['login@example.resend.app'],
          subject: 'Your verification code',
        },
      ],
    });
  };
  try {
    const result = await waitExecutor.execute(
      context('wait', {
        to: 'login@example.resend.app',
        fromFilter: '@example.com',
        subjectFilter: 'verification',
        bodyFilter: 'code',
        extraction: 'verification_code',
        timeoutSeconds: 5,
      }),
    );
    const output = result.output as {
      result: {
        attachments: Array<{ downloadUrl?: string; filename?: string }>;
        email: { id: string };
        extraction: { status: string; type: string; value: string | null };
      };
    };
    assert.equal(output.result.email.id, 'email-1');
    assert.deepEqual(output.result.extraction, {
      type: 'verification_code',
      status: 'matched',
      value: '482193',
    });
    assert.equal(output.result.attachments[0].filename, 'receipt.pdf');
    assert.equal(
      output.result.attachments[0].downloadUrl,
      'https://inbound-cdn.resend.test/receipt',
    );
    assert.deepEqual(paths, [
      '/emails/receiving',
      '/emails/receiving/email-1',
      '/emails/receiving/email-1/attachments/attachment-1',
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('verification extraction refuses ambiguous numeric codes', () => {
  assert.deepEqual(extractVerificationCode('Use 123456 or 654321.'), {
    status: 'ambiguous',
    value: null,
  });
  assert.deepEqual(extractVerificationCode('OTP: A7B9C2'), {
    status: 'matched',
    value: 'A7B9C2',
  });
  assert.deepEqual(extractVerificationCode('No code in this message.'), {
    status: 'not_found',
    value: null,
  });
});

test('validates operation-specific send fields before calling Resend', async () => {
  await assert.rejects(
    sendExecutor.execute(
      context('send', {
        from: 'automation@example.com',
        to: '',
        subject: 'Hello',
        text: 'Body',
      }),
    ),
    /To is required/,
  );
});

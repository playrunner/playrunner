import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { evaluateTestPlan, validateTestPlan } from '../../shared/test-plan';

const escape = (value: unknown) =>
  String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        char
      ]!,
  );

export function writeTestPlanReport(
  directory: string,
  value: unknown,
  executionId: string,
  nodeId: string,
) {
  const plan = validateTestPlan(value);
  const version = createHash('sha256')
    .update(JSON.stringify(plan))
    .digest('hex');
  fs.mkdirSync(directory, { recursive: true });
  const rawPath = path.join(directory, 'report.json');
  const report =
    fs.existsSync(rawPath) && fs.statSync(rawPath).size <= 16 * 1024 * 1024
      ? JSON.parse(fs.readFileSync(rawPath, 'utf8'))
      : {};
  const result = {
    ...evaluateTestPlan(plan, report),
    name: plan.name,
    version,
    executionId,
    nodeId,
  };
  fs.writeFileSync(path.join(directory, 'test-plan.md'), plan.markdown);
  fs.writeFileSync(
    path.join(directory, 'test-plan.json'),
    JSON.stringify({ plan, ...result }, null, 2),
  );
  const index = path.join(directory, 'index.html');
  const original = path.join(directory, 'automated-tests.html');
  if (fs.existsSync(index) && !fs.existsSync(original))
    fs.renameSync(index, original);
  const automatedLink = fs.existsSync(original)
    ? '<a href="automated-tests.html">Automated test report and evidence</a>'
    : '<p>No automated test report was produced.</p>';
  fs.writeFileSync(
    index,
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escape(plan.name)} — ${result.status}</title><style>body{font:16px system-ui;max-width:1200px;margin:40px auto;padding:0 24px;color:#202124;background:#fff}table{width:100%;border-collapse:collapse}td,th{border:1px solid #ddd;padding:12px;text-align:left;vertical-align:top}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f5f5f5;padding:20px}a{color:#1659a5}small{overflow-wrap:anywhere}.PASS{color:#147d32}.FAIL{color:#b91c1c}</style><h1>Test plan: ${escape(plan.name)}</h1><h2 class="${result.status}">Overall plan: ${result.status}</h2><p>Execution ${escape(executionId)} · Node ${escape(nodeId)}</p><p><small>Plan version: ${version}</small></p><p>${Object.entries(
      result.counts,
    )
      .map(([key, count]) => `${escape(key)}: ${count}`)
      .join(
        ' · ',
      )}</p><p>${automatedLink} · <a href="test-plan.md" download>Download original plan</a> · <a href="test-plan.json" download>Download plan results</a></p><table><thead><tr><th>Case</th><th>SUCCESS/PASS criteria</th><th>Mapped tests</th><th>Outcome and evidence</th></tr></thead><tbody>${result.cases.map((c) => `<tr><td>${escape(c.id)}<p>${escape(c.description)}</p></td><td>${escape(c.criteria)}</td><td>${c.tests.map((t) => `${escape(t.project || '(default)')} :: ${escape(t.title)}`).join('<br>')}</td><td><strong class="${c.status}">${c.status}</strong><p>${escape(c.reason)}</p>${c.evidence.map((t) => `<a href="automated-tests.html#?testId=${encodeURIComponent(t.evidenceId)}">${escape(t.title)} (${escape(t.project || 'default')}): ${t.status}</a>`).join('<br>')}</td></tr>`).join('')}</tbody></table><h2>Original test plan</h2><p>Authored status text below is preserved; it does not override the current execution results above.</p><pre>${escape(plan.markdown)}</pre></html>`,
  );
  return { status: result.status, counts: result.counts, version };
}

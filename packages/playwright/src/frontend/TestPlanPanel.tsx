import { useEffect, useState } from 'react';
import { useIntegrationHost } from '@playrunner/integration-sdk';

type PlanCase = {
  id: string;
  description: string;
  criteria: string;
  tests: Array<{ project: string; title: string }>;
};
type Plan = { name: string; markdown: string; cases: PlanCase[] };

function importCases(markdown: string): PlanCase[] {
  const cases: PlanCase[] = [];
  const seen = new Set<string>();
  let exitCriteria = false;
  for (const line of markdown.split('\n')) {
    if (/^#{1,6}\s/.test(line))
      exitCriteria = /^#{1,6}\s+Exit criteria\s*$/i.test(line);
    const cells = line
      .trim()
      .replace(/^\||\|$/g, '')
      .split(/(?<!\\)\|/)
      .map((s) => s.trim());
    if (
      /^[A-Z][A-Z0-9_-]*-\d+$/.test(cells[0]) &&
      cells.length >= 3 &&
      !seen.has(cells[0])
    ) {
      seen.add(cells[0]);
      cases.push({
        id: cells[0],
        description: cells[1],
        criteria: cells[2],
        tests: [],
      });
    } else if (exitCriteria && /^\s*[-*]\s+/.test(line)) {
      const id = `EXIT-${cases.filter((c) => c.id.startsWith('EXIT-')).length + 1}`;
      cases.push({
        id,
        description: 'Exit criterion',
        criteria: line.replace(/^\s*[-*]\s+/, ''),
        tests: [],
      });
    }
  }
  return cases;
}

export function TestPlanPanel({
  value,
  onChange,
}: {
  value?: Plan;
  onChange: (plan: Plan | undefined) => void;
}) {
  const { ui } = useIntegrationHost();
  const { Input, Textarea } = ui;
  const Button = ui.Button!;
  const [error, setError] = useState('');
  const updateCase = (index: number, patch: Partial<PlanCase>) => {
    if (value)
      onChange({
        ...value,
        cases: value.cases.map((item, i) =>
          i === index ? { ...item, ...patch } : item,
        ),
      });
  };
  return (
    <section
      className="space-y-3 border-t border-subtle pt-4"
      aria-label="Test plan"
    >
      <h3 className="text-sm font-medium">Test plan (optional)</h3>
      <p className="text-xs text-muted">
        Upload Markdown with your suite. Define the checks that must pass and
        map each case to exact test titles and projects. Unmapped cases and exit
        criteria remain unresolved.
      </p>
      <label className="block text-sm">
        Upload test plan
        <input
          className="block mt-2 text-xs"
          type="file"
          accept=".md,text/markdown"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            try {
              if (!/\.md$/i.test(file.name) || file.size > 256 * 1024)
                throw new Error('Choose a Markdown (.md) file up to 256 KB.');
              const markdown = await file.text();
              if (!markdown.trim()) throw new Error('The test plan is empty.');
              const cases = importCases(markdown);
              if (cases.length > 200)
                throw new Error('A plan supports at most 200 cases.');
              onChange({ name: file.name, markdown, cases });
              setError('');
            } catch (cause) {
              setError(
                cause instanceof Error
                  ? cause.message
                  : 'Could not read test plan.',
              );
            }
          }}
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      )}
      {value && (
        <>
          <div className="flex justify-between items-center gap-2">
            <span className="text-sm">{value.name}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onChange(undefined)}
            >
              Remove plan
            </Button>
          </div>
          <details>
            <summary className="cursor-pointer text-sm">
              Preview original plan
            </summary>
            <pre className="whitespace-pre-wrap break-words rounded-lg bg-surface-hover border border-subtle p-3 text-xs">
              {value.markdown}
            </pre>
          </details>
          <p className="text-xs text-muted">
            Review imported cases and add any missing requirements. Mapping
            format: one <code>project :: full test title</code> per line. Use{' '}
            <code>(default)</code> for an unnamed project and <code> › </code>{' '}
            between describe groups and the test title. List every required
            browser/device variant explicitly.
          </p>
          {value.cases.map((item, index) => (
            <fieldset
              key={`${value.name}-${index}-${value.markdown.length}`}
              className="border border-subtle rounded-xl p-3 space-y-2"
            >
              <legend className="text-sm">Case {index + 1}</legend>
              <label className="block text-xs">
                Case ID
                <Input
                  value={item.id}
                  onChange={(event) =>
                    updateCase(index, { id: event.target.value })
                  }
                />
              </label>
              <label className="block text-xs">
                Description / steps
                <Textarea
                  value={item.description}
                  onChange={(event) =>
                    updateCase(index, { description: event.target.value })
                  }
                />
              </label>
              <label className="block text-xs">
                SUCCESS/PASS criteria
                <Textarea
                  value={item.criteria}
                  onChange={(event) =>
                    updateCase(index, { criteria: event.target.value })
                  }
                />
              </label>
              <TestMappings
                value={item.tests}
                onChange={(tests) => updateCase(index, { tests })}
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  onChange({
                    ...value,
                    cases: value.cases.filter((_, i) => i !== index),
                  })
                }
              >
                Remove case
              </Button>
            </fieldset>
          ))}
          <Button
            variant="secondary"
            size="sm"
            disabled={value.cases.length >= 200}
            onClick={() =>
              onChange({
                ...value,
                cases: [
                  ...value.cases,
                  {
                    id: `CASE-${value.cases.length + 1}`,
                    description: '',
                    criteria: '',
                    tests: [],
                  },
                ],
              })
            }
          >
            Add plan case
          </Button>
        </>
      )}
    </section>
  );
}

function TestMappings({
  value,
  onChange,
}: {
  value: PlanCase['tests'];
  onChange: (tests: PlanCase['tests']) => void;
}) {
  const {
    ui: { Textarea },
  } = useIntegrationHost();
  const [text, setText] = useState(
    value.map((t) => `${t.project || '(default)'} :: ${t.title}`).join('\n'),
  );
  useEffect(() => {
    setText(
      value.map((t) => `${t.project || '(default)'} :: ${t.title}`).join('\n'),
    );
  }, [value]);
  return (
    <label className="block text-xs">
      Required tests
      <Textarea
        placeholder="chromium :: Policy › matches source"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => {
          onChange(
            text
              .split('\n')
              .filter((line) => line.trim())
              .map((line) => {
                const separator = line.indexOf('::');
                const project =
                  separator < 0 ? '' : line.slice(0, separator).trim();
                return {
                  project: project === '(default)' ? '' : project,
                  title: (separator < 0
                    ? line
                    : line.slice(separator + 2)
                  ).trim(),
                };
              }),
          );
        }}
      />
    </label>
  );
}

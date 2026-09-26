import type { WorkflowTestPlan } from '../components/WorkflowTestPlanPanel';

export function migrateNodePlans<
  T extends { id: string; label: string; config?: Record<string, any> },
>(nodes: T[], plan?: WorkflowTestPlan | null) {
  const legacy = nodes.filter((node) => node.config?.testPlan);
  if (!legacy.length) return { nodes, testPlan: plan ?? null };
  const plans = [
    ...(plan ? [{ id: '', plan }] : []),
    ...legacy.map((node) => ({
      id: node.id,
      plan: node.config!.testPlan as WorkflowTestPlan,
    })),
  ];
  const merged: WorkflowTestPlan = {
    name: plans.length === 1 ? plans[0].plan.name : 'workflow-test-plan.md',
    markdown:
      plans.length === 1
        ? plans[0].plan.markdown
        : plans
            .map(
              ({ id, plan }) =>
                (id
                  ? '# ' +
                    (nodes.find((node) => node.id === id)?.label ?? id) +
                    '\n\n'
                  : '') + plan.markdown,
            )
            .join('\n\n---\n\n'),
    cases: plans.flatMap(({ id, plan }, index) =>
      plan.cases.map((item) => ({
        ...item,
        id:
          plans.length > 1
            ? 'PLAN-' + (index + 1) + '-' + item.id.slice(0, 85)
            : item.id,
        tests: item.tests.map((test) => ({
          ...test,
          ...(id ? { nodeId: id } : {}),
        })),
      })),
    ),
  };
  return {
    testPlan: merged,
    nodes: nodes.map((node) => {
      if (!node.config?.testPlan) return node;
      const { testPlan: _legacy, ...config } = node.config;
      return { ...node, config };
    }),
  };
}

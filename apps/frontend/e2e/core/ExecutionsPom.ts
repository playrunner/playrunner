import { expect, type Page } from '@playwright/test';

export class ExecutionsPom {
  constructor(private readonly page: Page) {}

  execution(id: string) {
    return this.page.getByRole('region', {
      name: `Execution ${id}`,
      exact: true,
    });
  }

  async open() {
    await this.page.goto('/executions');
    await expect(this.page.getByText('Live', { exact: true })).toBeVisible();
  }

  node(id: string, title: string) {
    return this.execution(id).getByRole('listitem', {
      name: title,
      exact: true,
    });
  }

  async toggleExecution(id: string, expanded: boolean) {
    const toggle = this.execution(id).getByRole('button', {
      name: /^(Expand|Collapse) execution /,
    });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', String(expanded));
  }

  async toggle(id: string, title: string, expanded: boolean) {
    await this.node(id, title)
      .getByRole('button', {
        name: `${expanded ? 'Expand' : 'Collapse'} ${title}`,
        exact: true,
      })
      .click();
    await expect(
      this.node(id, title).getByRole('button', {
        name: `${expanded ? 'Collapse' : 'Expand'} ${title}`,
        exact: true,
      }),
    ).toHaveAttribute('aria-expanded', String(expanded));
  }
}

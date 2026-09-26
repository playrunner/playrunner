import { expect, type Page } from '@playwright/test';
import { confirmAction } from './NavigationPom';

export class TeamsPom {
  constructor(readonly page: Page) {}
  card(name: string) {
    return this.page
      .getByTestId('team-details')
      .filter({ has: this.page.getByRole('heading', { name, exact: true }) });
  }
  async goto() {
    await this.page.goto('/teams');
  }
  async create(name: string) {
    await this.page.getByRole('button', { name: 'Create new team' }).click();
    await this.page.getByLabel('Team name').fill(name);
    await this.page
      .getByRole('button', { name: 'Create team', exact: true })
      .click();
    await expect(this.card(name)).toBeVisible();
  }
  async open(name: string) {
    await this.page.getByRole('heading', { name, exact: true }).click();
  }
  async invite(email: string) {
    await this.page.getByLabel('Email address').fill(email);
    await this.page.getByRole('button', { name: 'Send invitation' }).click();
  }
  async share(team: string, workflow: string) {
    await this.card(team)
      .getByRole('combobox', { name: `Workflows shared with ${team}` })
      .click();
    await this.card(team)
      .getByRole('searchbox', { name: 'Search workflows' })
      .fill(workflow);
    await this.card(team)
      .getByRole('option', { name: workflow, exact: true })
      .click();
  }
  async delete(name: string, accept = true) {
    await confirmAction(
      this.page,
      () =>
        this.card(name).getByRole('button', { name: 'Delete team' }).click(),
      'Delete',
      accept,
    );
    if (accept) await expect(this.card(name)).toBeHidden();
  }
}

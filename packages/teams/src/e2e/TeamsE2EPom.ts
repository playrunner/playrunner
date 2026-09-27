import type { Page } from '@playwright/test';
import type { PlayrunnerE2EHost } from '@playrunner/integration-sdk/e2e';
import type { TeamsE2EData } from './data';

export class TeamsE2EPom {
  constructor(
    readonly page: Page,
    readonly host: PlayrunnerE2EHost,
  ) {}
  get dialog() {
    return this.page.getByRole('dialog', {
      name: 'Connect to Microsoft Teams',
    });
  }
  get connectButton() {
    return this.dialog.getByRole('button', {
      name: 'Connect Microsoft Teams',
      exact: true,
    });
  }
  get connectedHeading() {
    return this.dialog.getByRole('heading', {
      name: 'Microsoft Teams Connected Successfully',
    });
  }
  get team() {
    return this.page.getByRole('combobox', { name: 'Team', exact: true });
  }
  get channel() {
    return this.page.getByRole('combobox', { name: 'Channel', exact: true });
  }
  get message() {
    return this.page.getByRole('textbox', { name: 'Message', exact: true });
  }
  async open() {
    await this.host.openIntegration({ id: 'teams', name: 'Microsoft Teams' });
  }
  async close() {
    await this.dialog.getByTitle('Close').click();
  }
  async fill(data: TeamsE2EData) {
    for (const [label, value] of [
      ['Tenant ID or domain', data.tenantId],
      ['Application ID', data.clientId],
      ['Client secret', data.clientSecret],
    ]) {
      const field = this.dialog.getByRole('textbox', {
        name: label,
        exact: true,
      });
      await field.click();
      await field.fill(value);
    }
  }
  async fakeAuthorization(denied = false) {
    await this.page
      .context()
      .route(
        'https://login.microsoftonline.com/**/oauth2/v2.0/authorize?**',
        async (route) => {
          const url = new URL(route.request().url());
          const redirect = new URL(url.searchParams.get('redirect_uri')!);
          redirect.searchParams.set('state', url.searchParams.get('state')!);
          redirect.searchParams.set(
            denied ? 'error' : 'code',
            denied ? 'access_denied' : 'fake-code',
          );
          await route.fulfill({
            status: 302,
            headers: { location: redirect.toString() },
          });
        },
      );
  }
  async connect(data: TeamsE2EData) {
    await this.fakeAuthorization();
    await this.open();
    await this.fill(data);
    await this.connectButton.click();
    await this.connectedHeading.waitFor();
  }
  async createNode() {
    await this.close();
    await this.host.openNewWorkflow();
    await this.host.addNode('teams');
    await this.host.openNodeSettings('teams');
  }
  async reloadNode() {
    await this.host.closeNodeSettings();
    await this.host.saveWorkflow();
    await this.host.reloadWorkflow();
    await this.host.openNodeSettings('teams');
  }
}

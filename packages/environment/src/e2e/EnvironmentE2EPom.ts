import type { Locator, Page } from '@playwright/test';
import type { PlayrunnerE2EHost } from '@playrunner/integration-sdk/e2e';

export class EnvironmentE2EPom {
  readonly dialog: Locator;
  readonly environmentSelect: Locator;
  readonly saveGloballyCheckbox: Locator;
  readonly variableInitialValueInput: Locator;
  readonly variableCurrentValueInput: Locator;
  readonly variableNameInput: Locator;
  readonly variableTypeSelect: Locator;
  readonly variableEnabledToggle: Locator;

  constructor(
    readonly page: Page,
    private readonly host: PlayrunnerE2EHost,
  ) {
    this.dialog = page.getByRole('dialog', { name: 'Environment' });
    this.environmentSelect = this.dialog.locator('select').first();
    this.saveGloballyCheckbox = this.dialog.getByRole('checkbox', {
      name: 'Save globally',
    });
    this.variableNameInput = this.dialog.getByLabel('Variable 1 name');
    this.variableInitialValueInput = this.dialog.getByLabel(
      'Variable 1 initial value',
    );
    this.variableCurrentValueInput = page.getByTestId(
      'environment-node-variable-0-current',
    );
    this.variableTypeSelect = page.getByTestId(
      'environment-node-variable-0-type',
    );
    this.variableEnabledToggle = page.getByTestId(
      'environment-node-variable-0-enabled',
    );
  }

  integrationCard() {
    return this.page.getByTestId('integration-card-environment');
  }

  async openCatalog() {
    await this.host.gotoIntegrations();
  }

  async createNode() {
    await this.host.openNewWorkflow();
    await this.host.addNode('environment');
    await this.host.openNodeSettings('environment');
  }

  async close() {
    await this.host.closeNodeSettings();
  }

  async reopen() {
    await this.host.openNodeSettings('environment');
  }

  async reloadWorkflow() {
    await this.host.reloadWorkflow();
  }

  async saveWorkflow() {
    await this.host.saveWorkflow();
  }

  async runWorkflow() {
    return this.host.runWorkflowNode('environment');
  }
}

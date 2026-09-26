import { expect } from '@playwright/test';
import { EditorPom } from './EditorPom';

export class WorkflowGeometryPom extends EditorPom {
  async ready() {
    const retry = this.page.getByRole('button', {
      name: 'Retry runner startup',
    });
    await this.page.getByTitle('View JSON', { exact: true }).or(retry).waitFor();
    // A cold local Docker runner can finish starting after the API's first
    // health deadline. Use the real UI retry once before asserting readiness.
    if (await retry.isVisible()) await retry.click();
    await super.ready();
  }

  node(id: string) {
    return this.page.locator(`[data-node-id="${id}"]`);
  }

  async expectStandardGeometry(secondEnvironment = false) {
    await expect(this.node('api-playwright')).toHaveCSS('width', '128px');
    await expect(this.node('api-playwright')).toHaveCSS('height', '128px');
    await expect(this.node('api-environment')).toHaveCSS('height', '128px');
    const environmentWidth = await this.node('api-environment').evaluate(
      (element) => parseFloat(getComputedStyle(element).width),
    );
    expect(environmentWidth).toBeCloseTo(256 / Math.sqrt(3), 1);
    await expect(this.node('api-agent')).toHaveCSS('width', '360px');
    await expect(this.node('api-agent')).toHaveCSS('height', '128px');

    // A rendered connection must meet the actual sockets, not merely have
    // a valid SVG path somewhere else on the canvas.
    const path = this.page.locator(
      'g.guard-connection > path:not([stroke="transparent"])',
    );
    const sourceIds = secondEnvironment
      ? ['api-environment', 'api-release']
      : ['api-environment'];
    await expect(path).toHaveCount(sourceIds.length);
    for (const [index, sourceId] of sourceIds.entries()) {
      const endpoints = await path
        .nth(index)
        .evaluate((element: SVGPathElement) => {
          const matrix = element.getScreenCTM()!;
          const start = element.getPointAtLength(0).matrixTransform(matrix);
          const end = element
            .getPointAtLength(element.getTotalLength())
            .matrixTransform(matrix);
          return {
            start: { x: start.x, y: start.y },
            end: { x: end.x, y: end.y },
          };
        });
      const source = (await this.node(sourceId).boundingBox())!;
      const target = (await this.node('api-playwright').boundingBox())!;
      expect(endpoints.start.x).toBeCloseTo(source.x + source.width, 0);
      expect(endpoints.start.y).toBeCloseTo(source.y + source.height / 2, 0);
      expect(endpoints.end.x).toBeCloseTo(
        target.x - (10 * target.width) / 128,
        0,
      );
      expect(endpoints.end.y).toBeCloseTo(target.y + target.height / 2, 0);
    }
  }

  async expectAddedPlaywrightMatchesImported() {
    await this.addNode('playwright');
    const added = this.page.getByTestId('canvas-node-playwright').last();
    await expect(added).toHaveCSS('width', '128px');
    await expect(added).toHaveCSS('height', '128px');
    const originalBox = (await this.node('api-playwright').boundingBox())!;
    const addedBox = (await added.boundingBox())!;
    expect(addedBox.width).toBeCloseTo(originalBox.width, 1);
    expect(addedBox.height).toBeCloseTo(originalBox.height, 1);
  }
}

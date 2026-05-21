import type { Request, Response } from 'express';
import type { OutputProxyBackend } from './contracts';

export class NoopOutputProxyBackend implements OutputProxyBackend {
  async tryHandle(_req: Request, _res: Response): Promise<boolean> {
    return false;
  }
}

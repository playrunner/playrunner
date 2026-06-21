import { ChildProcess } from 'child_process';
import express from 'express';

interface GcpCredentials {
  accessToken: string;
  refreshToken: string;
  clientId: string;
  clientSecret: string;
  expiresAt?: number;
  selectedProject?: string;
}

export const state = {
  executionSseClients: [] as express.Response[],
  presenceSseClients: [] as express.Response[],
  runnerProcess: null as ChildProcess | null,
  gcpCredentials: {} as Record<string, GcpCredentials>,
  testCloudProviders: {} as Record<string, string>,
  testBucketNames: {} as Record<string, string>,
};

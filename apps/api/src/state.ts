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
  runnerProcess: null as ChildProcess | null,
  sseClients: [] as express.Response[],
  gcpCredentials: {} as Record<string, GcpCredentials>,
  testCloudProviders: {} as Record<string, string>,
  testBucketNames: {} as Record<string, string>,
};

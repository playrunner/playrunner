import type { IntegrationSdkHost } from '@playrunner/integration-sdk';
import { Button, Input, Select, Textarea } from '../components/ui';
import { Modal } from '../components/ui/Modal';
import { auth } from '../lib/auth';
import { DbAPI } from '../lib/db';

export const integrationSdkHost: IntegrationSdkHost = {
  auth,
  store: {
    getIntegration: DbAPI.getIntegration,
    saveIntegration: DbAPI.saveIntegration,
    deleteIntegration: DbAPI.deleteIntegration,
    getCloudCredential: DbAPI.getCloudCredential,
    saveCloudCredential: DbAPI.saveCloudCredential,
    deleteCloudCredential: DbAPI.deleteCloudCredential,
    getEnvironments: DbAPI.getEnvironments,
    saveEnvironment: DbAPI.saveEnvironment,
    deleteEnvironment: DbAPI.deleteEnvironment,
    saveSecret: DbAPI.saveSecret,
  },
  ui: {
    Button,
    Input,
    Modal,
    Select,
    Textarea,
  },
};

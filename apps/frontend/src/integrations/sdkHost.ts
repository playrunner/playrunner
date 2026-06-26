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
  },
  ui: {
    Button,
    Input,
    Modal,
    Select,
    Textarea,
  },
};

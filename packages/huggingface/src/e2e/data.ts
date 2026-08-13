import type { PlayrunnerE2EDataContext } from '@playrunner/integration-sdk/e2e';

export interface HuggingFaceE2EData {
  accessToken: string;
  input: string;
  model: string;
  parameters: string;
}

export function createHuggingFaceE2EData({
  runId,
}: PlayrunnerE2EDataContext): HuggingFaceE2EData {
  return {
    accessToken: `hf_e2e_${runId.replace(/[^a-zA-Z0-9]/g, '_')}`,
    input: `Classify this E2E input ${runId}`,
    model: 'playrunner/e2e-classifier',
    parameters: '{"top_k":3}',
  };
}

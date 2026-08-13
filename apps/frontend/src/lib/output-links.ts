import { auth } from './auth';

export async function openAuthenticatedOutput(url: string) {
  const outputWindow = window.open('about:blank', '_blank');
  if (!outputWindow) {
    return false;
  }

  outputWindow.opener = null;

  if (!(await auth.prepareOutputAccess())) {
    outputWindow.close();
    return false;
  }

  outputWindow.location.replace(url);
  return true;
}

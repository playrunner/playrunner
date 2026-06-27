const DEFAULT_DOCS_URL = 'https://docs.playrunner.dev';

export function getDocsUrl(path = '') {
  const baseUrl = (import.meta.env.VITE_DOCS_URL || DEFAULT_DOCS_URL)
    .trim()
    .replace(/\/+$/, '');
  const normalizedPath = path.trim().replace(/^\/+/, '');

  return normalizedPath ? `${baseUrl}/${normalizedPath}` : baseUrl;
}

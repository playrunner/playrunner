interface ImportMetaEnv {
  readonly VITE_SETUP_MODE?: string;
  readonly VITE_SETUP_SESSION_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

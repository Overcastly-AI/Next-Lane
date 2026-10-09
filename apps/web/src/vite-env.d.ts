/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Injected by vite `define` from the root package.json. */
declare const __APP_VERSION__: string;
/** Raw repo-root CHANGELOG.md text (empty when unavailable at build). */
declare const __APP_CHANGELOG__: string;

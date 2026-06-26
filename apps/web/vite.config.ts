import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig(() => {
  // Default to 5173 (the port the Docker images expose/map). An explicit
  // VITE_PORT can override it for bespoke local setups.
  const port = Number(process.env.VITE_PORT ?? 5173);
  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
        '@next-lane/shared': fileURLToPath(
          new URL('../../packages/shared/src/index.ts', import.meta.url),
        ),
      },
    },
    server: {
      port,
      host: true,
    },
  };
});

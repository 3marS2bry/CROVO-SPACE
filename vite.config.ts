import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // Disable HMR WebSocket to prevent connection failure errors in preview iframe
      hmr: false as const,
      ws: false as const,
      watch: null,
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/')) {
              return 'react-vendor';
            }
            if (id.includes('node_modules/lucide-react/')) {
              return 'icons';
            }
            if (id.includes('node_modules/canvas-confetti/')) {
              return 'effects';
            }
            return undefined;
          },
        },
      },
    },
  };
});

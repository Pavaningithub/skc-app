import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'fs'

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    // Baked into the bundle at build time — no runtime fetch needed
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_ENV__: JSON.stringify(process.env.VITE_APP_ENV ?? 'production'),
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Firebase SDK → its own chunk
          if (id.includes('node_modules/firebase')) return 'firebase';
          // React ecosystem → framework chunk
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) return 'react';
          // Other vendor libs
          if (id.includes('node_modules')) return 'vendor';
        },
      },
    },
  },
})

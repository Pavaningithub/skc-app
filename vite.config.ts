import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
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

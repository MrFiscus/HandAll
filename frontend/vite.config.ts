import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [
    // The React and Tailwind plugins are both required for Make, even if
    // Tailwind is not being actively used – do not remove them
    react(),
    tailwindcss(),
  ],
  server: {
    port: 3000,
    // If 3000 is taken, fail instead of picking the next port (3001 is the Node API — must not collide).
    strictPort: true,
    proxy: {
      '/api': {
        // Use 127.0.0.1 so the proxy matches the Node API bind and avoids IPv6 localhost races on Windows.
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
      '/agent-api': {
        target: 'http://127.0.0.1:8011',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/agent-api/, ''),
      },
    },
  },
  resolve: {
    alias: {
      // Alias @ to the src directory
      '@': path.resolve(__dirname, './app'),
    },
  },

  // File types to support raw imports. Never add .css, .tsx, or .ts files to this.
  assetsInclude: ['**/*.svg', '**/*.csv'],
})

import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

/**
 * `npm run demo:reset` / `deploy:demo` rewrite src/generated/*. Almost every module imports them, so Vite's hot update
 * re-runs a chain of modules (including the React context) under a page that is still using the old ones, and the open
 * page breaks ("useApp outside AppProvider"). A reset means a new chain, so a plain page reload is the correct behaviour.
 */
const reloadOnGeneratedChange = (): Plugin => ({
  name: 'sealstone-reload-on-generated-change',
  handleHotUpdate({ file, server }) {
    if (/[\\/]src[\\/]generated[\\/]/.test(file)) {
      server.ws.send({ type: 'full-reload' })
      return []
    }
  },
})

export default defineConfig({
  plugins: [react(), reloadOnGeneratedChange()],
  // Pre-bundle every dependency up front. Discovering one lazily (the app code-splits its pages) makes the dev server re-run its
  // optimiser and reload the page, which broke the first load after a demo reset.
  optimizeDeps: { include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-dev-runtime', 'ethers', 'zod'] },
  server: { port: 5173, strictPort: true, host: '127.0.0.1' },
})

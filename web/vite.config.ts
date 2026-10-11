import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'
import { defineConfig, normalizePath, type Plugin, type ViteDevServer } from 'vite'

/**
 * `npm run demo:reset` / `deploy:demo` rewrite src/generated/*. Almost every module imports them, so Vite's hot update would
 * re-run a chain of modules (including the React context) under a page that is still using the old ones, and the open page
 * breaks. A reset means a new chain, so a plain page reload is the correct behaviour.
 *
 * Timing matters: the file watcher can report the change seconds late (and twice, on Windows), which reloaded whatever page
 * had loaded in between. So the reset script TELLS the dev server (POST /__sealstone/reload): the reload happens at that
 * known moment, and the content is remembered so the watcher's later report of the same change is ignored.
 */
/**
 * Vite BUFFERS a full-reload that is sent while no browser is connected and replays it to the NEXT page that connects, which
 * made the first page opened after a reset reload itself mid-load. Only send when someone is actually there to receive it.
 */
const reloadOpenPages = (server: ViteDevServer) => {
  if (server.ws.clients.size > 0) server.ws.send({ type: 'full-reload' })
}

const reloadOnGeneratedChange = (): Plugin => {
  const last = new Map<string, string>()
  let generatedDir = ''
  const snapshot = () => {
    for (const name of fs.existsSync(generatedDir) ? fs.readdirSync(generatedDir) : []) {
      last.set(normalizePath(path.join(generatedDir, name)), fs.readFileSync(path.join(generatedDir, name), 'utf8'))
    }
  }
  return {
    name: 'sealstone-reload-on-generated-change',
    configureServer(server) {
      generatedDir = path.join(server.config.root, 'src', 'generated')
      snapshot()
      server.middlewares.use('/__sealstone/reload', (_req, res) => {
        snapshot()
        reloadOpenPages(server)
        res.statusCode = 204
        res.end()
      })
    },
    async handleHotUpdate({ file, server, read }) {
      if (!file.includes('/src/generated/')) return
      const content = await read()
      if (last.get(file) === content) return [] // already handled (the reset script told us), or a duplicate report
      last.set(file, content)
      reloadOpenPages(server)
      return []
    },
  }
}

export default defineConfig({
  plugins: [react(), reloadOnGeneratedChange()],
  // Pre-bundle every dependency up front. Discovering one lazily (the app code-splits its pages) makes the dev server re-run its
  // optimiser and reload the page, which broke the first load after a demo reset.
  optimizeDeps: { include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-dev-runtime', 'ethers', 'zod'] },
  server: { port: 5173, strictPort: true, host: '127.0.0.1' },
})

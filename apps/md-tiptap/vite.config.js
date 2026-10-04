import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import pkg from './package.json' with { type: 'json' }

export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  clearScreen: false,
  // MD Notepad(1420) · MDSyncNote 와 함께 띄울 수 있게 포트를 달리한다
  server: { port: 1430, strictPort: true },
  // React 는 한 벌만 (CLAUDE.md "dev 서버에서는 React 를 한 벌로")
  resolve: { dedupe: ['react', 'react-dom'] },
  optimizeDeps: { exclude: ['@md/editor-core', '@md/editor-tiptap', '@md/md-bridge'] },
})

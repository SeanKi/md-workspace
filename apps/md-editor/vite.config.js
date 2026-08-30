import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  // 워크스페이스 공유 패키지는 소스 그대로 컴파일한다
  optimizeDeps: { exclude: ['@md/editor-core'] },
})

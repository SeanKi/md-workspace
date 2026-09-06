import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  // 공유 패키지를 사전 번들에서 빼면 vite 가 그 안의 @lexical/react 를 따로 묶으면서
  // React 를 한 벌 더 끌어들인다 ("Invalid hook call" 로 dev 화면이 통째로 죽는다).
  // 반드시 한 벌만 쓰도록 못 박는다.
  resolve: { dedupe: ['react', 'react-dom'] },
  // 워크스페이스 공유 패키지는 소스 그대로 컴파일한다
  optimizeDeps: { exclude: ['@md/editor-core'] },
})

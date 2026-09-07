import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import pkg from './package.json' with { type: 'json' }

export default defineConfig({
  plugins: [react()],
  // 창 제목에 버전을 띄운다. 빌드한 그 버전이 그대로 박히므로 어긋날 일이 없다
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  clearScreen: false,
  server: { port: 1421, strictPort: true },
  // 공유 패키지를 사전 번들에서 빼면 vite 가 그 안의 @lexical/react 를 따로 묶으면서
  // React 를 한 벌 더 끌어들인다 ("Invalid hook call" 로 dev 화면이 통째로 죽는다).
  // 반드시 한 벌만 쓰도록 못 박는다.
  resolve: { dedupe: ['react', 'react-dom'] },
  // 워크스페이스 공유 패키지는 소스 그대로 컴파일한다
  optimizeDeps: { exclude: ['@md/editor-core'] },
})

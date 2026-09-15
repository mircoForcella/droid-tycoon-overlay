import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: 'src/main/index.ts',
        vite: { build: { outDir: 'dist/main', rollupOptions: { external: ['electron', 'onnxruntime-node'] } } }
      },
      {
        entry: 'src/preload/index.ts',
        vite: { build: { outDir: 'dist/preload' } }
      }
    ]),
    renderer()
  ],
  build: { outDir: 'dist/renderer' },
  // Relative paths so bundled card art loads under Electron file:// builds.
  base: './',
  server: { port: 5173 }
})
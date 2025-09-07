import { defineConfig } from 'vite'
import path from 'path'
import dts from 'vite-plugin-dts'

// https://vitejs.dev/config/
export default defineConfig({
  build: {
    lib: {
      entry: path.resolve(__dirname, 'lib/index.ts'),
      formats: ['es', 'cjs'],
      fileName: (format) => format === 'es' ? 'index.js' : 'index.cjs'
    },
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      external: [
        'ioredis',
        'fs',
        'path'
      ],
      output: {
        exports: 'named',
      }
    },
    minify: false
  },
  plugins: [
    dts({
      tsconfigPath: 'tsconfig.build.json',
      include: ['lib']
    })
  ]
})

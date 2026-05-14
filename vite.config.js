import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig({
  base: './', // Ensures relative paths work on GH Pages
  plugins: [
    basicSsl()
  ],
  server: {
    https: true,
    host: true // Optional: allows access from local network
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: 'index.html'
      }
    }
  }
});

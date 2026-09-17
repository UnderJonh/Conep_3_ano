import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const webAdapter = (file: string) => fileURLToPath(new URL(`./src/crossy/${file}.js`, import.meta.url));

export default defineConfig({
  plugins: [
    {
      name: 'crossy-expo-assets',
      enforce: 'pre',
      transform(code, id) {
        if (!id.replaceAll('\\', '/').includes('/Expo-Crossy-Road-master/src/')) return;
        let index = 0;
        const imports: string[] = [];
        const source = code.replace(/require\(["']([^"']+)["']\)/g, (_match, path: string) => {
          const name = `crossyAsset${index++}`;
          imports.push(`import ${name} from ${JSON.stringify(`${path}?url`)};`);
          return name;
        });
        return { code: `${imports.join('\n')}\n${source}`, map: null };
      },
    },
    react(),
  ],
  resolve: {
    alias: {
      'react-native': webAdapter('native'),
      'expo-asset': webAdapter('asset'),
      'expo-three': webAdapter('three'),
      'expo-audio': webAdapter('audio'),
      '@/components/GestureView': webAdapter('directions'),
    },
  },
  define: { 'process.env.EXPO_OS': JSON.stringify('web') },
  assetsInclude: ['**/*.obj'],
  envDir: '..',
  server: { port: 5173, strictPort: true },
});

import { defineConfig } from 'rolldown';
import { dts } from 'rolldown-plugin-dts';

export default defineConfig([
  {
    input: 'src/index.ts',
    platform: 'browser',
    plugins: [dts()],
    output: {
      dir: 'dist',
      format: 'esm',
      entryFileNames: '[name].js',
      minify: false,
      sourcemap: true,
    },
  },
  {
    input: 'src/index.ts',
    platform: 'browser',
    output: {
      file: 'dist/index.umd.min.js',
      format: 'umd',
      name: 'WchIsp',
      minify: true,
      sourcemap: true,
    },
  },
]);

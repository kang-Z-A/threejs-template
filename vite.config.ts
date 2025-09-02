import { defineConfig } from 'vite';
import glsl from 'vite-plugin-glsl';
import path from 'path';

const resolve = () => {
  return {
    "@": path.resolve(__dirname, "src"),
    "three/addons": path.resolve(__dirname, 'node_modules/three/examples/jsm'),
    "three/examples/jsm": path.resolve(__dirname, 'node_modules/three/examples/jsm'),
    'three': path.resolve(__dirname, 'node_modules/three/build/three.module.js'),
  }
}

export default defineConfig({
  plugins: [glsl()],
  resolve: {
    alias: resolve(),
    extensions: ['.mjs', '.js', '.ts', '.jsx', '.tsx', '.json', '.vue']
  },
  server:{
    port: 8080,
    open: true,
  }
}); 
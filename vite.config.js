import { defineConfig } from 'vite';
import mkcert from 'vite-plugin-mkcert';

// 用 base: './' 让 build 产物可以放任意路径（GitHub Pages / 静态托管均可）。
// dev 启用 https + 局域网监听，方便 X6 真机调试（getUserMedia 需要 secure context）。
export default defineConfig({
  base: './',
  plugins: [mkcert()],
  server: {
    host: true,
    https: true,
    port: 5173,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});

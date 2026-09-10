import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
      "/demo": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
});

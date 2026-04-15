import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/v1": {
        target: process.env.API_URL || "https://gamecards-api.servesys.workers.dev",
        changeOrigin: true,
      },
      "/agents": {
        target: process.env.API_URL || "https://gamecards-api.servesys.workers.dev",
        changeOrigin: true,
        ws: true,
      },
    },
  },
});

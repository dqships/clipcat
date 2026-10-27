import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Built files are loaded from the app:// protocol, so every URL is relative.
export default defineConfig({
  base: "./",
  plugins: [react()],
  server: { port: 5173, strictPort: true, fs: { allow: ["../.."] } },
  build: { outDir: "dist", emptyOutDir: true, target: "chrome140" },
  test: { environment: "jsdom" },
});

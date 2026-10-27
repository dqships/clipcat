import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Built files are loaded from the app:// protocol, so every URL is relative.
export default defineConfig({
  base: "./",
  plugins: [react()],
  server: { port: 5173, strictPort: true, fs: { allow: ["../.."] } },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "chrome140",
    // The face detector's page is its own entry, loaded in a hidden window.
    rollupOptions: { input: { main: "index.html", faces: "faces.html" } },
    // The model and the WebAssembly runtime stay files, never inlined.
    assetsInlineLimit: 0,
  },
  test: { environment: "jsdom" },
});

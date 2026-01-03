import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// For GitHub Pages deployments this is typically "/<repo-name>/".
// The deploy workflow sets VITE_BASE_PATH accordingly.
const base = process.env.VITE_BASE_PATH || "/";

export default defineConfig({
  base,
  plugins: [react()],
});



import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Lets the dashboard reuse the backend's phone/opt-out/template helpers.
  server: { fs: { allow: [".."] } },
});

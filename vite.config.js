import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    // The site is served as static files by Vercel and Netlify; both are
    // pointed at dist/ rather than the repo root now that there is a build.
    emptyOutDir: true,
  },
  server: {
    // `npm run dev` proxies /api to a locally running `vercel dev` so the
    // function can be exercised without deploying.
    proxy: { "/api": "http://localhost:3000" },
  },
});

import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * The production CSP in index.html has no 'unsafe-inline' in script-src, which
 * blocks the inline React-refresh preamble and HMR client the dev server
 * injects. Strip the tag while serving so dev works; builds keep it.
 */
function stripCspInDev(): Plugin {
  return {
    name: "strip-csp-in-dev",
    apply: "serve",
    transformIndexHtml(html) {
      return html.replace(
        /\s*<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?\/>/i,
        "",
      );
    },
  };
}

export default defineConfig({
  base: "/",
  plugins: [react(), tailwindcss(), stripCspInDev()],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            // React changes only when we upgrade it, while the app chunk
            // changes every deploy. Splitting it out means a returning visitor
            // re-downloads the app, not the runtime underneath it.
            {
              name: "react-vendor",
              test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/,
            },
          ],
        },
      },
    },
  },
});

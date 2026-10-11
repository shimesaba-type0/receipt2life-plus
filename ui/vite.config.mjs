import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import preact from "@preact/preset-vite";
import { defineConfig } from "vite";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  plugins: [
    preact(),
    {
      // dist を空にしても、gitで追跡する .gitkeep(Wrangler の assets.directory を存在させるため)は残す
      name: "keep-gitkeep",
      closeBundle() {
        fs.writeFileSync(path.join(root, "dist", ".gitkeep"), "");
      },
    },
  ],
  build: { outDir: path.join(root, "dist"), emptyOutDir: true, sourcemap: false },
  server: {
    // 開発時は、ローカルの Worker(wrangler dev)にAPIを中継する
    proxy: { "/api": "http://localhost:8787", "/export": "http://localhost:8787" },
  },
});

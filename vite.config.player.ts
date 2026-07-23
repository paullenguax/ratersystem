import { defineConfig } from 'vite'
import path from 'path'

// Builds the standalone "player shell" (Storyline Replacement) used both for
// in-app preview and as the base of an exported test bundle. Deliberately
// separate from vite.config.ts: it must never land in dist/, which is what
// .github/workflows/deploy.yml FTPs to the live site on every push. Instead
// its output goes straight into public/player-shell, which the main build
// picks up as ordinary static assets (fetched/opened by JS, never routed to).
//
// Filenames are fixed and unhashed (not content-hashed) so exportStoryline.ts
// can hardcode the file list when assembling a zip, instead of parsing a
// build manifest. Trade-off: no cache-busting on this rarely-changing shell.
export default defineConfig({
  root: path.resolve(__dirname, 'player-src'),
  base: './',
  build: {
    outDir: path.resolve(__dirname, 'public/player-shell'),
    emptyOutDir: true,
    // Emitted so exportStoryline.ts can discover the exact built file list
    // (including shared-chunk names, which can change between builds)
    // instead of hardcoding filenames.
    manifest: true,
    rollupOptions: {
      input: {
        examiner: path.resolve(__dirname, 'player-src/examiner.html'),
        candidate: path.resolve(__dirname, 'player-src/candidate.html'),
      },
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name]-chunk.js',
        // player.css is <link>-referenced from both HTML entries (not
        // imported from JS), so Rollup has no single natural entry name to
        // derive an asset filename from — pin it explicitly rather than
        // relying on [name], which produced a nondeterministic name tied to
        // an unrelated shared JS chunk.
        assetFileNames: assetInfo =>
          assetInfo.names?.some(n => n.endsWith('.css')) ? 'assets/player.css' : 'assets/[name][extname]',
      },
    },
  },
})

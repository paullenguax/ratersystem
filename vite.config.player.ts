import { defineConfig } from 'vite'
import path from 'path'

// Builds the standalone "player shell" (Storyline Replacement) used both for
// in-app preview and as the base of an exported test bundle. Deliberately
// separate from vite.config.ts: it must never land in dist/, which is what
// .github/workflows/deploy.yml FTPs to the live site on every push. Instead
// its output goes straight into public/player-shell, which the main build
// picks up as ordinary static assets (fetched/opened by JS, never routed to).
//
// Content-hashed filenames (examiner.html/candidate.html themselves stay
// stable — Vite doesn't hash HTML entry output — only their JS/CSS/asset
// references do). This used to be unhashed on the theory that
// exportStoryline.ts would need to hardcode filenames, but it's actually
// always discovered them dynamically via the manifest below, so hashing
// costs nothing there — and fixes a real problem: this shell now changes
// constantly during active development, and a fixed filename with no
// explicit cache-control header meant a browser could silently keep
// serving a stale cached copy indefinitely after a deploy, with a normal
// refresh not being enough to notice.
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
        practice: path.resolve(__dirname, 'player-src/practice.html'),
      },
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
})

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { execSync } from 'node:child_process'
import path from 'path'

// Short commit hash, so a deployed build can be matched to a commit at a
// glance (shown on the login screen — the SiteGround cache makes "did my
// push land?" otherwise unanswerable). Falls back to the CI-provided SHA,
// then 'dev' for a plain local build with no git.
const buildId = (() => {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch {
    return process.env.GITHUB_SHA?.slice(0, 7) || 'dev'
  }
})()

export default defineConfig({
  base: '/ratersystem/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __BUILD_ID__: JSON.stringify(buildId),
  },
})

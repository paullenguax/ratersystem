import type { StorylineTheme } from './types'

// Sets CSS custom properties on the root element for whichever theme knobs
// are actually configured — player.css reads each with its own built-in
// default (var(--x, <default>)), so an empty/partial theme just falls back
// cleanly rather than needing every field filled in.
export function applyTheme(theme: StorylineTheme) {
  const root = document.documentElement.style
  if (theme.logoHeight) root.setProperty('--logo-height', `${theme.logoHeight}px`)
  if (theme.accentColor) root.setProperty('--accent-color', theme.accentColor)
  if (theme.slideMaxWidth) root.setProperty('--slide-max-width', `${theme.slideMaxWidth}px`)
  if (theme.slideMinHeight) root.setProperty('--slide-min-height', `${theme.slideMinHeight}px`)
}

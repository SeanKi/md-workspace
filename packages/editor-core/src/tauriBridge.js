export const isTauri =
  typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__

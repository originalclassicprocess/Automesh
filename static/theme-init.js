// Non-sensitive display preference only; runs before paint under the page CSP.
try {
  const mode = localStorage.getItem('automesh-ui-theme-v1');
  if (mode === 'light' || mode === 'dark' || mode === 'system') document.documentElement.dataset.theme = mode;
} catch { /* CSS follows the system when preference storage is unavailable. */ }

// Applies the saved or system colour theme before first paint (kept external so CSP can forbid inline scripts).
try {
  var t = localStorage.getItem('cw-theme');
  if (t === 'dark' || (!t && matchMedia('(prefers-color-scheme: dark)').matches)) document.documentElement.classList.add('dark');
} catch (e) {}

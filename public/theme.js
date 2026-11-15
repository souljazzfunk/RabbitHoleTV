// runs before first paint (render-blocking on purpose) so a saved dark theme does not flash
try { const t = JSON.parse(localStorage.getItem("theme")); if (t === "light" || t === "dark") document.documentElement.dataset.theme = t; } catch {}

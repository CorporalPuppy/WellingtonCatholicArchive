// ===========================================================================
// Light and dark mode.
//
// By default the site follows the visitor's device setting. The half-circle button
// in the menu swaps between light and dark, and the choice is remembered
// in this browser (localStorage).
// ===========================================================================

function applySavedTheme() {
  let saved = null;
  try {
    saved = localStorage.getItem("theme"); // "light", "dark" or nothing
  } catch (error) {
    // Some private browsing modes block localStorage. That's fine.
  }
  if (saved === "light" || saved === "dark") {
    document.documentElement.dataset.theme = saved;
  }
}

function toggleTheme() {
  const root = document.documentElement;
  // What are we showing now? (A saved choice, or else the device setting.)
  let current = root.dataset.theme;
  if (current !== "light" && current !== "dark") {
    current = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  const next = current === "dark" ? "light" : "dark";
  root.dataset.theme = next;
  try {
    localStorage.setItem("theme", next);
  } catch (error) {
    // Can't remember it; the switch still works for this page.
  }
}

applySavedTheme();

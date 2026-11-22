export function setupTheme() {
  const topbar = document.querySelector(".topbar");
  const themeButton = document.querySelector("#theme-toggle");
  const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");
  let theme;
  try {
    theme = localStorage.getItem("pck-theme");
  } catch {}

  function applyTheme() {
    const dark = theme ? theme === "dark" : colorScheme.matches;
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    themeButton.setAttribute("aria-pressed", String(dark));
  }
  themeButton.addEventListener("click", () => {
    theme =
      document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    try {
      localStorage.setItem("pck-theme", theme);
    } catch {}
    applyTheme();
  });
  colorScheme.addEventListener("change", applyTheme);
  applyTheme();

  function updateTopbar() {
    topbar.classList.toggle("is-scrolled", window.scrollY > 12);
  }
  window.addEventListener("scroll", updateTopbar, { passive: true });
  updateTopbar();
}

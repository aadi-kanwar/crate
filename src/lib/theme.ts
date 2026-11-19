/**
 * Light / dark mode. "system" (the default) follows the phone's or
 * computer's setting; "light" and "dark" are the person's own choice, kept
 * in this browser only. The resolved theme is <html data-theme="...">,
 * which globals.css reads.
 */
export type ThemeChoice = "system" | "light" | "dark";

export const THEME_STORAGE_KEY = "theme";

/**
 * Runs in <head> before the page paints (so there's no flash of the wrong
 * theme), and keeps following the device while the choice is "system".
 */
export const THEME_SCRIPT = `(function(){var m=window.matchMedia("(prefers-color-scheme: dark)");function c(){try{return localStorage.getItem("theme")}catch(e){return null}}function a(){var p=c();document.documentElement.dataset.theme=p==="dark"||(p!=="light"&&m.matches)?"dark":"light"}a();m.addEventListener("change",a);window.addEventListener("storage",a)})();`;

export function readThemeChoice(): ThemeChoice {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

export function applyThemeChoice(choice: ThemeChoice) {
  try {
    if (choice === "system") localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    // Private mode or blocked storage: the choice lasts until the page closes.
  }
  const dark =
    choice === "dark" ||
    (choice === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  window.dispatchEvent(new Event(THEME_EVENT));
}

const THEME_EVENT = "themechoicechange";

/** For useSyncExternalStore: tells React when the choice changes (here or in another tab). */
export function subscribeToThemeChoice(onChange: () => void) {
  window.addEventListener(THEME_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(THEME_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

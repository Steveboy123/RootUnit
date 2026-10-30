/**
 * Copy text to the clipboard. Uses the async Clipboard API where the browser allows it (secure contexts only —
 * a head unit opened by its LAN address over plain http is not one), else a hidden textarea + execCommand.
 * Resolves false when neither works; the caller then tells the user to select the text by hand.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permission denied or not a secure context — try the fallback.
  }
  return legacyCopy(text);
}

function legacyCopy(text: string): boolean {
  if (typeof document === 'undefined' || !document.body) return false;
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.setAttribute('aria-hidden', 'true');
  // Off-screen but still selectable; fixed so adding it never scrolls the page.
  area.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0;user-select:text;-webkit-user-select:text';
  document.body.appendChild(area);
  try {
    area.focus();
    area.select();
    area.setSelectionRange(0, text.length);
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    area.remove();
  }
}

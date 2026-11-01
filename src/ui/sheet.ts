/**
 * The head of a dialog or sheet (title and close button) stays at the top while the rest scrolls. Its background is
 * only drawn once the dialog is scrolled, so a dialog at rest is exactly what it always was.
 */
export function initSheetScroll(): void {
  for (const dlg of document.querySelectorAll<HTMLElement>('.cdlg')) {
    const sync = (): void => void dlg.classList.toggle('is-scrolled', dlg.scrollTop > 0);
    dlg.addEventListener('scroll', sync, { passive: true });
    // Shown again after being hidden: the scroll position is back to the top without a scroll event.
    new ResizeObserver(sync).observe(dlg);
  }
}

/** On a phone the harmony select has a fixed width. A wide font (Linux, Windows, Android) can make the longest name wider than that: the select then tightens its spacing. Where the name fits, nothing changes. */
export function initHarmonyFit(select: HTMLSelectElement): void {
  const ctx = document.createElement('canvas').getContext('2d');
  if (ctx === null) return;
  const fit = (): void => {
    select.classList.remove('is-tight');
    const cs = getComputedStyle(select);
    ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const room = select.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    let longest = 0;
    for (const option of select.options) longest = Math.max(longest, ctx.measureText(option.text).width);
    if (longest > room) select.classList.add('is-tight');
  };
  fit();
  window.addEventListener('resize', fit);
  document.fonts.addEventListener('loadingdone', fit);
}

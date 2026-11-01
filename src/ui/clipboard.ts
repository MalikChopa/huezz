export type CopyPath = 'clipboard' | 'execCommand' | 'manual';

export type CopyEnv = {
  isSecure: boolean;
  writeText?: (text: string) => Promise<void>;
  /** Copies `text` through a hidden field; true if the browser accepted it. */
  execCopy?: (text: string) => boolean;
};

/** Clipboard API when the page is a secure context, else hidden field + execCommand, else 'manual' (the caller shows a selected field). */
export async function copyText(text: string, env: CopyEnv): Promise<CopyPath> {
  if (env.isSecure && env.writeText) {
    try {
      await env.writeText(text);
      return 'clipboard';
    } catch {
      /* permission refused: next path */
    }
  }
  if (env.execCopy) {
    try {
      if (env.execCopy(text)) return 'execCommand';
    } catch {
      /* next path */
    }
  }
  return 'manual';
}

export function browserEnv(): CopyEnv {
  return {
    isSecure: window.isSecureContext,
    ...(navigator.clipboard ? { writeText: (t: string) => navigator.clipboard.writeText(t) } : {}),
    execCopy(text) {
      const previous = document.activeElement;
      const area = document.createElement('textarea');
      area.className = 'copy-sink';
      area.value = text;
      area.setAttribute('readonly', '');
      area.setAttribute('aria-hidden', 'true');
      area.tabIndex = -1;
      document.body.append(area);
      area.select();
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } finally {
        area.remove();
        if (previous instanceof HTMLElement) previous.focus();
      }
      return ok;
    },
  };
}

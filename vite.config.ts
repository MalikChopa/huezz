import { createHash } from 'node:crypto';
import { defineConfig, type Plugin } from 'vite';

const sha256 = (text: string) => `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;

function inlineCsp(): Plugin {
  return {
    name: 'huezz-inline-csp',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const htmlFile = bundle['index.html'];
      if (htmlFile?.type !== 'asset') throw new Error('huezz-inline-csp: index.html introuvable');
      let js = '';
      let css = '';
      for (const [name, file] of Object.entries(bundle)) {
        if (file.type === 'chunk') js += file.code;
        else if (name.endsWith('.css')) css += String(file.source);
        else continue;
        delete bundle[name];
      }
      js = js.replaceAll('</script', '<\\/script');
      css = css.replaceAll('</style', '<\\/style');
      const csp = [
        "default-src 'none'",
        `script-src ${sha256(js)}`,
        `style-src ${sha256(css)}`,
        'img-src data: blob:',
        "connect-src 'none'",
        "form-action 'none'",
        "base-uri 'none'",
      ].join('; ');
      const html = String(htmlFile.source)
        .replace(/<script\b[^>]*\bsrc=[^>]*><\/script>\s*/g, '')
        .replace(/<link\b[^>]*\b(?:rel="modulepreload"|rel="stylesheet")[^>]*>\s*/g, '')
        .replace(/<head>/, () => `<head>\n<meta http-equiv="Content-Security-Policy" content="${csp}">`)
        .replace('</head>', () => `<style>${css}</style>\n</head>`)
        .replace('</body>', () => `<script type="module">${js}</script>\n</body>`);
      htmlFile.source = html;
    },
  };
}

export default defineConfig({
  plugins: [inlineCsp()],
  build: {
    modulePreload: false,
    cssCodeSplit: false,
    assetsInlineLimit: 0,
    rolldownOptions: { output: { codeSplitting: false } },
  },
});

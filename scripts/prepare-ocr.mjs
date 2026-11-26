import { cp, mkdir, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const modules = join(root, 'node_modules');
const destination = join(root, 'dist/vendor');
await mkdir(destination, { recursive: true });

await cp(join(modules, 'tesseract.js/dist'), join(destination, 'tesseract'), {
  recursive: true,
  filter: source => !source.endsWith('.map')
});
await cp(join(modules, 'tesseract.js/LICENSE.md'), join(destination, 'tesseract/LICENSE.md'));

const core = join(modules, 'tesseract.js-core');
await mkdir(join(destination, 'core'), { recursive: true });
for (const file of await readdir(core)) {
  if (file.endsWith('.wasm.js') || file.endsWith('.wasm') || file === 'LICENSE') {
    await cp(join(core, file), join(destination, 'core', file));
  }
}
await cp(join(modules, '@tesseract.js-data/eng/4.0.0'), join(destination, 'lang'), { recursive: true });
await cp(join(modules, '@tesseract.js-data/eng/README.md'), join(destination, 'lang/README.md'));
await cp(join(modules, '@tesseract.js-data/eng/package.json'), join(destination, 'lang/package.json'));
console.log('Lector de imágenes preparado en dist/vendor.');

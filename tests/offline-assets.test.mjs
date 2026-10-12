import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const worker = await readFile(new URL('sw.js', root), 'utf8');
const files = vm.runInNewContext(`${worker}\nFILES`, {
  URL, self: { registration: { scope: 'https://example.test/marine/' }, addEventListener() {} }
});
const relativeFiles = files.map(url => url.replace('https://example.test/marine/', ''));

test('every precached file exists and all application modules are included', async () => {
  for (const file of relativeFiles) await access(new URL(file, root));
  for (const file of relativeFiles.filter(file => file.startsWith('js/'))) {
    const source = await readFile(new URL(file, root), 'utf8');
    for (const match of source.matchAll(/from ['"]([^'"]+)['"]/g)) {
      const dependency = new URL(match[1], `https://example.test/marine/${file}`);
      assert.equal(dependency.origin, 'https://example.test');
      dependency.search = '';
      assert.ok(files.includes(dependency.href), `Missing dependency: ${dependency.href}`);
    }
  }
});

test('manifest is scoped relatively and required installation icons have valid dimensions', async () => {
  const manifest = JSON.parse(await readFile(new URL('manifest.webmanifest', root), 'utf8'));
  assert.equal(manifest.scope, './');
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.display, 'standalone');
  for (const size of [192, 512]) {
    const icon = manifest.icons.find(icon => icon.sizes === `${size}x${size}`);
    assert.ok(icon);
    const png = await readFile(new URL(icon.src, root));
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
    assert.ok(relativeFiles.includes(icon.src.replace('./', '')));
  }
});

test('vendored MapLibre runtime matches the locked package, including worker and license', async () => {
  for (const file of ['maplibre-gl.mjs', 'maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs', 'maplibre-gl.css', 'LICENSE.txt']) {
    const packagePath = file === 'LICENSE.txt' ? file : `dist/${file}`;
    assert.deepEqual(await readFile(new URL(`vendor/maplibre-gl/${file}`, root)),
      await readFile(new URL(`node_modules/maplibre-gl/${packagePath}`, root)));
  }
});

'use strict';

const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const root = path.resolve(__dirname, '..');
const outputDir = path.join(root, 'public', 'dist');

const assets = [
  { source: 'public/js/project.js', output: 'project.min.js', loader: 'js' },
  { source: 'public/js/project-unified.js', output: 'project-unified.min.js', loader: 'js' },
  { source: 'public/css/theme.css', output: 'theme.min.css', loader: 'css' },
  { source: 'public/css/project-unified.css', output: 'project-unified.min.css', loader: 'css' }
];

async function buildAsset(asset) {
  const sourcePath = path.join(root, asset.source);
  const outputPath = path.join(outputDir, asset.output);
  const source = fs.readFileSync(sourcePath, 'utf8');
  const result = await esbuild.transform(source, {
    loader: asset.loader,
    minify: true,
    target: asset.loader === 'js' ? 'es2022' : undefined,
    charset: 'utf8',
    legalComments: 'none',
    sourcemap: false
  });
  fs.writeFileSync(outputPath, result.code);
  return {
    source: asset.source,
    output: path.relative(root, outputPath),
    before: Buffer.byteLength(source),
    after: Buffer.byteLength(result.code)
  };
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const results = await Promise.all(assets.map(buildAsset));
  results.forEach(item => {
    const saved = item.before ? Math.round((1 - item.after / item.before) * 100) : 0;
    console.log(`[build:web] ${item.source} -> ${item.output} (${saved}% menos)`);
  });
}

main().catch(error => {
  console.error('[build:web] Error:', error);
  process.exitCode = 1;
});

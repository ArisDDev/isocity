// Genera IsoCity-standalone.html: un único archivo con CSS y JS incrustados.
// Uso: node build.js
const fs = require('fs'), path = require('path');
const root = __dirname;
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
html = html.replace(/<link rel="manifest"[^>]*>\s*/, '');
html = html.replace(/<link rel="stylesheet" href="(css\/[^"]+)">/g, (_, f) => `<style>\n${fs.readFileSync(path.join(root, f), 'utf8')}\n</style>`);
html = html.replace(/<script src="(js\/[^"]+)"><\/script>/g, (_, f) => `<script>\n${fs.readFileSync(path.join(root, f), 'utf8').replace(/<\/script>/g, '<\\/script>')}\n</script>`);
fs.writeFileSync(path.join(root, 'IsoCity-standalone.html'), html);
console.log('IsoCity-standalone.html', (html.length / 1024).toFixed(0) + ' KB');

const fs = require('fs'), path = require('path'), acorn = require('acorn'), scope = require('eslint-scope');
const root = path.resolve(__dirname, '..');
function collect(dir) { return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(e => e.isDirectory() ? collect(path.posix.join(dir, e.name)) : e.name.endsWith('.js') ? [path.posix.join(dir, e.name)] : []); }
const files = ['service-worker.js', ...collect('js')];
const resolveImport = (file, specifier) => path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier)); const modules = {}, graph = {}; let failures = 0;
const globals = new Set(['location', 'history', 'HTMLMediaElement', 'jsQR', 'QRCode', 'window', 'document', 'navigator', 'localStorage', 'console', 'URL', 'URLSearchParams', 'fetch', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'Blob', 'File', 'FileReader', 'FormData', 'AbortController', 'DOMException', 'Response', 'Request', 'Headers', 'TextEncoder', 'TextDecoder', 'Uint8Array', 'ArrayBuffer', 'DataView', 'indexedDB', 'caches', 'self', 'globalThis', 'crypto', 'atob', 'btoa', 'performance', 'Image', 'Audio', 'MediaMetadata', 'BarcodeDetector', 'CompressionStream', 'DecompressionStream', ...Object.getOwnPropertyNames(globalThis)]);
function error(s) { console.log('ERROR', s); failures++; }
for (const file of files) {
    const text = fs.readFileSync(path.join(root, file), 'utf8'); const ast = acorn.parse(text, { ecmaVersion: 'latest', sourceType: 'module', ranges: true }); const sm = scope.analyze(ast, { ecmaVersion: 2024, sourceType: 'module' }); const ms = sm.scopes.find(s => s.type === 'module'); const exports = new Set(), imports = []; for (const n of ast.body) { if (n.type === 'ExportNamedDeclaration') { if (n.declaration?.id) exports.add(n.declaration.id.name); for (const d of n.declaration?.declarations || []) exports.add(d.id.name); for (const s of n.specifiers || []) exports.add(s.exported.name); } if (n.type === 'ImportDeclaration') imports.push(n); } modules[file] = { exports, imports }; graph[file] = imports.map(n => resolveImport(file, n.source.value));
    for (const r of sm.globalScope.through) if (!globals.has(r.identifier.name)) error(`${file}: unresolved ${r.identifier.name}`);
    for (const v of ms.variables) if (v.defs[0]?.type === 'ImportBinding' && !v.references.length) error(`unused import ${file}: ${v.name}`);
}
for (const [file, m] of Object.entries(modules)) for (const n of m.imports) { const target = resolveImport(file, n.source.value); if (!modules[target]) { error(`${file}: missing ${target}`); continue; } for (const s of n.specifiers) if (!modules[target].exports.has(s.imported?.name)) error(`${file}: missing export ${s.imported?.name} from ${target}`); }
const done = new Set(); function visit(f, stack = []) { if (stack.includes(f)) { error('cycle ' + [...stack, f].join(' -> ')); return; } if (done.has(f)) return; for (const d of graph[f] || []) visit(d, [...stack, f]); done.add(f); } files.forEach(f => visit(f));

const { spawnSync } = require('child_process');
function syntax(dir) { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { if (['node_modules', '.git'].includes(entry.name)) continue; const f = path.join(dir, entry.name); if (entry.isDirectory()) syntax(f); else if (/\.(c?js)$/.test(f)) { const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' }); if (r.status !== 0) error(r.stderr); } } } syntax(root);
const sw = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');
const swAst = acorn.parse(sw, { ecmaVersion: 'latest' }); const shell = swAst.body.flatMap(n => n.declarations || []).find(n => n.id.name === 'SHELL_ASSETS').init.elements.map(n => n.value);
for (const asset of shell) { const f = asset.split('?')[0]; if (!fs.existsSync(path.join(root, f))) error('missing precache asset ' + asset); }
for (const f of files) if (f !== 'service-worker.js' && !shell.includes('./' + f)) error('module not precached: ' + f);
for (const f of ['vendor/jsQR.js', 'vendor/qrcode.min.js']) if (!shell.includes('./' + f)) error('vendor not precached: ' + f);
const html =
    fs.readFileSync(
        path.join(
            root,
            'index.html'
        ),
        'utf8'
    );


/*
 * Service Worker 必须有统一的 APP_VERSION。
 */
const appVersionMatch =
    sw.match(
        /const\s+APP_VERSION\s*=\s*['"]([^'"]+)['"]/
    );


if (
    !appVersionMatch
) {

    error(
        'service-worker.js: missing APP_VERSION'
    );

}


/*
 * CACHE_NAME 必须由 APP_VERSION 生成。
 */
if (
    !sw.includes(
        'gama-music-shell-v${APP_VERSION}'
    )
) {

    error(
        'service-worker.js: CACHE_NAME must use APP_VERSION'
    );

}


/*
 * app.js 现在不再手动添加 ?v=xx。
 *
 * Service Worker 自己负责版本更新。
 */
if (
    !html.includes(
        'src="./js/app.js"'
    ) ||
    !html.includes(
        'type="module"'
    )
) {

    error(
        'index.html: missing module entry ./js/app.js'
    );

}


/*
 * 防止以后不小心又写回：
 * app.js?v=80
 */
if (
    /src=["']\.\/js\/app\.js\?v=/i
        .test(
            html
        )
) {

    error(
        'index.html: app.js should not use manual ?v= cache version'
    );

}


/*
 * 新版更新提示 UI 必须存在。
 */
for (
    const id
    of [
        'pwaUpdateBanner',
        'pwaUpdateVersion',
        'pwaUpdateButton'
    ]
) {

    if (
        !html.includes(
            `id="${id}"`
        )
    ) {

        error(
            `index.html: missing #${id}`
        );

    }

}


console.log(
    `Checked ${files.length} modules; ` +
    `${failures} failures`
);


process.exitCode =
    failures
        ? 1
        : 0;

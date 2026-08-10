// ¿Cuánto cuelga una búsqueda a la que el servidor contesta con un Retry-After largo?
const vm = require("vm"), fs = require("fs"), path = require("path");
const src = fs.readFileSync(path.join(__dirname, "../../src/scrape.js"), "utf8");
const load = (fetchFake) => {
  const esperas = []; let calls = 0;
  const sandbox = { module: { exports: {} }, require: { main: null }, process: { argv: [] }, console,
    fetch: (u, i) => (calls++, fetchFake(u, i)),
    setTimeout: (cb, ms) => (esperas.push(ms), cb(), 0), clearTimeout: () => {},
    Math, Date, JSON, URL, URLSearchParams, Promise, Error, AbortController };
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  vm.createContext(sandbox); vm.runInContext(src, sandbox, { filename: "scrape.js" });
  return { api: sandbox.module.exports || sandbox.Rebusca, esperas, calls: () => calls };
};
const resp = (status, body, headers = {}) => ({ ok: status >= 200 && status < 300, status,
  headers: { get: (k) => headers[k.toLowerCase()] ?? null }, json: async () => body });

for (const ra of ["30", "600", "3600"]) {
  const { api, esperas } = load(async () => resp(429, {}, { "retry-after": ra }));
  api.scrape({ keywords: "ford OR sofa OR mesa" }).catch(() => {}).then(() => {
    const total = esperas.reduce((a, b) => a + b, 0);
    console.log(`Retry-After: ${ra}s  ->  ${esperas.length} esperas, ${(total / 60000).toFixed(1)} min colgado`);
  });
}

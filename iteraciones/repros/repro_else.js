// repro_else.js — ¿el "else idb.set(csvIndex)" de cacheCsv importa, o el riesgo ya existe sin él?
// node src/repro_else.js
"use strict";
const vm = require("vm");
const fs = require("fs");
const path = require("path");
const { boot } = require("../../src/test_app.js");

const FIELDS = require("../../src/scrape.js").FIELDS;
const row = (o) => FIELDS.map((f) => (f in o ? String(o[f]) : "")).join(",");
const CSV = [FIELDS.join(","),
  row({ id: "a1", titulo: "Ford Focus", precio: "1000", categoria: "Coches", ciudad: "Jaen", km: "3", dias: "1", reservado: "False", envio: "False", url: "https://w/a1", vendedor: "Ana", descripcion: "buen estado" }),
].join("\r\n") + "\r\n";

const flush = () => new Promise((r) => setImmediate(r));
const ev = (b, code) => vm.runInContext(code, b.sandbox);

async function main() {
  const mem = new Map();
  mem.set("csv:ford.csv", "id,titulo,precio\r\nz1,Ford del ocupante anterior,300\r\n");
  const opts = { csv: CSV, timers: true, idbMem: mem, idbFalla: "commit" };
  const b = await boot({ wp_cacheajena: "1" }, opts);
  await flush(); await flush();
  console.log("A) marca tras arranque:", b.store.wp_cacheajena);

  opts.idbFalla = "commit"; opts.idbFallaClave = "csv:"; // el índice entra, el texto no
  b.q("#kw").value = "ford";
  await b.q("#scrape").click();
  await flush(); await flush();
  console.log("B) marca tras scrapear (texto falla):", b.store.wp_cacheajena);
  console.log("C) csvIndex en memoria:", JSON.stringify(ev(b, "csvIndex")));

  // MISMA sesión, SIN recargar: se reabre "ford.csv" (loadQuery, como desde el gestor de búsquedas)
  await ev(b, "loadQuery('ford.csv')");
  await flush(); await flush();
  console.log("D) data tras reabrir en la MISMA sesión:", JSON.stringify(ev(b, "data")));

  // Ahora sí: reload completo (boot2) sobre el mismo almacén, ya sano
  opts.idbFalla = undefined; opts.idbFallaClave = undefined;
  const b2 = await boot({ ...b.store }, { csv: CSV, timers: true, idbMem: mem });
  await flush(); await flush();
  console.log("E) tras reload, csvIndex:", JSON.stringify(ev(b2, "csvIndex")));
  console.log("F) tras reload, marca:", b2.store.wp_cacheajena);
  console.log("G) tras reload, ¿sigue 'csv:ford.csv' en disco?", mem.has("csv:ford.csv") ? JSON.stringify(mem.get("csv:ford.csv")) : "(borrado)");
}
main().catch((e) => { console.error(e); process.exit(1); });

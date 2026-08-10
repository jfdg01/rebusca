# Iteración 34 — la copia de seguridad que no se medía entera

Zona: `src/app.js:2308-2418` — copia de seguridad, exportar y restaurar.
Elegida por daño al usuario: aquí no hay cuentas ni backend. Meses de triaje viven solo en el
almacén de este navegador, y este fichero es la única salida.

## F1 — Investigar

23 mutantes sobre la zona, cada veredicto por el código de salida de `./check.sh`.
**17 mueren, 6 VIVEN.**

| mutante | veredicto |
| --- | --- |
| `backupKeys`: se lleva claves ajenas | VIVE |
| `backupKeys`: se lleva los caches | VIVE |
| `BACKUP_SKIP`: pierde la marca de cache ajeno | VIVE |
| `backupJSON`: se lleva filas con la lectura rota | muere |
| `backupJSON`: nunca se lleva las filas | muere |
| export: no avisa de la lectura rota | muere |
| export: el fichero pierde la fecha | VIVE |
| import: acepta cualquier json | muere |
| import: escribe claves ajenas | muere |
| import: borra antes de escribir | VIVE |
| import: borra lo que acaba de escribir | muere |
| import: filas `{}` pisa las buenas | muere |
| import: no mira si IndexedDB aceptó | muere |
| import: no espera a IndexedDB | muere |
| import: no marca el cache ajeno | muere |
| import: no vacía antes de reponer | muere |
| import: no repone lo previo | muere |
| import: se traga el error | muere |
| import: no recarga | muere |
| import: la foto solo cubre las nuevas | muere |
| import: culpa al fichero de todo | muere |
| import: culpa al navegador de todo | muere |
| import: repone también los nulos | VIVE |

### Hallazgo A — el check de los caches se comparaba con un almacén que no los tiene

`test_buttons.js:1115` dice:

```js
ok(!("wp_rows" in datos) && !("wp_csv" in datos), "la copia se lleva los caches de resultados");
```

`wp_rows` y `wp_csv` son claves del modelo viejo. En el arnés no las escribe nadie, así que el
check afirma que no está lo que nunca estuvo. Borrar `BACKUP_SKIP` entero sale verde.

Daño: la copia se lleva el cache de CSVs (pesa, y se regenera solo) y la marca `wp_cacheajena`.
Restaurar esa copia pone la marca en el navegador de destino, que tira su propio cache de anuncios
sin motivo.

Es la misma forma que la iteración 33: un check que no puede distinguir.

### Hallazgo B — el filtro `wp_` de la copia no se mide

`backupKeys` recorre TODO el almacén y se queda con las `wp_*`. Sin ese filtro la copia se lleva
cualquier otra clave del dominio. El fichero es lo que el usuario manda por correo o guarda en la
nube: lo que entra ahí sale del navegador.

### Hallazgo C — «escribe antes de borrar» no lo mide nadie

`src/app.js:2357` documenta el orden y por qué existe. El bloque 42 de la suite fue escrito para
esto, pero **la vuelta atrás lo tapa**: con el orden invertido la cuota revienta igual, el `catch`
repone y los tres `ok` siguen verdes.

El orden sigue mandando. La vuelta atrás vive en un `catch`, y hay un fallo que no pasa por ningún
`catch`: el navegador mata la pestaña a media escritura. Safari en iOS lo hace. Con el borrado ya
hecho, el usuario abre la app y no tiene nada.

### Hallazgo D — el nombre del fichero que se baja no se mide

`a.download = "rebusca-" + fecha + ".json"`. Sin la fecha, dos copias del mismo navegador se
llaman igual y la segunda pisa a la primera en la carpeta de descargas.

### Hallazgo E — la guarda `if (v !== null)` de la vuelta atrás no se mide

La foto `previo` guarda `null` para una clave que no existía. Reponer sin la guarda llama a
`localStorage.setItem(k, null)`, que escribe el texto `"null"`. Esa clave queda inventada tras una
restauración fallida, y `hydrateEstado` la lee.

## F2 — Documentar (el contrato)

**Producción no se toca.** Los 17 mutantes que mueren dicen que la lógica está bien. Lo que falta
es medirla. Se añaden checks, y cada uno tiene que matar a su mutante.

1. Bloque 38: sembrar `wp_rows`, `wp_csv`, `wp_cacheajena` y una clave ajena EN el almacén antes
   de exportar, y comprobar que la copia no se los lleva. Mata A y B.
2. Bloque 38: capturar el `<a>` de la descarga y comprobar el nombre con la fecha. Mata D.
3. Bloque 42, caso nuevo: enganchar `setItem` para que reviente en la segunda clave de la copia y
   mirar el almacén EN ESE INSTANTE. Lo viejo tiene que seguir ahí. Mata C.
   La misma copia trae una clave que no existía antes: tras la vuelta atrás no puede existir.
   Mata E.

No se añade ninguna lista escrita a mano (regla de la iteración 31). Los nombres que se siembran
son los tres de `BACKUP_SKIP`, y se leen del propio `BACKUP_SKIP` del módulo.

## F3 — Implementar

`src/test_buttons.js` únicamente.

- Bloque 38: el almacén de partida se siembra con los tres nombres de `BACKUP_SKIP` (leídos del
  módulo, no escritos a mano) más `otra_app_token`. La copia no puede traer ninguno.
- Bloque 38: `document.createElement` envuelto para pillar el `<a>`; el nombre tiene que ser
  `rebusca-AAAA-MM-DD.json`.
- Bloque 42: caso `b8`. `setItem` revienta al llegar a `wp_zzz_futura` (una clave de una versión
  posterior, que la copia arrastra igual). En el instante del fallo se fotografía el almacén.

## F4 — Probar

Los siete checks: VERDE. 433 comprobaciones (antes 426).
Los 6 mutantes vivos, otra vez: **los 6 mueren.**

Y cada uno por SU aserción, no por otra (regla de la iteración 24). El primer intento no cumplía
eso: el mutante de los nulos moría con el mensaje del orden.

## F5 — Review adversaria

### Lo que encontró la review de mi propio check

El gancho de `setItem` del caso `b8` era reentrante. La vuelta atrás escribe otra vez la misma
clave, así que el gancho saltaba dos veces y la segunda machacaba la foto con el almacén de
DESPUÉS del borrado de la vuelta atrás. Con eso, el mutante de los nulos moría por el mensaje del
orden, que es un motivo que no es el suyo. El gancho se arma una sola vez. Ahora:

```
borra antes de escribir  -> FAIL: en mitad de la restauración el triaje viejo ya estaba borrado
repone también los nulos -> FAIL: la vuelta atrás dejó inventada una clave: "null"
```

### Lo que este trabajo NO prueba

El caso `b8` no reproduce la muerte de la pestaña. Aquí no hay navegador que matar. Lo que mide es
el contenido del almacén EN EL INSTANTE del fallo, que es el observable que el orden controla.
Que ese instante importe depende de que exista un fallo sin `catch`, y eso es un argumento, no una
medida.

### Lo que se decidió NO hacer

Invertir el orden. Con la vuelta atrás puesta, escribir después de borrar haría caber más
restauraciones: el pico de ocupación baja de `viejo + nuevo` a `max(viejo, nuevo)`. Se queda como
está por el fallo sin `catch` de arriba. Queda escrito aquí para que la próxima iteración no lo
redescubra como si fuera nuevo.

### Regla que se lleva esta iteración

**Un gancho que el propio código bajo prueba vuelve a llamar mide dos cosas y reporta una.**
Ármalo una vez, o la foto es de otro momento.

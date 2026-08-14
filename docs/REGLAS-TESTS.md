# Un check que no distingue no es un check

Reglas para escribir un check en este repo. Se leen **antes** de escribir uno, no después.

Ninguna se inventó de antemano: cada una salió de un check que dio verde sin medir nada,
durante la tanda de robustez del 10/08/2026 (47 iteraciones, método en el ya retirado
`CICLO.md`). El commit de cualquiera sale con `git log --grep="(it40)"`; la marca empieza
en la it16.

Los checks se corren con `./check.sh` (todos, ~5 s, silencio = verde). El total lo cuenta
el propio `check.sh`: un número escrito a mano envejece en cuanto entra un check nuevo.

## Antes de creerte un verde

- Mueve la entrada y comprueba que la salida cambia (it20). Un check que falla por el
  motivo equivocado (it24), o que falla a ratos (it35), tampoco mide.
- Un caso no basta cuando la regla tiene varios lados: un cubo exclusivo pide un tercer id
  que solo esté en uno (it42), un tope pide además la aserción de que dejó pasar lo que
  tenía que dejar pasar (it44), y una simetría pide los dos lados (it36).
- Una aserción de una línea prueba la rama, no la frontera. La rama la mata cualquier
  valor; la frontera solo la mata el valor de al lado (it39).
- Datos de juguete miden juguetes: un dígito suelto ordena igual en texto que en número, y
  un precio de verdad no (it40, `median()` en `test_buttons.js`).
- El escapado no se prueba con un caso, se prueba con un carácter por regla (it38,
  el bloque de `csvEscape` en `test_buttons.js`).
- Una lista escrita a mano dentro de una prueba envejece en silencio (it31). Por eso la
  copia de seguridad recorre el almacén con `length`/`key` (`test_app.js`, el stub de
  `Storage`).

## Sobre el DOM falso de `test_app.js` (lo reutiliza `test_buttons.js`)

- El arnés ya NO se inventa un id: `q()` lanza «el arnés se inventó #x» si el id no está en
  `index.html` ni en `app.js`, y `qa()` hace lo mismo con un contenedor sin hijos (it32).
  Esa guarda **es** el check: quien la quite le devuelve el verde a los ids mal escritos.
- Lo que sí se sigue inventando es una **propiedad que nadie sembró**: el proxy de `makeAny`
  responde truthy a cualquier nombre. Por eso `open` nace en `false` y por eso se compara
  con `=== true` (it37).
- Un gancho que el código bajo prueba vuelve a llamar mide dos cosas y reporta una (it34).
- **Antes de acusar al arnés, léelo.** Dos iteraciones seguidas cerraron un abierto cuyo
  motivo era «el arnés no puede»: `makeContext` ya tenía `opts.limit` (it44) y el DOM falso
  ya vaciaba `children` (it45). La medida que te falta suele estar escrita en otro bloque
  del mismo fichero.

## Higiene

- Un `clear()` antes de rellenar no se ve en la primera carga; pruébalo con la segunda
  (it42, `blockSel.clear()` en `app.js`).
- Un filtro que solo tiene sentido en una vista necesita un check en la OTRA vista: el de
  la vista buena no distingue «filtra donde debe» de «filtra en todas partes» (it47, el
  filtro por vendedor de la vista `rejected` en `app.js`).
- Lo que un bloque ensucia, el bloque lo limpia al salir. Un filtro que se queda puesto se
  lleva por delante los bloques de después (it46).

## Citas al código

Cita el **símbolo**, no el número de línea. Los números envejecen en el commit siguiente y
nadie los revisa; una función se puede buscar. Esa fue la avería que se llevó por delante
media docena de referencias de la documentación vieja.

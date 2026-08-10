# Ciclo de robustez

Método de trabajo para la tanda de robustez del 10 de agosto de 2026. Meta: **arreglar
bugs y simplificar sin quitar ni una funcionalidad**, con cierre a las 10:00 de Madrid.

`DESARROLLO.md` dice cómo se trabaja en este repo siempre. Este fichero dice cómo se
trabaja durante esta tanda. Cuando la tanda cierre, lo que valga la pena se muda a
`DESARROLLO.md` y esto se borra.

## Las dos reglas que mandan sobre todo lo demás

1. **Ninguna funcionalidad se pierde.** Simplificar es quitar código, nunca comportamiento.
   Cada iteración pasa por un guardián que compara qué hacía la app antes y qué hace después.
2. **Un hallazgo sin reproducción no es un hallazgo.** Se descarta. La auditoría anterior
   mató 8 de 14 hallazgos con esta regla, y por eso los 6 que quedaron eran reales.

## Las cinco fases de una iteración

### F1 · Investigar

Varias lentes distintas sobre una zona acotada del código. Lentes distintas, no
repetidas: cada agente busca una clase de fallo que los otros no miran.

Salida de cada lente: una lista de hallazgos. Cada hallazgo lleva `fichero:línea`, el
síntoma que ve el usuario, y cómo reproducirlo. Sin esas tres cosas, el hallazgo no
entra.

Tope: **6 agentes por tanda**, contados en toda la ejecución.

### F2 · Documentar

Un documento por iteración, en `iteraciones/NN-<zona>.md`. Se escribe **antes** de tocar
código. Lleva:

- Los hallazgos que sobreviven, ordenados por gravedad (`alta` / `media` / `baja`, la
  misma escala de `MEJORAS.md`).
- Los descartados, **con el motivo**. Esto evita que el siguiente los vuelva a levantar.
- Qué se va a tocar, y qué se deja fuera a propósito.

El documento es el contrato. Si la implementación se sale de él, se actualiza el
documento primero.

### F3 · Implementar

Rama propia desde `main` limpio. Un cambio por commit. El mensaje del commit nombra el
hallazgo que cierra.

Aplica la escalera de ponytail: la solución más corta que funciona. Un arreglo que añade
una abstracción para un solo caso no es un arreglo, es deuda con otro nombre.

### F4 · Probar

**El test va en rojo antes que el arreglo.** Se escribe el check, se ve fallar, se
arregla, se ve pasar. Un test que nunca estuvo rojo no prueba nada.

Después, el bucle de los siete checks de `CLAUDE.md`. Los siete, siempre, aunque el
cambio parezca de una línea. El defecto 6 de `MEJORAS.md` nació de saltarse esto.

Cambio visual: captura de la app real, y se espera la aprobación del usuario.

### F5 · Review adversaria

Agentes que intentan **refutar** el trabajo, no confirmarlo. Tres lentes:

- **El refutador:** ¿el arreglo arregla de verdad lo que dice? ¿Rompe otra cosa?
- **El guardián de funcionalidad:** ¿desapareció algún comportamiento? Esta es la regla 1,
  y tiene su propio agente porque es la que más fácil se cuela.
- **El crítico de completitud:** ¿qué zona quedó sin mirar? Lo que encuentre es la
  siguiente iteración.

Un hallazgo de la review adversaria vuelve a F2. No se arregla sobre la marcha.

**Una lente que muta ficheros corre en su propio worktree** (`isolation: 'worktree'`). Las
lentes van en paralelo, y la prueba de mutantes edita el árbol: en la review de la iteración 4,
el guardián midió `./check.sh` en rojo seis veces por los mutantes del refutador y estuvo a
punto de reportar una fragilidad que no existía. Lo cazó comparando el `mtime` del fichero con
lo que él mismo había tocado. Sin worktrees separados, ninguna medida vale nada.

## Ritmo

Iteraciones cortas, una zona cada una. Cerrar sobre `main` al final de cada iteración, no
al final de la tanda: así `main` sigue desplegable y un fallo solo cuesta una iteración.

Si el reloj aprieta, se recorta el **alcance** de la iteración, nunca F4 ni F5. Media zona
bien cerrada vale más que dos zonas sin verificar.

## Reglas que dejaron las iteraciones

Ninguna se inventó de antemano: cada una salió de un check que dio verde sin medir nada.
Se leen antes de escribir un check, no después.

**Sobre el barrido de mutantes**

- La señal del barrido es el código de salida, no el texto.
- Un `MUTADOR ROTO` no es un resultado. Vuelve a anclar el corte y vuelve a medirlo (it30).
- Un mutante que vive porque apunta a un nombre que no existe no dice nada (it29).
- Cuando un mutante evidente sobrevive, sospecha del arnés antes que de la aserción (it28).
- Un recuento de menciones por nombre sirve para elegir dónde barrer; quien decide es el
  mutante (it25), y antes de eso, leer el código (it27).
- Un mutante equivalente es código que no se puede romper. A veces es una propiedad del
  dominio (la mediana no depende del sentido del orden, it40) y a veces es código muerto que
  hay que quitar (los dos `Math.max`, it39). Hay que distinguirlos, no contarlos juntos.

**Sobre los checks**

- Un check que no distingue no es un check (it20). Antes de creerte un verde, mueve la
  entrada y comprueba que la salida cambia.
- Un check que falla por el motivo equivocado tampoco es un check (it24).
- Un check inestable no es mejor que ningún check (it35).
- Un check contra el arnés mide el arnés (it37). `Boolean(propiedad que nadie asignó)` es
  cierto en el DOM falso: compara con `=== true`.
- Un check contra un umbral tiene que caer del lado que quiere medir, y un check contra una
  simetría tiene que visitar los dos lados (it36).
- Un `console.assert` de una línea prueba una rama, no su frontera. La rama la mata un valor
  cualquiera; la frontera solo la mata el valor de al lado (it39).
- Un check con datos de juguete mide juguetes: un dígito suelto ordena igual en texto que en
  número, un precio de verdad no (it40).
- El escapado no se prueba con un caso, se prueba con un carácter por regla (it38).
- Una lista escrita a mano dentro de una prueba envejece en silencio (it31).
- Una lente que descarta el hallazgo de otra tiene que medirlo, no razonarlo.

**Sobre el arnés**

- Un arnés que fabrica lo que le piden convierte una errata en un check verde (it32). Si
  `querySelector("#loQueSea")` devuelve siempre un elemento, un id mal escrito pasa el check.
- Un gancho que el propio código bajo prueba vuelve a llamar mide dos cosas y reporta una (it34).
- El arnés puede más de lo que parece. La it43 dejó un mutante abierto diciendo «el arnés no
  sabe fallar al escribir»; `makeContext` tenía `opts.limit` desde hacía 30 iteraciones (it44).
  Antes de declarar que falta arnés, léelo.
- Antes de acusar al arnés, mira si el código pinta más de lo que crees. La lista vacía pinta
  su propia fila de aviso, así que el conteo «correcto» de una papelera vacía es 1, no 0. Yo
  culpé al DOM falso de no vaciar `children`; lo vaciaba desde el principio (it45).
- La medida que te falta suele estar ya escrita en otro bloque del mismo fichero de pruebas.
- Un motivo escrito para dejar algo abierto se revisa antes de darlo por bueno. Dos iteraciones
  seguidas cerraron un abierto cuyo motivo era «el arnés no puede» (it44, it45).

**Sobre el alcance**

- Un barrido con demasiados supervivientes no cabe en una iteración. Se corta en dos: la
  primera escribe los nombres y el daño de cada uno, la segunda hereda esa F1 y no la repite
  (it42 → it43). Lo que se recorta es el alcance, nunca F4 ni F5.
- Lo que queda abierto se escribe con nombre, daño y motivo. «Por reloj» y «por criterio» no
  son lo mismo, y solo el primero vuelve.
- Una lista vacía de filtros significa «no filtro». El código que la lee tiene que decirlo, y
  el check tiene que visitar la lista vacía además de la llena (it41).
- Un cubo exclusivo se prueba con el id que está en los dos cubos, y con un tercero que solo
  está en uno: sin el tercero, el check no distingue «reconcilia» de «vacía el otro cubo» (it42).
- Un `clear()` antes de rellenar no se ve en la primera carga. Se prueba con la segunda (it42).
- Un check contra un presupuesto pide dos aserciones: la que mide, y la que comprueba que el
  presupuesto dejó pasar lo que tenía que dejar pasar (it44).
- Un mutante sobre una llamada mide un sitio. Para medir la regla, muta su definición (it44).
- Cuando el reloj corta un barrido, se actúa sobre lo medido y el mutador se guarda **en el
  repo** (`iteraciones/NN-mutantes.py`). La F1 de la iteración siguiente costó dos minutos
  porque nadie tuvo que volver a pensarla (it46 → it47).
- Un separador que produce huecos vacíos convierte «filtra por estos ids» en «no filtra». Un
  `filter(Boolean)` que falta no lo ve ningún check de camino feliz (it46).
- Un filtro que solo tiene sentido en una vista necesita un check en la OTRA vista. El check de
  la vista buena no distingue «filtra donde debe» de «filtra en todas partes» (it47).
- Un bloque que deja puesto un filtro se lleva por delante los bloques de después. Lo que el
  check ensucia, el check lo limpia al salir (it46).

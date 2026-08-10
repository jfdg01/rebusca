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

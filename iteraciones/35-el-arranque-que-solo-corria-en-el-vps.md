# Iteración 35 — el arranque que solo corría en el VPS

Zona: `src/servidor.py:167-173`, el bloque `if __name__ == "__main__"`.
Es el último punto abierto de `MEJORAS.md`, encontrado en la iteración 31.

## F1 — Investigar

Las 208 líneas de `test_servidor.py` montan `servidor.H` a mano dentro del propio proceso:

```python
srv = ThreadingHTTPServer(("127.0.0.1", 0), servidor.H)
```

Eso prueba el handler entero, y no prueba nada del arranque. Lo que queda fuera son tres
decisiones, y las tres son las que usa una persona:

- `PORT` del entorno — `PORT=8123 python3 src/servidor.py` es el servidor de pruebas que
  documenta `CLAUDE.md`.
- El argumento posicional, que gana al entorno.
- La rama `demo`, que es uno de los siete checks.

Cinco mutantes sobre el bloque. **4 mueren después del trabajo, 1 VIVE.** Antes del trabajo
vivían los cinco: el bloque no lo tocaba ningún check.

| mutante | veredicto |
| --- | --- |
| el argumento posicional se ignora | muere |
| el argumento posicional se cuenta mal (`== 3`) | muere |
| `PORT` del entorno se ignora | muere |
| la rama `demo` desaparece | muere |
| solo escucha en loopback | VIVE |

## F2 — Documentar (el contrato)

**Producción no se toca.** Se levanta el proceso de verdad, como lo levanta systemd, y se le
pide la portada por HTTP.

1. Dos arranques: uno con el puerto por argumento y otro con el puerto por `PORT`.
2. En cada uno, el puerto que NO manda va cruzado a propósito: se le pasa otro número libre.
   Si el server escuchara en el equivocado, la portada no aparece donde se la pide.
3. El puerto lo elige el kernel (`bind` a 0 y soltar). Ningún número fijo: el usuario tiene
   el suyo en el 8000 y las pruebas a mano en el 8123.
4. `servidor.py demo` acaba con código 0 y escribe `ok`.

Nada de esto pide red: todo es `127.0.0.1`.

## F3 — Implementar

`src/test_servidor.py` únicamente: dos ayudantes (`libre`, `espera`) y el bloque 10.

## F4 — Probar

Los siete checks: VERDE. La suite del server pasa de 0,3 s a 0,6 s.

Los cinco mutantes, y cada muerte por su propia aserción:

```
posicional ignorado  -> AssertionError: el argumento posicional no manda: nadie sirve la portada
PORT ignorado        -> AssertionError: PORT no manda: nadie sirve la portada
sin rama demo        -> ValueError: invalid literal for int() with base 10: 'demo'
```

## F5 — Review adversaria

### El mutante que vive, y por qué se queda vivo

`ThreadingHTTPServer(("0.0.0.0", port), H)` cambiado a `("127.0.0.1", port)` pasa los siete
checks. No es un empate técnico: el check pide la portada por loopback, así que no puede
distinguir. Y el bind abierto sí sirve para algo — el usuario abre la app desde el móvil
contra el portátil de la misma red.

Medirlo pide una segunda dirección de esta máquina. Sacarla necesita una ruta de salida, y en
un contenedor sin red el check saldría inestable. Un check que a veces falla por el entorno se
acaba ignorando, y entonces no vale nada. Se queda sin medir, y escrito en `MEJORAS.md`.

**No** se mira el texto del banner (`print(f"Rebusca en http://0.0.0.0:{port}")`). Ese check
mediría el `print`, no el bind: es exactamente la tautología que cerró la iteración 33.

### Lo que este bloque cuesta

Levanta dos procesos y los mata. Si la máquina va muy cargada, `espera` aguanta 5 s antes de
rendirse; en la práctica tarda una décima. El coste real medido es 0,3 s.

### Regla que se lleva esta iteración

**Un check inestable no es mejor que ningún check: se ignora, y encima tapa el hueco.**
Cuando la medida no cabe, el sitio del hallazgo es la lista de pendientes, no una aserción
que a veces vale.

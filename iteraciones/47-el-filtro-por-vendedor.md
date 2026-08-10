# Iteración 47 — el filtro por vendedor

**Zona:** los 6 mutantes que la iteración 46 dejó sin correr, con el mutador ya escrito en
`iteraciones/46-mutantes.py`.

**Por qué así.** La 46 cortó el barrido por reloj y dejó el mutador en el repo. Esta iteración
lo corre y ya está: la F1 costó dos minutos porque nadie tuvo que volver a pensarla.

## F1

```
#id: la almohadilla no fuerza id               muere
texto: no casa por id                          muere
texto: no casa por titulo                      muere
texto: el titulo no se normaliza               muere
vendedor: el filtro no se aplica               muere
vendedor: tambien en favoritos                 VIVE
orden: la lista no se ordena                   muere
```

Los checks de la 46 ya cubrían casi todo, incluidos tres que la 46 no llegó a correr.

## F2 — el contrato

**El filtro por vendedor es de la papelera.** Nace de bloquear a un vendedor, y solo ahí la
pantalla dice por quién está filtrando. Si se colara en favoritos, el usuario vería su lista de
favoritos recortada sin nada en pantalla que lo explique, y creería que perdió favoritos.

## F4 y F5

Una aserción más en el bloque `7i`. Suite 528 → 529. El mutante muere.

Con esto, los **15 mutantes** del filtro de la lista están medidos: 14 mueren y uno es
equivalente (`q: el filtro vacio filtra igual`, medido en la 46).

## Lo que deja esta iteración

- Dejar el mutador escrito en el repo cuando el reloj corta un barrido convierte la F1 de la
  iteración siguiente en dos minutos. Es la forma más barata de no perder el trabajo de pensar.
- Un filtro que solo tiene sentido en una vista necesita un check en la OTRA vista. El check de
  la vista buena no distingue «filtra donde debe» de «filtra en todas partes».

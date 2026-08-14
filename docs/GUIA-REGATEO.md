# Estrategia de regateo en Wallapop para el comprador: guía fundamentada para instruir a una IA

## TL;DR
- La sugerencia de regateo debe dejar de ser un número al azar y calcularse con dos palancas fundamentadas: (1) un **descuento base sobre el "precio para mí"** —el que ya incluye protección y envío—, modulado por las señales del anuncio; y (2) una **oferta puntual, precisa y justificada**, no un rango que suba por encima de tu techo. La mejor evidencia disponible (26 millones de negociaciones reales de eBay; Schweinsberg, Petrowsky, Funk & Loschelder, *PNAS* 2023) sitúa la primera oferta que equilibra precio bajo y bajo riesgo de ruptura en el **80 % del precio pedido**, con un rango del 33 % al 95 % según categoría, demanda y tolerancia al riesgo de que no haya trato.
- Wallapop condiciona el regateo de forma concreta: el comprador paga **protección + envío** sobre el precio, así que el trato **en mano** libera ese ~5–10 % que comprador y vendedor pueden repartir; las ofertas por la función nativa **caducan a las 24 h** y no se pueden cancelar una vez enviadas; y el vendedor **particular** (con efecto dotación) se negocia distinto del **profesional/revendedor** (sin apego, más margen, menos ofendible).
- Reglas de oro para la IA: **nunca regatear un chollo** ya por debajo de mercado (actuar rápido y reservar); ofertar **cifras salientes** (fracciones tipo ½, ¾, 80 %, 90 %) e **imitar la precisión del precio del vendedor**; **justificar siempre con un comparable** ("porque…"); construir algo de **rapport**; y **no sacar la conversación de la app** ni pagar por Bizum/enlaces externos.

## Key Findings

**1. La mecánica de Wallapop cambia el cálculo del regateo.**
- El comprador puede negociar por el **chat** o con la función **"hacer una oferta"/contraoferta**. Si la oferta se hace por el sistema, **caduca automáticamente a las 24 h** si el vendedor no responde, y **no se puede cancelar** una vez enviada (solo esperar a que caduque o que el vendedor la rechace).
- En una compra **con envío**, el comprador asume **la Protección Wallapop y el envío por encima del precio del artículo**. Los tramos del "seguro" que han circulado son: **1,69 €** (1–13 €); **0,69 € + 7,5 % del precio** (13,01–657 €); y **50 € fijos** (657,01–2.500 €). Fuentes más recientes describen una **comisión de gestión de ~10 %** (mínimo ~1,95 € por debajo de 25 €). Los envíos por peso van de **3,50 € (0–2 kg) a 14,50 € (20–30 kg)**. Ese recargo es lo que convierte "800 €" en "845 € para mí" en el output actual del usuario.
- La **entrega en mano no tiene comisión ni protección**. Implicación táctica central: esos fees son dinero muerto que paga el comprador; pasar a **efectivo en mano hoy** libera ese margen y da al comprador una palanca real ("te lo pago en mano y hoy") a cambio de rebaja, porque al vendedor le ahorra empaquetar, la espera de 48 h para liberar el dinero y el riesgo de disputa.
- **Vendedor particular vs. profesional (Wallapop PRO, desde 39,99 €/mes):** el particular sufre **efecto dotación** (sobrevalora lo suyo; la literatura estima ratios "willingness to accept / willingness to pay" que superan con frecuencia el 2×) y se ofende con ofertas bajas; el profesional/revendedor (mucho stock publicado, a menudo precios inflados de lotes de devoluciones) no tiene apego, tiene más margen y responde a lógica de negocio: se puede ser más agresivo sin romper la relación.
- **DAC7 / Hacienda:** desde 2023 Wallapop reporta a Hacienda (Modelo 238) a quien supere **2.000 € o 30 ventas al año** (umbral que se está elevando a 3.000 €). En la Campaña de la Renta 2024 (iniciada el 2 de abril de 2025) la AEAT incluyó **330.000 avisos preventivos**, que la propia directora de Gestión Tributaria, Rosa María Prieto del Rey, describió como *"una información parcial y no exhaustiva ni concluyente"*. Wallapop, junto con TaxDown, estima que **"menos de un 1% de los usuarios de la plataforma es susceptible de alcanzar los límites de DAC7 en un año tipo"** y que "más del 90% de las ventas de segunda mano no tiene obligación de tributar por el IRPF". Relevancia para el regateo: vendedores cerca del umbral o revendedores pueden preferir cerrar **en mano** (fuera del rastro de la plataforma), lo que refuerza la palanca del efectivo. La IA debe registrarlo como realidad conductual, **sin inducir a fraude**.
- **Reputación:** las valoraciones son el aval del vendedor; uno con muchas valoraciones positivas es más fiable pero también más firme; uno nuevo o con malas valoraciones da margen para pedir garantías (factura, prueba de funcionamiento) y, con ello, rebaja.
- **Riesgos/estafas:** el **"Bizum inverso"** (te piden devolver un pago que nunca llegó), salir del chat a **WhatsApp**, y **enlaces de phishing** que imitan "Wallapop Protección" para robar datos de tarjeta. Regla: **si el dinero sale del sistema de pago integrado, sale de toda protección.** Esto importa al estructurar la oferta porque la presión del vendedor a "cerrar fuera de la app / pagar por adelantado para reservar" es a la vez **señal de estafa y falsa táctica de cierre**: la IA debe blindar el trato dentro de la app (o en mano con inspección).

**2. Dinámica de precios en marketplaces C2C: hay evidencia dura.**
- El hallazgo cuantitativo más sólido procede de **26 millones de negociaciones reales de eBay** (Schweinsberg, Petrowsky, Funk & Loschelder, *PNAS* 2023, vol. 120, e2218582120): *"the ideal buyer offer lies at 80% of the seller's list price across all products—although this value ranges from 33% to 95% depending on the type of product, demand, and buyers' weighting of price versus impasse risk."* Es decir, la primera oferta que **minimiza a la vez el precio final y el riesgo de ruptura ("impasse") está en el 80 % del precio pedido** (si solo se optimiza el riesgo de ruptura, el mínimo se da en ofertas del 90 %). El riesgo de ruptura sigue una curva con tres zonas: **zona de seguridad** (ofertas del 100 % al 90 %, riesgo estable o incluso algo menor), **zona de aceleración** (del 90 % al 20 %, el riesgo de ruptura sube con fuerza) y **zona de saturación** (por debajo del 20 %, la venta casi siempre muere).
- El mismo cuerpo de investigación (comunicado del estudio, ESMT Berlin) documenta un **"sesgo del comprador"**: *"the results contradict the prevailing view that the final sales price lies somewhere in the middle… Final sale prices are closer to buyers' initial offers than to sellers' asking prices."* Es decir, lo contrario de "partir la diferencia": conviene anclar bajo sin romper.
- **Antigüedad, bajadas de precio y favoritos** son señales de concesión. En inmobiliario (mejor documentado) un descuento del 6–10 % se justifica cuando un anuncio cruza los 30–60 días o ya tuvo una bajada; el propio "tiempo en mercado" comunica al vendedor que su precio no aguantó. Los foros españoles lo confirman para Wallapop: un artículo con semanas publicadas y varias rebajas señala vendedor cansado.
- **Efecto de la redondez del precio (Backus, Blake & Tadelis, NBER Working Paper 21285, 2015):** *"Items listed at multiples of $100 receive offers that are 5%–8% lower but that arrive 6–11 days sooner than listings at neighboring 'precise' values, and are 3%–5% more likely to sell."* Traducción para el comprador: un **precio redondo** señala vendedor motivado y flexible; un **precio con terminación precisa** (p. ej. 847 €) señala que ha hecho los deberes y baja peor (Mason et al. 2013, "Precise offers are potent anchors"; el estudio "€14.875" muestra que la precisión potencia el anclaje). Además, los precios precisos crean **"barreras de entrada"**: la gente entra menos a negociar (Lee, Loschelder, Schweinsberg, Mason & Galinsky, *OBHDP* 2018).
- **Efecto dotación:** los vendedores particulares exigen sistemáticamente más de lo que un comprador pagaría (ratio WTA/WTP frecuentemente >2), ligado a la aversión a la pérdida (Thaler 1980; Kahneman-Knetsch-Thaler). Se atenúa con la práctica y con bienes fungibles/abundantes, y es menor en profesionales.

**3. Ciencia de la negociación aplicable al chat asíncrono.**
- **Anclaje y primera oferta:** quien ancla primero suele condicionar el resultado; la primera oferta explica **entre el 50 % y el 85 %** de la varianza del precio final (Galinsky, Ku & Mussweiler 2009). En Wallapop **el precio publicado ya es el ancla del vendedor**; el comprador lo contrarresta con una **contraoferta ambiciosa pero creíble** respaldada por comparables (el ancla ajena pierde fuerza cuando se opone información objetiva).
- **Descuento óptimo:** ofertas más agresivas anclan mejor pero disparan la ruptura (Schweinsberg et al. 2012; Wang et al. 2008). El punto dulce empírico es el ~80 % del pedido en eBay; por debajo del 20 % la negociación casi siempre muere.
- **Ofertas de rango (Ames & Mason, *JPSP* 2015, "Tandem Anchoring"):** de tres tipos, la **"bolstering range"** (tu punto objetivo estirado en tu dirección ambiciosa) logra mejores acuerdos sin dañar la relación; la **"backdown range"** (estirar hacia la concesión) es la **peor**. **Implicación crítica para el output actual del usuario:** decir *"te doy 730–750 €"* cuando tu techo es 730 es una *backdown range* —le comunicas al vendedor que pagarás 750 y sueles acabar ahí—. La versión correcta para un comprador es poner tu **techo como extremo superior** ("puedo hacerte 700–730") o, mejor aún, una **oferta puntual y precisa**.
- **Justificar la oferta (efecto "porque"; Langer, Blank & Chanowitz 1978):** añadir una razón sube el cumplimiento del **~60 % al ~93–94 %** en peticiones pequeñas, y funciona incluso con razones débiles. Un comparable de mercado ("porque el mismo modelo con 4060 está a 730 € usado") es una razón **fuerte**. Ojo: en peticiones de mayor coste la razón debe ser **real**, no de relleno (la evidencia muestra que ahí las razones vacías dejan de funcionar).
- **Precisión de la cifra (Mason et al. 2013):** las ofertas precisas anclan más y generan contraofertas más conciliadoras porque parecen informadas. En Wallapop conviene **imitar la precisión del vendedor** (Petrowsky et al., ~25M de negociaciones eBay, *Journal of Economic Psychology* 2023): si pide 800 €, oferta redonda; si pide 847 €, oferta precisa; y **ofertar en fracciones salientes** (½, ⅔, ¾, 80 %, 90 %) reduce la ruptura frente a cifras vecinas.
- **Concesiones:** patrón de **concesión decreciente** (cada subida menor que la anterior) señala que te acercas a tu límite; pocas rondas (2–3) y cierre.
- **BATNA / precio de reserva:** tener **alternativas visibles** (otros anuncios del mismo modelo) es la palanca más real; mencionarlas con naturalidad ("tengo otro a X, pero prefiero el tuyo por…") baja el precio sin ofender. El comprador debe fijar su *walk-away* antes de escribir.
- **Rapport en canal asíncrono (Morris, Nadler, Kurtzberg & Thompson 2002, "Schmooze or lose"):** en negociación por texto se pierde el rapport; un breve toque humano lo recupera y **reduce las rupturas** (la literatura resume que los impasses bajaron de ~60 % a ~40 % con una simple conversación previa de "schmoozing"). Un saludo cordial + una frase personal ayuda.
- **Cierre:** el **"flinch"** (mostrar sorpresa ante el precio) mejora resultados (Fassina & Whyte); el **silencio** tras la oferta; y ofrecer **recogida inmediata / pago hoy / compra en lote** como monedas de cambio.

**4. Cultura española del regateo en Wallapop.**
- El regateo es **esperado y normal**; reducciones del **10–20 %** se consideran típicas (consenso de guías y foros). La cultura española tiene una vena "regateadora", pero hay un umbral de lo **ofensivo**: ofertar la mitad de un precio ya ajustado se percibe como insulto y el vendedor se cierra (testimonios de vendedores: "guerra psicológica"; las ofertas del 30–40 % del precio irritan y a menudo cortan la conversación).
- Fórmulas habituales: "¿aceptas X?", "¿lo dejamos en X?", "¿cuál es tu último precio?", "¿lo mínimo que aceptas?", "¿es negociable?", "reservado". Preguntar **"¿cuál es tu último precio?" perjudica al comprador**: cede el turno de anclaje al vendedor y revela interés sin comprometerte; es mejor **anclar tú** con una cifra concreta y justificada.
- Consejo transversal de guías españolas (Xataka, TuExpertoApps): amabilidad, responder rápido, **preguntar detalles antes de hablar de precio**, y usar defectos/faltas de accesorios como argumento.

**5. Señales del anuncio que modulan la agresividad (checklist observable).**
Suben el descuento que se pide (más agresivo): **muchos días publicado**; **precio ya bajado** una o más veces; **muchos favoritos/visitas sin venderse**; vendedor **revendedor** (mucho stock, precios de lote); texto con **"urge", "mudanza", "se regala", "acepto ofertas", "negociable"**; **defectos declarados** o faltan accesorios/caja/factura; **precio redondo** (señal de flexibilidad); modelo **abundante**.
Bajan el descuento (más suave o nada): **anuncio recién publicado**; **precio con terminación precisa**; texto **"no regateo/precio fijo/último precio"**; **factura y garantía** incluidas; **fotos buenas y detalladas**; particular con pocas ventas y buenas valoraciones; **modelo escaso**; y sobre todo **precio ya por debajo de mercado** → en ese caso **NO se regatea: se reserva/compra ya**. Ubicación: si es **solo en mano y lejos**, el desplazamiento es argumento de rebaja; si es envío obligatorio, recuerda sumar fees.

**6. Margen por importe y categoría.**
- Por **importe**: en artículos baratos (10–40 €) el margen absoluto es pequeño y regatear mucho ofende ("por 2 € priorizo el movimiento", dice un vendedor en foro); conviene oferta redonda suave o comprar directo. En artículos caros (varios cientos de €), 1 punto porcentual son euros reales y el regateo compensa y es esperado; ahí es donde el 80–90 % del pedido tiene sentido.
- Por **categoría** (según demanda y depreciación): **electrónica/informática/móviles** se deprecian rápido y hay mucha oferta comparable → más margen para regatear y para justificar con comparables; **muebles** (voluminosos, envío caro/imposible, el vendedor quiere deshacerse) → margen alto y palanca de recogida inmediata; **moda** → márgenes pequeños salvo lujo; **coches/motor** → negociación más larga y con más rondas; **coleccionables/escasos** → poco margen, actuar rápido. La demanda desplaza el óptimo (recuérdese el ~65 % en música frente al 80 % general en eBay).

## Details: marco operativo con números

**Paso 0 — ¿Se regatea?**
- Si el "precio para mí" ya está **por debajo del precio de segunda mano de mercado** → **NO regatear.** Recomendar comprar/reservar ya y, si acaso, un mensaje de cierre rápido. Regatear un chollo solo lo pierde.
- Si el vendedor escribe **"no regateo/precio fijo"** y el precio es de mercado → una **única** oferta suave y respetuosa, o preguntar por pago en mano hoy; no insistir.

**Paso 1 — Descuento base de la primera oferta** (la oferta se hace sobre el **precio anunciado**; la IA razona el ahorro sobre el **"precio para mí"**).

| Perfil del anuncio | Oferta inicial (% del pedido) | Descuento pedido |
|---|---|---|
| Precio de mercado, anuncio fresco (<7 d), particular, sin urgencia | **90–95 %** | 5–10 % |
| Precio algo alto, 2–4 semanas, o 1 bajada previa | **85–90 %** | 10–15 % |
| Precio claramente alto, >30–45 días, varias bajadas, muchos favoritos sin vender, o defectos | **78–85 %** | 15–22 % |
| Revendedor con stock y precio inflado, o texto "urge/mudanza/se regala" | **70–80 %** | 20–30 % |
| Artículo barato (<40 €) | oferta **redonda** 1 escalón abajo o comprar ya | mínimo |

Ajustes: nunca bajar del ~70 % salvo señales extremas (por debajo del 20 % la venta muere; el tramo 90–20 % encarece la ruptura). Usar **fracciones salientes** e **imitar la precisión del vendedor**. El **80 %** es el ancla por defecto para importes altos cuando hay margen y el comprador tolera algo de riesgo de ruptura.

**Paso 2 — Formato de la oferta.**
- **Oferta puntual y precisa**, no un rango que suba por encima de tu techo. Si se usa rango, que sea **bolstering** con tu techo como extremo alto ("puedo hacerte 700–730"), nunca "730–750".
- **Una razón** (efecto "porque"): comparable de mercado, defecto o faltante.
- **Rapport**: saludo cordial + microtoque humano; nada de disparar cifra sin saludar.
- **Preguntas de valor** que además son palanca: ciclos de batería, garantía transferible y tienda, factura, si la RAM es SODIMM o soldada, motivo de venta.

**Paso 3 — Concesiones y cierre.**
- Concesión **decreciente** y 2–3 rondas máximo. Cerrar con moneda de cambio: **"y lo recojo hoy" / "te lo pago ya en mano"** (libera los fees) / compra en **lote**.
- Blindaje anti-estafa: todo dentro de la app o en mano con inspección; **nunca** Bizum/enlaces/WhatsApp para pagar.

## Recommendations

### Bloque listo para añadir al `llms.txt` de Rebusca

> ## Cómo estructurar el regateo (para cada recomendación)
>
> El precio a batir es el **"precio para mí"** (con protección y envío), no el anunciado. La oferta, en cambio, se hace sobre el **precio anunciado** (Wallapop suma los fees aparte). Antes de sugerir un regateo, decide en este orden:
>
> 1. **¿Es ya un chollo (por debajo de mercado)?** → **No regatees.** Di "cómpralo/resérvalo ya" y, como mucho, un mensaje corto de cierre.
> 2. **¿Dice "no regateo/precio fijo" y el precio es de mercado?** → Una sola oferta suave y educada, o pregunta por pago **en mano hoy**. No insistas.
> 3. **En los demás casos, calcula la oferta como % del precio anunciado** con esta tabla y modúlala por señales:
>    - Precio de mercado, anuncio fresco, particular → **90–95 %**.
>    - Precio algo alto / 2–4 semanas / 1 bajada → **85–90 %**.
>    - Precio alto / +30 días / varias bajadas / muchos favoritos sin vender / defectos → **78–85 %**.
>    - Revendedor con stock y precio inflado, o "urge/mudanza/se regala" → **70–80 %**.
>    - Artículo barato (<40 €) → oferta **redonda** un escalón abajo, o comprar ya.
>    - Nunca por debajo de ~70 % salvo señales extremas (ofertas muy bajas rompen la venta).
> 4. **Modula por señales.** Suben el descuento: días publicado, precio ya bajado, favoritos altos sin venta, revendedor, "negociable/urge", defectos/faltantes, precio **redondo**, modelo abundante, entrega solo en mano y lejos. Lo bajan: recién publicado, precio con **terminación precisa**, "no regateo", factura+garantía, buenas fotos, modelo escaso, particular con buenas valoraciones.
> 5. **Da la cifra ya formateada:**
>    - **Una cifra puntual y precisa**, no un rango que suba por encima de tu tope. Si usas rango, pon tu tope como extremo **alto** ("700–730"), nunca por encima ("730–750").
>    - **Imita la precisión del vendedor**: si pide 800 €, oferta redonda; si pide 847 €, oferta precisa. Prioriza fracciones salientes (½, ¾, 80 %, 90 %).
>    - **Añade una razón** con un comparable de mercado ("porque el mismo modelo está a X usado") o un defecto.
>    - **Incluye 1–2 preguntas** que además sean palanca (batería/ciclos, factura, garantía transferible, RAM soldada o SODIMM, motivo de venta).
> 6. **Palanca del efectivo en mano:** el comprador paga ~5–10 % de protección + envío. Si es viable en mano, sugiérelo: libera ese margen y da motivo de rebaja. Todo el pago, **dentro de la app o en mano**; nunca Bizum/enlaces/WhatsApp.
> 7. **Tono:** saludo cordial y humano, en español coloquial de España; una sola oferta por mensaje; concesiones decrecientes en 2–3 rondas; cerrar con "y lo recojo hoy".
>
> Formato de salida por anuncio (una línea): `Ofrécele <cifra> € (<%> del pedido; ahorro real ~<X> € sobre tu precio) porque <razón/comparable>; pregúntale <1–2 preguntas>. [Si en mano: propón recogerlo hoy en efectivo.]`

### Plantillas de mensaje (español de España, listas para el chat)

- **Primer contacto (anclaje suave, artículo de mercado):**
  "¡Buenas! Me interesa el [modelo]. ¿Sigue disponible? ¿Tiene factura y cuántos ciclos de batería lleva? Si encaja, podría hacerte **730 €** y lo recojo esta semana. ¡Gracias!"

- **Oferta con justificación (comparable de mercado):**
  "Le he echado el ojo de verdad. El mismo modelo con 4060 de 8 GB lo estoy viendo sobre **730 € usado**, así que te ofrezco esa cifra. Es en serio y puedo cerrar ya. ¿Lo vemos?"

- **Contraoferta / concesión decreciente:**
  "Te entiendo. Puedo estirarme un poco: **745 €** y lo recojo yo hoy en mano, así te ahorras el envío y el lío. Creo que es buen trato para los dos."

- **Cierre con palanca de inmediatez:**
  "Perfecto. Si te va bien, **hoy mismo** me acerco, pago en mano y cerramos. Dime hora y sitio 👌"

- **Retirada elegante (puerta abierta):**
  "Sin problema, ¡gracias por contestar! 🙂 Si más adelante te lo replanteas a **730 €**, escríbeme y lo cierro al momento. ¡Suerte con la venta!"

- **Cuando dice "no regateo":**
  "¡Entendido, respeto el precio! Solo por preguntar: si te lo pago **en mano hoy**, ¿habría algún margen? Si no, no pasa nada, me interesa igual."

### Árbol de decisión resumido
1. ¿Chollo bajo mercado? → comprar/reservar ya, no regatear.
2. ¿"Precio fijo" a precio de mercado? → una oferta suave o pregunta por mano; no insistir.
3. Resto → % base por tabla → modular por señales → formatear (cifra precisa + razón + preguntas) → ofrecer mano si aplica → 2–3 rondas con concesión decreciente → cerrar hoy.

**Umbrales que cambian la recomendación:** el precio cae por debajo de mercado → deja de regatear; el anuncio cruza ~30 días o suma otra bajada → sube el descuento un escalón; aparece "reservado" → acelera y no regatees; el vendedor exige salir de la app o pagar por adelantado → **aborta: riesgo de estafa**.

### Reescritura de los ejemplos reales del usuario
- **HP Omen 17 a 800 € (845 € para ti):** "Ofrécele **740 €** (92,5 % del pedido; ahorro real ~105 € sobre tu precio) porque un portátil con 4060 de 8 GB usado ronda esa cifra; pregúntale ciclos de batería y si tiene factura. Si es en mano, ofrécete a recogerlo hoy y pagar en efectivo." *(Cambio clave: una sola cifra, no "730–750", que era una backdown range.)*
- **HP Omen 16 a 849 €:** "Ofrécele **780 €** (~92 %) porque [comparable]; pregunta si la garantía es transferible y a qué tienda." *(Mantener cifra puntual; la justificación ya es correcta.)*
- **HP Omen 16 a 949 €:** "Ofrécele **860 €** (~91 %) si el anuncio es fresco, o baja a **820 €** (~86 %) si lleva semanas o ya ha bajado; pregunta si la RAM son dos módulos SODIMM o va soldada." *(Sustituir el rango "880–900" por una cifra modulada según antigüedad.)*

## Caveats
- **Datos vs. sabiduría de foros.** Los números de primera oferta (**80 % óptimo**, zonas de seguridad/aceleración/saturación, sesgo del comprador, fracciones salientes, mímica de precisión) provienen de estudios de **eBay con 25–26 millones de negociaciones reales** y son la evidencia más fuerte, pero **eBay no es Wallapop**: allí hay función formal de oferta/contraoferta y otra cultura; en Wallapop hay más trato en mano y regateo por chat. Trasládense como puntos de partida, no como certezas.
- El rango "**10–20 % es lo normal**" en España es consenso de guías y foros (Xataka, TuExpertoApps, testimonios), **no** un dato de estudio con muestra representativa; trátese como heurística cultural.
- La investigación de **rangos (Ames & Mason)** se hizo sobre todo desde la óptica de quien fija el precio (a menudo el vendedor); su traslación al comprador ("bolstering hacia abajo") es una **extrapolación razonada**, no un resultado medido en compradores de Wallapop.
- Las **comisiones exactas de Wallapop cambian con frecuencia** y las fuentes discrepan (tramos de "seguro" 7,5 %+0,69 € / 50 € fijos frente a "~10 % de gestión"); además Wallapop fue **vendida en 2025** y se anticipan subidas de tarifas y posibles comisiones al vendedor. La IA debería fiarse del **"precio para mí"** que ya calcula Rebusca en vez de recalcular fees, y revisar los tramos periódicamente.
- El **efecto dotación** y la **precisión** son robustos en laboratorio, pero su magnitud en un vendedor concreto de Wallapop es desconocida; úsense como dirección, no como fórmula.
- Nada de esto debe empujar a **salir de la app, pagar por Bizum/PayPal/transferencia o pinchar enlaces**: es el vector de estafa dominante. El regateo termina siempre dentro del sistema seguro o en mano con inspección.
- La mención a **DAC7** es contexto conductual (algunos vendedores prefieren efectivo/mano), **no** una invitación a facilitar la elusión fiscal.
// Prueba del puente desde el navegador. Recorre el mismo camino que va a recorrer la app:
// fetch a /ia con la contraseña en X-Pass. Si esta página contesta, la app puede llamar igual.
// ponytail: sin estilos y sin build. Es un diagnóstico, no una pantalla de la app.
const $ = (id) => document.getElementById(id);
const CLAVE = "wp_pass";   // la misma que usará la app: se teclea una vez por navegador

$("pass").value = localStorage.getItem(CLAVE) || "";

$("enviar").onclick = async () => {
  localStorage.setItem(CLAVE, $("pass").value);
  $("salida").textContent = "…";
  try {
    const r = await fetch("/ia", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Pass": $("pass").value },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [{ role: "user", content: $("msg").value }],
      }),
    });
    const t = await r.text();
    let j = null;
    try { j = JSON.parse(t); } catch { /* el error no siempre viene en JSON */ }
    // El cuerpo crudo cuando no hay respuesta que enseñar: el 401 y el 429 del puente y el 402
    // de DeepSeek (sin saldo) llegan por aquí, y esconderlos es esconder el diagnóstico.
    $("salida").textContent = j?.choices?.[0]?.message?.content ?? `${r.status} ${t}`;
  } catch (e) {
    $("salida").textContent = "la petición no salió: " + e;
  }
};

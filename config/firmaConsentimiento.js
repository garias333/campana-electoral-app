/**
 * La firma que la persona dibuja en la pantalla al autorizar sus datos.
 *
 * QUÉ PROBLEMA RESUELVE. La casilla del formulario dice «le leí o le mostré
 * esta información y autoriza», y la marca EL LÍDER. Como evidencia es la
 * afirmación de un tercero interesado: frente a un «yo nunca autoricé», la
 * campaña no tiene nada que venga de la persona. La firma sí viene de ella.
 */

// 200 KB de texto. Una firma normal ocupa entre 5 y 30 KB en data URL; el
// margen es para pantallas grandes y trazos largos. El límite existe porque
// el cuerpo de la API admite 5 MB y sin un tope propio una sola ficha podría
// llevarse casi todo — y porque un campo sin límite es una invitación.
const LARGO_MAXIMO = 200 * 1024;

const PREFIJO = 'data:image/png;base64,';

/**
 * ¿Esto es una firma que se pueda guardar?
 *
 * Solo PNG en data URL. No se acepta cualquier `data:` — un SVG puede llevar
 * scripts dentro y esta imagen se va a pintar después en el panel.
 *
 * Devuelve { ok, valor, motivo }. Nunca lanza: una firma ilegible no puede
 * tumbar el registro de una persona, se descarta y se anota por qué.
 */
function validarFirma(valor) {
  if (valor === undefined || valor === null || valor === '') return { ok: false, motivo: 'vacia' };
  const texto = String(valor);
  if (!texto.startsWith(PREFIJO)) return { ok: false, motivo: 'no es un PNG en data URL' };
  if (texto.length > LARGO_MAXIMO) return { ok: false, motivo: `pesa ${texto.length} y el tope son ${LARGO_MAXIMO}` };
  const base64 = texto.slice(PREFIJO.length);
  // Un lienzo vacío exportado a PNG son unos cientos de bytes. Por debajo de
  // 500 no hay trazo: es la firma que nadie llegó a dibujar.
  if (base64.length < 500) return { ok: false, motivo: 'sin trazo' };
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return { ok: false, motivo: 'base64 mal formado' };
  return { ok: true, valor: texto };
}

/**
 * Guarda la firma de un votante. Repetible: vuelve a escribir la misma fila.
 *
 * No lanza. Si algo falla se anota en el log y el votante queda guardado igual:
 * perder el registro de una persona por un fallo al guardar su firma sería
 * cambiar un problema por otro peor.
 */
async function guardarFirma(pool, votanteId, valor) {
  const v = validarFirma(valor);
  if (!v.ok) return { guardada: false, motivo: v.motivo };
  try {
    await pool.query(
      `INSERT INTO votante_firmas (votante_id, firma) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE firma = VALUES(firma)`,
      [votanteId, v.valor]
    );
    return { guardada: true };
  } catch (err) {
    console.error('No se pudo guardar la firma del votante ' + votanteId + ':', err.code || err.message);
    return { guardada: false, motivo: err.code || 'error de base de datos' };
  }
}

module.exports = { validarFirma, guardarFirma, LARGO_MAXIMO, PREFIJO };

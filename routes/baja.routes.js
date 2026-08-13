/**
 * routes/baja.routes.js — La página pública para darse de baja.
 *
 * Va montada ANTES del candado de licencia y sin sesión, a propósito: quien
 * recibe un mensaje no tiene cuenta en esta aplicación, y revocar la
 * autorización de datos (Ley 1581) no puede depender de que la campaña tenga
 * la licencia al día. Si la instalación está vencida, el mensaje ya se envió
 * y la persona tiene derecho a salirse igual.
 *
 * DAR DE BAJA ES UN POST, NUNCA UN GET, y esto no es formalismo:
 * los clientes de correo y algunos operadores ABREN los enlaces por su cuenta
 * para previsualizarlos o revisarlos. Con la baja en el GET, media lista
 * quedaría dada de baja sin que nadie hiciera clic. El GET muestra un botón;
 * el POST es el que marca.
 *
 * SE MARCA A LA PERSONA, NO AL NÚMERO — igual que la baja del parche 14: un
 * teléfono se comparte en una familia, así que se marcan todas las fichas que
 * lo tengan. Hacerlo distinto aquí significaría que la misma persona sigue
 * recibiendo por su otra ficha.
 */
'use strict';

const express = require('express');
const pool = require('../config/db');
const { verificar } = require('../config/bajaContacto');

const router = express.Router();

function pagina({ titulo, cuerpo, boton }) {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${titulo}</title>
<style>
  body { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
         background: #F3F5F8; color: #161B26; margin: 0;
         display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; }
  .caja { background: #fff; border-radius: 14px; padding: 30px 26px; max-width: 420px; width: 100%;
          box-shadow: 0 10px 34px rgba(16,35,63,.12); text-align: center; }
  h1 { font-size: 1.25rem; color: #10233F; margin: 0 0 12px; }
  p { font-size: 1rem; line-height: 1.55; color: #5B6472; margin: 0 0 18px; }
  button { background: #0B5ED7; color: #fff; border: 0; border-radius: 9px;
           font-size: 1rem; font-weight: 700; padding: 13px 26px; cursor: pointer; width: 100%; }
  button:hover { background: #084298; }
  .ok { color: #1E6B44; font-weight: 600; }
</style></head><body><div class="caja">
<h1>${titulo}</h1><p>${cuerpo}</p>${boton || ''}
</div></body></html>`;
}

router.get('/:codigo', (req, res) => {
  const dato = verificar(req.params.codigo);
  if (!dato) {
    return res.status(404).send(pagina({
      titulo: 'Enlace no válido',
      cuerpo: 'Este enlace no es válido o ya no está vigente. Si sigue recibiendo mensajes que no pidió, responda a quien se los envía.',
    }));
  }
  // El nombre NO se muestra: la URL viaja por SMS y puede acabar reenviada o
  // en el historial de un teléfono prestado. Confirmar que un número
  // pertenece a «Fulano de Tal» es más información de la que hace falta para
  // darse de baja.
  res.send(pagina({
    titulo: 'No recibir más mensajes',
    cuerpo: 'Si confirma, esta campaña dejará de enviarle mensajes de texto, correos y avisos.',
    boton: `<form method="POST" action="/b/${encodeURIComponent(req.params.codigo)}">
              <button type="submit">Confirmar mi baja</button>
            </form>`,
  }));
});

router.post('/:codigo', async (req, res) => {
  const dato = verificar(req.params.codigo);
  if (!dato) {
    return res.status(404).send(pagina({
      titulo: 'Enlace no válido',
      cuerpo: 'Este enlace no es válido o ya no está vigente.',
    }));
  }

  try {
    // 'estructura' se traduce a su usuario AQUÍ, al abrir el enlace: el id
    // que viaja es el de la fila de estructura y usarlo contra `usuarios`
    // daría de baja a otra persona — los dos rangos se solapan.
    let tabla = 'usuarios';
    let id = dato.id;
    if (dato.tipo === 'votante') {
      tabla = 'votantes';
    } else if (dato.tipo === 'estructura') {
      const [[e]] = await pool.query(`SELECT usuario_id FROM estructura WHERE id = ?`, [dato.id]);
      if (!e) {
        return res.status(404).send(pagina({
          titulo: 'Enlace no válido', cuerpo: 'Este enlace no es válido o ya no está vigente.',
        }));
      }
      id = e.usuario_id;
    }
    const [[fila]] = await pool.query(`SELECT telefono, email FROM ${tabla} WHERE id = ?`, [id]);
    if (!fila) {
      return res.status(404).send(pagina({
        titulo: 'Enlace no válido', cuerpo: 'Este enlace no es válido o ya no está vigente.',
      }));
    }

    // Se marcan TODAS las fichas de esa persona: la suya, y las que compartan
    // su teléfono o su correo. Es la misma regla del parche 14 — se marca a la
    // persona, no al registro.
    const diez = String(fila.telefono || '').replace(/\D/g, '').slice(-10);
    for (const t of ['votantes', 'usuarios']) {
      await pool.query(
        `UPDATE ${t}
            SET no_contactar = 1,
                no_contactar_fecha = NOW(),
                no_contactar_origen = 'enlace'
          WHERE (? <> '' AND RIGHT(REGEXP_REPLACE(COALESCE(telefono,''), '[^0-9]', ''), 10) = ?)
             OR (? IS NOT NULL AND email = ?)`,
        [diez, diez, fila.email || null, fila.email || null]
      );
    }

    res.send(pagina({
      titulo: 'Listo',
      cuerpo: '<span class="ok">Su solicitud quedó registrada.</span><br>No volverá a recibir mensajes de esta campaña.',
    }));
  } catch (err) {
    console.error('Error registrando la baja:', err);
    res.status(500).send(pagina({
      titulo: 'No se pudo registrar',
      cuerpo: 'Hubo un problema al registrar su solicitud. Intente de nuevo en unos minutos.',
    }));
  }
});

module.exports = router;

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
 * Y tampoco lo hace la propia página: la baja sale SÓLO al tocar el botón. Google revisa los
 * enlaces de los SMS con un Chrome real, que ejecuta JavaScript; un envío automático daría de
 * baja a quien nunca abrió el mensaje (ver config/paginaBaja.js, compartido con /v).
 *
 * SE MARCA A LA PERSONA, NO AL NÚMERO — igual que la baja del parche 14: un
 * teléfono se comparte en una familia, así que se marcan todas las fichas que
 * lo tengan. Hacerlo distinto aquí significaría que la misma persona sigue
 * recibiendo por su otra ficha.
 */
'use strict';

const express = require('express');
const pool = require('../config/db');
const { verificar, aplicarBajaDeFicha } = require('../config/bajaContacto');
const { confirmacionDeBaja, ANTES, LISTO } = require('../config/paginaBaja');

const router = express.Router();

function pagina({ titulo, cuerpo, boton }) {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${titulo}</title>
<link rel="stylesheet" href="/app/estilos-app.css">
<style>
  body { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
         background: var(--fondo, #f4f6fb); color: var(--texto, #1b2333); margin: 0;
         display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; }
  .caja { background: #fff; border-radius: var(--radio, 18px); padding: 30px 26px; max-width: 420px; width: 100%;
          box-shadow: var(--sombra-flot, 0 8px 24px rgba(8,66,152,.13)); text-align: center; }
  h1 { font-size: 1.25rem; color: var(--marca-azul-osc, #084298); font-weight: 800; margin: 0 0 12px; }
  p { font-size: 1rem; line-height: 1.55; color: var(--texto-2, #6a7590); margin: 0 0 18px; }
  button { display: flex; align-items: center; justify-content: center; background: var(--marca-amarillo, #FFC300); color: #1b2333; border: 0; border-radius: 999px;
           font-size: 16.5px; font-weight: 800; min-height: 54px; padding: 12px 26px; cursor: pointer; width: 100%;
           box-shadow: 0 8px 20px rgba(255,195,0,.4); font-family: inherit; }
  button:disabled { opacity: .6; box-shadow: none; }
  .ok { color: var(--ok, #1e6b2e); font-weight: 700; }
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
    titulo: ANTES.titulo,
    cuerpo: ANTES.cuerpo,
    boton: confirmacionDeBaja(`/b/${encodeURIComponent(req.params.codigo)}`),
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
    // Se marcan TODAS las fichas de esa persona (ver `aplicarBajaDeFicha`, que es la misma
    // que usa la baja desde el enlace «Ya voté»).
    if (!(await aplicarBajaDeFicha(pool, tabla, id))) {
      return res.status(404).send(pagina({
        titulo: 'Enlace no válido', cuerpo: 'Este enlace no es válido o ya no está vigente.',
      }));
    }

    res.send(pagina({ titulo: LISTO.titulo, cuerpo: `<span class="ok">${LISTO.cuerpo}</span>` }));
  } catch (err) {
    console.error('Error registrando la baja:', err);
    res.status(500).send(pagina({
      titulo: 'No se pudo registrar',
      cuerpo: 'Hubo un problema al registrar su solicitud. Intente de nuevo en unos minutos.',
    }));
  }
});

module.exports = router;

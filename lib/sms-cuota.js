/**
 * sms-cuota.js — Control de creditos por campaña + bitacora de envios
 * Estrategia Marketing Politico / appestrategia.net
 *
 * MODELO: cuenta maestra unica de Onurix (suya), creditos revendidos por campaña.
 *
 * DONDE VIVE CADA COSA:
 *   - El ledger de creditos vive en la BD CENTRAL de licencias.
 *     El cliente NO puede editarlo. Esa es la razon de separarlo.
 *   - La bitacora de envios vive en la BD de la campaña.
 *
 * Uso:
 *   const crearCanal = require('./lib/sms-cuota');
 *   const canal = crearCanal({ poolCentral, poolCampana, campanaId: 'ramos2027' });
 *   const r = await canal.enviar({ to, body, origen: 'testigos' });
 *
 * Requiere mysql2/promise.
 */

'use strict';

const { sendSMS, analizarTexto, normalizarCelular, forzarGSM7 } = require('./sms');

function hoyISO() {
  // Fecha local Colombia (UTC-5), no UTC. Importante para el limite diario.
  const d = new Date(Date.now() - 5 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

function crearCanal({ poolCentral, poolCampana, campanaId, config = {} }) {
  if (!poolCentral || !poolCampana || !campanaId) {
    throw new Error('crearCanal requiere poolCentral, poolCampana y campanaId');
  }

  // -------------------------------------------------------------------------
  // Cuota
  // -------------------------------------------------------------------------

  async function consultarSaldo() {
    const [filas] = await poolCentral.query(
      `SELECT creditos_asignados, creditos_consumidos, limite_diario, activo
         FROM sms_cuota WHERE campana_id = ?`,
      [campanaId]
    );
    if (!filas.length) return null;

    const f = filas[0];
    const [dia] = await poolCentral.query(
      `SELECT creditos FROM sms_consumo_diario WHERE campana_id = ? AND fecha = ?`,
      [campanaId, hoyISO()]
    );

    const consumidoHoy = dia.length ? dia[0].creditos : 0;

    return {
      asignados: f.creditos_asignados,
      consumidos: f.creditos_consumidos,
      disponibles: f.creditos_asignados - f.creditos_consumidos,
      limiteDiario: f.limite_diario,
      consumidoHoy,
      disponibleHoy: f.limite_diario > 0
        ? Math.max(0, f.limite_diario - consumidoHoy)
        : null,
      activo: Boolean(f.activo),
    };
  }

  /**
   * Reserva creditos de forma atomica. Devuelve true si alcanzo.
   * El UPDATE condicional evita condiciones de carrera con envios simultaneos.
   */
  async function reservar(creditos) {
    const conn = await poolCentral.getConnection();
    try {
      await conn.beginTransaction();

      const [r1] = await conn.query(
        `UPDATE sms_cuota
            SET creditos_consumidos = creditos_consumidos + ?
          WHERE campana_id = ?
            AND activo = 1
            AND (creditos_asignados - creditos_consumidos) >= ?`,
        [creditos, campanaId, creditos]
      );

      if (r1.affectedRows === 0) {
        await conn.rollback();
        return { ok: false, motivo: 'SIN_SALDO' };
      }

      // Limite diario
      const [r2] = await conn.query(
        `INSERT INTO sms_consumo_diario (campana_id, fecha, creditos)
              VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE creditos = creditos + VALUES(creditos)`,
        [campanaId, hoyISO(), creditos]
      );

      const [lim] = await conn.query(
        `SELECT c.limite_diario, d.creditos AS hoy
           FROM sms_cuota c
           LEFT JOIN sms_consumo_diario d
             ON d.campana_id = c.campana_id AND d.fecha = ?
          WHERE c.campana_id = ?`,
        [hoyISO(), campanaId]
      );

      const ld = lim[0];
      if (ld && ld.limite_diario > 0 && ld.hoy > ld.limite_diario) {
        await conn.rollback();
        return { ok: false, motivo: 'LIMITE_DIARIO' };
      }

      await conn.query(
        `INSERT INTO sms_movimientos (campana_id, tipo, creditos, detalle)
              VALUES (?, 'consumo', ?, 'reserva previa a envio')`,
        [campanaId, -creditos]
      );

      await conn.commit();
      return { ok: true };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  /** Devuelve creditos si el envio fallo. */
  async function devolver(creditos, motivo) {
    const conn = await poolCentral.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(
        `UPDATE sms_cuota
            SET creditos_consumidos = GREATEST(0, creditos_consumidos - ?)
          WHERE campana_id = ?`,
        [creditos, campanaId]
      );
      await conn.query(
        `UPDATE sms_consumo_diario
            SET creditos = GREATEST(0, creditos - ?)
          WHERE campana_id = ? AND fecha = ?`,
        [creditos, campanaId, hoyISO()]
      );
      await conn.query(
        `INSERT INTO sms_movimientos (campana_id, tipo, creditos, detalle)
              VALUES (?, 'devolucion', ?, ?)`,
        [campanaId, creditos, motivo || 'envio fallido']
      );
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  // -------------------------------------------------------------------------
  // Exclusiones
  // -------------------------------------------------------------------------

  async function estaExcluido(destino) {
    const [f] = await poolCampana.query(
      `SELECT 1 FROM sms_exclusiones WHERE destino = ? LIMIT 1`,
      [destino]
    );
    return f.length > 0;
  }

  async function excluir(destino, motivo, origen) {
    const n = normalizarCelular(destino);
    if (!n) return false;
    await poolCampana.query(
      `INSERT IGNORE INTO sms_exclusiones (destino, motivo, origen) VALUES (?, ?, ?)`,
      [n, motivo || null, origen || null]
    );
    return true;
  }

  // -------------------------------------------------------------------------
  // Bitacora
  // -------------------------------------------------------------------------

  async function registrar(datos) {
    const [r] = await poolCampana.query(
      `INSERT INTO sms_envios
        (destino, contacto_id, mensaje, segmentos, codificacion,
         proveedor, proveedor_id, fallback_desde, estado,
         error_codigo, error_mensaje, origen, lote_id, usuario_id, consentimiento)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        datos.destino, datos.contactoId || null, datos.mensaje,
        datos.segmentos, datos.codificacion,
        datos.proveedor || null, datos.proveedorId || null,
        datos.fallbackDesde || null, datos.estado,
        datos.errorCodigo || null,
        datos.errorMensaje ? String(datos.errorMensaje).slice(0, 255) : null,
        datos.origen || null, datos.loteId || null,
        datos.usuarioId || null, datos.consentimiento ? 1 : 0,
      ]
    );
    return r.insertId;
  }

  // -------------------------------------------------------------------------
  // Envio con cuota
  // -------------------------------------------------------------------------

  /**
   * @param {Object} o
   * @param {string} o.to
   * @param {string} o.body
   * @param {string} [o.origen]        'testigos' | 'coordinadores' | 'sistema'
   * @param {string} [o.loteId]
   * @param {number} [o.contactoId]
   * @param {number} [o.usuarioId]
   * @param {boolean}[o.consentimiento]
   * @param {boolean}[o.omitirExclusion] solo para mensajes operativos internos
   */
  async function enviar(o) {
    const destino = normalizarCelular(o.to);
    if (!destino) {
      return { ok: false, errorCodigo: 'NUMERO',
               error: `Numero invalido: ${o.to}` };
    }

    // La lista de exclusion se respeta salvo en mensajeria interna al equipo.
    if (!o.omitirExclusion && (await estaExcluido(destino))) {
      await registrar({
        destino, mensaje: o.body, segmentos: 0, codificacion: 'gsm7',
        estado: 'rechazado', errorCodigo: 'EXCLUIDO',
        errorMensaje: 'Numero en lista de exclusion',
        origen: o.origen, loteId: o.loteId, contactoId: o.contactoId,
        usuarioId: o.usuarioId, consentimiento: o.consentimiento,
      });
      return { ok: false, errorCodigo: 'EXCLUIDO',
               error: 'El numero pidio no recibir mas mensajes' };
    }

    const texto = config.forzarGSM7 === false ? o.body : forzarGSM7(o.body);
    const analisis = analizarTexto(texto);
    const creditos = analisis.segmentos;

    const reserva = await reservar(creditos);
    if (!reserva.ok) {
      await registrar({
        destino, mensaje: texto, segmentos: creditos,
        codificacion: analisis.codificacion, estado: 'rechazado',
        errorCodigo: reserva.motivo,
        errorMensaje: reserva.motivo === 'SIN_SALDO'
          ? 'Creditos agotados' : 'Limite diario alcanzado',
        origen: o.origen, loteId: o.loteId, contactoId: o.contactoId,
        usuarioId: o.usuarioId, consentimiento: o.consentimiento,
      });
      return { ok: false, errorCodigo: reserva.motivo,
               error: reserva.motivo === 'SIN_SALDO'
                 ? 'La campaña no tiene creditos disponibles'
                 : 'Se alcanzo el limite diario de envios' };
    }

    const r = await sendSMS({
      to: destino,
      body: texto,
      config,
      proveedor: config.proveedorPreferido,
      forzarGSM7: false, // ya se aplico arriba
    });

    if (!r.ok) {
      await devolver(creditos, `envio fallido: ${r.errorCodigo}`);
    }

    const envioId = await registrar({
      destino, mensaje: texto, segmentos: creditos,
      codificacion: analisis.codificacion,
      proveedor: r.provider, proveedorId: r.providerId,
      fallbackDesde: r.fallbackDesde,
      estado: r.ok ? 'aceptado' : 'fallido',
      errorCodigo: r.errorCodigo, errorMensaje: r.error,
      origen: o.origen, loteId: o.loteId, contactoId: o.contactoId,
      usuarioId: o.usuarioId, consentimiento: o.consentimiento,
    });

    return { ...r, envioId, creditosUsados: r.ok ? creditos : 0 };
  }

  /**
   * Lote secuencial con verificacion previa de saldo.
   * Falla rapido si no alcanza para todo, en vez de enviar a medias.
   */
  async function enviarLote(mensajes, opts = {}) {
    const loteId = opts.loteId || `lote_${Date.now()}`;
    const pausa = opts.pausaMs !== undefined ? opts.pausaMs : 250;

    // Estimacion previa
    const estimado = mensajes.reduce((acc, m) => {
      const t = config.forzarGSM7 === false ? m.body : forzarGSM7(m.body);
      return acc + analizarTexto(t).segmentos;
    }, 0);

    const saldo = await consultarSaldo();
    if (!saldo) {
      return { ok: false, error: 'La campaña no tiene cuota configurada' };
    }
    if (!saldo.activo) {
      return { ok: false, error: 'El canal SMS esta desactivado para esta campaña' };
    }
    if (saldo.disponibles < estimado && !opts.parcialPermitido) {
      return {
        ok: false,
        error: `Creditos insuficientes: necesita ${estimado}, tiene ${saldo.disponibles}`,
        estimado, disponibles: saldo.disponibles,
      };
    }

    const resultados = [];
    for (let i = 0; i < mensajes.length; i++) {
      const r = await enviar({ ...mensajes[i], loteId, origen: opts.origen });
      resultados.push({ ...r, indice: i, destino: mensajes[i].to });

      if (typeof opts.onProgreso === 'function') {
        opts.onProgreso(i + 1, mensajes.length, r);
      }
      // Si se acabo el saldo a mitad, no seguir golpeando la BD.
      if (r.errorCodigo === 'SIN_SALDO' || r.errorCodigo === 'LIMITE_DIARIO') {
        console.warn(`[SMS] Lote ${loteId} detenido en ${i + 1}/${mensajes.length}: ${r.error}`);
        break;
      }
      if (pausa > 0 && i < mensajes.length - 1) {
        await new Promise((res) => setTimeout(res, pausa));
      }
    }

    const ok = resultados.filter((r) => r.ok).length;
    return {
      ok: true,
      loteId,
      total: mensajes.length,
      procesados: resultados.length,
      enviados: ok,
      fallidos: resultados.length - ok,
      creditosUsados: resultados.reduce((a, r) => a + (r.creditosUsados || 0), 0),
      resultados,
    };
  }

  return {
    enviar,
    enviarLote,
    consultarSaldo,
    excluir,
    estaExcluido,
  };
}

module.exports = crearCanal;

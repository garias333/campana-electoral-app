'use strict';
/**
 * validarCedula.js — Validación de cédula digitada en campo (modo declarado).
 *
 * CONTEXTO
 * --------
 * La cédula de ciudadanía colombiana NO tiene dígito de verificación. Un número
 * mal digitado es sintácticamente indistinguible de uno correcto. Por tanto la
 * validación aquí es ESTADÍSTICA, no determinística: se buscan inconsistencias
 * entre el número y los demás datos declarados.
 *
 * PRINCIPIO RECTOR
 * ----------------
 * El validador ADVIERTE; no rechaza. Solo se bloquea por formato imposible.
 * Existen cédulas legítimas fuera de todo patrón: nacionalizados, reposiciones,
 * expediciones tardías, correcciones de registro civil. Impedirle registrarse a
 * un ciudadano real es un error peor que admitir un registro dudoso marcado
 * como tal. Cuando llegue el censo del partido, las advertencias se resuelven
 * con verificación diferida.
 *
 * AUTOCALIBRACIÓN
 * ---------------
 * La tabla `cedula_cohorte` se construye desde los propios registros capturados
 * (ver scripts/calibrar_cohortes.js). Al inicio está vacía y el validador opera
 * solo con reglas de formato. A medida que se acumulan capturas, la validación
 * de cohorte se activa por bucket, cuando cada uno alcanza muestra suficiente.
 */

/**
 * Códigos de formato que SÍ impiden guardar. Son los imposibles: no hay
 * cédula colombiana vacía, con letras, de 3 dígitos o de 15.
 *
 * `digito_repetido` y `secuencia_trivial` quedan FUERA a propósito, aunque
 * el validador los detecte: son heurísticas de tecleo, no formatos
 * imposibles, y bloquear con ellas contradice el principio declarado
 * arriba — impedirle registrarse a un ciudadano real es peor que admitir
 * un registro dudoso marcado como tal. Advierten, y quien captura decide.
 */
const CODIGOS_QUE_BLOQUEAN = [
  'vacio', 'sin_digitos', 'solo_ceros',
  'caracteres_no_numericos', 'demasiado_corta', 'demasiado_larga',
];

// Muestra mínima por bucket para que la validación de cohorte sea confiable.
// Por debajo de esto el bucket no se usa: mejor no validar que validar mal.
const MIN_MUESTRAS_BUCKET = 40;

// Holgura sobre los percentiles observados, en años. Absorbe la cola de la
// distribución que no está en la muestra.
const HOLGURA_ANIOS = 6;

// Proporción mínima para considerar que un bucket tiene sexo dominante.
const UMBRAL_SEXO_DOMINANTE = 0.93;

const ANIO_ACTUAL = () => new Date().getFullYear();

// ============================================================
// Formato
// ============================================================

/**
 * Reglas de formato. Lo único que puede producir bloqueo duro.
 * @returns {{ok:boolean, cedula:string|null, errores:string[]}}
 */
function validarFormato(entrada) {
  const errores = [];
  const crudo = String(entrada ?? '').trim();

  if (!crudo) return { ok: false, cedula: null, errores: ['vacio'] };

  // Se aceptan puntos y espacios como separadores de miles; nada más.
  if (/[^0-9.\s]/.test(crudo)) errores.push('caracteres_no_numericos');

  const n = crudo.replace(/[^0-9]/g, '');
  if (!n) return { ok: false, cedula: null, errores: ['sin_digitos'] };

  const sinCeros = n.replace(/^0+/, '');
  if (!sinCeros) return { ok: false, cedula: null, errores: ['solo_ceros'] };

  if (sinCeros.length < 6)  errores.push('demasiado_corta');
  if (sinCeros.length > 10) errores.push('demasiado_larga');

  // Patrones de tecleo accidental
  if (/^(\d)\1+$/.test(sinCeros))              errores.push('digito_repetido');
  if (/^(?:0123456789|123456789|12345678)/.test(sinCeros)) errores.push('secuencia_trivial');

  return {
    ok: errores.length === 0,
    cedula: sinCeros,
    errores,
  };
}

// ============================================================
// Cohorte: coherencia entre rango de cédula y año de nacimiento
// ============================================================

/**
 * @param {string} cedula
 * @param {Array} tabla  filas de cedula_cohorte
 */
function buscarBucket(cedula, tabla) {
  const n = Number(cedula);
  if (!Number.isFinite(n)) return null;
  return tabla.find(b => n >= Number(b.bucket_ini) && n <= Number(b.bucket_fin)) || null;
}

/**
 * Contrasta el año de nacimiento declarado contra la distribución observada
 * para el rango de cédula.
 * @returns {{senal:string|null, detalle:object}}
 */
function validarCohorte(cedula, fechaNacimiento, tabla) {
  if (!tabla || !tabla.length) return { senal: null, detalle: { motivo: 'tabla_vacia' } };
  if (!fechaNacimiento)        return { senal: null, detalle: { motivo: 'sin_fecha' } };

  const anio = Number(String(fechaNacimiento).slice(0, 4));
  if (!Number.isFinite(anio)) return { senal: null, detalle: { motivo: 'fecha_ilegible' } };

  const b = buscarBucket(cedula, tabla);
  if (!b) return { senal: null, detalle: { motivo: 'sin_bucket' } };
  if (b.n_muestras < MIN_MUESTRAS_BUCKET) {
    return { senal: null, detalle: { motivo: 'muestra_insuficiente', n: b.n_muestras } };
  }
  if (b.anio_p05 == null || b.anio_p95 == null) {
    return { senal: null, detalle: { motivo: 'bucket_sin_percentiles' } };
  }

  const min = Number(b.anio_p05) - HOLGURA_ANIOS;
  const max = Number(b.anio_p95) + HOLGURA_ANIOS;

  if (anio < min || anio > max) {
    return {
      senal: 'cohorte_inconsistente',
      detalle: {
        anio_declarado: anio,
        esperado: [min, max],
        mediana_bucket: Number(b.anio_p50),
        desvio_anios: anio < min ? min - anio : anio - max,
        n: b.n_muestras,
      },
    };
  }
  return { senal: null, detalle: { motivo: 'coherente', mediana_bucket: Number(b.anio_p50) } };
}

/**
 * La serie antigua de cédulas se asignaba en rangos separados por sexo.
 * Solo aplica donde la muestra muestre dominancia clara.
 */
function validarSexoSerie(cedula, sexo, tabla) {
  if (!sexo || !tabla || !tabla.length) return { senal: null, detalle: {} };
  const b = buscarBucket(cedula, tabla);
  if (!b || b.n_muestras < MIN_MUESTRAS_BUCKET) return { senal: null, detalle: {} };
  if (!b.sexo_dominante || b.sexo_dominante === 'MIXTO') return { senal: null, detalle: {} };
  if (Number(b.sexo_pct) < UMBRAL_SEXO_DOMINANTE) return { senal: null, detalle: {} };

  if (sexo !== b.sexo_dominante) {
    return {
      senal: 'sexo_inconsistente_con_serie',
      detalle: { declarado: sexo, esperado: b.sexo_dominante, pct: Number(b.sexo_pct), n: b.n_muestras },
    };
  }
  return { senal: null, detalle: {} };
}

// ============================================================
// Coherencia interna del formulario
// ============================================================

function validarEdad(fechaNacimiento) {
  if (!fechaNacimiento) return { senal: null, detalle: {} };
  const anio = Number(String(fechaNacimiento).slice(0, 4));
  if (!Number.isFinite(anio)) return { senal: null, detalle: {} };
  const edad = ANIO_ACTUAL() - anio;

  if (edad < 18) return { senal: 'menor_de_edad', detalle: { edad } };
  if (edad > 110) return { senal: 'edad_implausible', detalle: { edad } };
  return { senal: null, detalle: { edad } };
}

function validarNombres(d) {
  const senales = [];
  const re = /^[A-ZÑÁÉÍÓÚÜ][A-ZÑÁÉÍÓÚÜ ]{1,59}$/i;
  if (!d.primerNombre || !re.test(d.primerNombre.trim()))     senales.push('primer_nombre_invalido');
  if (!d.primerApellido || !re.test(d.primerApellido.trim())) senales.push('primer_apellido_invalido');
  // Tecleo de relleno tipo "AAA", "XXX", "NN"
  for (const [k, v] of Object.entries({
    primerNombre: d.primerNombre, primerApellido: d.primerApellido,
  })) {
    const s = String(v || '').replace(/\s/g, '').toUpperCase();
    if (s && (/^(.)\1+$/.test(s) || ['NN', 'XX', 'ND', 'NA'].includes(s))) {
      senales.push(`${k}_relleno`);
    }
  }
  return senales;
}

// ============================================================
// Entrada pública
// ============================================================

/**
 * @param {object} datos
 *   { cedula, primerNombre, segundoNombre, primerApellido, segundoApellido,
 *     sexo, fechaNacimiento, dobleDigitacion:{ingresado:string} }
 * @param {Array} tablaCohorte  filas de cedula_cohorte (puede ir vacía)
 * @returns {{nivel:'ok'|'advertencia'|'bloqueo', cedula:string|null,
 *            senales:Array<{codigo:string, detalle:object}>, mensajes:string[]}}
 */
function validarCedula(datos, tablaCohorte = []) {
  const senales = [];
  const mensajes = [];

  // --- Formato: única fuente de bloqueo ---
  const f = validarFormato(datos.cedula);
  const bloqueos = f.errores.filter(e => CODIGOS_QUE_BLOQUEAN.includes(e));
  if (bloqueos.length) {
    return {
      nivel: 'bloqueo',
      cedula: f.cedula,
      senales: bloqueos.map(e => ({ codigo: e, detalle: {} })),
      mensajes: ['El número de cédula no tiene un formato válido. Verifíquelo con la persona.'],
    };
  }
  // Lo que detectó el formato y NO bloquea (dígitos repetidos, secuencia
  // trivial) sigue viaje como advertencia.
  for (const e of f.errores) {
    senales.push({ codigo: e, detalle: {} });
    if (e === 'digito_repetido') mensajes.push('El número tiene todos los dígitos iguales. Confírmelo con la persona.');
    if (e === 'secuencia_trivial') mensajes.push('El número parece una secuencia escrita de corrido. Confírmelo con la persona.');
  }
  const cedula = f.cedula;

  // --- Doble digitación de los últimos 4 ---
  if (datos.dobleDigitacion && datos.dobleDigitacion.ingresado != null) {
    const conf = String(datos.dobleDigitacion.ingresado).replace(/\D/g, '');
    if (conf !== cedula.slice(-4)) {
      return {
        nivel: 'bloqueo',
        cedula,
        senales: [{ codigo: 'doble_digitacion_no_coincide', detalle: {} }],
        mensajes: ['Los últimos 4 dígitos no coinciden. Vuelva a digitar el número completo.'],
      };
    }
  }

  // --- Señales estadísticas: solo advierten ---
  const coh = validarCohorte(cedula, datos.fechaNacimiento, tablaCohorte);
  if (coh.senal) {
    senales.push({ codigo: coh.senal, detalle: coh.detalle });
    mensajes.push(
      `El número de cédula no corresponde a la edad indicada (${coh.detalle.anio_declarado}). `
      + 'Confirme ambos datos con la persona.');
  }

  const sx = validarSexoSerie(cedula, datos.sexo, tablaCohorte);
  if (sx.senal) {
    senales.push({ codigo: sx.senal, detalle: sx.detalle });
    mensajes.push('El número de cédula no corresponde al sexo indicado. Confirme ambos datos.');
  }

  const ed = validarEdad(datos.fechaNacimiento);
  if (ed.senal === 'menor_de_edad') {
    senales.push({ codigo: ed.senal, detalle: ed.detalle });
    mensajes.push('La persona sería menor de edad y no estaría habilitada para votar. Verifique la fecha.');
  } else if (ed.senal) {
    senales.push({ codigo: ed.senal, detalle: ed.detalle });
    mensajes.push('La edad calculada es poco plausible. Verifique la fecha de nacimiento.');
  }

  for (const s of validarNombres(datos)) {
    senales.push({ codigo: s, detalle: {} });
  }
  if (senales.some(s => s.codigo.includes('nombre') || s.codigo.includes('apellido'))) {
    mensajes.push('Revise la escritura del nombre y el apellido.');
  }

  return {
    nivel: senales.length ? 'advertencia' : 'ok',
    cedula,
    senales,
    mensajes,
  };
}

// El mismo archivo se usa en el servidor (require) y en el navegador
// (<script src>). Sin esta guarda, `module` no existe en el navegador y la
// página muere con "module is not defined" al cargarlo. Una sola copia del
// validador: si se duplicara, las dos reglas divergirían tarde o temprano
// y el formulario diría una cosa y la API otra.
const API_VALIDACION = {
  validarCedula, validarFormato, validarCohorte, validarSexoSerie,
  validarEdad, validarNombres, buscarBucket,
  CODIGOS_QUE_BLOQUEAN, MIN_MUESTRAS_BUCKET, HOLGURA_ANIOS,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = API_VALIDACION;
} else if (typeof window !== 'undefined') {
  window.ValidarCedula = API_VALIDACION;
}

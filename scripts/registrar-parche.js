#!/usr/bin/env node
/**
 * REGISTRA Y FIRMA UN PARCHE EN EL PANEL DE LICENCIAS. INACTIVO. NADA MÁS.
 *
 * Uso:
 *   node scripts/registrar-parche.js 260 "Título corto" ["Descripción larga"]
 *
 * Es la otra mitad de scripts/publicar-parche.sh. Aquel deja el .zip en la
 * carpeta desde la que el servidor SIRVE las descargas; éste le pide al
 * PROPIO Servidor de Licencias que calcule el sha256, derive si toca base
 * de datos, lo firme y cree la fila — este script ya no hace ninguna de
 * esas tres cosas.
 *
 * ------------------------------------------------------------------------
 * POR QUÉ CAMBIÓ DE FORMA (antes de la firma de parches)
 *
 * La versión anterior leía `/home/appestrategia-licencias/.../.env` desde
 * ESTE lado y hacía un INSERT directo contra la base de licencias-app,
 * usando el acceso de archivo (ACL) que ya existe para publicar-parche.sh.
 * Funcionaba, pero significaba que cualquiera con ese mismo acceso podía
 * escribir en `parches_disponibles` sin pasar por ninguna regla del lado
 * de licencias-app — ni firmar nada, ni validar nada.
 *
 * Ahora ESTE script no toca ni el filesystem ni la base de licencias-app
 * directamente: llama a `POST /parches/registrar-y-firmar`, autenticado
 * con un secreto propio (`PARCHES_PUBLICADOR_SECRET`, nunca el mismo
 * `LICENCIA_API_SECRET` que ya tiene CADA campaña cliente — ese es un solo
 * valor compartido por TODAS las instalaciones, así que usarlo aquí le
 * habría dado a cualquier cliente la capacidad de hacer firmar un parche).
 * Quien de verdad calcula el hash, deriva `toca_base_datos` y firma con la
 * llave privada es el propio Servidor de Licencias — la llave nunca sale
 * de ahí.
 *
 * EL REQUISITO (Orden 46). El zip trae `.parche-requiere` (lo escribe
 * generar-parche.js). Aquí se lee del zip local, se compara con el «Requiere el
 * N» del título y se manda al servidor, que lo vuelve a leer de SU copia del zip
 * (la que de verdad se va a servir) y lo guarda: no ofrecerá el parche a una
 * campaña que no reporte tenerlo, y el panel marcará «falta el N».
 *
 * LA DISTRIBUCIÓN NACE EN «seleccionadas», SIN NINGUNA CAMPAÑA MARCADA, nunca en
 * «Todos» (lo hace el servidor al registrar). Así un parche recién registrado no
 * le llega a nadie aunque alguien lo active por descuido; hay que elegir a
 * quién en el panel (o con «Aplicar ahora», que agrega a la elegida).
 *
 * `publicar-parche.sh` SIGUE IGUAL: el .zip se sigue copiando por el mismo
 * canal de archivos de siempre. Lo único que cambia es quién y cómo
 * registra la fila.
 * ------------------------------------------------------------------------
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const SERVIDOR_LICENCIAS = process.env.LICENCIA_SERVIDOR_URL;
const SECRETO_PUBLICADOR = process.env.PARCHES_PUBLICADOR_SECRET;

const numero = parseInt(process.argv[2], 10);
const nombre = process.argv[3];
const descripcion = process.argv[4] || null;

if (!Number.isInteger(numero) || numero < 1 || !nombre) {
  console.error('Uso: node scripts/registrar-parche.js <numero> "<nombre>" ["<descripcion>"]');
  process.exit(1);
}

if (!SERVIDOR_LICENCIAS || !SECRETO_PUBLICADOR) {
  console.error(
    'Faltan variables de entorno: LICENCIA_SERVIDOR_URL y/o PARCHES_PUBLICADOR_SECRET.\n' +
    'Esta última es NUEVA (no es LICENCIA_API_SECRET) — pídesela a quien tenga acceso al ' +
    '.env del Servidor de Licencias, que debe tener el mismo valor.'
  );
  process.exit(1);
}

/** El requisito que lleva el zip local (parches/campana-parche<N>.zip), o null. */
function requisitoDelZipLocal(n) {
  const zip = path.join(__dirname, '..', 'parches', `campana-parche${n}.zip`);
  if (!fs.existsSync(zip)) return { zip, requisito: null, existe: false };
  try {
    const t = execFileSync('unzip', ['-p', zip, '.parche-requiere'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return { zip, requisito: /^\d+$/.test(t) ? Number(t) : null, existe: true };
  } catch (err) {
    return { zip, requisito: null, existe: true };   // unzip sale con error si el archivo no existe dentro del zip
  }
}

(async () => {
  const local = requisitoDelZipLocal(numero);
  const delTitulo = (/\brequiere\s+(?:el\s+)?#?(\d+)\b/i.exec(nombre) || [])[1];
  if (local.existe) {
    if (local.requisito === null) {
      console.warn('AVISO: el zip local NO trae .parche-requiere (formato anterior a la Orden 46): el actualizador solo lo aplicará si es el siguiente al .version-parche.');
    } else {
      console.log(`Requisito del zip: #${local.requisito}.`);
      if (delTitulo && Number(delTitulo) !== local.requisito) {
        console.warn(`AVISO: el título dice «Requiere el ${delTitulo}» pero el zip requiere el ${local.requisito}. Vale el del zip; corrige el título.`);
      }
    }
  }
  console.log(`Pidiéndole al Servidor de Licencias que registre y firme el parche #${numero}...`);

  const resp = await fetch(`${SERVIDOR_LICENCIAS}/parches/registrar-y-firmar`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Publicador-Secret': SECRETO_PUBLICADOR,
    },
    body: JSON.stringify({ numero_parche: numero, nombre, descripcion, requiere_parche: local.requisito }),
  });

  const datos = await resp.json().catch(() => ({}));

  // Respuesta cruda, siempre -- para depurar sin adivinar qué resumió el
  // mensaje bonito de abajo.
  console.log(`HTTP ${resp.status} — ${JSON.stringify(datos)}`);

  if (!resp.ok) {
    console.error(`No se pudo registrar el parche #${numero} (HTTP ${resp.status}): ${datos.error || 'sin detalle'}`);
    if (resp.status === 404) {
      console.error(`¿Ya corriste "bash scripts/publicar-parche.sh ${numero}"? El servidor no encontró el .zip.`);
    }
    process.exit(1);
  }

  console.log(`Registrado el parche #${numero}: «${nombre}»`);
  console.log(`  toca base datos : ${datos.toca_base_datos ? 'SÍ (trae archivos de db/)' : 'no'}`);
  console.log(`  sha256          : ${datos.sha256 || '(no informado)'}`);
  console.log(`  requiere        : ${datos.requiere_parche ? '#' + datos.requiere_parche : '(ninguno declarado: solo se aplica si es el siguiente)'}`);
  console.log('  firmado         : sí (Ed25519, llave del Servidor de Licencias)');
  console.log('  estado          : INACTIVO');
  console.log(`  distribución    : ${datos.modo_distribucion || 'seleccionadas'} — sin ninguna campaña marcada`);
  console.log('');
  console.log('Inactivo y sin campañas a propósito: ninguna instalación lo va a descargar sola.');
  console.log('Elige a quién en el panel (Parches → Distribución, o «Aplicar actualizaciones») y actívalo cuando lo hayas probado.');
})().catch((err) => {
  console.error('No se pudo registrar:', err.message);
  process.exit(1);
});

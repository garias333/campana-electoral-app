/**
 * Los ítems de LOGÍSTICA del día D que se siembran al crear el módulo (orden 39). Un archivo aparte, sin base de datos,
 * porque lo usan `db/init-db.js` (que no debe abrir el pool de la aplicación) y `lib/logisticaDiaD.js`.
 *
 * Son editables y desactivables, NO borrables: una entrega registrada apunta a su ítem. `hora` es hasta cuándo debe
 * estar entregado (la alerta «sin entregar» sólo cuenta desde esa hora).
 */
'use strict';

const ITEMS_DE_FABRICA = [
  { nombre: 'Kit de testigo', hora: '07:00:00', destinatario: 'testigos', orden: 1 },
  { nombre: 'Refrigerio',     hora: '12:00:00', destinatario: 'testigos', orden: 2 },
  { nombre: 'Almuerzo',       hora: '14:00:00', destinatario: 'testigos', orden: 3 },
];

module.exports = { ITEMS_DE_FABRICA };

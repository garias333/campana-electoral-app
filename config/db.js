const mysql = require('mysql2/promise');

// Nota: en Hostinger usar 127.0.0.1 en DB_HOST evita el problema clásico
// de resolución IPv6/IPv4 que causa timeouts intermitentes de conexión.
const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  dateStrings: true
});

/* ---------------------------------------------------------------------------
   LA SESIÓN HABLA EN HORA DE COLOMBIA

   El servidor y MySQL corren en UTC, pero esta aplicación es colombiana de
   punta a punta. Sin esto, `NOW()` guardaba las 16:00 para algo que pasó a
   las 11 de la mañana, y la pantalla mostraba esas 16:00 como si fueran la
   hora local: **cinco horas adelante**, en el historial de envíos, la
   auditoría y todo lo que lleve fecha.

   POR QUÉ AQUÍ Y NO AL PINTAR. En la base conviven dos clases de fecha: las
   que pone la máquina (`NOW()`, `created_at`) y las que escribe una persona
   en un campo `datetime-local` —eventos, agenda, programación de envíos—,
   que ya vienen en hora de Colombia. Corregir en la pantalla habría arreglado
   las primeras y corrido las segundas cinco horas al otro lado. Aquí las dos
   quedan hablando el mismo idioma.

   ES `-05:00` Y NO `America/Bogota` A PROPÓSITO: el nombre exige las tablas
   de zonas horarias de MySQL, que no siempre están cargadas, y falla en
   silencio. Colombia no tiene horario de verano, así que el desfase fijo es
   exacto y no cambia nunca.

   Va en el evento `connection` porque el pool abre conexiones cuando le hace
   falta: fijarlo una sola vez al arrancar dejaría a las demás en UTC, y las
   fechas saldrían bien o mal según qué conexión atendiera la consulta — el
   peor error posible, porque es intermitente.
--------------------------------------------------------------------------- */
pool.pool.on('connection', (conexion) => {
  conexion.query("SET time_zone = '-05:00'");
});

module.exports = pool;

-- ============================================================================
-- PUNTO 3 — Usuario dedicado para que campana-app use el LEDGER de SMS
--           sin tener acceso al resto de licenciasdb
-- Estrategia Marketing Politico / appestrategia.net
--
-- REQUIERE root de MySQL: licenciasuser tiene ALL sobre licenciasdb pero NO
-- tiene GRANT OPTION, asi que no puede repartir permisos.
--   mysql -h 127.0.0.1 -P 3306 -u root -p
-- El -h 127.0.0.1 NO es opcional: sin el, el cliente entra por socket, que es
-- la cuenta root@localhost, y esa tiene otra clave (ver CLAUDE.md).
--
-- ORDEN: correr ANTES sql/migracion-sms-licencias.sql. MySQL exige que la
-- tabla exista para conceder un permiso a nivel de tabla.
--
-- LA CLAVE: sustituir __CLAVE__ antes de ejecutar. Sin '#' (dotenv corta el
-- valor ahi), sin comillas simples ni dobles y sin espacios, porque este mismo
-- valor va al .env de cada campaña.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. La cuenta
--
-- @'localhost' y no @'%', a diferencia de licenciasuser y electoraluser:
-- bind_address = * (MySQL escucha en todas las interfaces), asi que una cuenta
-- @'%' es alcanzable desde fuera del VPS. Las tres apps corren en esta misma
-- maquina, asi que no se pierde nada.
--
-- Funciona porque skip_name_resolve = OFF: una conexion a 127.0.0.1 resuelve
-- a 'localhost' y casa con esta cuenta (medido: electoraluser conecta a
-- 127.0.0.1 y USER() reporta @localhost). Si algun dia se enciende
-- skip_name_resolve, esta cuenta deja de casar y hay que crearla @'127.0.0.1'.
-- ----------------------------------------------------------------------------

CREATE USER IF NOT EXISTS 'smsledger'@'localhost' IDENTIFIED BY '__CLAVE__';

-- ----------------------------------------------------------------------------
-- 2. Los permisos, uno por tabla y ajustados a lo que el codigo hace
--
-- Salen de leer lib/sms-cuota.js, no de suponer:
--   consultarSaldo() -> SELECT en sms_cuota y sms_consumo_diario
--   reservar()       -> UPDATE de creditos_consumidos en sms_cuota
--                       INSERT ... ON DUPLICATE KEY UPDATE en sms_consumo_diario
--                       INSERT en sms_movimientos
--   devolver()       -> UPDATE en las dos primeras + INSERT en movimientos
--
-- "Que solo lea el ledger" no alcanza: la app tiene que descontar el consumo.
-- Lo que si se acota es POR COLUMNA.
-- ----------------------------------------------------------------------------

-- El saldo se lee entero, pero solo se puede mover el consumo.
-- Sin este recorte por columna, la campaña podria subirse creditos_asignados
-- —regalarse saldo— que es justo lo que separar las bases quiere impedir.
GRANT SELECT                       ON licenciasdb.sms_cuota TO 'smsledger'@'localhost';
GRANT UPDATE (creditos_consumidos) ON licenciasdb.sms_cuota TO 'smsledger'@'localhost';

-- Consumo del dia: se inserta la fila del dia y se le suma o resta.
-- El UPDATE tambien va por columna: asi no puede reasignar una fila de consumo
-- a otra campaña cambiandole campana_id o fecha.
GRANT SELECT, INSERT   ON licenciasdb.sms_consumo_diario TO 'smsledger'@'localhost';
GRANT UPDATE (creditos) ON licenciasdb.sms_consumo_diario TO 'smsledger'@'localhost';

-- Bitacora del ledger: solo se escribe. No se puede corregir ni borrar lo ya
-- anotado, que es lo que la hace servir para facturar.
-- (Si algun dia la campaña debe VER su estado de cuenta, se agrega SELECT aqui
-- y en ninguna otra tabla.)
GRANT INSERT ON licenciasdb.sms_movimientos TO 'smsledger'@'localhost';

FLUSH PRIVILEGES;

-- ----------------------------------------------------------------------------
-- 3. Comprobacion — lo que debe poder y lo que NO
--
-- Conectar como la cuenta nueva y correr esto. Las cuatro primeras responden;
-- las cuatro ultimas tienen que dar "command denied". Si alguna de esas pasa,
-- el permiso quedo mas ancho de lo que dice este archivo.
--
--   mysql -h 127.0.0.1 -P 3306 -u smsledger -p licenciasdb
--
--   -- DEBE FUNCIONAR
--   SELECT * FROM sms_cuota;
--   SELECT * FROM sms_consumo_diario;
--   UPDATE sms_cuota SET creditos_consumidos = creditos_consumidos WHERE campana_id='x';
--   INSERT INTO sms_movimientos (campana_id,tipo,creditos) VALUES ('x','consumo',-1);
--
--   -- DEBE FALLAR
--   SELECT * FROM licencias;          -- el resto de la base
--   SELECT * FROM admins;             -- hashes de contraseña del panel
--   UPDATE sms_cuota SET creditos_asignados = 999999;   -- regalarse saldo
--   DELETE FROM sms_movimientos;      -- borrar la huella de lo consumido
--
-- ----------------------------------------------------------------------------
-- Para deshacer:  DROP USER 'smsledger'@'localhost';
-- ----------------------------------------------------------------------------

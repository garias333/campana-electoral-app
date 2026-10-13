# Llaves públicas de firma de parches

Cada archivo `.pem` en esta carpeta es una llave pública Ed25519 contra la
que `config/verificarFirmaParche.js` compara la firma de cada parche antes
de aplicarlo (ver `scripts/actualizar-automatico.js`, `EXIGIR_FIRMA_DESDE_PARCHE`).

**Esta carpeta debe tener al menos un `.pem`.** `verificarFirmaParche.js` la
lee al cargarse y lanza un error si no existe o está vacía; como
`actualizar-automatico.js` lo requiere al arrancar, sin llave el actualizador
muere antes de mirar un solo parche — también los anteriores al #261, que no
exigen firma. No hay forma segura de tratar "sin llaves" como "todo pasa" ni
como "todo falla en silencio", por eso falla en voz alta.

Hoy contiene `clave-01.pem`. Va dentro de la plantilla de instalación nueva
(`scripts/generar-plantilla.js`): una campaña sin ella no puede actualizarse.

Son datos públicos, no secretos: no hace falta protegerlos. **Nunca debe
haber aquí una llave privada**; el generador de plantillas se niega a empaquetar
la carpeta si encuentra una. Ningún parche puede tocar esta carpeta — está en
la lista de exclusión de `scripts/generar-parche.js` a propósito. Rotar una
llave es un despliegue manual (agregar un `.pem` nuevo), no un parche.

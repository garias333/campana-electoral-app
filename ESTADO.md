# ESTADO — electoral

> Bitácora de handoff entre máquinas. La escribe `/cierre` al final de cada
> sesión y el hook de apertura la inyecta automáticamente al iniciar.
> El contexto permanente (arquitectura, puertos, reglas de despliegue) va en
> CLAUDE.md, no aquí.

## Anclas verificables

- **Parche publicado:** 143. Las dos campañas reportan `version_actual = 143`;
  electoral reporta 1 porque es la plantilla y no recibe parches, se los genera.
- **Service worker:** `estrategia-v108` en las tres, comprobado sirviéndolo por
  cada dominio.
- **Rama:** `auditoria-fable`
- **Último commit:** `5495413`

## Hecho y verificado en la última sesión

Jornada del 23 y 24 de agosto de 2026.

- [x] **Parches 138 a 142**, aplicados a las dos campañas con resultado
      `exitoso` y comprobados pidiendo los archivos por HTTPS, no mirando el
      disco.
      - 138–141: el ingreso se parte entre celular y PC. El celular vuelve a
        ver la elección «Acceso de Líderes o Testigos / Otros usuarios»; el PC
        ve directamente el campo del correo. El botón de instalar sube arriba
        del formulario y deja de salir en el computador. En el PC la sesión ya
        no se queda puesta: fuera las cuentas guardadas y la casilla de 7 días.
      - 142: la paleta azul de App Territorios en el ingreso y la franja
        lateral. El área de trabajo se queda en claro a propósito.
- [x] **El VPS quedó cerrado.** SSH sólo con llave (`passwordauthentication no`,
      `permitrootlogin without-password`), comprobado contra `sshd -T` y con las
      nueve cuentas entrando con llave desde 186.80.30.20. 381 elementos que
      cualquiera de las 30 cuentas podía leer —incluidos los 141 zip de parches
      del servidor de licencias— cerrados. 14 copias del `.env` con credenciales
      ya retiradas, borradas.
- [x] **Paleta unificada** en electoral, las dos campañas y el servidor de
      licencias. Guía publicada en `/usr/local/share/estrategia/paleta-navy.md`,
      legible por todas las cuentas.
- [x] **Superadministrador único** (`3c29558`, hecho en otra sesión): no es un
      rol nuevo sino una bandera `usuarios.es_superadmin`, y la unicidad la
      garantiza una columna generada con `UNIQUE`, no un `if`.
- [x] **Publicado como parche 143** el 24 de agosto, con `toca_base_datos = 1`.
      Aplicado encima de lo que ya estaba en las dos campañas sin crear ni
      duplicar nada: dos columnas, un índice `uq_superadmin_unico` y **un**
      superadministrador en cada una, que es lo que había antes. Llegó además
      `scripts/reiniciar-instancia.sh`, el único de los nueve archivos que
      faltaba allá. `version_actual` pasó a 143 en las dos.

## Pendiente inmediato

- [ ] **Seis aplicaciones sin la paleta:** encuesta, foda, proyector,
      mapamanizales, escucha, pretest. En ese orden, de menos a más trabajo.
      No se alcanzan desde esta cuenta: hay que abrir la sesión de cada una y
      escribir `Lee /usr/local/share/estrategia/paleta-navy.md y aplícalo`.
- [ ] **La cuenta de Onurix sigue bloqueada** por control antifraude (error
      1048) desde el 23 de agosto. Sin eso no salen SMS.
- [ ] **Los enlaces sobre fondo claro dan 3,86 de contraste**, por debajo del
      4,5 de AA. Igual en electoral y en licencias, y no es regresión —el valor
      anterior daba 3,93—. Si se corrige, hay que hacerlo en las dos a la vez.

## Trampas encontradas

- **`/etc/ssh/sshd_config.d/` manda sobre `sshd_config`.** En sshd gana el
  PRIMER valor leído, no el último, y el `Include` va arriba del todo. La
  primera corrida editó el archivo principal, `sshd -t` validó, el servicio
  recargó sin quejarse... y `passwordauthentication` seguía en `yes` porque
  `50-cloud-init.conf` lo reponía. **Todo indicaba éxito y no había cambiado
  nada.** Ahora el guion comprueba contra `sshd -T`, que es lo único que sabe
  qué valor ganó.
- **Un inventario sacado del registro no es el inventario real.** Las nueve
  cuentas a las que se instaló la llave salieron de quién había entrado con
  contraseña en `auth.log`. `gariasapplicencias` no se había conectado en esos
  días, así que no apareció, así que se quedó sin llave y sin contraseña. No
  estar en el registro significa «no se conectó últimamente», no «no hace
  falta». `instalar-llave-ssh.sh --todas` recorre `/etc/passwd`.
- **Unificar un acento no es poner el mismo valor en todas partes.** `#FFC300`
  como texto sobre crema da 1,45 y un botón oro con letra blanca 1,61: las dos
  ilegibles. Va en pareja — oro para fondos con letra oscura encima (10,71) y
  `#A66F1F` para texto sobre claro.
- **Un enlace simbólico no cruza una carpeta cerrada.** Compartir la guía por
  symlink desde `scripts/` no servía: `other::---` detiene a cualquier cuenta
  ajena, el enlace resuelve y la lectura falla. Se resolvió con copia en
  `/usr/local/share/estrategia/` y un guion que compara huellas para que la
  deriva entre las dos copias sea detectable.
- **`50-cloud-init.conf` lo escribe cloud-init.** Si el VPS se reconstruye
  puede volver con `PasswordAuthentication yes` y deshacer el cierre en
  silencio. Se comprueba con `sshd -T | grep -i passwordauth`.
- **Distribuir a mano deja el registro mintiendo.** El superadministrador
  llegó a las dos campañas por fuera del sistema de parches: el código y la
  columna estaban en el disco, pero `parches_disponibles` se quedaba en 142 y
  `version_actual` decía 142. Nada fallaba —por eso no se veía— y la próxima
  persona que mirara el número habría creído que a las campañas les faltaba el
  superadministrador. Se corrigió publicándolo como 143. Regla: si un cambio
  llega a una campaña, tiene que llegar con su número, aunque ya esté puesto.

## Candidatos para CLAUDE.md

- La regla de sshd: gana el primer valor, y `sshd_config.d` va primero.
  Comprobar siempre contra `sshd -T`, nunca contra el archivo editado.
- La pareja del acento (`#FFC300` fondo / `#A66F1F` texto) y por qué no puede
  ser un solo valor.
- Que las cuentas del VPS están aisladas entre sí desde el 23 de agosto, y que
  lo compartido va en `/usr/local/share/estrategia/`.
- Que todo cambio que llegue a una campaña tiene que llegar **con su número de
  parche**, aunque el archivo ya esté puesto en el disco. Copiar a mano no
  falla; deja el registro mintiendo, que es peor porque no se ve.

---
<!-- cierre automático -->
Sesión cerrada: 2026-08-24 13:48 UTC desde srv1807015
Rama: auditoria-fable | Commit: 3c29558 Un superadministrador único, invisible y protegido por la base | Sin commitear: 0 archivo(s)

---
<!-- cierre automático -->
Sesión cerrada: 2026-08-27 16:04 UTC desde srv1807015
Rama: auditoria-fable | Commit: 1e887cd Las dos de geocodificar vuelven, pero corriendo sobre su rama | Sin commitear: 0 archivo(s)

---
<!-- cierre automático -->
Sesión cerrada: 2026-08-27 16:05 UTC desde srv1807015
Rama: auditoria-fable | Commit: 1e887cd Las dos de geocodificar vuelven, pero corriendo sobre su rama | Sin commitear: 1 archivo(s)

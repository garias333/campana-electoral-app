# ESTADO — electoral

> Bitácora de handoff entre máquinas. La escribe `/cierre` al final de cada
> sesión y el hook de apertura la inyecta automáticamente al iniciar.
> El contexto permanente (arquitectura, puertos, reglas de despliegue) va en
> CLAUDE.md, no aquí.

## Anclas verificables

*Remedidas el 27 de agosto de 2026. Las dos primeras estaban mal desde el 24 y
nadie lo habría notado: un número de parche viejo no falla, sólo hace creer que
a las campañas les falta algo que ya tienen — o al revés.*

- **Último parche generado:** **155**, el 27 de agosto — y **sin publicar**.
  Lleva la categoría Aspirante al Concejo, los contrastes AA, la confirmación
  por contraseña al editar/eliminar y los tres botones del ingreso móvil.
  El anterior es el 154 (25 de agosto), que sí está aplicado.
  *(El 143 que decía esta línea era de la sesión del 24; en `parches/` había
  zips hasta el 154.)*
- **`version_actual` de las campañas:** **no comprobado en esta sesión.** Desde
  esta cuenta no se alcanzan sus bases —el cierre del 23 de agosto—, así que se
  deja sin afirmar en vez de repetir el número anterior. Se mide entrando a
  cada campaña, no desde aquí.
- **Service worker:** `estrategia-v116` en las tres, pedido por HTTP a los
  puertos 3002, 3101 y 3102. *(Decía v108.)*
- **Rama:** `auditoria-fable`
- **Último commit:** ver `git log -1`; la sesión del 27 dejó cinco.

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

### Lo que necesita root o el panel — no se puede desde esta cuenta

La sesión corre como `gariasappelectoral`, sin sudo. El proceso de electoral es
de `appestrategia-electoral` y ni siquiera admite una señal (`kill -0` da
*Operation not permitted*). Los tres de abajo están comprobados como
imposibles desde aquí, no supuestos.

- [ ] **Publicar el parche 155** en `licencias.appestrategia.net → Parches`.
      Es una subida por navegador con credenciales; no hay forma por consola.
      Sin publicarlo, las dos campañas siguen sin la categoría Aspirante al
      Concejo, sin los tres botones del ingreso y sin la confirmación por
      contraseña. **No marcar «toca base de datos».**
- [ ] **Reiniciar electoral** para que entren sus rutas nuevas. Hasta que pase,
      aquí la contraseña se pide sin que el servidor la exija y el limitador
      sigue gastando cupo con los aciertos. En el servidor, como root:
      `bash scripts/reiniciar-instancia.sh appestrategia-electoral 3002`
      (ese guion ya sabe encontrar la ruta de electoral desde el 27 de agosto;
      antes moría con «No existe» porque su carpeta no sigue la convención de
      las campañas — era la única instancia que no sabía reiniciar).
- [ ] **Publicar la guía de la paleta**, que se quedó atrás respecto a la copia
      del repositorio: `sudo bash scripts/sincronizar-paleta-compartida.sh --publicar`.
      El propio guion detecta la diferencia si se corre sin argumentos.

### Lo demás

- [ ] **Seis aplicaciones sin la paleta:** encuesta, foda, proyector,
      mapamanizales, escucha, pretest. En ese orden, de menos a más trabajo.
      No se alcanzan desde esta cuenta: hay que abrir la sesión de cada una y
      escribir `Lee /usr/local/share/estrategia/paleta-navy.md y aplícalo`.
- [ ] **La cuenta de Onurix sigue bloqueada** por control antifraude (error
      1048) desde el 23 de agosto. Sin eso no salen SMS.
- [x] ~~**Los enlaces sobre fondo claro dan 3,86**~~ — **hecho en electoral el
      27 de agosto**: `--color-accent-dark` pasó de `#A66F1F` a `#8C5E17`.
      Al medirlo entero apareció que fallaba en los CINCO fondos donde aparece,
      no sólo en el crema, y que el peor era 3,68 (el rótulo de asesor del
      organigrama, sobre un velo translúcido que ninguna auditoría de pares
      hexadecimales ve). Peor caso ahora: 4,85.
- [ ] **Falta licencias, y hasta entonces las dos están divergidas** — que es
      justo lo que la regla quería evitar. Es una línea: `--oro-texto: #8C5E17`.
      La decisión y el porqué quedaron escritos en
      `scripts/paleta-navy-instrucciones.md`, incluido que el otro candidato
      de la guía (`#996619`) NO sirve: da 4,45 sobre el crema.

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

---
<!-- cierre automático -->
Sesión cerrada: 2026-08-29 00:14 UTC desde srv1807015
Rama: auditoria-fable | Commit: 6da7311 El panel dejaba de decir la verdad en cuatro sitios | Sin commitear: 2 archivo(s)

---
<!-- cierre automático -->
Sesión cerrada: 2026-08-29 16:52 UTC desde srv1807015
Rama: auditoria-fable | Commit: c3bd54c Mi modificador se llamaba .vacio, y ese nombre ya era de la hoja global | Sin commitear: 2 archivo(s)

---
<!-- cierre automático -->
Sesión cerrada: 2026-08-29 16:53 UTC desde srv1807015
Rama: auditoria-fable | Commit: c3bd54c Mi modificador se llamaba .vacio, y ese nombre ya era de la hoja global | Sin commitear: 3 archivo(s)

---
<!-- cierre automático -->
Sesión cerrada: 2026-08-30 13:24 UTC desde srv1807015
Rama: auditoria-fable | Commit: ce2766a Del parche 190 al 199: el panel del aspirante, y lo que salió al probarlo | Sin commitear: 27 archivo(s)

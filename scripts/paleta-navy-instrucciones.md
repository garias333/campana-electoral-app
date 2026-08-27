# Paleta azul compartida — encargo para las demás aplicaciones

Este archivo se pega **tal cual** en una sesión abierta sobre otra aplicación
del ecosistema (mapamanizales, proyector, escucha, foda, pretest, encuesta,
panel, licencias). Es autosuficiente a propósito: no depende de leer el código
de electoral ni de abrir ningún enlace, porque cada aplicación vive en una
cuenta cerrada que no ve a las otras.

Aplicado ya en: App Territorios (de donde salió), electoral, campaña municipal,
campaña departamental (parche 142) y el servidor de licencias — los cinco el
24 de agosto de 2026.

---

## El encargo

Unifica el cromo azul de esta aplicación con el del resto del ecosistema
Estrategia / INGESES. El azul entra en **la pantalla de ingreso y la franja del
menú lateral**; el área de trabajo se queda como está.

### 1. Los ocho valores, en el `:root` de la hoja principal

```css
:root {
  --ing-fondo:   #131F3B;  /* fondo de pantalla y franja lateral */
  --ing-tarjeta: #1B2B4F;  /* paneles de ingreso y tarjetas      */
  --ing-campo:   #16264A;  /* campos de formulario sobre azul    */
  --ing-borde:   #2E4271;  /* bordes y separadores sobre azul    */
  --ing-oro:     #FFC300;  /* acento                             */
  --ing-oro-o:   #E5AF00;  /* acento al pasar el puntero         */
  --ing-tenue:   #A9BBD4;  /* texto secundario SOBRE azul        */
  --ing-texto:   #FFFFFF;
}
```

Si la aplicación ya tiene variables de color, se **retocan las suyas** en vez de
añadir un juego paralelo: dos sistemas de nombres para un mismo color es cómo
una pantalla se queda atrás sin que nadie se entere. Si no tiene variables, este
es el momento de crearlas.

### 2. Repartir los papeles

| Dónde | Token |
|---|---|
| Fondo de la pantalla de ingreso | `--ing-fondo` |
| Franja del menú lateral | degradado `--ing-fondo` → `#0E1830` |
| Tarjeta / panel de ingreso | `--ing-tarjeta` |
| Campos del formulario sobre azul | `--ing-campo` |
| Bordes y separadores sobre azul | `--ing-borde` |
| Renglón activo del menú | `--ing-tarjeta` + filete izquierdo `--ing-oro` |

El menú lateral lleva **degradado**, no color plano: es lo que le da profundidad
contra el área de trabajo.

### 3. El texto secundario que quede sobre azul

Es el paso que se olvida. Todo gris de texto secundario que esté encima del azul
pasa a `--ing-tenue`. Un gris de los que se usan sobre blanco (por ejemplo
`#5B6472`) cae a **2,4** de contraste sobre este azul: ilegible.

### 4. Comprobar el renglón activo del menú

Es lo primero que se rompe. Mídelo antes de darlo por bueno.

---

## Cuatro trampas, todas encontradas aplicándolo

**La tarjeta va MÁS CLARA que el fondo.** `--ing-fondo` es el más oscuro;
`--ing-tarjeta` se levanta encima. Al revés —que es lo que uno teclea sin
pensar— el panel se hunde en el fondo y sólo lo separa la sombra.

**El texto secundario no puede ser gris.** Ver el paso 3.

**No tocar los azules que viven sobre blanco.** Enlaces, aros de foco e
insignias suelen usar un azul de la misma familia y *no* son cromo. Aclararlos
junto con los demás baja el contraste de los enlaces de toda la aplicación sin
que nadie lo haya pedido. En electoral son `--color-navy-light` y
`--color-navy-lighter`, y se quedaron intactos.

**Fondo plano, no degradado.** Electoral tenía un degradado radial que aclaraba
una esquina hasta `#29497A`; contra ese punto la tarjeta perdía el borde.

**El relleno del renglón activo no se ve, y no hay que forzarlo.** Sobre azul
oscuro cualquier relleno de la misma familia queda en 1,1–1,2 de contraste. Lo
que señala es el **filete dorado** de la izquierda, que da 10,15 sobre el azul
del menú. Si resulta poco en uso, se engorda el filete; no se aclara el relleno.

---

## Contrastes ya medidos (WCAG)

Los ocho valores están comprobados; no hace falta volver a medirlos salvo que se
cambie alguno.

| Par | Contraste | Nivel |
|---|---|---|
| blanco sobre `#131F3B` | 16,32 | AAA |
| blanco sobre `#1B2B4F` | 13,95 | AAA |
| `#FFC300` sobre `#131F3B` | 10,15 | AAA |
| `#161B26` sobre botón `#FFC300` | 10,71 | AAA |
| `#A9BBD4` sobre `#131F3B` | 8,35 | AAA |
| `#A9BBD4` sobre `#1B2B4F` | 7,14 | AAA |

---

## Antes de dar por terminado

- Sirve la hoja de estilos por su dominio y comprueba que los valores llegaron:
  editar el archivo no prueba que el navegador lo reciba.
- Si la aplicación tiene *service worker* con caché versionada, súbele el
  número; si no, la gente sigue viendo los colores viejos y parece que el
  cambio no entró.
- Mira la pantalla de recuperar contraseña, no sólo la de ingreso. Suelen ser
  archivos distintos con el mismo fondo copiado.

---

## Qué se va a encontrar en cada aplicación

Medido el 24 de agosto de 2026 pidiendo su pantalla de ingreso y su hoja de
estilos por HTTP. El orden es de menos a más trabajo: cada una que sale bien
confirma la receta para la siguiente.

### 1. Encuesta — la más fácil, empezar por aquí

Ya tiene variables de color **y el mismo amarillo**:

```
--marca: #1F5C99   --marca-honda: #0E2841   --ambar: #FFC300
--ambar-tinta: #3A2A00   --fondo: #f7f1e3
```

Sólo cambia el azul: `--marca-honda` es el candidato natural para `--ing-fondo`.
El acento no se toca. Es el caso donde el paso 1 es literalmente retocar dos
valores.

### 2. FODA

Ya usa `#FFC300` (siete veces) y un oscuro `#1a1400`. El acento está resuelto;
falta el azul y probablemente crear las variables, porque los colores están
sueltos en la hoja.

### 3. Proyector

Usa `#FFC300`. Mismo caso que FODA, con menos superficie.

### 4. Mapa Manizales

Usa `#FFC300`. Su ingreso responde en `/login`, sin `.html`: la pantalla la
arma el servidor, así que el fondo puede estar en una plantilla y no en la
hoja de estilos. Buscarlo antes de suponer.

### 5. Escucha — ojo, su dorado es OTRO

No usa `#FFC300` sino **`#f5b400`**, más apagado. Aquí sí hay que unificar el
acento, y aplica la trampa de la pareja: `--ing-oro` para fondos con letra
oscura encima, y un oro hondo (**`#8C5E17`**) para texto y enlaces sobre claro.
Poner `#FFC300` en los dos sitios deja los enlaces en 1,45 de contraste.

### 6. Pretest — la última, y es harina de otro costal

No tiene ni azul ni dorado: va en grises (`#1d232b`, `#5b6773`, `#9aa5b1`,
`#f4f5f7`). No es retocar una paleta, es darle una. Conviene mirarla con calma
y decidir si entra en la familia o se queda como está a propósito.

---

## Cómo se resolvió en el servidor de licencias — sirve de ejemplo

Era el caso más lejano: casi negro `#1c1c1c` con dorado `#d4af37` en vez del
amarillo. Se unificó entero el 24 de agosto de 2026, dorado incluido, y ahí
apareció la trampa que este archivo repite dos veces — vale la pena verla con
los números reales:

```
#FFC300 como TEXTO sobre el crema #f8f3e9 ....... 1,45   ilegible
botón #FFC300 con letra blanca ................. 1,61   ilegible
#161B26 sobre botón #FFC300 .................... 10,71  AAA
#A66F1F como texto sobre el crema ...............  3,86
```

O sea: unificar el acento **no es poner el mismo valor en todas partes**. Es
poner la misma *pareja*: `--oro #FFC300` donde el acento es fondo, y
`--oro-texto` donde es texto. En licencias el botón primario estaba en cobre
con letra blanca (3,9) y pasó a oro con letra oscura (10,71).

(Ese `--oro-texto` era `#A66F1F` cuando se escribió esto. **Hoy es `#8C5E17`**
— ver el apartado siguiente, que explica por qué cambió.)

### La deuda del oro de texto — saldada en electoral el 27 de agosto de 2026

Decía así, y se deja para que se entienda la corrección:

> Queda una deuda declarada, igual en licencias y en electoral: los **enlaces
> sobre fondo claro** dan 3,86, que no llega al 4,5 de AA para texto normal. No
> es una regresión —el cobre anterior daba 3,93— pero si algún día se corrige,
> hay que hacerlo en las dos a la vez o vuelven a divergir. Los candidatos:
> `#996619` (4,45) o `#8C5E17` (5,09).

**El valor es `#8C5E17`.** Ya está puesto en electoral. Falta licencias, y hasta
que se ponga las dos están divergidas — que era justo lo que el párrafo de
arriba quería evitar. Es un cambio de una línea:

```css
--oro-texto: #8C5E17;   /* era #A66F1F */
```

**No tomar `#996619`.** Da 4,45 sobre el crema `#f8f3e9` y el mínimo es 4,5:
se queda a cinco centésimas. Aparecía como candidato porque el 4,45 se leyó
como si pasara.

**El 3,86 era el mejor de los malos, no el peor.** Al medir electoral entero
—no sólo el caso que estaba anotado— `#A66F1F` fallaba en los **cinco** fondos
donde aparece:

```
blanco #FFFFFF ..... 4,27        crema  #F8F3E9 ..... 3,86
página #F3F5F8 ..... 3,91        aviso  #FDF3E0 ..... 3,88
rótulo del organigrama, sobre su propio velo ....... 3,68   <- el peor
```

Ese 3,68 no estaba en ninguna lista porque su fondo no es un color plano sino
un `rgba(...,0.12)` sobre blanco: hay que componer la mezcla antes de medir.
**Un fondo translúcido se salta las auditorías que sólo miran pares de
hexadecimales.** Con `#8C5E17` el peor caso queda en 4,85.

Y conviene mirar dónde el mismo token hace de **fondo** antes de oscurecerlo.
En electoral son dos sitios (el día de hoy en Agenda, el marcador de Recursos)
y los dos llevan letra blanca encima, así que oscurecer mejora también ahí —
pero eso se comprueba, no se supone.

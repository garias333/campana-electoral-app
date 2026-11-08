---
id: t-votante-agregar
titulo: Registrar a una persona
seccion: antes
orden: 121
icono: persona
modulo: votantes
nivel: agregar
roles:
ruta: Escritorio: Electoral > Votantes y sublíderes | Celular: Registro de votantes y sublíderes
captura: t-votante-agregar.webp
---
Sirve para dejar en la base a un votante o a un sublíder, con su lugar de votación y la autorización para tratar sus datos. Hay dos pantallas: el **computador**, con un formulario único, y el **celular** de líderes y sublíderes, con un formulario por pasos y firma de la persona.

## Pasos

1. Abre el formulario. En el computador, entra a **Electoral > Votantes y sublíderes** y pulsa [[+ Nuevo votante o sublíder]]. En el celular, entra a **Registro de votantes y sublíderes** (el administrador lo ve como **Registro de votantes**) y pulsa [[+ Registrar una persona]]. El celular lo lleva en cuatro pasos, con [[Siguiente →]] y [[← Atrás]]: Categoría, Lugar de votación e identificación, Datos personales y contacto, y Territorio y autorización.
2. Elige la **Categoría**: Votante o Sublíder (paso 1 en el celular). Un sublíder solo registra votantes: a él no le sale el botón Sublíder. Al sublíder se le pone **Meta de votos** y se le crea una cuenta de acceso con su cédula como usuario y contraseña, así que necesita **Número de identificación**.
3. Escribe el **Número de identificación** (paso 2 en el celular) y mira el aviso que sale debajo ({{t-cedula-privacidad}}). En un votante puede quedar vacío; en un sublíder no. [[Consultar lugar de votación]] abre la Registraduría con la cédula copiada ({{t-registraduria}}).
4. Llena el **Lugar de votación**: Departamento, Municipio, Puesto y Mesa. Departamento y Municipio pueden venir ya llenos con los de la campaña. En el celular, Puesto y Mesa se eligen de una lista (la de los puestos de la campaña). En el computador, el Puesto sale de una lista según el Municipio y la Mesa se escribe.
5. Escribe los **Nombres y apellidos** (obligatorio, paso 3 en el celular) y, si quieres, Género y Edad. Si debajo del nombre sale «Ya existe un registro con un nombre parecido» o «con ese mismo teléfono», revisa que no sea la misma persona: el aviso no impide guardar.
6. Llena los datos de contacto: **Teléfono** (opcional; si lo pones, de 10 dígitos), **Correo** y **Dirección de residencia**, con su Departamento y Ciudad de residencia. En el celular, [[GPS]] llena la dirección.
7. Si tu campaña activó apoyos, aparece **Apoya a**: marca a qué otras campañas apoya la persona (puedes marcar varias).
8. Elige su territorio (paso 4 en el celular). El **Área** es opcional: Urbano muestra Comuna y Barrio, y Rural muestra Corregimiento y Vereda; si eliges el área, tienes que elegir esos datos de la lista (o dejar el área sin especificar). En un sublíder, antes sale **Territorio o área de influencia**: Territorio u Organización (con el nombre de la organización). En el computador, además, elige quién lo refirió en **Referido por**.
9. Pulsa [[Leer la política de tratamiento de datos]] y enséñasela a la persona. Marca que **autoriza el tratamiento de sus datos** y los medios por los que acepta que le escriban: Correo electrónico, Mensajes de texto (SMS) o WhatsApp.
10. En el celular, al marcar la autorización aparece **Firma de la persona**: pásale el teléfono para que firme con el dedo ([[Borrar]] limpia el trazo). Pulsa [[Guardar registro]]. En el computador pulsa [[Guardar]]; ahí no se pide firma.

::: listo
En el celular sale «Registro guardado» con los botones [[Registrar otro contacto]] y [[Ver mis registros]]; sin señal, sale «Guardado en tu celular» y la persona se sube sola cuando vuelva la conexión. En el computador la ventana se cierra y la persona aparece en la lista. Si era un sublíder, el computador avisa que se creó su cuenta y que deberá cambiar la contraseña en su primer ingreso.
:::

::: importante
Sin la autorización marcada no se puede guardar, y en el celular tampoco sin la firma. Si al guardar sale «Falta la firma de la persona», la pantalla puede llevarte al paso del teléfono: avanza con [[Siguiente →]] hasta el paso 4, donde está la firma. Los medios que la persona no quiera, déjalos sin marcar: queda registrada igual, pero no le llegan mensajes por ellos.
:::

::: cuidado
Si la cédula ya existe, la app muestra «Ya registrado por otro líder». En el celular el aviso sale apenas escribes la cédula y no te deja pasar al paso siguiente; en el computador, al guardar. Y si registras a un sublíder sin cédula, la persona queda guardada pero sin cuenta de acceso: el computador lo avisa, el celular no.
:::

Relacionado: {{mod-votantes}}, {{t-qr-enlace}}.

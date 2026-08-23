/**
 * Botón «Instalar la aplicación».
 *
 * POR QUÉ HACE FALTA. Hasta ahora no había ninguno: instalar dependía de que
 * la persona encontrara «Instalar aplicación» en el menú ⋮ de Chrome. Ese menú
 * está escondido, cambia de sitio entre versiones de Android, y Chrome deja de
 * ofrecerlo durante un tiempo después de que alguien desinstala — de ahí que
 * reinstalar costara varios intentos.
 *
 * CÓMO FUNCIONA. El navegador avisa con `beforeinstallprompt` cuando la
 * aplicación cumple los requisitos. Se guarda ese aviso, se enseña el botón, y
 * al pulsarlo se le pide al navegador que muestre SU diálogo de instalación.
 * El aviso solo sirve una vez: después hay que esperar a que el navegador
 * vuelva a mandarlo.
 *
 * EL BOTÓN NO SE INVENTA LA INSTALACIÓN. Si el navegador no manda el aviso
 * —porque ya está instalada, porque es un iPhone, o porque Chrome está en su
 * periodo de espera— el botón no aparece y en su lugar se explica cómo
 * hacerlo a mano. Un botón que no hace nada al pulsarlo es peor que no
 * tenerlo.
 *
 * SOLO EN EL CELULAR. Chrome de escritorio también manda `beforeinstallprompt`
 * —en el computador la aplicación se instala igual, en una ventana propia—,
 * así que el botón salía en la pantalla de ingreso del PC diciendo «instalar
 * la aplicación en este celular», que ahí no significa nada. Quien entra por
 * computador es administración y trabaja en el navegador. La pregunta de si
 * esto es un celular se le hace a `js/es-celular.js`, el mismo que usa la
 * pantalla de ingreso para decidir qué formulario mostrar: así las dos cosas
 * no pueden discrepar.
 */
(function () {
  let avisoGuardado = null;

  /** ¿Ya se está usando como aplicación instalada? Entonces no hay nada que ofrecer. */
  function yaInstalada() {
    return window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true;
  }

  function contenedor() {
    return document.getElementById('zona-instalar-app');
  }

  /** Si la definición común no cargó, no se ofrece nada: quedarse sin botón
   *  deja el camino del menú del navegador, que es como se hacía antes.
   *  Ofrecerlo donde no corresponde sí crea un problema nuevo. */
  function enCelular() {
    return typeof window.esCelular === 'function' && window.esCelular();
  }

  function pintarBoton() {
    const zona = contenedor();
    if (!zona || yaInstalada() || !enCelular()) return;
    zona.innerHTML =
      '<button type="button" class="btn-instalar-app" id="btn-instalar-app">' +
      '📲 Instalar la aplicación en este celular</button>';
    zona.style.display = 'block';
    document.getElementById('btn-instalar-app').addEventListener('click', async () => {
      if (!avisoGuardado) return;
      avisoGuardado.prompt();
      const { outcome } = await avisoGuardado.userChoice;
      // El aviso es de un solo uso: se suelta pase lo que pase.
      avisoGuardado = null;
      if (outcome === 'accepted') zona.style.display = 'none';
      else pintarAyuda();   // dijo que no: queda cómo hacerlo a mano
    });
  }

  /**
   * Cuando no se puede ofrecer el botón, se dice cómo hacerlo a mano en vez de
   * dejar la pantalla muda. Es lo que evita los «muchos intentos»: la persona
   * sabe qué buscar en vez de adivinar.
   */
  function pintarAyuda() {
    const zona = contenedor();
    if (!zona || yaInstalada() || !enCelular()) return;
    const esIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    zona.innerHTML = esIOS
      ? '<p class="nota-instalar-app">Para instalarla en un iPhone: toque <strong>Compartir</strong> ' +
        '(el cuadro con la flecha) y luego <strong>Añadir a pantalla de inicio</strong>.</p>'
      : '<p class="nota-instalar-app">Si no aparece el botón de instalar, abra el menú <strong>⋮</strong> ' +
        'del navegador y elija <strong>Instalar aplicación</strong> o <strong>Añadir a pantalla de inicio</strong>.</p>';
    zona.style.display = 'block';
  }

  window.addEventListener('beforeinstallprompt', (evento) => {
    // Sin esto el navegador muestra su propia barra, que en Android aparece
    // abajo, chiquita y se va sola.
    evento.preventDefault();
    avisoGuardado = evento;
    pintarBoton();
  });

  // Instalada desde el botón o desde el menú del navegador: el ofrecimiento
  // sobra a partir de aquí.
  window.addEventListener('appinstalled', () => {
    const zona = contenedor();
    if (zona) zona.style.display = 'none';
    avisoGuardado = null;
  });

  // Si al cabo de un momento el navegador no ha avisado, se explica el camino
  // manual. Dos segundos y medio: `beforeinstallprompt` llega en cuanto el
  // service worker toma el control, que es casi siempre antes.
  document.addEventListener('DOMContentLoaded', () => {
    if (yaInstalada() || !enCelular()) return;
    setTimeout(() => { if (!avisoGuardado) pintarAyuda(); }, 2500);
  });
})();

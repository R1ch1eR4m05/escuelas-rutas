/**
 * movil.js — Comportamiento de la interfaz en pantallas angostas (< 640px,
 * el mismo corte que el breakpoint `sm:` de Tailwind).
 *
 * En escritorio este módulo no hace nada: todos los manejadores consultan
 * `esAngosto()` antes de actuar, y el layout de tres columnas queda intacto.
 *
 * En móvil convierte los paneles en hojas superpuestas sobre un mapa a
 * pantalla completa:
 *   · zona   → hoja que baja desde arriba (barra superior compacta)
 *   · ruta   → hoja que sube desde abajo (botón flotante)
 *   · ficha  → hoja inferior arrastrable con dos posiciones (pico y completa)
 *
 * No toca datos, API ni la validación con INEGI: solo posición e interacción.
 */
const Movil = (() => {
  const consulta = window.matchMedia('(max-width: 639px)');
  const esAngosto = () => consulta.matches;

  const cuerpo = document.body;
  const panelZona = document.getElementById('panel-zona');
  const panelRuta = document.getElementById('panel-ruta');
  const panelDetalle = document.getElementById('panel-detalle');
  const backdrop = document.getElementById('backdrop-movil');
  const fab = document.getElementById('fab-ruta');
  const btnZona = document.getElementById('btn-zona-movil');
  const btnCerrarZona = document.getElementById('btn-cerrar-zona');
  const btnCerrarRuta = document.getElementById('btn-cerrar-ruta');
  const etiquetaZona = document.getElementById('etiqueta-zona-movil');
  const selMunicipio = document.getElementById('sel-municipio');

  // Las hojas arrancan en su posición cerrada sin animar: las transiciones
  // se habilitan hasta después del primer pintado (ver estilos.css). Si no,
  // se verían entrar deslizándose cada vez que se abre la app.
  const habilitarAnimaciones = () => cuerpo.classList.add('animaciones');
  requestAnimationFrame(() => requestAnimationFrame(habilitarAnimaciones));
  // Respaldo: rAF no corre si la pestaña arranca en segundo plano.
  setTimeout(habilitarAnimaciones, 400);

  // ── Fondo oscuro y botón flotante ───────────────────────────────────────
  function refrescarSuperposicion() {
    const hayHoja = cuerpo.classList.contains('zona-abierta') || cuerpo.classList.contains('ruta-abierta');
    backdrop.classList.toggle('opacity-100', hayHoja);
    backdrop.classList.toggle('pointer-events-auto', hayHoja);
    backdrop.classList.toggle('opacity-0', !hayHoja);
    backdrop.classList.toggle('pointer-events-none', !hayHoja);
    // El botón flotante estorba cuando ya hay una hoja arriba.
    fab.classList.toggle('hidden', hayHoja || fichaAbierta);
  }

  // ── Hoja de zona (baja desde arriba) ────────────────────────────────────
  function abrirZona() {
    cerrarRuta();
    cerrarFicha();
    cuerpo.classList.add('zona-abierta');
    btnZona.setAttribute('aria-expanded', 'true');
    refrescarSuperposicion();
  }

  function cerrarZona() {
    cuerpo.classList.remove('zona-abierta');
    btnZona.setAttribute('aria-expanded', 'false');
    refrescarSuperposicion();
  }

  function alternarZona() {
    cuerpo.classList.contains('zona-abierta') ? cerrarZona() : abrirZona();
  }

  // ── Hoja de ruta (sube desde abajo) ─────────────────────────────────────
  function abrirRuta() {
    cerrarZona();
    cerrarFicha();
    cuerpo.classList.add('ruta-abierta');
    refrescarSuperposicion();
  }

  function cerrarRuta() {
    cuerpo.classList.remove('ruta-abierta');
    panelRuta.style.transform = '';
    refrescarSuperposicion();
  }

  // ── Hoja de la ficha (arrastrable, dos posiciones) ──────────────────────
  let fichaAbierta = false;
  let yFicha = 0; // desplazamiento actual en píxeles desde el tope de la hoja

  /** Altura de la hoja completa. */
  const altoHoja = () => panelDetalle.offsetHeight;

  /** Posición "pico": se asoma poco más de la mitad de la pantalla. */
  const yPico = () => Math.max(0, altoHoja() - Math.round(window.innerHeight * 0.52));

  function fijarY(y) {
    yFicha = y;
    panelDetalle.style.transform = `translate3d(0, ${y}px, 0)`;
  }

  function alAbrirFicha() {
    if (!esAngosto()) return;
    cerrarZona();
    cerrarRuta();
    // Arranca abajo del todo y sube al pico, para que se vea el gesto.
    // Todo síncrono: con requestAnimationFrame la hoja se quedaría fuera de
    // pantalla si el navegador difiere el cuadro (pestaña en segundo plano).
    panelDetalle.classList.add('arrastrando'); // sin transición
    fijarY(altoHoja());
    void panelDetalle.offsetHeight;            // confirma la posición inicial
    panelDetalle.classList.remove('arrastrando');
    fijarY(yPico());                           // anima hasta el pico
  }

  function alCerrarFicha() {
    panelDetalle.style.transform = '';
    panelDetalle.classList.remove('arrastrando');
    yFicha = 0;
  }

  /** Cierra la ficha deslizándola hacia abajo antes de ocultarla. */
  function cerrarFicha() {
    if (!fichaAbierta || !esAngosto()) return;
    fijarY(altoHoja());
    setTimeout(() => Panel.cerrar(), 240);
  }

  // Panel.abrir/cerrar solo alternan clases; aquí se detecta ese cambio sin
  // tener que modificar panel.js.
  new MutationObserver(() => {
    const visible = !panelDetalle.classList.contains('hidden');
    if (visible === fichaAbierta) return;
    fichaAbierta = visible;
    if (visible) alAbrirFicha(); else alCerrarFicha();
    refrescarSuperposicion();
  }).observe(panelDetalle, { attributes: true, attributeFilter: ['class'] });

  // ── Arrastre de la ficha ────────────────────────────────────────────────
  let arrastrando = false;
  let yDedoInicio = 0;
  let yHojaInicio = 0;

  panelDetalle.addEventListener('touchstart', (ev) => {
    if (!esAngosto() || !fichaAbierta) return;
    // Solo desde el asa o la cabecera: el resto del contenido debe poder
    // desplazarse con normalidad.
    if (!ev.target.closest('[data-arrastre]')) return;
    arrastrando = true;
    yDedoInicio = ev.touches[0].clientY;
    yHojaInicio = yFicha;
    panelDetalle.classList.add('arrastrando');
  }, { passive: true });

  panelDetalle.addEventListener('touchmove', (ev) => {
    if (!arrastrando) return;
    ev.preventDefault(); // evita que el navegador desplace la página detrás
    const desplazamiento = ev.touches[0].clientY - yDedoInicio;
    fijarY(Math.max(0, yHojaInicio + desplazamiento));
  }, { passive: false });

  function finArrastreFicha() {
    if (!arrastrando) return;
    arrastrando = false;
    panelDetalle.classList.remove('arrastrando');

    const pico = yPico();
    // Pasado el pico con margen suficiente, se cierra; si no, se acomoda
    // en la posición más cercana (completa o pico).
    if (yFicha > pico + window.innerHeight * 0.12) cerrarFicha();
    else if (yFicha > pico / 2) fijarY(pico);
    else fijarY(0);
  }

  panelDetalle.addEventListener('touchend', finArrastreFicha);
  panelDetalle.addEventListener('touchcancel', finArrastreFicha);

  // ── Arrastre de la hoja de ruta (solo para cerrarla) ────────────────────
  let arrastrandoRuta = false;
  let yDedoRuta = 0;

  panelRuta.addEventListener('touchstart', (ev) => {
    if (!esAngosto() || !cuerpo.classList.contains('ruta-abierta')) return;
    if (!ev.target.closest('[data-arrastre-ruta]')) return;
    arrastrandoRuta = true;
    yDedoRuta = ev.touches[0].clientY;
    panelRuta.style.transition = 'none';
  }, { passive: true });

  panelRuta.addEventListener('touchmove', (ev) => {
    if (!arrastrandoRuta) return;
    ev.preventDefault();
    const d = Math.max(0, ev.touches[0].clientY - yDedoRuta);
    panelRuta.style.transform = `translate3d(0, ${d}px, 0)`;
  }, { passive: false });

  function finArrastreRuta(ev) {
    if (!arrastrandoRuta) return;
    arrastrandoRuta = false;
    panelRuta.style.transition = '';
    const d = (ev.changedTouches?.[0]?.clientY ?? yDedoRuta) - yDedoRuta;
    if (d > 90) cerrarRuta();
    else panelRuta.style.transform = '';
  }

  panelRuta.addEventListener('touchend', finArrastreRuta);
  panelRuta.addEventListener('touchcancel', finArrastreRuta);

  // ── Conexiones de la interfaz ───────────────────────────────────────────
  btnZona.addEventListener('click', alternarZona);
  btnCerrarZona.addEventListener('click', cerrarZona);
  btnCerrarRuta.addEventListener('click', cerrarRuta);
  fab.addEventListener('click', abrirRuta);
  backdrop.addEventListener('click', () => { cerrarZona(); cerrarRuta(); });

  // Al elegir municipio la hoja se retira sola: lo siguiente que quieres
  // ver es el mapa con los pines.
  selMunicipio.addEventListener('change', () => {
    if (esAngosto() && selMunicipio.value) cerrarZona();
  });

  // Etiqueta de la barra superior: refleja la zona activa.
  document.addEventListener('zona:cargada', (ev) => {
    const seg = ev.detail;
    if (seg?.municipio) etiquetaZona.textContent = `${seg.municipio}, ${seg.estado}`;
  });

  // ── Leaflet: recalcular tamaño cuando cambia el espacio disponible ──────
  let temporizador = null;
  function invalidarMapa() {
    clearTimeout(temporizador);
    temporizador = setTimeout(() => Mapa.invalidar(), 60);
  }

  window.addEventListener('resize', invalidarMapa);
  window.addEventListener('orientationchange', invalidarMapa);

  // Al cruzar el breakpoint el layout cambia por completo (columnas ⇄ hojas):
  // se limpian los estilos en línea y se recalcula el mapa.
  consulta.addEventListener('change', () => {
    panelDetalle.style.transform = '';
    panelRuta.style.transform = '';
    panelDetalle.classList.remove('arrastrando');
    cerrarZona();
    cerrarRuta();
    if (esAngosto() && fichaAbierta) alAbrirFicha();
    invalidarMapa();
  });

  // Las hojas son superposiciones sobre un mapa a pantalla completa, así que
  // el contenedor no cambia de tamaño; aun así se recalcula al terminar la
  // animación por si el navegador ajustó la barra de direcciones.
  panelZona.addEventListener('transitionend', invalidarMapa);
  panelRuta.addEventListener('transitionend', invalidarMapa);

  return { esAngosto, cerrarZona, cerrarRuta, cerrarFicha };
})();

/**
 * mapa.js — Mapa Leaflet: pines por estatus, resaltado de alertas,
 * agrupación (cluster) para municipios densos y numeración de la ruta.
 */
const Mapa = (() => {
  let mapa = null;
  let capaEscuelas = null;   // markercluster o layerGroup
  let capaRuta = null;       // números de parada + línea
  let halo = null;           // marca de la escuela seleccionada
  let idSeleccionada = null;
  const marcadores = new Map(); // id → circleMarker

  /** ¿Pantalla angosta? Mismo corte que el breakpoint `sm:` de Tailwind. */
  const anguloEstrecho = window.matchMedia('(max-width: 639px)');
  const esAngosto = () => anguloEstrecho.matches;

  function iniciar() {
    mapa = L.map('mapa', { zoomControl: true, preferCanvas: true })
      .setView([23.6, -102.5], 5); // vista nacional inicial

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap',
    }).addTo(mapa);

    capaRuta = L.layerGroup().addTo(mapa);

    // Si el contenedor cambia de tamaño (girar el teléfono, abrir o cerrar
    // paneles), Leaflet necesita enterarse o el mapa se ve cortado.
    const contenedor = document.getElementById('mapa');
    if (typeof ResizeObserver === 'function') {
      let pendiente = null;
      new ResizeObserver(() => {
        clearTimeout(pendiente);
        pendiente = setTimeout(recalcular, 80);
      }).observe(contenedor);
    }
    window.addEventListener('load', recalcular);
  }

  /**
   * Recalcula el tamaño y, si hiciera falta, vuelve a dibujar.
   *
   * En móvil el contenedor puede medir 0 cuando se dibuja por primera vez
   * (Tailwind llega por CDN y aplica el layout después): Leaflet descarta
   * todos los marcadores y el mapa queda vacío. Al corregirse el tamaño hay
   * que redibujar, porque invalidateSize() por sí solo no los recupera.
   * Solo se redibuja en ese caso —sin pines habiendo escuelas que mostrar—
   * para no reencuadrar el mapa cada vez que el usuario gira el teléfono.
   */
  function recalcular() {
    if (!mapa) return;
    mapa.invalidateSize({ animate: false });
    const hayQueMostrar = Estado.escuelas.some((e) => Estado.visible(e) && Number.isFinite(e.lat));
    if (!marcadores.size && hayQueMostrar) dibujarEscuelas();
  }

  /** Estilo del pin según estatus y alertas. */
  function estiloDe(escuela) {
    const color = Estado.COLORES[escuela.estatus] || Estado.COLORES.sin_visitar;
    const tieneAlerta = (escuela.alertas || []).length > 0;
    return {
      radius: 7,
      fillColor: color,
      fillOpacity: 0.9,
      color: tieneAlerta ? '#DC2626' : '#ffffff', // borde rojo = alerta
      weight: tieneAlerta ? 3 : 1.5,
    };
  }

  /** Redibuja todos los pines del municipio activo aplicando filtros. */
  function dibujarEscuelas() {
    // Antes de calcular qué entra en pantalla, Leaflet debe conocer el
    // tamaño real del contenedor. Tailwind y las fuentes llegan por CDN y
    // aplican el layout DESPUÉS de que el mapa se inicializó: con el tamaño
    // viejo, el agrupador descarta todos los marcadores por creerlos fuera
    // de vista y el mapa aparece vacío.
    mapa.invalidateSize({ animate: false });

    if (capaEscuelas) { mapa.removeLayer(capaEscuelas); capaEscuelas = null; }
    marcadores.clear();

    const visibles = Estado.escuelas.filter(
      (e) => Estado.visible(e) && Number.isFinite(e.lat) && Number.isFinite(e.lng)
    );

    // Cluster solo cuando hay muchos puntos; con pocos, pines directos.
    capaEscuelas = visibles.length > 250
      ? L.markerClusterGroup({ disableClusteringAtZoom: 14, chunkedLoading: true })
      : L.layerGroup();

    for (const e of visibles) {
      const m = L.circleMarker([e.lat, e.lng], estiloDe(e));
      // En móvil el tooltip estorba: el toque abre la ficha, que ya trae
      // el nombre, y el globo se queda pegado sobre el mapa.
      if (!esAngosto()) m.bindTooltip(e.nombre, { direction: 'top', offset: [0, -6] });
      m.on('click', () => Panel.abrir(e.id));
      marcadores.set(e.id, m);
      capaEscuelas.addLayer(m);
    }
    capaEscuelas.addTo(mapa);

    repintarSeleccion();

    if (visibles.length) {
      const limites = L.latLngBounds(visibles.map((e) => [e.lat, e.lng])).pad(0.08);
      // En móvil se reserva espacio para la barra superior y el botón
      // flotante de la ruta, para que ningún pin quede debajo de ellos.
      mapa.fitBounds(limites, esAngosto()
        ? { paddingTopLeft: [16, 68], paddingBottomRight: [16, 92] }
        : undefined);
    }
    dibujarRuta();
  }

  /** Actualiza el estilo de un solo pin (tras cambiar estatus o coordenadas). */
  function refrescarEscuela(escuela) {
    const m = marcadores.get(escuela.id);
    if (!m) { dibujarEscuelas(); return; } // pudo entrar/salir de filtros
    if (!Estado.visible(escuela)) { dibujarEscuelas(); return; }
    m.setLatLng([escuela.lat, escuela.lng]);
    m.setStyle(estiloDe(escuela));
    // Si es la seleccionada y se corrigió su ubicación, el aro la sigue.
    if (escuela.id === idSeleccionada) seleccionar(escuela);
  }

  /** Dibuja los números de parada y la polilínea de la ruta del día. */
  function dibujarRuta() {
    capaRuta.clearLayers();
    const orden = Ruta.ordenar(Estado.escuelasDeRuta());
    orden.forEach((e, i) => {
      const icono = L.divIcon({
        className: '',
        html: `<div class="marcador-ruta">${i + 1}</div>`,
        iconSize: [20, 20],
        iconAnchor: [10, 24],
      });
      capaRuta.addLayer(L.marker([e.lat, e.lng], { icon: icono, interactive: false }));
    });
    if (orden.length >= 2) {
      capaRuta.addLayer(
        L.polyline(orden.map((e) => [e.lat, e.lng]), {
          color: '#7C3AED', weight: 2.5, dashArray: '6 6', opacity: 0.8,
        })
      );
    }
  }

  /**
   * Marca en el mapa la escuela seleccionada con un aro visible, para no
   * perderla de vista cuando el mapa se mueve al abrir su ficha.
   */
  function seleccionar(escuela) {
    limpiarSeleccion();
    if (!escuela || !Number.isFinite(escuela.lat) || !Number.isFinite(escuela.lng)) return;
    idSeleccionada = escuela.id;
    halo = L.marker([escuela.lat, escuela.lng], {
      icon: L.divIcon({ className: '', html: '<div class="halo-seleccion"></div>', iconSize: [46, 46], iconAnchor: [23, 23] }),
      interactive: false,   // no debe robarle el clic al pin
      zIndexOffset: 1000,   // siempre por encima de los demás marcadores
      keyboard: false,
    }).addTo(mapa);
  }

  /** Quita la marca de selección. */
  function limpiarSeleccion() {
    if (halo) { mapa.removeLayer(halo); halo = null; }
    idSeleccionada = null;
  }

  /** Vuelve a dibujar el aro tras un redibujado o un cambio de coordenada. */
  function repintarSeleccion() {
    if (!idSeleccionada) return;
    const e = Estado.porId.get(idSeleccionada);
    if (e && Estado.visible(e)) seleccionar(e);
    else limpiarSeleccion();
  }

  /** Centra el mapa en una escuela. */
  function centrarEn(escuela, zoom = 16) {
    if (!Number.isFinite(escuela.lat) || !Number.isFinite(escuela.lng)) return;
    // Nunca alejar: si ya estabas más acercado, se respeta tu zoom. Antes
    // se forzaba el zoom fijo y el mapa se alejaba de golpe, perdiendo la
    // referencia de qué escuela habías tocado.
    mapa.setView([escuela.lat, escuela.lng], Math.max(mapa.getZoom(), zoom));
    // En móvil la ficha cubre la mitad inferior de la pantalla: se sube el
    // punto para que quede en la franja de mapa que sigue visible.
    if (esAngosto()) {
      mapa.panBy([0, Math.round(window.innerHeight * 0.26)], { animate: false });
    }
  }

  /**
   * Recalcula el tamaño del mapa. Leaflet lo necesita cuando el contenedor
   * cambia de tamaño (al abrir/cerrar hojas en móvil o al girar el
   * teléfono); si no, el mapa se ve gris o cortado.
   */
  function invalidar() {
    if (mapa) mapa.invalidateSize({ animate: false });
  }

  // ── Suscripciones a eventos globales ────────────────────────────────────
  document.addEventListener('zona:cargada', () => {
    document.getElementById('mensaje-vacio')?.classList.add('hidden');
    dibujarEscuelas();
  });
  document.addEventListener('filtros:cambiados', dibujarEscuelas);
  document.addEventListener('escuela:cambiada', (ev) => refrescarEscuela(ev.detail));
  document.addEventListener('ruta:cambiada', dibujarRuta);

  return { iniciar, centrarEn, invalidar, seleccionar, limpiarSeleccion };
})();

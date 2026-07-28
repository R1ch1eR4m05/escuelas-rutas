/**
 * estado.js — Estado compartido de la aplicación (patrón módulo simple).
 * Otros módulos leen/escriben aquí y disparan eventos personalizados en
 * `document` para mantenerse sincronizados sin acoplarse entre sí.
 *
 * Eventos emitidos:
 *   'zona:cargada'      → se cargó un municipio (detail: segmento)
 *   'escuela:cambiada'  → una escuela fue actualizada (detail: escuela)
 *   'ruta:cambiada'     → la ruta del día cambió
 *   'filtros:cambiados' → cambió la visibilidad por estatus/alertas
 */
const Estado = {
  estadoSlug: null,
  municipioSlug: null,
  escuelas: [],            // escuelas del municipio activo
  porId: new Map(),        // id → escuela
  filtros: new Set(['sin_visitar', 'pendiente', 'visitada', 'descartada']),
  soloAlertas: false,
  rutas: [],               // rutas del municipio activo (una por equipo)
  rutaActivaId: null,      // a cuál se agregan las paradas

  COLORES: {
    sin_visitar: '#64748B',
    pendiente: '#D97706',
    visitada: '#16A34A',
    descartada: '#DC2626',
  },

  ETIQUETAS_ESTATUS: {
    sin_visitar: 'Sin visitar',
    pendiente: 'Pendiente',
    visitada: 'Visitada',
    descartada: 'Descartada / Inaccesible',
  },

  ETIQUETAS_ALERTA: {
    coord_invalida: 'Coordenada inválida o en (0,0)',
    coord_duplicada: 'Coordenada idéntica a otras escuelas de la zona',
    fuera_de_zona: 'Muy lejos del centro del municipio (> 30 km)',
  },

  /**
   * Limpia un campo de dirección del CSV.
   *
   * "NINGUNO" es el relleno que usa la fuente cuando falta el dato, pero
   * aparece de varias formas: solo ("NINGUNO NINGUNO", 21,852 casos),
   * pegado al tipo de vialidad ("CALLE NINGUNO") o como prefijo de una
   * calle que SÍ existe ("NINGUNO HIDALGO"). Por eso se quitan solo esas
   * palabras y se conserva lo demás; si lo que queda es nada o únicamente
   * un tipo de vialidad genérico, el campo no aporta y se descarta.
   *
   * @returns {string} el valor legible, o '' si no hay dato real
   */
  limpiarCampo(v) {
    const bruto = String(v ?? '').trim();
    if (!bruto) return '';

    const sinRelleno = bruto
      .replace(/\bningun[oa]s?\b/gi, ' ')
      .replace(/[.,;]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!sinRelleno) return '';

    const comparable = sinRelleno.toUpperCase();
    if (['0', 'N/A', 'NA', 'SIN DATO', 'SIN NOMBRE', 'S/N', 'SN'].includes(comparable)) return '';

    // Solo el tipo de vialidad, sin nombre: no sirve para llegar.
    const GENERICOS = /^(CALLE|CERRADA|CAMINO|VEREDA|AVENIDA|AV|PRIVADA|ANDADOR|BOULEVARD|BLVD|CARRETERA|PROLONGACION|CALLEJON|BRECHA|DOMICILIO CONOCIDO|CONOCIDO|CONOCIDA)$/;
    if (GENERICOS.test(comparable)) return '';

    return sinRelleno;
  },

  /** ¿El campo trae información real? */
  hayDato(v) {
    return this.limpiarCampo(v) !== '';
  },

  /** Dirección legible: omite los campos sin dato real. */
  direccionCompleta(e) {
    const partes = [];
    const calle = this.limpiarCampo(e.domicilio);
    const numero = this.limpiarCampo(e.numero_exterior);
    if (calle) partes.push(numero ? `${calle} #${numero}` : calle);

    const colonia = this.limpiarCampo(e.colonia);
    if (colonia) partes.push(colonia);

    const localidad = this.limpiarCampo(e.localidad);
    if (localidad && localidad !== e.municipio) partes.push(localidad);

    const cp = this.limpiarCampo(e.codigo_postal);
    if (cp) partes.push(`C.P. ${cp}`);

    if (this.limpiarCampo(e.municipio)) partes.push(e.municipio);
    if (this.limpiarCampo(e.estado)) partes.push(e.estado);

    return partes.join(', ') || 'Sin dirección registrada';
  },

  emitir(nombre, detail) {
    document.dispatchEvent(new CustomEvent(nombre, { detail }));
  },

  cargarZona(estadoSlug, municipioSlug, segmento) {
    this.estadoSlug = estadoSlug;
    this.municipioSlug = municipioSlug;
    this.escuelas = segmento.escuelas;
    this.porId = new Map(segmento.escuelas.map((e) => [e.id, e]));
    this.emitir('zona:cargada', segmento);
    // Las rutas son de este municipio y viven en el servidor.
    this.cargarRutas();
  },

  /** ¿La escuela pasa los filtros activos? */
  visible(escuela) {
    if (!this.filtros.has(escuela.estatus)) return false;
    if (this.soloAlertas && !(escuela.alertas || []).length) return false;
    return true;
  },

  aplicarCambio(escuelaActualizada) {
    const e = this.porId.get(escuelaActualizada.id);
    if (e) Object.assign(e, escuelaActualizada);
    this.emitir('escuela:cambiada', e || escuelaActualizada);
  },

  // ── Rutas del día ─────────────────────────────────────────────────────
  //
  // Un municipio puede tener varias rutas a la vez (una por equipo de
  // campo). Todas se guardan en el servidor, así que persisten y las ven
  // todos los equipos. `rutaActiva` es a la que se agregan las paradas.

  /** La ruta activa, o null si la zona no tiene ninguna. */
  get rutaActiva() {
    return this.rutas.find((r) => r.id === this.rutaActivaId) || null;
  },

  /** Ids de escuelas de la ruta activa (vacío si no hay ruta). */
  get ruta() {
    return this.rutaActiva?.escuelas || [];
  },

  /** Carga las rutas de la zona activa y elige cuál queda seleccionada. */
  async cargarRutas() {
    try {
      this.rutas = await Api.rutas(this.estadoSlug, this.municipioSlug);
    } catch {
      this.rutas = [];
    }
    // Las paradas que ya no existan en la zona se descartan al vuelo.
    for (const r of this.rutas) r.escuelas = r.escuelas.filter((id) => this.porId.has(id));
    if (!this.rutas.some((r) => r.id === this.rutaActivaId)) {
      this.rutaActivaId = this.rutas[0]?.id || null;
    }
    this.emitir('rutas:cambiadas');
    this.emitir('ruta:cambiada');
  },

  seleccionarRuta(id) {
    if (this.rutaActivaId === id) return;
    this.rutaActivaId = id;
    this.emitir('rutas:cambiadas');
    this.emitir('ruta:cambiada');
  },

  async crearRuta(nombre) {
    const ruta = await Api.crearRuta(this.estadoSlug, this.municipioSlug, nombre);
    this.rutas.push(ruta);
    this.rutaActivaId = ruta.id;
    this.emitir('rutas:cambiadas');
    this.emitir('ruta:cambiada');
    return ruta;
  },

  async renombrarRuta(id, nombre) {
    const ruta = this.rutas.find((r) => r.id === id);
    if (!ruta) return;
    const actualizada = await Api.actualizarRuta(id, { nombre });
    Object.assign(ruta, actualizada);
    this.emitir('rutas:cambiadas');
  },

  async eliminarRuta(id) {
    await Api.eliminarRuta(id);
    this.rutas = this.rutas.filter((r) => r.id !== id);
    if (this.rutaActivaId === id) this.rutaActivaId = this.rutas[0]?.id || null;
    this.emitir('rutas:cambiadas');
    this.emitir('ruta:cambiada');
  },

  /** Guarda las paradas de la ruta activa en el servidor. */
  async guardarParadas() {
    const ruta = this.rutaActiva;
    if (!ruta) return;
    try {
      await Api.actualizarRuta(ruta.id, { escuelas: ruta.escuelas });
    } catch (err) {
      if (window.App) App.aviso(`No se pudo guardar la ruta: ${err.message}`, true);
    }
  },

  enRuta(id) { return this.ruta.includes(id); },

  /** Agrega o quita una parada de la ruta activa. */
  alternarEnRuta(id) {
    const ruta = this.rutaActiva;
    if (!ruta) return false; // sin ruta activa no hay dónde ponerla
    const i = ruta.escuelas.indexOf(id);
    if (i >= 0) ruta.escuelas.splice(i, 1);
    else ruta.escuelas.push(id);
    this.emitir('ruta:cambiada');
    this.guardarParadas();
    return true;
  },

  quitarDeRuta(id) {
    const ruta = this.rutaActiva;
    if (!ruta) return;
    ruta.escuelas = ruta.escuelas.filter((x) => x !== id);
    this.emitir('ruta:cambiada');
    this.guardarParadas();
  },

  limpiarRuta() {
    const ruta = this.rutaActiva;
    if (!ruta) return;
    ruta.escuelas = [];
    this.emitir('ruta:cambiada');
    this.guardarParadas();
  },

  /** Reemplaza el orden de las paradas de la ruta activa. */
  ordenarRuta(ids) {
    const ruta = this.rutaActiva;
    if (!ruta) return;
    ruta.escuelas = ids;
    this.emitir('ruta:cambiada');
    this.guardarParadas();
  },

  escuelasDeRuta(ruta = this.rutaActiva) {
    if (!ruta) return [];
    return ruta.escuelas.map((id) => this.porId.get(id)).filter(Boolean);
  },
};

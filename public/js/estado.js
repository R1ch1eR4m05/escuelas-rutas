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
  ruta: [],                // ids de escuelas en la ruta del día (en orden)

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
    this.ruta = this.ruta.filter((id) => this.porId.has(id)); // la ruta solo vive dentro de la zona
    this.emitir('zona:cargada', segmento);
    this.emitir('ruta:cambiada');
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

  // ── Ruta del día ──────────────────────────────────────────────────────
  enRuta(id) { return this.ruta.includes(id); },

  alternarEnRuta(id) {
    const i = this.ruta.indexOf(id);
    if (i >= 0) this.ruta.splice(i, 1);
    else this.ruta.push(id);
    this.emitir('ruta:cambiada');
  },

  quitarDeRuta(id) {
    this.ruta = this.ruta.filter((x) => x !== id);
    this.emitir('ruta:cambiada');
  },

  limpiarRuta() {
    this.ruta = [];
    this.emitir('ruta:cambiada');
  },

  escuelasDeRuta() {
    return this.ruta.map((id) => this.porId.get(id)).filter(Boolean);
  },
};

/**
 * api.js — Cliente de datos.
 *
 * Funciona en dos modos, decididos automáticamente en el arranque:
 *
 *   SERVIDOR  — hay un backend Express (npm start, VPS): se usa la API REST
 *               completa y todo se guarda en disco.
 *   ESTÁTICO  — no hay backend (GitHub Pages y similares): los datos se leen
 *               directo de los archivos JSON publicados. Se puede consultar
 *               todo, y los cambios de estatus y notas se guardan solo en
 *               este navegador (localStorage). La corrección con INEGI no
 *               está disponible porque requiere el token del servidor.
 *
 * El mismo código sirve para los dos casos: no hay que compilar nada
 * distinto para publicar.
 */
const Api = (() => {
  const LLAVE_CAMBIOS = 'escuelas-rutas:cambios';

  let modo = null;          // 'servidor' | 'estatico'
  let deteccion = null;     // promesa de detección en curso
  let indiceCache = null;

  async function pedir(ruta, opciones = {}) {
    const resp = await fetch(ruta, {
      headers: { 'Content-Type': 'application/json' },
      ...opciones,
    });
    const datos = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(datos.error || `Error ${resp.status}`);
    return datos;
  }

  /**
   * Detecta el modo una sola vez preguntando por el índice de la API.
   * Si no hay backend, la respuesta no será JSON (404 de Pages) y se pasa
   * a modo estático.
   */
  function detectar() {
    if (modo) return Promise.resolve(modo);
    if (deteccion) return deteccion;
    deteccion = (async () => {
      try {
        const resp = await fetch('api/estados', { headers: { Accept: 'application/json' } });
        if (!resp.ok) throw new Error('sin API');
        await resp.json(); // Pages devuelve HTML: esto truena y caemos a estático
        modo = 'servidor';
      } catch {
        modo = 'estatico';
      }
      document.dispatchEvent(new CustomEvent('api:modo', { detail: modo }));
      return modo;
    })();
    return deteccion;
  }

  // ── Modo estático ───────────────────────────────────────────────────────

  async function indice() {
    if (!indiceCache) {
      const resp = await fetch('db/indice.json');
      if (!resp.ok) throw new Error('No se pudo cargar el índice de datos');
      indiceCache = await resp.json();
    }
    return indiceCache;
  }

  /** Cambios locales del navegador: { id: { estatus, notas, lat, lng, ... } } */
  function cambiosLocales() {
    try { return JSON.parse(localStorage.getItem(LLAVE_CAMBIOS) || '{}'); }
    catch { return {}; }
  }

  function guardarCambioLocal(id, cambios) {
    const todos = cambiosLocales();
    todos[id] = { ...(todos[id] || {}), ...cambios };
    try { localStorage.setItem(LLAVE_CAMBIOS, JSON.stringify(todos)); }
    catch { /* sin espacio o modo privado: el cambio vive solo en memoria */ }
    return todos[id];
  }

  async function estadosEstatico() {
    const idx = await indice();
    return Object.entries(idx.estados)
      .map(([slug, e]) => ({
        slug,
        nombre: e.nombre,
        municipios: Object.keys(e.municipios).length,
        total: Object.values(e.municipios).reduce((s, m) => s + m.total, 0),
      }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }

  async function municipiosEstatico(estadoSlug) {
    const idx = await indice();
    const e = idx.estados[estadoSlug];
    if (!e) throw new Error('Estado no encontrado');
    return Object.entries(e.municipios)
      .map(([slug, m]) => ({ slug, ...m }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }

  async function escuelasEstatico(estadoSlug, municipioSlug) {
    const resp = await fetch(`db/segmentos/${estadoSlug}/${municipioSlug}.json`);
    if (!resp.ok) throw new Error('Municipio no encontrado');
    const seg = await resp.json();

    // Se reaplican los cambios que el visitante haya hecho en este navegador.
    const guardados = cambiosLocales();
    for (const escuela of seg.escuelas) {
      const c = guardados[escuela.id];
      if (c) Object.assign(escuela, c);
    }
    return seg;
  }

  const SIN_BACKEND = 'Esta es una vista de solo consulta: la corrección con INEGI necesita el servidor.';

  // ── API pública ─────────────────────────────────────────────────────────
  return {
    /** 'servidor' | 'estatico' | null si aún no se detecta. */
    get modo() { return modo; },
    detectar,

    async estados() {
      return (await detectar()) === 'servidor' ? pedir('api/estados') : estadosEstatico();
    },

    async municipios(estadoSlug) {
      return (await detectar()) === 'servidor'
        ? pedir(`api/estados/${estadoSlug}/municipios`)
        : municipiosEstatico(estadoSlug);
    },

    async escuelas(estadoSlug, municipioSlug) {
      return (await detectar()) === 'servidor'
        ? pedir(`api/escuelas/${estadoSlug}/${municipioSlug}`)
        : escuelasEstatico(estadoSlug, municipioSlug);
    },

    /** Actualiza estatus / notas / coordenadas de una escuela. */
    async actualizarEscuela(estadoSlug, municipioSlug, id, cambios) {
      if ((await detectar()) === 'servidor') {
        return pedir(`api/escuelas/${estadoSlug}/${municipioSlug}/${id}`, {
          method: 'PATCH',
          body: JSON.stringify(cambios),
        });
      }
      // Sin servidor: se guarda en este navegador y se devuelve la escuela ya
      // fusionada, para que la interfaz se comporte igual que con backend.
      guardarCambioLocal(id, cambios);
      const escuela = Estado.porId.get(id);
      const actualizada = { ...escuela, ...cambios };
      if ('lat' in cambios || 'lng' in cambios) actualizada.alertas = [];
      return actualizada;
    },

    async validarMunicipio(estadoSlug, municipioSlug, aplicar) {
      if ((await detectar()) !== 'servidor') throw new Error(SIN_BACKEND);
      return pedir('api/denue/validar-municipio', {
        method: 'POST',
        body: JSON.stringify({ estado: estadoSlug, municipio: municipioSlug, aplicar }),
      });
    },

    async aplicarCorrecciones(estadoSlug, municipioSlug, correcciones) {
      if ((await detectar()) !== 'servidor') throw new Error(SIN_BACKEND);
      return pedir('api/denue/aplicar-correcciones', {
        method: 'POST',
        body: JSON.stringify({ estado: estadoSlug, municipio: municipioSlug, correcciones }),
      });
    },

    async validarDenue(escuela) {
      if ((await detectar()) !== 'servidor') throw new Error(SIN_BACKEND);
      return pedir('api/denue/validar', {
        method: 'POST',
        body: JSON.stringify({
          nombre: escuela.nombre,
          estado: escuela.estado,
          municipio: escuela.municipio,
          lat: escuela.lat,
          lng: escuela.lng,
          codigo_postal: escuela.codigo_postal,
          colonia: escuela.colonia,
        }),
      });
    },
  };
})();

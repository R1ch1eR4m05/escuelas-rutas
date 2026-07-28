/**
 * src/db.js
 * Capa de acceso a los datos segmentados en JSON.
 * - El índice (estados/municipios) se mantiene en memoria.
 * - Cada segmento (municipio) se lee bajo demanda y se cachea.
 * - Las actualizaciones se escriben de forma atómica (tmp + rename).
 */
const fs = require('fs');
const path = require('path');
const { slug } = require('./util/geo');

const RAIZ = path.join(__dirname, '..');
const DIR_SEGMENTOS = path.join(RAIZ, 'db', 'segmentos');
const ARCHIVO_INDICE = path.join(RAIZ, 'db', 'indice.json');
const ARCHIVO_RUTAS = path.join(RAIZ, 'db', 'rutas.json');

let indice = null;
let rutas = null;
const cacheSegmentos = new Map(); // "eSlug/mSlug" → objeto segmento

/** Colores para distinguir las rutas en el mapa. */
const COLORES_RUTA = ['#7C3AED', '#EA580C', '#0891B2', '#16A34A', '#DB2777', '#CA8A04'];

/** Carga (una vez) el índice generado por scripts/importar-csv.js. */
function obtenerIndice() {
  if (!indice) {
    if (!fs.existsSync(ARCHIVO_INDICE)) {
      throw Object.assign(
        new Error('No existe db/indice.json. Ejecuta primero: npm run importar'),
        { codigo: 'SIN_IMPORTAR' }
      );
    }
    indice = JSON.parse(fs.readFileSync(ARCHIVO_INDICE, 'utf8'));
  }
  return indice;
}

function rutaSegmento(eSlug, mSlug) {
  return path.join(DIR_SEGMENTOS, eSlug, `${mSlug}.json`);
}

/** Devuelve el segmento (municipio completo) o null si no existe. */
function obtenerSegmento(eSlug, mSlug) {
  const llave = `${eSlug}/${mSlug}`;
  if (cacheSegmentos.has(llave)) return cacheSegmentos.get(llave);
  const ruta = rutaSegmento(eSlug, mSlug);
  if (!fs.existsSync(ruta)) return null;
  const seg = JSON.parse(fs.readFileSync(ruta, 'utf8'));
  cacheSegmentos.set(llave, seg);
  return seg;
}

/** Escritura atómica del segmento (evita archivos a medias si algo falla). */
function guardarSegmento(eSlug, mSlug, seg) {
  const ruta = rutaSegmento(eSlug, mSlug);
  seg.actualizado = new Date().toISOString();
  const tmp = `${ruta}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(seg));
  fs.renameSync(tmp, ruta);
  cacheSegmentos.set(`${eSlug}/${mSlug}`, seg);
}

/**
 * Actualiza campos permitidos de una escuela dentro de su segmento.
 * @returns la escuela actualizada o null si no se encontró.
 */
function actualizarEscuela(eSlug, mSlug, idEscuela, cambios) {
  const seg = obtenerSegmento(eSlug, mSlug);
  if (!seg) return null;
  const escuela = seg.escuelas.find((e) => e.id === idEscuela);
  if (!escuela) return null;

  const PERMITIDOS = ['estatus', 'notas', 'lat', 'lng', 'corregida_denue', 'denue_id'];
  for (const campo of PERMITIDOS) {
    if (campo in cambios) escuela[campo] = cambios[campo];
  }
  // Si se corrigió manualmente la coordenada, se retiran las alertas de ubicación.
  if ('lat' in cambios || 'lng' in cambios) {
    escuela.alertas = [];
  }
  guardarSegmento(eSlug, mSlug, seg);
  return escuela;
}

/**
 * Recalcula en el índice el número de escuelas con alerta del municipio.
 *
 * El índice lo genera `npm run importar`, pero corregir ubicaciones limpia
 * alertas: sin esto el selector de municipios seguiría mostrando el conteo
 * viejo (p. ej. «Tijuana ⚠277» cuando ya solo quedan 173).
 */
function refrescarConteoAlertas(eSlug, mSlug) {
  const seg = obtenerSegmento(eSlug, mSlug);
  if (!seg) return null;
  const idx = obtenerIndice();
  const mun = idx.estados?.[eSlug]?.municipios?.[mSlug];
  if (!mun) return null;

  const alertas = seg.escuelas.filter((e) => (e.alertas || []).length).length;
  if (mun.alertas === alertas) return alertas; // sin cambios: no se reescribe

  mun.alertas = alertas;
  const tmp = `${ARCHIVO_INDICE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(idx, null, 2));
  fs.renameSync(tmp, ARCHIVO_INDICE);
  return alertas;
}

// ── Rutas del día ───────────────────────────────────────────────────────
//
// Varios equipos trabajan en paralelo, cada uno con su propia ruta. Se
// guardan en el servidor (no en el navegador) para que todos vean lo mismo
// y no se pierdan al recargar. Van en su propio archivo: son datos de
// planeación, no del catálogo de escuelas.

function cargarRutas() {
  if (rutas) return rutas;
  try {
    rutas = JSON.parse(fs.readFileSync(ARCHIVO_RUTAS, 'utf8'));
    if (!Array.isArray(rutas.rutas)) rutas = { rutas: [] };
  } catch {
    rutas = { rutas: [] }; // aún no existe: se crea al guardar
  }
  return rutas;
}

function guardarRutas() {
  rutas.actualizado = new Date().toISOString();
  const tmp = `${ARCHIVO_RUTAS}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(rutas, null, 2));
  fs.renameSync(tmp, ARCHIVO_RUTAS);
}

/** Rutas de un municipio, en el orden en que se crearon. */
function rutasDeZona(eSlug, mSlug) {
  return cargarRutas().rutas.filter((r) => r.estado === eSlug && r.municipio === mSlug);
}

function crearRuta({ nombre, estado, municipio }) {
  cargarRutas();
  const deZona = rutasDeZona(estado, municipio);
  const ruta = {
    id: `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    nombre: String(nombre || `Ruta ${deZona.length + 1}`).slice(0, 60).trim() || `Ruta ${deZona.length + 1}`,
    color: COLORES_RUTA[deZona.length % COLORES_RUTA.length],
    estado, municipio,
    escuelas: [],
    creada: new Date().toISOString(),
  };
  rutas.rutas.push(ruta);
  guardarRutas();
  return ruta;
}

function actualizarRuta(id, cambios) {
  cargarRutas();
  const ruta = rutas.rutas.find((r) => r.id === id);
  if (!ruta) return null;
  if (cambios.nombre !== undefined) {
    const limpio = String(cambios.nombre).slice(0, 60).trim();
    if (limpio) ruta.nombre = limpio;
  }
  if (Array.isArray(cambios.escuelas)) {
    ruta.escuelas = cambios.escuelas.map(String).slice(0, 500);
  }
  if (cambios.color !== undefined && /^#[0-9A-Fa-f]{6}$/.test(cambios.color)) {
    ruta.color = cambios.color;
  }
  guardarRutas();
  return ruta;
}

function eliminarRuta(id) {
  cargarRutas();
  const antes = rutas.rutas.length;
  rutas.rutas = rutas.rutas.filter((r) => r.id !== id);
  if (rutas.rutas.length === antes) return false;
  guardarRutas();
  return true;
}

module.exports = {
  obtenerIndice, obtenerSegmento, actualizarEscuela, refrescarConteoAlertas, slug,
  rutasDeZona, crearRuta, actualizarRuta, eliminarRuta, COLORES_RUTA,
};

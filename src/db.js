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

let indice = null;
const cacheSegmentos = new Map(); // "eSlug/mSlug" → objeto segmento

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

module.exports = { obtenerIndice, obtenerSegmento, actualizarEscuela, refrescarConteoAlertas, slug };

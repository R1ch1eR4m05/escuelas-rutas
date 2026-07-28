/**
 * util/geo.js
 * Utilidades geográficas y de normalización de texto compartidas
 * entre el script de importación y el servidor.
 */

/** Distancia haversine en kilómetros entre dos puntos {lat, lng}. */
function haversineKm(a, b) {
  const R = 6371;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Convierte un nombre ("MICHOACÁN DE OCAMPO") en slug de archivo ("michoacan-de-ocampo"). */
function slug(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // quita acentos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'sin-nombre';
}

/** Bounding box aproximado de México (con margen). */
const BBOX_MEXICO = { latMin: 14.0, latMax: 33.5, lngMin: -119.0, lngMax: -85.0 };

/** true si la coordenada es numérica, distinta de 0 y cae dentro de México. */
function coordenadaValida(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat === 0 || lng === 0) return false;
  return (
    lat >= BBOX_MEXICO.latMin && lat <= BBOX_MEXICO.latMax &&
    lng >= BBOX_MEXICO.lngMin && lng <= BBOX_MEXICO.lngMax
  );
}

/** Mediana de un arreglo numérico (no muta el original). */
function mediana(valores) {
  if (!valores.length) return null;
  const v = [...valores].sort((x, y) => x - y);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

module.exports = { haversineKm, slug, coordenadaValida, mediana, BBOX_MEXICO };

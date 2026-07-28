/**
 * util/similitud.js
 * Normalización de texto y puntuación de candidatos DENUE contra una
 * escuela de la base. Compartido por la validación individual (botón en
 * la ficha) y la validación por lote (script y endpoint).
 */
const { haversineKm } = require('./geo');

/** Normaliza: sin acentos, minúsculas, sin signos, espacios colapsados. */
function normalizar(t) {
  return String(t || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Palabras que no distinguen una escuela de otra: aparecen en casi todos
 * los nombres y en la clase de actividad del DENUE.
 */
const RUIDO = new Set([
  'escuela', 'escuelas', 'primaria', 'primarias', 'colegio', 'instituto',
  'educacion', 'publico', 'publica', 'privado', 'privada', 'sector',
  'general', 'profesor', 'profesora', 'profr', 'profra', 'lic', 'licenciado',
  'dr', 'doctor', 'gral', 'no', 'num', 'numero', 'turno', 'matutino', 'vespertino',
  'de', 'del', 'la', 'las', 'el', 'los', 'y', 'a', 'en',
]);

/** Palabras significativas de un nombre (sin ruido, sin duplicados). */
function palabrasClave(nombre) {
  return [...new Set(normalizar(nombre).split(' ').filter((w) => w.length > 1 && !RUIDO.has(w)))];
}

/**
 * Similitud 0–1 entre dos nombres.
 * Combina traslape de palabras (Jaccard) con un bono si el nombre corto
 * está contenido por completo en el largo (p. ej. "BENITO JUAREZ" dentro
 * de "ESC PRIM BENITO JUAREZ GARCIA").
 */
function similitudNombre(a, b) {
  const pa = palabrasClave(a);
  const pb = palabrasClave(b);
  if (!pa.length || !pb.length) return 0;

  const setB = new Set(pb);
  const comunes = pa.filter((w) => setB.has(w)).length;
  const jaccard = comunes / (pa.length + pb.length - comunes);
  const contenido = comunes === Math.min(pa.length, pb.length) ? 0.2 : 0;

  return Math.min(1, jaccard + contenido);
}

/**
 * Puntúa un candidato DENUE contra una escuela (0–100).
 *
 * @param {object} escuela  registro de la base
 * @param {object} cand     candidato ya normalizado {nombre, cp, colonia, lat, lng}
 * @param {object} [ref]    punto de referencia {lat, lng} del municipio, para
 *                          penalizar candidatos absurdamente lejanos
 */
function puntuar(escuela, cand, ref) {
  const nombre = similitudNombre(escuela.nombre, cand.nombre);

  // El nombre es la señal principal: sin parecido, no hay candidato.
  if (nombre < 0.2) return 0;

  let puntaje = nombre * 60;

  // Código postal exacto: señal fuerte de que es la misma ubicación.
  if (escuela.codigo_postal && cand.cp &&
      String(escuela.codigo_postal).trim() === String(cand.cp).trim()) {
    puntaje += 22;
  }

  // Colonia: coincidencia por traslape de palabras.
  if (escuela.colonia && cand.colonia) {
    const s = similitudNombre(escuela.colonia, cand.colonia);
    if (s > 0.5) puntaje += 12;
    else if (s > 0.2) puntaje += 6;
  }

  // Cercanía al centro del municipio: descarta candidatos de otra ciudad
  // que casualmente se llamen igual (hay cientos de "Benito Juárez").
  if (ref && Number.isFinite(cand.lat)) {
    const d = haversineKm({ lat: cand.lat, lng: cand.lng }, ref);
    if (d > 60) puntaje -= 40;
    else if (d > 30) puntaje -= 15;
    else if (d < 10) puntaje += 6;
  }

  return Math.max(0, Math.min(100, Math.round(puntaje)));
}

module.exports = { normalizar, palabrasClave, similitudNombre, puntuar };

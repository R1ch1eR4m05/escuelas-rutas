/**
 * src/denue-cliente.js
 * Cliente de la API pública DENUE (INEGI).
 *
 * Métodos usados (según la documentación oficial):
 *   Buscar        /consulta/Buscar/{condicion}/{lat},{lng}/{metros}/{token}
 *                 radio máximo 5,000 m
 *   BuscarEntidad /consulta/BuscarEntidad/{condicion}/{entidad}/{ini}/{fin}/{token}
 *
 * Nota importante de la documentación: cuando la condición tiene varias
 * palabras, éstas se separan con COMA (no con espacio).
 */
const BASE = 'https://www.inegi.org.mx/app/api/denue/v1/consulta';

/** Espera n milisegundos (para no saturar la API). */
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Une los términos de búsqueda y los codifica para URL.
 *
 * OJO: la documentación oficial dice que las palabras se separan con COMA,
 * pero contra la API real cualquier condición con coma deja al servidor de
 * INEGI colgado — acepta la conexión, responde encabezados y nunca manda el
 * cuerpo, hasta que revienta el timeout. Afecta por igual a Buscar y a
 * BuscarEntidad. Separando con ESPACIO responde normal y los términos se
 * combinan como se espera ("...primaria tijuana" devuelve solo Tijuana).
 *
 * @param {string[]} palabras
 */
function condicion(palabras) {
  const limpias = palabras
    .map((p) => String(p || '').trim())
    .filter(Boolean);
  return encodeURIComponent(limpias.join(' ') || 'todos');
}

/** Tiempo máximo de espera por consulta. El servidor de INEGI a veces
 * acepta la conexión y nunca responde (ver nota en validacion-lote.js):
 * sin este límite el proceso se queda colgado para siempre. */
const TIMEOUT_MS = 30000;

/**
 * Ejecuta una consulta con reintentos ante fallos de red o 5xx.
 * DENUE responde 404 cuando simplemente no hay resultados: eso no es error.
 */
async function consultar(url, { intentos = 3, esperaMs = 800, timeoutMs = TIMEOUT_MS } = {}) {
  let ultimoError;
  for (let i = 0; i < intentos; i++) {
    try {
      const resp = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (resp.status === 404) return [];
      if (resp.status === 401 || resp.status === 403) {
        throw Object.assign(new Error('Token de DENUE inválido o sin autorización'), { fatal: true });
      }
      if (!resp.ok) throw new Error(`DENUE respondió ${resp.status}`);
      const datos = await resp.json();
      return Array.isArray(datos) ? datos : [];
    } catch (err) {
      if (err.fatal) throw err;
      ultimoError = err.name === 'TimeoutError'
        ? new Error(`DENUE no respondió en ${timeoutMs / 1000} s`)
        : err;
      if (i < intentos - 1) await dormir(esperaMs * (i + 1));
    }
  }
  throw ultimoError;
}

/**
 * El DENUE no trae un campo de municipio limpio: viene como texto dentro
 * de Ubicacion, con formato "{localidad}, {municipio}, {estado}".
 * Se toma el penúltimo segmento (el último es el estado).
 */
function municipioDeUbicacion(ubicacion) {
  const partes = String(ubicacion || '').split(',').map((s) => s.trim()).filter(Boolean);
  return partes.length >= 2 ? partes[partes.length - 2] : '';
}

/** Convierte un registro crudo del DENUE al formato interno. */
function normalizarRegistro(r) {
  const lat = parseFloat(r.Latitud);
  const lng = parseFloat(r.Longitud);
  return {
    id_denue: r.Id,
    // El CLEE codifica entidad (0-2) y municipio (2-5): es la única forma
    // de conocer la clave INEGI del municipio sin un catálogo aparte.
    clee: r.CLEE || '',
    nombre: r.Nombre || r.Razon_social || '',
    actividad: r.Clase_actividad || '',
    calle: [r.Calle, r.Num_Exterior].filter((x) => x && x !== '0').join(' '),
    colonia: r.Colonia || '',
    cp: r.CP || '',
    telefono: r.Telefono || '',
    ubicacion: r.Ubicacion || '',
    municipio: municipioDeUbicacion(r.Ubicacion),
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
  };
}

/**
 * Búsqueda por cercanía a un punto (radio máximo permitido: 5 km).
 * @param {string[]} palabras  términos de búsqueda
 */
async function buscarCerca(palabras, lat, lng, metros, token) {
  const radio = Math.min(Math.max(parseInt(metros, 10) || 5000, 1), 5000);
  const url = `${BASE}/Buscar/${condicion(palabras)}/${lat},${lng}/${radio}/${token}`;
  return (await consultar(url)).map(normalizarRegistro);
}

/**
 * Búsqueda en una entidad federativa, con paginación automática.
 * Se usa para bajar de una sola vez el catálogo de escuelas primarias de
 * un municipio y luego cruzarlo localmente.
 *
 * @param {string[]} palabras   términos (se unen con coma)
 * @param {string}   entidad    clave '01'–'32'
 * @param {number}   maximo     tope de registros a traer
 * @param {function} [alAvanzar] callback(traidos) para mostrar progreso
 */
async function buscarEnEntidad(palabras, entidad, token, { maximo = 4000, tamPagina = 1000, alAvanzar } = {}) {
  const acumulado = [];
  for (let inicio = 1; inicio <= maximo; inicio += tamPagina) {
    const fin = Math.min(inicio + tamPagina - 1, maximo);
    const url = `${BASE}/BuscarEntidad/${condicion(palabras)}/${entidad}/${inicio}/${fin}/${token}`;
    const pagina = await consultar(url);
    acumulado.push(...pagina.map(normalizarRegistro));
    if (alAvanzar) alAvanzar(acumulado.length);
    if (pagina.length < tamPagina) break; // última página
    await dormir(300); // ritmo amable con la API
  }
  return acumulado;
}

/**
 * Catálogo por ÁREA y ACTIVIDAD (endpoint BuscarAreaAct).
 *
 * A diferencia de BuscarEntidad, no hace búsqueda difusa de texto: filtra
 * por clave geográfica y de actividad SCIAN, así que devuelve el censo
 * completo del municipio para ese giro. Es un superconjunto de lo que
 * encuentra la búsqueda por texto.
 *
 * Firma oficial:
 *   /BuscarAreaAct/{entidad}/{municipio}/{localidad}/{ageb}/{manzana}
 *                 /{sector}/{subsector}/{rama}/{clase}/{nombre}
 *                 /{ini}/{fin}/{id}/{token}
 * Los parámetros que no se usan van en 0.
 *
 * @param {string} entidad    clave '01'–'32'
 * @param {string} municipio  clave INEGI de municipio ('004' = Tijuana)
 * @param {string} subsector  '611' = servicios educativos
 */
async function buscarPorAreaActividad(entidad, municipio, subsector, token, { maximo = 5000 } = {}) {
  const url = `${BASE}/BuscarAreaAct/${entidad}/${municipio}/0/0/0/0/${subsector}/0/0/0/1/${maximo}/0/${token}`;
  return (await consultar(url)).map(normalizarRegistro);
}

/**
 * Descubre la clave INEGI del municipio a partir del CLEE de registros que
 * ya se sabe que pertenecen a él. Evita mantener a mano el catálogo de los
 * 2,481 municipios del país.
 *
 * @param {object[]} registros  registros ya normalizados
 * @param {string}   municipio  nombre del municipio a ubicar
 * @returns {string|null} clave de tres dígitos, o null si no se pudo deducir
 */
function claveMunicipioDesde(registros, municipio) {
  const objetivo = String(municipio || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const votos = new Map();
  for (const r of registros) {
    if (!r.clee || r.clee.length < 5) continue;
    const suyo = String(r.municipio || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
    if (suyo !== objetivo) continue;
    const clave = r.clee.slice(2, 5);
    votos.set(clave, (votos.get(clave) || 0) + 1);
  }
  if (!votos.size) return null;
  return [...votos.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

module.exports = {
  buscarCerca, buscarEnEntidad, buscarPorAreaActividad, claveMunicipioDesde,
  condicion, normalizarRegistro, municipioDeUbicacion, dormir,
};

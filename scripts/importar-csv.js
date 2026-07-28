/**
 * scripts/importar-csv.js
 * ETL: lee data/Primarias_General.csv (~98 mil registros) y lo segmenta en
 * archivos JSON por Estado/Municipio bajo db/segmentos/, más un índice
 * ligero db/indice.json que la interfaz usa para poblar los selectores.
 *
 * Durante la importación se calculan alertas de geocodificación:
 *   - coord_invalida:  lat/lng en 0, no numérica o fuera de México.
 *   - coord_duplicada: 2+ escuelas del municipio comparten la MISMA
 *                      coordenada exacta Y parecen sitios distintos (CCT y
 *                      domicilio diferentes): firma de una geocodificación
 *                      caída al centroide. Los turnos de un mismo plantel y
 *                      las escuelas que comparten edificio NO se marcan.
 *   - fuera_de_zona:   la escuela está a más de UMBRAL_KM de la mediana
 *                      geográfica de su municipio (probable error).
 *
 * Uso:  npm run importar
 * Es idempotente: puede re-ejecutarse, pero CONSERVA estatus y notas ya
 * capturados en los segmentos existentes (los fusiona por clave CCT+turno).
 */
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { haversineKm, slug, coordenadaValida, mediana } = require('../src/util/geo');

const RAIZ = path.join(__dirname, '..');
const ARCHIVO_CSV = path.join(RAIZ, 'data', 'Primarias_General.csv');
// Misma carpeta de datos que usa el servidor (ver DATOS_DIR en src/db.js).
const DIR_DATOS = process.env.DATOS_DIR || path.join(RAIZ, 'db');
const DIR_SEGMENTOS = path.join(DIR_DATOS, 'segmentos');
const ARCHIVO_INDICE = path.join(DIR_DATOS, 'indice.json');

/** Km máximos de distancia a la mediana del municipio antes de marcar alerta. */
const UMBRAL_KM = 30;

function main() {
  if (!fs.existsSync(ARCHIVO_CSV)) {
    console.error(`No se encontró ${ARCHIVO_CSV}. Coloca el CSV en data/ y reintenta.`);
    process.exit(1);
  }

  console.log('Leyendo CSV…');
  const crudo = fs.readFileSync(ARCHIVO_CSV, 'utf8');
  const filas = parse(crudo, { columns: true, skip_empty_lines: true, trim: true });
  console.log(`  ${filas.length.toLocaleString()} registros leídos.`);

  // ── 1. Conservar estatus/notas de una importación previa ────────────────
  const previos = cargarEstadoPrevio();
  if (previos.size) console.log(`  Conservando avance previo de ${previos.size.toLocaleString()} escuelas.`);

  // ── 2. Normalizar y agrupar por estado → municipio ──────────────────────
  const porMunicipio = new Map(); // "estadoSlug|municipioSlug" → { estado, municipio, escuelas[] }
  for (const f of filas) {
    const estado = f.estado || 'SIN ESTADO';
    const municipio = f.municipio_o_delegacion || 'SIN MUNICIPIO';
    const idSeg = `${slug(estado)}|${slug(municipio)}`;
    if (!porMunicipio.has(idSeg)) porMunicipio.set(idSeg, { estado, municipio, escuelas: [] });

    let lat = parseFloat(f.latitud);
    let lng = parseFloat(f.longitud);
    // Identificador único: CCT + turno (una CCT puede tener matutino y vespertino).
    const id = `${f.clave}-${slug(f.turno)}`;
    const previo = previos.get(id);

    // Si la ubicación ya se corrigió (con DENUE o a mano), esa coordenada
    // gana sobre la del CSV: de lo contrario re-importar borraría el
    // trabajo de corrección.
    if (previo?.corregida_denue && Number.isFinite(previo.lat) && Number.isFinite(previo.lng)) {
      lat = previo.lat;
      lng = previo.lng;
    }

    porMunicipio.get(idSeg).escuelas.push({
      id,
      clave: f.clave,
      nombre: f.nombre_de_escuela,
      turno: f.turno,
      nivel: f.nivel,
      tipo: f.tipo,
      estado,
      municipio,
      localidad: f.localidad,
      domicilio: f.domicilio,
      numero_exterior: f.numero_exterior,
      colonia: f.colonia,
      codigo_postal: f.codigo_postal,
      alumnos: parseInt(f.alumnos_total, 10) || 0,
      docentes: parseInt(f.docentes_total, 10) || 0,
      lat: Number.isFinite(lat) ? lat : null,
      lng: Number.isFinite(lng) ? lng : null,
      estatus: previo?.estatus || f.estatus || 'sin_visitar',
      notas: previo?.notas || f.notas || '',
      alertas: [],           // se calcula abajo
      corregida_denue: previo?.corregida_denue || false,
      ...(previo?.denue_id ? { denue_id: previo.denue_id } : {}),
    });
  }

  // ── 3. Calcular alertas por municipio y escribir segmentos ──────────────
  console.log('Calculando alertas de geocodificación y escribiendo segmentos…');
  fs.rmSync(DIR_SEGMENTOS, { recursive: true, force: true });
  const indice = { generado: new Date().toISOString(), total: filas.length, estados: {} };
  let totalAlertas = 0;

  for (const { estado, municipio, escuelas } of porMunicipio.values()) {
    calcularAlertas(escuelas);
    const conAlerta = escuelas.filter((e) => e.alertas.length).length;
    totalAlertas += conAlerta;

    const eSlug = slug(estado);
    const mSlug = slug(municipio);
    const dirEstado = path.join(DIR_SEGMENTOS, eSlug);
    fs.mkdirSync(dirEstado, { recursive: true });
    fs.writeFileSync(
      path.join(dirEstado, `${mSlug}.json`),
      JSON.stringify({ estado, municipio, actualizado: new Date().toISOString(), escuelas })
    );

    if (!indice.estados[eSlug]) indice.estados[eSlug] = { nombre: estado, municipios: {} };
    indice.estados[eSlug].municipios[mSlug] = {
      nombre: municipio,
      total: escuelas.length,
      alertas: conAlerta,
    };
  }

  fs.mkdirSync(path.dirname(ARCHIVO_INDICE), { recursive: true });
  fs.writeFileSync(ARCHIVO_INDICE, JSON.stringify(indice, null, 2));

  console.log(`Listo: ${porMunicipio.size.toLocaleString()} segmentos en db/segmentos/`);
  console.log(`  Escuelas con al menos una alerta: ${totalAlertas.toLocaleString()}`);
  console.log('  Índice escrito en db/indice.json');
}

/** Normaliza texto para comparar domicilios y claves. */
function normalizarTexto(t) {
  return String(t || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Domicilios que no identifican un sitio y no sirven para comparar. */
const DOMICILIO_GENERICO = /^(|conocido|domicilio conocido|s n|sn|sin nombre|calle sin nombre|no disponible|nd)$/;

/** Huella del domicilio: calle + número + CP. */
function huellaDomicilio(e) {
  const calle = normalizarTexto(e.domicilio);
  if (DOMICILIO_GENERICO.test(calle)) return null; // no comparable
  return `${calle}|${normalizarTexto(e.numero_exterior)}|${normalizarTexto(e.codigo_postal)}`;
}

/**
 * Marca alertas dentro de un municipio:
 *   coord_invalida, coord_duplicada, fuera_de_zona.
 */
function calcularAlertas(escuelas) {
  const validas = escuelas.filter((e) => coordenadaValida(e.lat, e.lng));

  // Escuelas agrupadas por coordenada exacta.
  const grupos = new Map();
  for (const e of validas) {
    const k = `${e.lat},${e.lng}`;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(e);
  }

  // Compartir coordenada NO siempre es un error: en México es normal que
  // los turnos de un mismo plantel (registrados con CCT distinta) y que
  // dos escuelas que comparten edificio tengan la misma ubicación. Solo se
  // marca el grupo cuando sus integrantes parecen sitios DISTINTOS, que es
  // la firma real de una geocodificación caída al centroide del municipio.
  const sospechosa = new Set();
  for (const [k, grupo] of grupos) {
    if (grupo.length < 2) continue;

    const mismaCct = new Set(grupo.map((e) => e.clave)).size === 1;
    if (mismaCct) continue; // turnos del mismo registro

    const huellas = grupo.map(huellaDomicilio);
    const comparables = huellas.filter(Boolean);
    const mismoDomicilio =
      comparables.length === grupo.length && new Set(comparables).size === 1;
    if (mismoDomicilio) continue; // mismo edificio

    sospechosa.add(k);
  }

  // Mediana geográfica del municipio (robusta ante valores atípicos).
  const centro = validas.length
    ? { lat: mediana(validas.map((e) => e.lat)), lng: mediana(validas.map((e) => e.lng)) }
    : null;

  for (const e of escuelas) {
    e.alertas = [];
    if (!coordenadaValida(e.lat, e.lng)) {
      e.alertas.push('coord_invalida');
      continue;
    }
    if (sospechosa.has(`${e.lat},${e.lng}`)) e.alertas.push('coord_duplicada');
    if (centro) {
      const d = haversineKm({ lat: e.lat, lng: e.lng }, centro);
      if (d > UMBRAL_KM) e.alertas.push('fuera_de_zona');
    }
  }
}

/** Lee segmentos previos (si existen) y regresa Map id → {estatus, notas, corregida_denue}. */
function cargarEstadoPrevio() {
  const previos = new Map();
  if (!fs.existsSync(DIR_SEGMENTOS)) return previos;
  for (const dirEstado of fs.readdirSync(DIR_SEGMENTOS)) {
    const ruta = path.join(DIR_SEGMENTOS, dirEstado);
    if (!fs.statSync(ruta).isDirectory()) continue;
    for (const archivo of fs.readdirSync(ruta)) {
      try {
        const seg = JSON.parse(fs.readFileSync(path.join(ruta, archivo), 'utf8'));
        for (const e of seg.escuelas || []) {
          if (e.estatus !== 'sin_visitar' || e.notas || e.corregida_denue) {
            previos.set(e.id, {
              estatus: e.estatus,
              notas: e.notas,
              corregida_denue: e.corregida_denue,
              denue_id: e.denue_id,
              lat: e.lat,
              lng: e.lng,
            });
          }
        }
      } catch { /* segmento corrupto: se ignora y se regenera */ }
    }
  }
  return previos;
}

main();

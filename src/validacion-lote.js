/**
 * src/validacion-lote.js
 * Corrige en bloque las coordenadas de un municipio completo.
 *
 * Estrategia (una sola descarga en lugar de una consulta por escuela):
 *   1. Se baja el catálogo de escuelas primarias del municipio con
 *      BuscarEntidad, usando el nombre del municipio como parte de la
 *      condición. Son unas pocas llamadas, no cientos.
 *   2. Cada escuela con alerta se cruza localmente contra ese catálogo y
 *      se queda con el mejor candidato según nombre, código postal,
 *      colonia y cercanía al municipio.
 *   3. Solo se aplican automáticamente las coincidencias por encima del
 *      umbral; el resto se reporta para revisión manual desde la ficha.
 */
const db = require('./db');
const { claveEntidad } = require('./util/entidades');
const { coordenadaValida, mediana, haversineKm } = require('./util/geo');
const { puntuar, normalizar } = require('./util/similitud');
const denue = require('./denue-cliente');

/** Subsector SCIAN de servicios educativos. */
const SUBSECTOR_EDUCATIVO = '611';

/**
 * Clases del subsector educativo que SÍ imparten primaria. Además de las
 * dos clases de primaria, se incluyen las escuelas que "combinan diversos
 * niveles" (colegios privados con preescolar+primaria+secundaria): ahí está
 * buena parte de las escuelas que la búsqueda por texto no encontraba.
 * Las de necesidades especiales (CAM) se dejan fuera a propósito: aportaron
 * una sola coincidencia y sí meten candidatos que pueden confundirse.
 */
const IMPARTEN_PRIMARIA = /escuelas de educacion primaria|combinan diversos niveles/;

/**
 * Limpia un campo de dirección del CSV. Espejo de Estado.limpiarCampo() en
 * public/js/estado.js: "NINGUNO" es el relleno de la fuente cuando falta el
 * dato y aparece solo ("NINGUNO NINGUNO"), pegado al tipo de vialidad
 * ("CALLE NINGUNO") o como prefijo de una calle real ("NINGUNO HIDALGO").
 */
const GENERICOS = /^(CALLE|CERRADA|CAMINO|VEREDA|AVENIDA|AV|PRIVADA|ANDADOR|BOULEVARD|BLVD|CARRETERA|PROLONGACION|CALLEJON|BRECHA|DOMICILIO CONOCIDO|CONOCIDO|CONOCIDA)$/;

function limpiarCampo(v) {
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
  if (GENERICOS.test(comparable)) return '';
  return sinRelleno;
}

/** Calle, colonia y CP, saltando los campos sin dato real. */
function direccionCorta(calle, colonia, cp) {
  const partes = [];
  const c = limpiarCampo(calle); if (c) partes.push(c);
  const col = limpiarCampo(colonia); if (col) partes.push(col);
  const p = limpiarCampo(cp); if (p) partes.push(`C.P. ${p}`);
  return partes.join(', ');
}

/**
 * Puntaje mínimo para aplicar una corrección sin intervención humana.
 * 60 y no 70: cuando el registro del DENUE no trae CP ni colonia (muy
 * común), los bonos de esos campos nunca suman y el tope alcanzable solo
 * por nombre es exactamente 60. Con 70 se descartaban coincidencias de
 * nombre casi exactas.
 */
const UMBRAL_POR_OMISION = 60;

/**
 * @param {string} estadoSlug
 * @param {string} municipioSlug
 * @param {object} opciones
 * @param {string} opciones.token      DENUE_TOKEN
 * @param {number} [opciones.umbral]   puntaje mínimo (0–100)
 * @param {boolean} [opciones.aplicar] false = simulación (no escribe nada)
 * @param {function} [opciones.alAvanzar] callback({fase, mensaje, ...})
 */
async function validarMunicipio(estadoSlug, municipioSlug, opciones = {}) {
  const { token, umbral = UMBRAL_POR_OMISION, aplicar = false, alAvanzar = () => {} } = opciones;

  if (!token) throw new Error('Falta DENUE_TOKEN');

  const seg = db.obtenerSegmento(estadoSlug, municipioSlug);
  if (!seg) throw new Error(`No existe el segmento ${estadoSlug}/${municipioSlug}`);

  const entidad = claveEntidad(seg.estado);
  if (!entidad) throw new Error(`No se reconoce la entidad federativa: ${seg.estado}`);

  const conAlerta = seg.escuelas.filter((e) => (e.alertas || []).length);
  if (!conAlerta.length) {
    return { total: seg.escuelas.length, revisadas: 0, corregidas: 0, dudosas: 0, sinCandidato: 0, detalle: [] };
  }

  // Punto de referencia del municipio: mediana de las escuelas que SÍ
  // tienen coordenada creíble (sin alerta). Si no hay ninguna, se usa la
  // mediana de todas: imperfecta pero suficiente para descartar candidatos
  // de otra ciudad.
  const confiables = seg.escuelas.filter((e) => !(e.alertas || []).length && coordenadaValida(e.lat, e.lng));
  const base = confiables.length >= 3 ? confiables : seg.escuelas.filter((e) => coordenadaValida(e.lat, e.lng));
  const ref = base.length
    ? { lat: mediana(base.map((e) => e.lat)), lng: mediana(base.map((e) => e.lng)) }
    : null;

  // ── 1. Catálogo DENUE del municipio ──────────────────────────────────
  // Se baja en dos pasos:
  //   a) Búsqueda por texto acotada al municipio (el municipio va dentro de
  //      la condición; ver la nota sobre separadores en denue-cliente.js).
  //      Sirve además para deducir la clave INEGI del municipio del CLEE.
  //   b) Censo por área y actividad (BuscarAreaAct), que no hace búsqueda
  //      difusa y devuelve TODO el subsector educativo del municipio.
  // El paso (b) es un superconjunto de (a): en Tijuana pasa de 538 a 695
  // establecimientos, y duplica las escuelas que logran corregirse. Si (b)
  // falla o no se puede deducir la clave, se usa (a) como respaldo.
  alAvanzar({ fase: 'descarga', mensaje: `Descargando escuelas primarias de ${seg.municipio} desde DENUE…` });

  const municipioObjetivo = normalizar(seg.municipio);

  const porTexto = (await denue.buscarEnEntidad(
    ['escuelas de educacion primaria', seg.municipio],
    entidad,
    token,
    { maximo: 6000, alAvanzar: (n) => alAvanzar({ fase: 'descarga', traidos: n }) }
  )).filter((c) => normalizar(c.municipio) === municipioObjetivo);

  let catalogo = porTexto;
  const claveMun = denue.claveMunicipioDesde(porTexto, seg.municipio);
  if (claveMun) {
    try {
      const censo = await denue.buscarPorAreaActividad(entidad, claveMun, SUBSECTOR_EDUCATIVO, token);
      const conPrimaria = censo.filter((c) => IMPARTEN_PRIMARIA.test(normalizar(c.actividad)));
      // Se conserva lo que trajo la búsqueda por texto y no venga en el
      // censo, por si alguna clase quedara fuera del filtro.
      const vistos = new Set(conPrimaria.map((c) => c.id_denue));
      catalogo = [...conPrimaria, ...porTexto.filter((c) => !vistos.has(c.id_denue))];
      alAvanzar({ fase: 'descarga', mensaje: `Censo DENUE del municipio: ${catalogo.length} establecimientos que imparten primaria.` });
    } catch (err) {
      alAvanzar({ fase: 'descarga', mensaje: `No se pudo usar el censo por actividad (${err.message}); se usa la búsqueda por texto.` });
    }
  }
  const catalogoEntidad = catalogo;

  const utiles = catalogo.filter((c) => coordenadaValida(c.lat, c.lng));
  alAvanzar({
    fase: 'cruce',
    mensaje: `${catalogoEntidad.length} descargados, ${catalogo.length} en ${seg.municipio}, ${utiles.length} con coordenada útil. Cruzando…`,
    catalogo: utiles.length,
  });

  if (!utiles.length) {
    return {
      total: seg.escuelas.length,
      revisadas: conAlerta.length,
      corregidas: 0, dudosas: 0, sinCandidato: conAlerta.length,
      catalogo: 0,
      aviso: 'DENUE no devolvió escuelas primarias para este municipio. Verifica el token o intenta con el nombre del municipio escrito de otra forma.',
      detalle: [],
    };
  }

  // ── 2. Cruce local con asignación exclusiva ──────────────────────────
  // Un establecimiento del DENUE corresponde a UN plantel físico. Si dos
  // escuelas distintas apuntan al mismo candidato, quedarían otra vez
  // encimadas: por eso cada candidato se asigna a la escuela que mejor
  // puntúa y las demás se marcan como dudosas.
  //
  // Excepción: dos registros con la MISMA CCT son turnos del mismo
  // plantel (matutino y vespertino) y sí deben compartir coordenada.

  // Candidatos por escuela, ordenados de mejor a peor. Se guarda una lista
  // corta y no solo el primero: si el mejor candidato se lo lleva otra
  // escuela, esta puede quedarse con el siguiente en vez de rendirse (era
  // el caso de 62 escuelas de Tijuana con coincidencia de nombre perfecta).
  const MAX_CANDIDATOS = 5;
  const propuestas = [];
  for (const escuela of conAlerta) {
    const puntuados = [];
    for (const cand of utiles) {
      const p = puntuar(escuela, cand, ref);
      if (p >= 40) puntuados.push({ cand, p });
    }
    puntuados.sort((a, b) => b.p - a.p);
    const lista = puntuados.slice(0, MAX_CANDIDATOS);
    propuestas.push({
      escuela,
      lista,
      candidato: lista[0]?.cand || null,
      puntaje: lista[0]?.p || 0,
    });
  }

  // Se resuelven de mayor a menor puntaje: el más confiable se queda con
  // el candidato disputado.
  propuestas.sort((a, b) => b.puntaje - a.puntaje);
  const tomado = new Map(); // id_denue → clave CCT que se lo quedó

  // Los planteles asignados en corridas ANTERIORES siguen ocupados. Esas
  // escuelas ya no traen alerta, así que no entran al cruce y sus
  // candidatos parecerían libres: sin esto, una segunda corrida se los
  // reasigna a otra escuela y las vuelve a encimar.
  const llaveCoord = (lat, lng) => `${lat.toFixed(6)},${lng.toFixed(6)}`;
  const porCoord = new Map();
  for (const c of utiles) {
    const k = llaveCoord(c.lat, c.lng);
    if (!porCoord.has(k)) porCoord.set(k, []);
    porCoord.get(k).push(c);
  }
  for (const e of seg.escuelas) {
    if (!e.corregida_denue || (e.alertas || []).length) continue;
    if (!coordenadaValida(e.lat, e.lng)) continue;
    // Si ya se guardó el id del plantel se usa directo; si no (datos
    // corregidos antes de que se registrara), se ubica por coordenada.
    for (const c of porCoord.get(llaveCoord(e.lat, e.lng)) || []) {
      if (e.denue_id && c.id_denue !== e.denue_id) continue;
      tomado.set(c.id_denue, e.clave);
    }
  }

  const detalle = [];
  let corregidas = 0, dudosas = 0, sinCandidato = 0;

  for (const { escuela, lista, candidato: mejorAbsoluto, puntaje: mejorPuntaje } of propuestas) {
    if (!mejorAbsoluto || mejorPuntaje < 40) {
      sinCandidato++;
      detalle.push({ id: escuela.id, nombre: escuela.nombre, resultado: 'sin_candidato', puntaje: mejorPuntaje });
      continue;
    }

    // Se toma el mejor candidato que siga libre. Un plantel ocupado por la
    // MISMA CCT no cuenta como disputa: son turnos del mismo lugar.
    const libre = lista.find(({ cand }) => {
      const dueño = tomado.get(cand.id_denue);
      return dueño === undefined || dueño === escuela.clave;
    });

    // Si todos sus candidatos están ocupados, se reporta el mejor para que
    // se pueda revisar a mano cuál de las dos escuelas se quedó con él.
    const candidato = libre ? libre.cand : mejorAbsoluto;
    const puntaje = libre ? libre.p : mejorPuntaje;
    const disputado = !libre;

    const desplazamiento = coordenadaValida(escuela.lat, escuela.lng)
      ? haversineKm({ lat: escuela.lat, lng: escuela.lng }, { lat: candidato.lat, lng: candidato.lng })
      : null;

    const registro = {
      id: escuela.id, nombre: escuela.nombre, puntaje,
      candidato: candidato.nombre,
      lat: candidato.lat, lng: candidato.lng,
      desplazamiento_km: desplazamiento,
      // Contexto para poder decidir a mano en la revisión por tanda.
      denue_id: candidato.id_denue,
      clave: escuela.clave,
      turno: escuela.turno,
      lat_actual: escuela.lat, lng_actual: escuela.lng,
      dir_escuela: direccionCorta(escuela.domicilio, escuela.colonia, escuela.codigo_postal),
      dir_candidato: direccionCorta(candidato.calle, candidato.colonia, candidato.cp),
      actividad: candidato.actividad,
    };

    if (puntaje >= umbral && !disputado) {
      tomado.set(candidato.id_denue, escuela.clave);
      corregidas++;
      detalle.push({ ...registro, resultado: 'corregida' });
      if (aplicar) {
        db.actualizarEscuela(estadoSlug, municipioSlug, escuela.id, {
          lat: candidato.lat, lng: candidato.lng, corregida_denue: true,
          denue_id: candidato.id_denue,
        });
      }
    } else {
      dudosas++;
      detalle.push({ ...registro, resultado: 'dudosa', motivo: disputado ? 'candidato ya asignado a otra escuela' : 'puntaje por debajo del umbral' });
    }
  }

  // Al corregir se limpian alertas: el índice que alimenta el selector de
  // municipios debe reflejarlo.
  if (aplicar && corregidas) db.refrescarConteoAlertas(estadoSlug, municipioSlug);

  return {
    total: seg.escuelas.length,
    revisadas: conAlerta.length,
    catalogo: utiles.length,
    corregidas, dudosas, sinCandidato,
    umbral, aplicado: aplicar,
    detalle,
  };
}

module.exports = { validarMunicipio, UMBRAL_POR_OMISION };

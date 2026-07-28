/**
 * src/rutas/denue.js
 * Endpoints de validación de coordenadas contra la API DENUE del INEGI.
 * La consulta se hace en el servidor para no exponer el token al navegador.
 *
 * Requiere DENUE_TOKEN en .env (gratuito):
 * https://www.inegi.org.mx/app/api/denue/v1/tokenVerify.aspx
 */
const express = require('express');
const db = require('../db');
const { claveEntidad } = require('../util/entidades');
const { coordenadaValida } = require('../util/geo');
const { puntuar, normalizar } = require('../util/similitud');
const denue = require('../denue-cliente');
const { validarMunicipio } = require('../validacion-lote');

const router = express.Router();

/** Respuesta uniforme cuando falta el token. */
function sinToken(res) {
  return res.status(503).json({
    error: 'Falta configurar DENUE_TOKEN en el archivo .env',
    ayuda: 'Genera un token gratuito en https://www.inegi.org.mx/app/api/denue/v1/tokenVerify.aspx y agrégalo como DENUE_TOKEN=tu_token',
  });
}

/**
 * POST /api/denue/validar
 * Valida UNA escuela. Cuerpo: { nombre, estado, municipio?, lat?, lng?, codigo_postal?, colonia? }
 */
router.post('/denue/validar', async (req, res) => {
  const token = process.env.DENUE_TOKEN;
  if (!token) return sinToken(res);

  const escuela = req.body || {};
  if (!escuela.nombre || !escuela.estado) {
    return res.status(400).json({ error: 'Se requieren nombre y estado de la escuela' });
  }

  // Términos de búsqueda: el giro más el nombre distintivo de la escuela.
  // Sin el giro la consulta busca en TODO el DENUE y devuelve cualquier
  // negocio que comparta el nombre (bancos, bibliotecas, tiendas).
  const { palabrasClave } = require('../util/similitud');
  const GIRO = 'escuelas de educacion primaria';
  const terminos = [GIRO, ...palabrasClave(escuela.nombre).slice(0, 5)];

  try {
    let resultados = [];

    // 1) Por cercanía, si la coordenada de partida es creíble.
    const lat = parseFloat(escuela.lat), lng = parseFloat(escuela.lng);
    if (coordenadaValida(lat, lng)) {
      resultados = await denue.buscarCerca(terminos, lat, lng, 5000, token);
    }

    // 2) Respaldo: toda la entidad, acotando con el nombre del municipio.
    if (!resultados.length) {
      const entidad = claveEntidad(escuela.estado);
      if (entidad) {
        const terminosAmplios = escuela.municipio ? [...terminos, escuela.municipio] : terminos;
        resultados = await denue.buscarEnEntidad(terminosAmplios, entidad, token, { maximo: 200, tamPagina: 200 });
        if (escuela.municipio) {
          const objetivo = normalizar(escuela.municipio);
          const delMunicipio = resultados.filter((c) => normalizar(c.municipio) === objetivo);
          // Si el filtro deja todo fuera se conservan los resultados de la
          // entidad: el puntaje ya penaliza a los candidatos lejanos.
          if (delMunicipio.length) resultados = delMunicipio;
        }
      }
    }

    const ref = coordenadaValida(lat, lng) ? { lat, lng } : null;
    const candidatos = resultados
      .filter((c) => coordenadaValida(c.lat, c.lng))
      .map((c) => ({ ...c, puntaje: puntuar(escuela, c, ref) }))
      .filter((c) => c.puntaje > 0)
      .sort((a, b) => b.puntaje - a.puntaje)
      .slice(0, 8);

    res.json({ candidatos });
  } catch (err) {
    res.status(502).json({ error: `No se pudo consultar DENUE: ${err.message}` });
  }
});

/**
 * POST /api/denue/validar-municipio
 * Valida en bloque todas las escuelas con alerta de un municipio.
 * Cuerpo: { estado, municipio, umbral?, aplicar? }
 *
 * Con aplicar=false (por omisión) solo simula y devuelve el reporte.
 */
router.post('/denue/validar-municipio', async (req, res) => {
  const token = process.env.DENUE_TOKEN;
  if (!token) return sinToken(res);

  const { estado, municipio, umbral, aplicar } = req.body || {};
  if (!estado || !municipio) {
    return res.status(400).json({ error: 'Se requieren estado y municipio' });
  }

  try {
    const reporte = await validarMunicipio(estado, municipio, {
      token,
      umbral: parseInt(umbral, 10) || undefined,
      aplicar: Boolean(aplicar),
    });
    // El detalle completo puede ser muy grande: se envían las correcciones
    // (para refrescar los pines) y las dudosas (para la revisión por
    // tanda). Las "sin candidato" no aportan nada accionable.
    // OJO: `dudosas` ya es el CONTADOR del reporte; el arreglo va aparte.
    res.json({
      ...reporte,
      detalle: reporte.detalle.filter((d) => d.resultado === 'corregida'),
      detalleDudosas: reporte.detalle.filter((d) => d.resultado === 'dudosa'),
    });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

/**
 * POST /api/denue/aplicar-correcciones
 * Aplica una lista de correcciones ya revisadas a mano (revisión por tanda).
 * Cuerpo: { estado, municipio, correcciones: [{ id, lat, lng, denue_id? }] }
 *
 * No vuelve a consultar DENUE: escribe lo que el usuario aprobó.
 */
router.post('/denue/aplicar-correcciones', (req, res) => {
  const { estado, municipio, correcciones } = req.body || {};
  if (!estado || !municipio || !Array.isArray(correcciones)) {
    return res.status(400).json({ error: 'Se requieren estado, municipio y correcciones[]' });
  }

  const aplicadas = [];
  const fallidas = [];

  for (const c of correcciones) {
    const lat = parseFloat(c?.lat), lng = parseFloat(c?.lng);
    if (!c?.id || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      fallidas.push({ id: c?.id ?? null, motivo: 'datos incompletos o no numéricos' });
      continue;
    }
    const escuela = db.actualizarEscuela(estado, municipio, c.id, {
      lat, lng, corregida_denue: true,
      ...(c.denue_id ? { denue_id: String(c.denue_id) } : {}),
    });
    if (escuela) aplicadas.push(escuela);
    else fallidas.push({ id: c.id, motivo: 'escuela no encontrada' });
  }

  if (aplicadas.length) db.refrescarConteoAlertas(estado, municipio);

  res.json({ aplicadas: aplicadas.length, fallidas, escuelas: aplicadas });
});

module.exports = router;

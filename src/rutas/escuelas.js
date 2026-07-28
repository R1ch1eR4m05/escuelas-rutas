/**
 * src/rutas/escuelas.js
 * Endpoints REST de consulta y edición.
 * La interfaz nunca recibe el dataset completo: solo el índice ligero y,
 * bajo demanda, el segmento del municipio seleccionado.
 */
const express = require('express');
const db = require('../db');

const router = express.Router();

/** GET /api/estados → lista de estados con conteos. */
router.get('/estados', (_req, res) => {
  const indice = db.obtenerIndice();
  const estados = Object.entries(indice.estados)
    .map(([slugEstado, e]) => ({
      slug: slugEstado,
      nombre: e.nombre,
      municipios: Object.keys(e.municipios).length,
      total: Object.values(e.municipios).reduce((s, m) => s + m.total, 0),
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  res.json(estados);
});

/** GET /api/estados/:estado/municipios → municipios de un estado con conteos. */
router.get('/estados/:estado/municipios', (req, res) => {
  const indice = db.obtenerIndice();
  const e = indice.estados[req.params.estado];
  if (!e) return res.status(404).json({ error: 'Estado no encontrado' });
  const municipios = Object.entries(e.municipios)
    .map(([slugMun, m]) => ({ slug: slugMun, ...m }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  res.json(municipios);
});

/** GET /api/escuelas/:estado/:municipio → segmento completo del municipio. */
router.get('/escuelas/:estado/:municipio', (req, res) => {
  const seg = db.obtenerSegmento(req.params.estado, req.params.municipio);
  if (!seg) return res.status(404).json({ error: 'Municipio no encontrado' });
  res.json(seg);
});

/**
 * PATCH /api/escuelas/:estado/:municipio/:id
 * Cuerpo: { estatus?, notas?, lat?, lng?, corregida_denue? }
 */
router.patch('/escuelas/:estado/:municipio/:id', (req, res) => {
  const cambios = {};
  const { estatus, notas, lat, lng, corregida_denue } = req.body || {};

  if (estatus !== undefined) {
    const VALIDOS = ['sin_visitar', 'pendiente', 'visitada', 'descartada'];
    if (!VALIDOS.includes(estatus)) {
      return res.status(400).json({ error: `estatus debe ser uno de: ${VALIDOS.join(', ')}` });
    }
    cambios.estatus = estatus;
  }
  if (notas !== undefined) cambios.notas = String(notas).slice(0, 4000);
  if (lat !== undefined || lng !== undefined) {
    const nLat = parseFloat(lat), nLng = parseFloat(lng);
    if (!Number.isFinite(nLat) || !Number.isFinite(nLng)) {
      return res.status(400).json({ error: 'lat y lng deben ser numéricos y enviarse juntos' });
    }
    cambios.lat = nLat;
    cambios.lng = nLng;
  }
  if (corregida_denue !== undefined) cambios.corregida_denue = Boolean(corregida_denue);

  const escuela = db.actualizarEscuela(req.params.estado, req.params.municipio, req.params.id, cambios);
  if (!escuela) return res.status(404).json({ error: 'Escuela no encontrada' });
  // Corregir la coordenada limpia las alertas de la escuela: el conteo del
  // índice se recalcula para que el selector de municipios no quede viejo.
  if (cambios.lat !== undefined) db.refrescarConteoAlertas(req.params.estado, req.params.municipio);
  res.json(escuela);
});

module.exports = router;

/**
 * src/rutas/rutas-dia.js
 * Endpoints de las rutas del día.
 *
 * Cada equipo de campo lleva su propia ruta, así que un municipio puede
 * tener varias a la vez. Se guardan en el servidor para que todos los
 * equipos vean lo mismo y no se pierdan al recargar el navegador.
 */
const express = require('express');
const db = require('../db');

const router = express.Router();

/** GET /api/rutas/:estado/:municipio → rutas de esa zona. */
router.get('/rutas/:estado/:municipio', (req, res) => {
  res.json(db.rutasDeZona(req.params.estado, req.params.municipio));
});

/** POST /api/rutas → crea una ruta vacía. Cuerpo: { nombre?, estado, municipio } */
router.post('/rutas', (req, res) => {
  const { nombre, estado, municipio } = req.body || {};
  if (!estado || !municipio) {
    return res.status(400).json({ error: 'Se requieren estado y municipio' });
  }
  res.status(201).json(db.crearRuta({ nombre, estado, municipio }));
});

/** PATCH /api/rutas/:id → renombra, reordena o cambia sus paradas. */
router.patch('/rutas/:id', (req, res) => {
  const { nombre, escuelas, color } = req.body || {};
  if (escuelas !== undefined && !Array.isArray(escuelas)) {
    return res.status(400).json({ error: 'escuelas debe ser un arreglo de ids' });
  }
  const ruta = db.actualizarRuta(req.params.id, { nombre, escuelas, color });
  if (!ruta) return res.status(404).json({ error: 'Ruta no encontrada' });
  res.json(ruta);
});

/** DELETE /api/rutas/:id */
router.delete('/rutas/:id', (req, res) => {
  if (!db.eliminarRuta(req.params.id)) {
    return res.status(404).json({ error: 'Ruta no encontrada' });
  }
  res.json({ eliminada: true });
});

module.exports = router;

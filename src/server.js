/**
 * src/server.js
 * Servidor web local: sirve la interfaz (public/) y la API REST.
 * Arranque:  npm start   →  http://localhost:3000
 */
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');

const rutasEscuelas = require('./rutas/escuelas');
const rutasDenue = require('./rutas/denue');

const app = express();
const PUERTO = process.env.PUERTO || process.env.PORT || 3000;

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api', rutasEscuelas);
app.use('/api', rutasDenue);

// Manejador de errores central (incluye el caso "falta importar").
app.use((err, _req, res, _next) => {
  if (err.codigo === 'SIN_IMPORTAR') {
    return res.status(503).json({ error: err.message });
  }
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

/**
 * IPv4 de la red local, para abrir la app desde el celular.
 * Se listan todas las interfaces con su nombre: las máquinas con
 * VirtualBox, WSL o VPN tienen adaptadores virtuales que aparecen primero
 * pero no son alcanzables desde el teléfono. Las de Wi-Fi/Ethernet reales
 * se muestran arriba.
 */
function direccionesLocales() {
  const nombreVirtual = /virtual|vmware|vbox|hyper-v|loopback|wsl|docker|tailscale|zerotier/i;
  const nombrePreferido = /wi-?fi|wlan/i;
  // Rangos que casi siempre son de adaptadores virtuales, no de la red de
  // casa: 192.168.56.x (VirtualBox), 172.17–31.x (Docker), 169.254.x (APIPA).
  const ipVirtual = (ip) =>
    ip.startsWith('192.168.56.') || ip.startsWith('169.254.') ||
    /^172\.(1[7-9]|2\d|3[01])\./.test(ip);

  const encontradas = [];
  for (const [nombre, lista] of Object.entries(require('os').networkInterfaces())) {
    for (const i of lista || []) {
      if (i.family === 'IPv4' && !i.internal) encontradas.push({ nombre, ip: i.address });
    }
  }
  const puntuar = (x) => {
    if (ipVirtual(x.ip) || nombreVirtual.test(x.nombre)) return 2;
    return nombrePreferido.test(x.nombre) ? 0 : 1;
  };
  return encontradas.sort((a, b) => puntuar(a) - puntuar(b));
}

app.listen(PUERTO, () => {
  const indiceExiste = fs.existsSync(path.join(__dirname, '..', 'db', 'indice.json'));
  console.log(`\n  Escuelas y Rutas → http://localhost:${PUERTO}`);
  const redes = direccionesLocales();
  if (redes.length) {
    console.log('  Desde el celular (misma red Wi-Fi):');
    for (const { nombre, ip } of redes) {
      console.log(`    http://${ip}:${PUERTO}   (${nombre})`);
    }
  }
  console.log('');
  if (!indiceExiste) {
    console.log('  ⚠ Aún no se ha importado la base de datos.');
    console.log('    Ejecuta en otra terminal:  npm run importar\n');
  }
  if (!process.env.DENUE_TOKEN) {
    console.log('  ℹ Sin DENUE_TOKEN en .env: la validación con INEGI estará deshabilitada.');
    console.log('    Token gratuito: https://www.inegi.org.mx/app/api/denue/v1/tokenVerify.aspx\n');
  }
});

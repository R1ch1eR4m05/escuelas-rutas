/**
 * scripts/validar-municipio.js
 * Corrige en bloque las coordenadas de un municipio usando DENUE (INEGI).
 *
 * Uso:
 *   npm run validar -- --estado=baja-california --municipio=tijuana
 *   npm run validar -- --estado=baja-california --municipio=tijuana --aplicar
 *   npm run validar -- --estado=michoacan-de-ocampo --municipio=morelia --umbral=80 --aplicar
 *
 * SIN --aplicar solo simula: muestra qué cambiaría sin tocar nada.
 * Revisa el reporte antes de aplicar.
 */
require('dotenv').config();
const { validarMunicipio } = require('../src/validacion-lote');

function leerArgumentos() {
  const args = {};
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    if (m) args[m[1]] = m[2] === undefined ? true : m[2];
  }
  return args;
}

async function main() {
  const args = leerArgumentos();
  const estado = args.estado;
  const municipio = args.municipio;

  if (!estado || !municipio) {
    console.log(`
Corrección masiva de coordenadas con DENUE (INEGI)

  npm run validar -- --estado=SLUG --municipio=SLUG [--aplicar] [--umbral=70]

  --estado      slug del estado, sin acentos (ej. baja-california)
  --municipio   slug del municipio (ej. tijuana)
  --aplicar     escribe los cambios; sin esta bandera solo simula
  --umbral      puntaje mínimo 0-100 para corregir automáticamente (por omisión 60)

Ejemplo:
  npm run validar -- --estado=baja-california --municipio=tijuana
`);
    process.exit(1);
  }

  if (!process.env.DENUE_TOKEN) {
    console.error('Falta DENUE_TOKEN en el archivo .env');
    process.exit(1);
  }

  const aplicar = Boolean(args.aplicar);
  const umbral = parseInt(args.umbral, 10) || undefined;

  console.log(`\n${aplicar ? 'APLICANDO CAMBIOS' : 'SIMULACIÓN (no se escribe nada)'} — ${estado}/${municipio}\n`);

  let ultimo = 0;
  const res = await validarMunicipio(estado, municipio, {
    token: process.env.DENUE_TOKEN,
    umbral,
    aplicar,
    alAvanzar: (p) => {
      if (p.mensaje) console.log(`  ${p.mensaje}`);
      else if (p.traidos && p.traidos !== ultimo) {
        ultimo = p.traidos;
        process.stdout.write(`\r  ${p.traidos} establecimientos descargados…`);
      }
    },
  });
  if (ultimo) process.stdout.write('\n');

  if (res.aviso) console.log(`\n  ⚠ ${res.aviso}`);

  console.log(`
  Escuelas en el municipio : ${res.total}
  Con alerta de ubicación  : ${res.revisadas}
  Catálogo DENUE cruzado   : ${res.catalogo ?? 0}
  ─────────────────────────────────────
  Corregidas (≥ ${res.umbral ?? '—'})       : ${res.corregidas}
  Dudosas (revisar a mano) : ${res.dudosas}
  Sin candidato en DENUE   : ${res.sinCandidato}
`);

  // Muestra las 10 correcciones con mayor desplazamiento: son las más
  // relevantes de verificar en el mapa.
  const mayores = res.detalle
    .filter((d) => d.resultado === 'corregida' && d.desplazamiento_km != null)
    .sort((a, b) => b.desplazamiento_km - a.desplazamiento_km)
    .slice(0, 10);

  if (mayores.length) {
    console.log('  Correcciones con mayor desplazamiento:');
    for (const d of mayores) {
      console.log(`    ${d.desplazamiento_km.toFixed(1).padStart(6)} km  [${String(d.puntaje).padStart(3)}]  ${d.nombre.slice(0, 45)}`);
    }
    console.log('');
  }

  if (!aplicar && res.corregidas) {
    console.log('  Para escribir estos cambios, repite el comando agregando --aplicar\n');
  }
}

main().catch((err) => {
  console.error(`\nError: ${err.message}\n`);
  process.exit(1);
});

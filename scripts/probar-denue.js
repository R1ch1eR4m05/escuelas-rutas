/**
 * scripts/probar-denue.js
 * Diagnóstico de conexión con la API DENUE (INEGI), eslabón por eslabón:
 *   1. DENUE_TOKEN cargado desde .env
 *   2. Resolución DNS de inegi.org.mx
 *   3. Conectividad TCP/TLS al host
 *   4. Llamada real a /Buscar (radio, un punto conocido)
 *   5. Llamada real a /BuscarEntidad (paginado)
 *
 * No imprime el valor del token, solo si está presente y su longitud.
 */
require('dotenv').config();
const dns = require('node:dns').promises;

const HOST = 'www.inegi.org.mx';
const BASE = `https://${HOST}/app/api/denue/v1/consulta`;

function linea(ok, titulo, detalle) {
  const marca = ok ? '✔' : '✘';
  console.log(`  ${marca} ${titulo}${detalle ? ` — ${detalle}` : ''}`);
}

async function conTimeout(promesa, ms, etiqueta) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await promesa(ctrl.signal);
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`Tiempo de espera agotado (${ms} ms) en ${etiqueta}`);
    throw err;
  } finally {
    clearTimeout(t);
  }
}

async function main() {
  console.log('\nDiagnóstico de conexión DENUE (INEGI)\n');
  let fallo = null;

  // 1. Token
  const token = process.env.DENUE_TOKEN;
  if (!token) {
    linea(false, 'DENUE_TOKEN en .env', 'no está definido');
    console.log('\n  Copia .env.example a .env y coloca tu token. Ver README.\n');
    process.exit(1);
  }
  linea(true, 'DENUE_TOKEN en .env', `presente (${token.length} caracteres)`);

  // 2. DNS
  try {
    const dir = await dns.lookup(HOST);
    linea(true, `Resolución DNS de ${HOST}`, dir.address);
  } catch (err) {
    linea(false, `Resolución DNS de ${HOST}`, err.code || err.message);
    fallo = 'dns';
  }

  // 3. Conectividad TCP/TLS (HEAD a la raíz del sitio, no a la API)
  if (!fallo) {
    try {
      await conTimeout(
        (signal) => fetch(`https://${HOST}/`, { method: 'HEAD', signal }),
        8000,
        'conexión TLS'
      );
      linea(true, 'Conexión TLS a inegi.org.mx', 'respondió');
    } catch (err) {
      linea(false, 'Conexión TLS a inegi.org.mx', err.cause?.code || err.message);
      fallo = 'tls';
    }
  }

  // 4. Llamada real a /Buscar (radio) — Zócalo CDMX, término genérico
  let buscarOk = false;
  if (!fallo) {
    const url = `${BASE}/Buscar/${encodeURIComponent('escuela de educacion primaria')}/19.4326,-99.1332/2000/${token}`;
    try {
      const resp = await conTimeout((signal) => fetch(url, { signal, headers: { Accept: 'application/json' } }), 15000, '/Buscar');
      if (resp.status === 401 || resp.status === 403) {
        linea(false, 'Llamada a /Buscar', `HTTP ${resp.status} — token inválido o sin autorización`);
        fallo = 'token';
      } else if (resp.status === 404) {
        linea(true, '/Buscar responde', 'HTTP 404 (sin resultados en ese radio, la API sí contestó)');
        buscarOk = true;
      } else if (!resp.ok) {
        linea(false, 'Llamada a /Buscar', `HTTP ${resp.status}`);
        fallo = 'http';
      } else {
        const datos = await resp.json();
        linea(true, 'Llamada a /Buscar', `HTTP 200, ${Array.isArray(datos) ? datos.length : '?'} resultados`);
        buscarOk = true;
      }
    } catch (err) {
      linea(false, 'Llamada a /Buscar', err.cause?.code || err.message);
      fallo = 'fetch';
    }
  }

  // 5. Llamada real a /BuscarEntidad (paginado) — Baja California, primeros 5
  if (!fallo || buscarOk) {
    const entidad = '02'; // Baja California
    const url = `${BASE}/BuscarEntidad/${encodeURIComponent('escuelas de educacion primaria')}/${entidad}/1/5/${token}`;
    try {
      const resp = await conTimeout((signal) => fetch(url, { signal, headers: { Accept: 'application/json' } }), 15000, '/BuscarEntidad');
      if (resp.status === 401 || resp.status === 403) {
        linea(false, 'Llamada a /BuscarEntidad', `HTTP ${resp.status} — token inválido o sin autorización`);
        fallo = fallo || 'token';
      } else if (resp.status === 404) {
        linea(false, 'Llamada a /BuscarEntidad', 'HTTP 404 (sin resultados) — inesperado para Baja California');
        fallo = fallo || 'sin_resultados';
      } else if (!resp.ok) {
        linea(false, 'Llamada a /BuscarEntidad', `HTTP ${resp.status}`);
        fallo = fallo || 'http';
      } else {
        const datos = await resp.json();
        const n = Array.isArray(datos) ? datos.length : 0;
        linea(n > 0, 'Llamada a /BuscarEntidad', `HTTP 200, ${n} resultados`);
        if (n === 0) fallo = fallo || 'sin_resultados';
        if (n > 0) {
          console.log(`      ejemplo: "${datos[0].Nombre}" — ${datos[0].Municipio || datos[0].Localidad || ''}`);
        }
      }
    } catch (err) {
      linea(false, 'Llamada a /BuscarEntidad', err.cause?.code || err.message);
      fallo = fallo || 'fetch';
    }
  }

  console.log('');

  if (!fallo) {
    console.log('  Todo funciona. Puedes correr: npm run validar -- --estado=baja-california --municipio=tijuana\n');
    return;
  }

  if (fallo === 'dns' || fallo === 'tls' || fallo === 'fetch') {
    console.log('  Esto es un problema de RED, no de código: node.exe no está pudiendo salir a internet');
    console.log('  o algo intercepta/bloquea la conexión (antivirus, proxy corporativo, firewall, VPN).');
    console.log('  Qué revisar tú mismo:');
    console.log('    - Antivirus/Windows Defender: excepción para node.exe o para conexiones salientes HTTPS.');
    console.log('    - Proxy corporativo: si tu red usa uno, exporta HTTPS_PROXY antes de correr el comando.');
    console.log('    - Prueba abrir https://www.inegi.org.mx en el navegador desde esta misma máquina/red.');
    console.log('    - Si usas VPN, prueba desconectarla (algunas bloquean dominios .gob.mx).');
    console.log('  Cuando el navegador cargue esa URL sin problema, vuelve a correr: npm run probar-denue\n');
  } else if (fallo === 'token') {
    console.log('  El token de DENUE_TOKEN fue rechazado (401/403). Verifica que lo copiaste completo en .env');
    console.log('  y que sigue vigente (los tokens de INEGI pueden expirar). Genera uno nuevo aquí:');
    console.log('  https://www.inegi.org.mx/app/api/denue/v1/tokenVerify.aspx\n');
  } else if (fallo === 'sin_resultados') {
    console.log('  La API respondió pero sin resultados para Baja California, lo cual es inesperado.');
    console.log('  Puede ser un problema con la condición de búsqueda (ver src/validacion-lote.js) más que de red.\n');
  } else {
    console.log(`  Fallo no clasificado (${fallo}). Revisa el detalle de arriba.\n`);
  }

  process.exit(1);
}

main().catch((err) => {
  console.error(`\nError inesperado: ${err.message}\n`);
  process.exit(1);
});

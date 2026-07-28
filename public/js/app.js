/**
 * app.js — Punto de entrada: puebla selectores de Estado/Municipio,
 * conecta filtros, la bandeja "Ruta del día" y los avisos (toast).
 */
const App = (() => {
  const selEstado = document.getElementById('sel-estado');
  const selMunicipio = document.getElementById('sel-municipio');
  const resumenZona = document.getElementById('resumen-zona');
  const listaRuta = document.getElementById('lista-ruta');
  const rutaConteo = document.getElementById('ruta-conteo');
  const rutaDistancia = document.getElementById('ruta-distancia');
  const btnOptimizar = document.getElementById('btn-optimizar');
  const btnGoogle = document.getElementById('btn-google-maps');
  const btnLimpiar = document.getElementById('btn-limpiar-ruta');
  const toast = document.getElementById('aviso-toast');

  // ── Avisos ────────────────────────────────────────────────────────────
  let temporizadorToast = null;
  function aviso(mensaje, esError = false) {
    toast.innerHTML = `<div class="px-4 py-2 rounded-lg shadow-lg text-sm font-semibold text-white ${esError ? 'bg-red-600' : 'bg-slate-800'}">${mensaje}</div>`;
    toast.classList.remove('hidden');
    clearTimeout(temporizadorToast);
    temporizadorToast = setTimeout(() => toast.classList.add('hidden'), 2600);
  }

  // ── Selectores de zona ────────────────────────────────────────────────
  async function cargarEstados() {
    try {
      const estados = await Api.estados();
      selEstado.innerHTML =
        '<option value="">Selecciona un estado…</option>' +
        estados.map((e) => `<option value="${e.slug}">${e.nombre} (${e.total.toLocaleString('es-MX')})</option>`).join('');
    } catch (err) {
      selEstado.innerHTML = '<option value="">Error al cargar</option>';
      aviso(err.message, true);
    }
  }

  async function cargarMunicipios(estadoSlug) {
    selMunicipio.disabled = true;
    selMunicipio.innerHTML = '<option value="">Cargando…</option>';
    const municipios = await Api.municipios(estadoSlug);
    selMunicipio.innerHTML =
      '<option value="">Selecciona un municipio…</option>' +
      municipios.map((m) =>
        `<option value="${m.slug}">${m.nombre} (${m.total}${m.alertas ? ` · ⚠${m.alertas}` : ''})</option>`
      ).join('');
    selMunicipio.disabled = false;
  }

  async function cargarZona() {
    const eSlug = selEstado.value, mSlug = selMunicipio.value;
    if (!eSlug || !mSlug) return;
    try {
      const seg = await Api.escuelas(eSlug, mSlug);
      Estado.cargarZona(eSlug, mSlug, seg);
      const conAlerta = seg.escuelas.filter((x) => (x.alertas || []).length).length;
      resumenZona.textContent =
        `${seg.escuelas.length.toLocaleString('es-MX')} escuelas en ${seg.municipio}` +
        (conAlerta ? ` · ${conAlerta} con alerta de ubicación` : '');
      btnValidar.disabled = conAlerta === 0;
    } catch (err) {
      aviso(err.message, true);
    }
  }

  // ── Validación masiva del municipio con INEGI ─────────────────────────
  const btnValidar = document.getElementById('btn-validar-municipio');
  const reporteLote = document.getElementById('reporte-lote');

  /** Primer clic: simula. Segundo clic: aplica. */
  let simulacionPendiente = null;
  /** Dudosas del último reporte, para la revisión por tanda. */
  let ultimasDudosas = [];

  async function ejecutarLote(aplicar) {
    btnValidar.disabled = true;
    btnValidar.textContent = aplicar ? 'Aplicando correcciones…' : 'Consultando INEGI…';
    reporteLote.classList.remove('hidden');
    reporteLote.innerHTML = '<p class="text-slate-400">Esto puede tardar algunos segundos.</p>';

    try {
      const r = await Api.validarMunicipio(Estado.estadoSlug, Estado.municipioSlug, aplicar);

      ultimasDudosas = r.detalleDudosas || [];

      reporteLote.innerHTML = `
        <div class="rounded-md bg-tinta-700 px-3 py-2 space-y-0.5">
          ${r.aviso ? `<p class="text-amber-400 mb-1">${r.aviso}</p>` : ''}
          <p class="text-slate-300">Con alerta: <b>${r.revisadas}</b> · catálogo INEGI: <b>${r.catalogo ?? 0}</b></p>
          <p class="text-green-400">Se pueden corregir: <b>${r.corregidas}</b></p>
          <p class="text-amber-400">Dudosas (revisar a mano): <b>${r.dudosas}</b></p>
          <p class="text-slate-400">Sin candidato: <b>${r.sinCandidato}</b></p>
        </div>
        ${ultimasDudosas.length ? `
        <button id="btn-revisar-dudosas"
          class="mt-2 w-full rounded-md bg-amber-500 hover:bg-amber-400 text-tinta-900 text-xs font-bold py-2.5 transition">
          Revisar ${ultimasDudosas.length} dudosas una por una
        </button>` : ''}`;

      const btnRevisar = document.getElementById('btn-revisar-dudosas');
      if (btnRevisar) btnRevisar.onclick = () => Revision.abrir(ultimasDudosas);

      if (aplicar) {
        simulacionPendiente = null;
        btnValidar.textContent = 'Corregir ubicaciones del municipio con INEGI';
        aviso(`${r.corregidas} ubicaciones corregidas`);
        await cargarZona(); // recarga el segmento y redibuja el mapa
      } else if (r.corregidas > 0) {
        simulacionPendiente = true;
        btnValidar.textContent = `Aplicar ${r.corregidas} correcciones`;
        btnValidar.classList.add('bg-accion-600', 'text-white');
      } else {
        btnValidar.textContent = 'Corregir ubicaciones del municipio con INEGI';
      }
    } catch (err) {
      reporteLote.innerHTML = `<p class="text-red-400">${err.message}</p>`;
      btnValidar.textContent = 'Corregir ubicaciones del municipio con INEGI';
    } finally {
      btnValidar.disabled = false;
    }
  }

  btnValidar.addEventListener('click', () => ejecutarLote(Boolean(simulacionPendiente)));

  /** Reinicia el botón al cambiar de municipio. */
  function reiniciarBotonLote() {
    simulacionPendiente = null;
    ultimasDudosas = [];
    btnValidar.textContent = 'Corregir ubicaciones del municipio con INEGI';
    btnValidar.classList.remove('bg-accion-600', 'text-white');
    reporteLote.classList.add('hidden');
    reporteLote.innerHTML = '';
  }

  // ── Filtros ───────────────────────────────────────────────────────────
  document.querySelectorAll('#filtros-estatus .chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const f = chip.dataset.filtro;
      if (Estado.filtros.has(f)) Estado.filtros.delete(f);
      else Estado.filtros.add(f);
      chip.classList.toggle('chip-activo');
      Estado.emitir('filtros:cambiados');
    });
  });
  document.getElementById('filtro-alertas').addEventListener('change', (ev) => {
    Estado.soloAlertas = ev.target.checked;
    Estado.emitir('filtros:cambiados');
  });

  // ── Bandeja "Ruta del día" ────────────────────────────────────────────
  function pintarRuta() {
    const orden = Ruta.ordenar(Estado.escuelasDeRuta());
    const etiqueta = `${orden.length} parada${orden.length === 1 ? '' : 's'}`;
    rutaConteo.textContent = etiqueta;
    // Mismo conteo en el botón flotante de móvil.
    const fabConteo = document.getElementById('fab-conteo');
    if (fabConteo) fabConteo.textContent = etiqueta;

    listaRuta.innerHTML = orden.length
      ? orden.map((e, i) => `
        <li class="flex items-center gap-2.5 bg-tinta-700 rounded-lg px-3 py-2">
          <span class="marcador-ruta shrink-0">${i + 1}</span>
          <div class="min-w-0 flex-1">
            <p class="text-xs font-semibold truncate">${e.nombre}</p>
            <p class="text-[10px] text-slate-400">${e.alumnos.toLocaleString('es-MX')} alumnos · ${e.turno.toLowerCase()}</p>
          </div>
          <button data-id="${e.id}" class="btn-quitar text-slate-400 hover:text-red-400 text-lg leading-none shrink-0" aria-label="Quitar de la ruta">×</button>
        </li>`).join('')
      : '<li class="text-[11px] text-slate-500 italic">Aún no hay paradas.</li>';

    listaRuta.querySelectorAll('.btn-quitar').forEach((b) => {
      b.onclick = () => Estado.quitarDeRuta(b.dataset.id);
    });

    if (orden.length >= 2) {
      rutaDistancia.textContent = `Distancia estimada en línea recta: ${Ruta.distanciaTotal(orden).toFixed(1)} km`;
    } else rutaDistancia.textContent = '';

    btnOptimizar.disabled = orden.length < 3;
    btnGoogle.disabled = orden.length < 2;

    if (orden.length > Ruta.MAX_PUNTOS) {
      rutaDistancia.textContent += ` · Google Maps solo admite ${Ruta.MAX_PUNTOS} puntos: se abrirán las primeras ${Ruta.MAX_PUNTOS} paradas.`;
    }
  }

  btnOptimizar.addEventListener('click', () => {
    // Reordena el arreglo de ids según el orden optimizado y refresca todo.
    const orden = Ruta.ordenar(Estado.escuelasDeRuta());
    Estado.ruta = orden.map((e) => e.id);
    Estado.emitir('ruta:cambiada');
    aviso('Ruta reordenada por cercanía');
  });

  btnGoogle.addEventListener('click', () => {
    const url = Ruta.urlGoogleMaps(Ruta.ordenar(Estado.escuelasDeRuta()));
    if (url) window.open(url, '_blank', 'noopener');
  });

  btnLimpiar.addEventListener('click', () => Estado.limpiarRuta());

  // ── Eventos globales ──────────────────────────────────────────────────
  selEstado.addEventListener('change', () => {
    resumenZona.textContent = '';
    if (selEstado.value) cargarMunicipios(selEstado.value).catch((e) => aviso(e.message, true));
  });
  selMunicipio.addEventListener('change', () => { reiniciarBotonLote(); cargarZona(); });
  document.addEventListener('ruta:cambiada', pintarRuta);

  // ── Arranque ──────────────────────────────────────────────────────────
  Mapa.iniciar();
  cargarEstados();
  pintarRuta();

  return { aviso };
})();

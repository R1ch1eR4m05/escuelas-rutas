/**
 * revision.js — Revisión por tanda de las coincidencias DUDOSAS.
 *
 * La corrección masiva aplica sola lo que pasa el umbral, pero deja fuera
 * las que no lo alcanzan o cuyo plantel del DENUE ya se asignó a otra
 * escuela. Aquí se revisan todas juntas: se aprueban o descartan una por
 * una (o en bloque por puntaje) y se aplican de una sola vez.
 *
 * No consulta DENUE: trabaja sobre el reporte de la simulación y escribe
 * mediante /api/denue/aplicar-correcciones.
 */
const Revision = (() => {
  const cont = document.getElementById('revision');
  const lista = document.getElementById('revision-lista');
  const resumen = document.getElementById('revision-resumen');
  const conteo = document.getElementById('revision-conteo');
  const btnAplicar = document.getElementById('revision-aplicar');

  let dudosas = [];              // registros del reporte
  const decisiones = new Map();  // id → 'aceptada' | 'rechazada'

  function esc(t) {
    return String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  /** Color del puntaje: verde alto, ámbar medio, gris bajo. */
  function colorPuntaje(p) {
    if (p >= 80) return 'bg-green-100 text-green-700';
    if (p >= 60) return 'bg-amber-100 text-amber-700';
    return 'bg-slate-200 text-slate-600';
  }

  function abrir(registros) {
    dudosas = [...registros].sort((a, b) => b.puntaje - a.puntaje);
    decisiones.clear();
    cont.classList.remove('hidden');
    document.body.classList.add('revision-abierta');
    pintar();
  }

  function cerrar() {
    cont.classList.add('hidden');
    document.body.classList.remove('revision-abierta');
  }

  function pintar() {
    resumen.textContent = `${dudosas.length} por decidir · ordenadas de mayor a menor puntaje`;

    lista.innerHTML = dudosas.map((d) => {
      const estado = decisiones.get(d.id);
      const disputado = (d.motivo || '').includes('ya asignado');
      const borde = estado === 'aceptada' ? 'border-green-500 bg-green-50'
        : estado === 'rechazada' ? 'border-slate-300 bg-slate-100 opacity-60'
        : 'border-slate-200 bg-white';

      return `
      <li class="rounded-xl border-2 ${borde} transition">
        <div class="px-3.5 pt-3 pb-2.5">
          <div class="flex items-start gap-2.5">
            <div class="flex-1 min-w-0">
              <p class="font-bold text-sm text-slate-800 leading-snug">${esc(d.nombre)}</p>
              <p class="text-[11px] text-slate-500 mt-0.5">CCT ${esc(d.clave)} · ${esc(d.turno)}</p>
            </div>
            <span class="shrink-0 text-xs font-bold px-2 py-1 rounded-full ${colorPuntaje(d.puntaje)}">${d.puntaje}</span>
          </div>

          ${d.dir_escuela ? `
          <p class="text-[11px] text-slate-500 mt-2">
            <span class="font-semibold text-slate-400 uppercase tracking-wide text-[10px]">Registro SEP</span><br>${esc(d.dir_escuela)}
          </p>` : ''}

          <div class="mt-2 rounded-lg bg-cyan-50 border border-cyan-100 px-3 py-2">
            <p class="text-[10px] font-semibold text-cyan-700 uppercase tracking-wide">Propuesta del DENUE</p>
            <p class="text-xs font-semibold text-slate-700 leading-snug mt-0.5">${esc(d.candidato)}</p>
            ${d.dir_candidato ? `<p class="text-[11px] text-slate-500 mt-0.5">${esc(d.dir_candidato)}</p>` : ''}
            <p class="text-[11px] text-slate-500 mt-1">
              ${d.desplazamiento_km != null ? `Movería el pin <b>${d.desplazamiento_km.toFixed(1)} km</b>` : 'Sin coordenada previa'}
              · <a href="https://www.google.com/maps/search/?api=1&query=${d.lat},${d.lng}" target="_blank" rel="noopener"
                   class="text-accion-600 font-semibold underline">ver en Google Maps ↗</a>
            </p>
          </div>

          ${disputado ? `
          <p class="mt-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5">
            ⚠ Este plantel ya se asignó a otra escuela. Si lo aceptas, ambas quedarán en la misma coordenada
            (correcto solo si de verdad comparten edificio).
          </p>` : ''}
        </div>

        <div class="grid grid-cols-2 gap-px bg-slate-200 rounded-b-[10px] overflow-hidden">
          <button data-decidir="rechazada" data-id="${esc(d.id)}"
            class="py-3 text-xs font-bold transition ${estado === 'rechazada' ? 'bg-slate-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}">
            Descartar
          </button>
          <button data-decidir="aceptada" data-id="${esc(d.id)}"
            class="py-3 text-xs font-bold transition ${estado === 'aceptada' ? 'bg-green-600 text-white' : 'bg-white text-green-700 hover:bg-green-50'}">
            Aceptar
          </button>
        </div>
      </li>`;
    }).join('');

    lista.querySelectorAll('[data-decidir]').forEach((b) => {
      b.onclick = () => {
        const id = b.dataset.id;
        // Volver a tocar la misma opción la deshace.
        if (decisiones.get(id) === b.dataset.decidir) decisiones.delete(id);
        else decisiones.set(id, b.dataset.decidir);
        pintar();
      };
    });

    actualizarPie();
  }

  function aceptadas() {
    return dudosas.filter((d) => decisiones.get(d.id) === 'aceptada');
  }

  function actualizarPie() {
    const n = aceptadas().length;
    const rechazadas = [...decisiones.values()].filter((v) => v === 'rechazada').length;
    const pendientes = dudosas.length - n - rechazadas;
    conteo.textContent = `${n} aceptadas · ${rechazadas} descartadas · ${pendientes} sin decidir`;
    btnAplicar.disabled = n === 0;
    btnAplicar.textContent = n ? `Aplicar ${n}` : 'Aplicar';
  }

  /** Marca como aceptadas todas las que llegan al puntaje dado. */
  function aceptarDesde(minimo) {
    for (const d of dudosas) {
      if (d.puntaje >= minimo && !decisiones.has(d.id)) decisiones.set(d.id, 'aceptada');
    }
    pintar();
  }

  async function aplicar() {
    const seleccionadas = aceptadas();
    if (!seleccionadas.length) return;

    btnAplicar.disabled = true;
    btnAplicar.textContent = 'Aplicando…';
    try {
      const r = await Api.aplicarCorrecciones(
        Estado.estadoSlug, Estado.municipioSlug,
        seleccionadas.map((d) => ({ id: d.id, lat: d.lat, lng: d.lng, denue_id: d.denue_id }))
      );

      // Refleja los cambios en memoria y en el mapa sin recargar el segmento.
      for (const escuela of r.escuelas || []) Estado.aplicarCambio(escuela);

      // Las aplicadas salen de la lista; las demás siguen pendientes.
      const aplicadas = new Set(seleccionadas.map((d) => d.id));
      dudosas = dudosas.filter((d) => !aplicadas.has(d.id));
      for (const id of aplicadas) decisiones.delete(id);

      App.aviso(r.aplicadas === 1 ? '1 ubicación corregida' : `${r.aplicadas} ubicaciones corregidas`);
      if (r.fallidas?.length) App.aviso(`${r.fallidas.length} no se pudieron aplicar`, true);

      if (!dudosas.length) cerrar();
      else pintar();
    } catch (err) {
      App.aviso(err.message, true);
    } finally {
      actualizarPie();
    }
  }

  // ── Conexiones ────────────────────────────────────────────────────────
  document.getElementById('revision-cerrar').addEventListener('click', cerrar);
  document.getElementById('revision-limpiar').addEventListener('click', () => { decisiones.clear(); pintar(); });
  document.querySelectorAll('[data-aceptar-desde]').forEach((b) => {
    b.addEventListener('click', () => aceptarDesde(Number(b.dataset.aceptarDesde)));
  });
  btnAplicar.addEventListener('click', aplicar);

  // Cerrar tocando el fondo oscuro (solo el fondo, no la tarjeta).
  cont.addEventListener('click', (ev) => { if (ev.target === cont) cerrar(); });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !cont.classList.contains('hidden')) cerrar();
  });

  return { abrir, cerrar };
})();

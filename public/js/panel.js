/**
 * panel.js — Ficha lateral de la escuela: datos completos, cambio de
 * estatus (color del pin), notas locales, alertas de ubicación y
 * validación/corrección de coordenadas con la API DENUE del INEGI.
 */
const Panel = (() => {
  const cont = document.getElementById('panel-detalle');
  let idActual = null;

  function esc(t) {
    return String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function abrir(id) {
    idActual = id;
    const e = Estado.porId.get(id);
    if (!e) return;
    render(e);
    cont.classList.remove('hidden');
    cont.classList.add('flex');
    Mapa.centrarEn(e, 15);
    Mapa.seleccionar(e); // aro visible: el mapa se mueve y hay que ubicarla
  }

  function cerrar() {
    idActual = null;
    cont.classList.add('hidden');
    cont.classList.remove('flex');
    Mapa.limpiarSeleccion();
  }

  function render(e) {
    const alertas = (e.alertas || []);
    const enRuta = Estado.enRuta(e.id);
    // Omite los campos que el CSV marca como "sin dato" (NINGUNO, 0, …):
    // 4 de cada 10 escuelas traen colonia "NINGUNO".
    const direccion = Estado.direccionCompleta(e);

    cont.innerHTML = `
      <div class="flex flex-col h-full">
        <!-- Asa de arrastre de la hoja inferior (solo móvil) -->
        <div data-arrastre class="sm:hidden shrink-0 pt-2.5 pb-1 flex justify-center">
          <span class="block w-10 h-1.5 rounded-full bg-slate-300"></span>
        </div>
        <header data-arrastre class="px-5 pt-3 sm:pt-5 pb-4 border-b border-slate-200 flex items-start gap-3">
          <div class="flex-1 min-w-0">
            <h2 class="font-bold text-slate-800 leading-snug">${esc(e.nombre)}</h2>
            <p class="text-xs text-slate-500 mt-0.5">CCT ${esc(e.clave)} · ${esc(e.turno)}</p>
          </div>
          <button id="btn-cerrar-panel" aria-label="Cerrar ficha" class="text-slate-400 hover:text-slate-600 text-2xl leading-none px-2 -mr-2">×</button>
        </header>

        ${alertas.length ? `
        <div class="mx-5 mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5">
          <p class="text-xs font-bold text-red-700 mb-1">⚠ Posible error de ubicación</p>
          <ul class="text-[11px] text-red-600 space-y-0.5">
            ${alertas.map((a) => `<li>• ${esc(Estado.ETIQUETAS_ALERTA[a] || a)}</li>`).join('')}
          </ul>
        </div>` : ''}

        <div class="px-5 py-4 space-y-3 text-sm">
          <div class="grid grid-cols-2 gap-3">
            <div class="rounded-lg bg-slate-50 px-3 py-2">
              <p class="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">Alumnos</p>
              <p class="font-bold text-slate-700">${e.alumnos.toLocaleString('es-MX')}</p>
            </div>
            <div class="rounded-lg bg-slate-50 px-3 py-2">
              <p class="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">Docentes</p>
              <p class="font-bold text-slate-700">${e.docentes.toLocaleString('es-MX')}</p>
            </div>
          </div>

          <div>
            <p class="text-[10px] uppercase tracking-wide text-slate-400 font-semibold mb-0.5">Dirección</p>
            <p class="text-slate-600 leading-relaxed">${esc(direccion)}</p>
          </div>

          <div>
            <p class="text-[10px] uppercase tracking-wide text-slate-400 font-semibold mb-0.5">Coordenadas</p>
            <p class="text-slate-600 font-mono text-xs">${e.lat ?? '—'}, ${e.lng ?? '—'} ${e.corregida_denue ? '<span class="text-green-600 font-sans font-semibold">· corregida con INEGI ✓</span>' : ''}</p>
          </div>

          <div>
            <p class="text-[10px] uppercase tracking-wide text-slate-400 font-semibold mb-1.5">Estatus de visita (color del pin)</p>
            <div class="grid grid-cols-2 gap-1.5">
              ${Object.entries(Estado.ETIQUETAS_ESTATUS).map(([valor, etiqueta]) => `
                <button data-estatus="${valor}"
                  class="btn-estatus text-[11px] font-semibold rounded-md px-2 py-1.5 border transition
                    ${e.estatus === valor
                      ? 'text-white border-transparent'
                      : 'text-slate-600 border-slate-200 hover:border-slate-400 bg-white'}"
                  ${e.estatus === valor ? `style="background:${Estado.COLORES[valor]}"` : ''}>
                  ${esc(etiqueta)}
                </button>`).join('')}
            </div>
          </div>

          <div>
            <label for="notas-escuela" class="text-[10px] uppercase tracking-wide text-slate-400 font-semibold mb-1 block">Notas</label>
            <textarea id="notas-escuela" rows="3" placeholder="Contacto del director, mejores horarios, acuerdos…"
              class="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accion-500">${esc(e.notas)}</textarea>
            <button id="btn-guardar-notas" class="mt-1.5 w-full rounded-md bg-slate-700 hover:bg-slate-800 text-white text-xs font-semibold py-2 transition">Guardar notas</button>
          </div>

          <div class="pt-1 space-y-2">
            <button id="btn-ruta" class="w-full rounded-md text-sm font-semibold py-2 transition
              ${enRuta ? 'bg-violet-100 text-violet-700 hover:bg-violet-200' : 'bg-violet-600 text-white hover:bg-violet-500'}">
              ${enRuta
                ? `Quitar de «${esc(Estado.rutaActiva?.nombre || 'la ruta')}»`
                : `Agregar a «${esc(Estado.rutaActiva?.nombre || 'ruta del día')}»`}
            </button>
            <button id="btn-denue" ${Api.modo === 'estatico' ? 'disabled' : ''}
              title="${Api.modo === 'estatico' ? 'Requiere el servidor: no disponible en esta vista de demostración' : ''}"
              class="w-full rounded-md border border-accion-600 text-accion-600 hover:bg-cyan-50 text-sm font-semibold py-2 transition disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent">
              Validar / Corregir ubicación con INEGI
            </button>
          </div>

          <div id="resultados-denue"></div>
        </div>
      </div>`;

    // ── Manejadores ──────────────────────────────────────────────────────
    cont.querySelector('#btn-cerrar-panel').onclick = cerrar;

    cont.querySelectorAll('.btn-estatus').forEach((b) => {
      b.onclick = () => guardar({ estatus: b.dataset.estatus });
    });

    cont.querySelector('#btn-guardar-notas').onclick = () => {
      guardar({ notas: cont.querySelector('#notas-escuela').value }, 'Notas guardadas');
    };

    cont.querySelector('#btn-ruta').onclick = () => {
      // Sin ruta activa no hay dónde poner la parada: se avisa en vez de
      // que el botón no haga nada.
      if (!Estado.alternarEnRuta(e.id)) {
        App.aviso('Primero crea una ruta con «+ Agregar nueva ruta»', true);
        return;
      }
      render(Estado.porId.get(e.id));
    };

    cont.querySelector('#btn-denue').onclick = () => validarConDenue(e);
  }

  async function guardar(cambios, mensaje = 'Cambios guardados') {
    try {
      const actualizada = await Api.actualizarEscuela(Estado.estadoSlug, Estado.municipioSlug, idActual, cambios);
      Estado.aplicarCambio(actualizada);
      render(actualizada);
      App.aviso(mensaje);
    } catch (err) {
      App.aviso(err.message, true);
    }
  }

  /** Consulta DENUE y pinta la lista de candidatos con botón de aplicar. */
  async function validarConDenue(e) {
    const zona = cont.querySelector('#resultados-denue');
    zona.innerHTML = '<p class="text-xs text-slate-500 py-2">Consultando DENUE (INEGI)…</p>';
    try {
      const { candidatos } = await Api.validarDenue(e);
      if (!candidatos.length) {
        zona.innerHTML = '<p class="text-xs text-slate-500 py-2">Sin coincidencias en DENUE para esta escuela. Puedes ajustar la coordenada manualmente en el mapa de Google.</p>';
        return;
      }
      zona.innerHTML = `
        <p class="text-[10px] uppercase tracking-wide text-slate-400 font-semibold mt-2 mb-1.5">Candidatos en DENUE</p>
        <div class="space-y-1.5">
          ${candidatos.map((c, i) => `
            <div class="rounded-lg border border-slate-200 px-3 py-2">
              <div class="flex items-start justify-between gap-2">
                <p class="text-xs font-semibold text-slate-700 leading-snug">${esc(c.nombre)}</p>
                <span class="text-[10px] font-bold ${c.puntaje >= 60 ? 'text-green-600' : 'text-slate-400'}">${c.puntaje}%</span>
              </div>
              <p class="text-[11px] text-slate-500 mt-0.5">${esc([c.calle, c.colonia, c.cp && `C.P. ${c.cp}`].filter(Boolean).join(', '))}</p>
              <button data-cand="${i}" class="btn-aplicar-cand mt-1.5 text-[11px] font-semibold text-accion-600 hover:underline">
                Usar esta ubicación (${c.lat.toFixed(5)}, ${c.lng.toFixed(5)})
              </button>
            </div>`).join('')}
        </div>`;

      zona.querySelectorAll('.btn-aplicar-cand').forEach((b) => {
        b.onclick = () => {
          const c = candidatos[Number(b.dataset.cand)];
          guardar({ lat: c.lat, lng: c.lng, corregida_denue: true }, 'Coordenadas actualizadas con DENUE');
        };
      });
    } catch (err) {
      zona.innerHTML = `<p class="text-xs text-red-600 py-2">${esc(err.message)}</p>`;
    }
  }

  return { abrir, cerrar };
})();

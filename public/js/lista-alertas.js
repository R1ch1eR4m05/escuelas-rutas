/**
 * lista-alertas.js — Lista de las escuelas con error de ubicación.
 *
 * Cuando la geocodificación falló, decenas o cientos de escuelas quedan
 * encimadas en un mismo punto y el mapa deja de servir para trabajarlas:
 * los pines se tapan entre sí. Aquí se ven como lista, con todos los datos
 * necesarios para visitarlas (dirección, matrícula) y se les puede marcar
 * el estatus igual que desde la ficha.
 *
 * El estatus se guarda en el servidor con el mismo endpoint que usa la
 * ficha, así que el color del pin y esta lista siempre coinciden.
 */
const ListaAlertas = (() => {
  const cont = document.getElementById('lista-alertas');
  const lista = document.getElementById('alertas-lista');
  const resumen = document.getElementById('alertas-resumen');
  const pie = document.getElementById('alertas-pie');
  const buscador = document.getElementById('alertas-buscar');
  const boton = document.getElementById('btn-lista-alertas');
  const botonTexto = document.getElementById('btn-lista-alertas-texto');

  let filtro = '';

  function esc(t) {
    return String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  /** Texto sin acentos ni signos, para buscar sin que estorbe la ortografía. */
  function normalizar(t) {
    return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }

  /** Escuelas del municipio activo que traen alguna alerta de ubicación. */
  function conAlerta() {
    return Estado.escuelas.filter((e) => (e.alertas || []).length);
  }

  function coincide(e) {
    if (!filtro) return true;
    const aguja = normalizar(filtro);
    return normalizar(`${e.nombre} ${e.clave} ${e.colonia} ${e.localidad} ${e.domicilio}`).includes(aguja);
  }

  /** Dirección completa, la misma que muestra la ficha. */
  const direccion = (e) => Estado.direccionCompleta(e);

  // ── Botón del menú ──────────────────────────────────────────────────────
  function refrescarBoton() {
    const n = conAlerta().length;
    boton.classList.toggle('hidden', n === 0);
    botonTexto.textContent = `Escuelas con error de ubicación (${n.toLocaleString('es-MX')})`;
  }

  // ── Vista ───────────────────────────────────────────────────────────────
  function abrir() {
    filtro = '';
    buscador.value = '';
    cont.classList.remove('hidden');
    pintar();
  }

  function cerrar() {
    cont.classList.add('hidden');
  }

  function pintar() {
    const todas = conAlerta();
    const visibles = todas.filter(coincide);

    const municipio = Estado.escuelas[0]?.municipio;
    resumen.textContent = municipio
      ? `${todas.length.toLocaleString('es-MX')} en ${municipio}`
      : `${todas.length.toLocaleString('es-MX')} escuelas`;
    pie.textContent = filtro
      ? `Mostrando ${visibles.length} de ${todas.length}`
      : `${todas.length} escuelas · el estatus se guarda al instante`;

    if (!visibles.length) {
      lista.innerHTML = `<li class="text-center text-sm text-slate-500 py-10">
        ${todas.length ? 'Ninguna coincide con la búsqueda.' : '¡Ya no hay escuelas con error de ubicación en esta zona!'}
      </li>`;
      return;
    }

    lista.innerHTML = visibles.map((e) => `
      <li class="rounded-xl border border-slate-200 bg-white overflow-hidden" data-id="${esc(e.id)}">
        <div class="px-3.5 pt-3 pb-2.5">
          <p class="font-bold text-sm text-slate-800 leading-snug">${esc(e.nombre)}</p>
          <p class="text-[11px] text-slate-500 mt-0.5">CCT ${esc(e.clave)} · ${esc(e.turno)}</p>

          <ul class="mt-2 flex flex-wrap gap-1">
            ${(e.alertas || []).map((a) => `
              <li class="text-[10px] font-semibold text-red-700 bg-red-50 border border-red-200 rounded-full px-2 py-0.5">
                ${esc(Estado.ETIQUETAS_ALERTA[a] || a)}
              </li>`).join('')}
          </ul>

          <p class="text-[11px] text-slate-600 leading-relaxed mt-2">
            <span class="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">Dirección</span><br>
            ${esc(direccion(e))}
          </p>

          <p class="text-[11px] text-slate-600 mt-1.5">
            <b>${e.alumnos.toLocaleString('es-MX')}</b> alumnos ·
            <b>${e.docentes.toLocaleString('es-MX')}</b> docentes
          </p>
        </div>

        <div class="px-3.5 pb-3">
          <p class="text-[10px] uppercase tracking-wide text-slate-400 font-semibold mb-1.5">Estatus de visita</p>
          <div class="grid grid-cols-2 gap-1.5">
            ${Object.entries(Estado.ETIQUETAS_ESTATUS).map(([valor, etiqueta]) => `
              <button data-estatus="${valor}" data-id="${esc(e.id)}"
                class="btn-estatus-lista text-[11px] font-semibold rounded-md px-2 py-2 border transition
                  ${e.estatus === valor ? 'text-white border-transparent' : 'text-slate-600 border-slate-200 hover:border-slate-400 bg-white'}"
                ${e.estatus === valor ? `style="background:${Estado.COLORES[valor]}"` : ''}>
                ${esc(etiqueta)}
              </button>`).join('')}
          </div>
        </div>
      </li>`).join('');

    lista.querySelectorAll('.btn-estatus-lista').forEach((b) => {
      b.onclick = () => guardarEstatus(b.dataset.id, b.dataset.estatus);
    });
  }

  async function guardarEstatus(id, estatus) {
    const e = Estado.porId.get(id);
    if (!e || e.estatus === estatus) return;
    try {
      const actualizada = await Api.actualizarEscuela(Estado.estadoSlug, Estado.municipioSlug, id, { estatus });
      Estado.aplicarCambio(actualizada); // repinta el pin del mapa
      pintar();
    } catch (err) {
      App.aviso(err.message, true);
    }
  }

  // ── Conexiones ──────────────────────────────────────────────────────────
  boton.addEventListener('click', abrir);
  document.getElementById('alertas-cerrar').addEventListener('click', cerrar);
  buscador.addEventListener('input', () => { filtro = buscador.value.trim(); pintar(); });
  cont.addEventListener('click', (ev) => { if (ev.target === cont) cerrar(); });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !cont.classList.contains('hidden')) cerrar();
  });

  // El conteo del botón sigue al municipio activo y a las correcciones.
  document.addEventListener('zona:cargada', refrescarBoton);
  document.addEventListener('escuela:cambiada', () => {
    refrescarBoton();
    if (!cont.classList.contains('hidden')) pintar();
  });

  return { abrir, cerrar, refrescarBoton };
})();

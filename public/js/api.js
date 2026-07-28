/**
 * api.js — Cliente de la API REST del servidor local.
 * Todas las funciones regresan promesas y lanzan Error con mensaje legible.
 */
const Api = (() => {
  async function pedir(ruta, opciones = {}) {
    const resp = await fetch(ruta, {
      headers: { 'Content-Type': 'application/json' },
      ...opciones,
    });
    const datos = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(datos.error || `Error ${resp.status}`);
    return datos;
  }

  return {
    /** Lista de estados con conteos. */
    estados: () => pedir('/api/estados'),

    /** Municipios de un estado (por slug). */
    municipios: (estadoSlug) => pedir(`/api/estados/${estadoSlug}/municipios`),

    /** Segmento completo de un municipio (carga bajo demanda). */
    escuelas: (estadoSlug, municipioSlug) =>
      pedir(`/api/escuelas/${estadoSlug}/${municipioSlug}`),

    /** Actualiza estatus / notas / coordenadas de una escuela. */
    actualizarEscuela: (estadoSlug, municipioSlug, id, cambios) =>
      pedir(`/api/escuelas/${estadoSlug}/${municipioSlug}/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(cambios),
      }),

    /**
     * Valida en bloque todas las escuelas con alerta de un municipio.
     * Con aplicar=false solo simula y devuelve el reporte.
     */
    validarMunicipio: (estadoSlug, municipioSlug, aplicar) =>
      pedir('/api/denue/validar-municipio', {
        method: 'POST',
        body: JSON.stringify({ estado: estadoSlug, municipio: municipioSlug, aplicar }),
      }),

    /**
     * Aplica una tanda de correcciones ya revisadas a mano.
     * @param {{id,lat,lng,denue_id?}[]} correcciones
     */
    aplicarCorrecciones: (estadoSlug, municipioSlug, correcciones) =>
      pedir('/api/denue/aplicar-correcciones', {
        method: 'POST',
        body: JSON.stringify({ estado: estadoSlug, municipio: municipioSlug, correcciones }),
      }),

    /** Busca candidatos de ubicación en DENUE (INEGI) para UNA escuela. */
    validarDenue: (escuela) =>
      pedir('/api/denue/validar', {
        method: 'POST',
        body: JSON.stringify({
          nombre: escuela.nombre,
          estado: escuela.estado,
          municipio: escuela.municipio,
          lat: escuela.lat,
          lng: escuela.lng,
          codigo_postal: escuela.codigo_postal,
          colonia: escuela.colonia,
        }),
      }),
  };
})();

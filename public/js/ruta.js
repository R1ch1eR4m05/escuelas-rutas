/**
 * ruta.js — Ordenamiento de la ruta del día y exportación a Google Maps.
 *
 * El orden recomendado se calcula con vecino más cercano (partiendo de la
 * primera escuela agregada) y se afina con mejoras 2-opt: suficiente para
 * las ~5–15 paradas típicas de un día de visitas.
 */
const Ruta = (() => {
  /** Distancia haversine en km. */
  function distanciaKm(a, b) {
    const R = 6371, rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
    const s = Math.sin(dLat / 2) ** 2 +
      Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }

  function distanciaTotal(puntos) {
    let d = 0;
    for (let i = 1; i < puntos.length; i++) d += distanciaKm(puntos[i - 1], puntos[i]);
    return d;
  }

  /** Vecino más cercano partiendo del primer elemento. */
  function vecinoMasCercano(puntos) {
    if (puntos.length <= 2) return [...puntos];
    const pendientes = [...puntos];
    const orden = [pendientes.shift()];
    while (pendientes.length) {
      const ultimo = orden[orden.length - 1];
      let mejor = 0, mejorD = Infinity;
      for (let i = 0; i < pendientes.length; i++) {
        const d = distanciaKm(ultimo, pendientes[i]);
        if (d < mejorD) { mejorD = d; mejor = i; }
      }
      orden.push(pendientes.splice(mejor, 1)[0]);
    }
    return orden;
  }

  /** Mejora 2-opt: deshace cruces del recorrido hasta que no haya mejora. */
  function dosOpt(orden) {
    let mejora = true;
    const ruta = [...orden];
    while (mejora) {
      mejora = false;
      for (let i = 1; i < ruta.length - 1; i++) {
        for (let j = i + 1; j < ruta.length; j++) {
          const actual =
            distanciaKm(ruta[i - 1], ruta[i]) +
            (j + 1 < ruta.length ? distanciaKm(ruta[j], ruta[j + 1]) : 0);
          const invertida =
            distanciaKm(ruta[i - 1], ruta[j]) +
            (j + 1 < ruta.length ? distanciaKm(ruta[i], ruta[j + 1]) : 0);
          if (invertida < actual - 1e-9) {
            // invierte el tramo i..j
            let a = i, b = j;
            while (a < b) { [ruta[a], ruta[b]] = [ruta[b], ruta[a]]; a++; b--; }
            mejora = true;
          }
        }
      }
    }
    return ruta;
  }

  /** Devuelve las escuelas en el orden recomendado. */
  function ordenar(escuelas) {
    const conCoord = escuelas.filter((e) => Number.isFinite(e.lat) && Number.isFinite(e.lng));
    return dosOpt(vecinoMasCercano(conCoord));
  }

  /**
   * URL estándar de Google Maps Directions.
   * Nota: Google acepta un máximo de 9 waypoints intermedios en la URL,
   * es decir 11 puntos en total (origen + 9 + destino).
   */
  const MAX_PUNTOS = 11;

  function urlGoogleMaps(escuelasOrdenadas) {
    const pts = escuelasOrdenadas
      .filter((e) => Number.isFinite(e.lat) && Number.isFinite(e.lng))
      .slice(0, MAX_PUNTOS)
      .map((e) => `${e.lat},${e.lng}`);
    if (pts.length < 2) return null;

    const origen = pts[0];
    const destino = pts[pts.length - 1];
    const intermedios = pts.slice(1, -1).join('|');

    let url = `https://www.google.com/maps/dir/?api=1&origin=${origen}&destination=${destino}&travelmode=driving`;
    if (intermedios) url += `&waypoints=${encodeURIComponent(intermedios)}`;
    return url;
  }

  return { ordenar, distanciaKm, distanciaTotal, urlGoogleMaps, MAX_PUNTOS };
})();

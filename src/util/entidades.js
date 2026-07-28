/**
 * util/entidades.js
 * Mapa de nombre de estado (normalizado, sin acentos, mayúsculas)
 * a clave de entidad federativa INEGI (01–32), usada por la API DENUE.
 */
const { slug } = require('./geo');

const ENTIDADES = {
  'aguascalientes': '01',
  'baja-california': '02',
  'baja-california-sur': '03',
  'campeche': '04',
  'coahuila-de-zaragoza': '05',
  'colima': '06',
  'chiapas': '07',
  'chihuahua': '08',
  'ciudad-de-mexico': '09',
  'distrito-federal': '09',
  'durango': '10',
  'guanajuato': '11',
  'guerrero': '12',
  'hidalgo': '13',
  'jalisco': '14',
  'mexico': '15',
  'estado-de-mexico': '15',
  'michoacan-de-ocampo': '16',
  'michoacan': '16',
  'morelos': '17',
  'nayarit': '18',
  'nuevo-leon': '19',
  'oaxaca': '20',
  'puebla': '21',
  'queretaro': '22',
  'quintana-roo': '23',
  'san-luis-potosi': '24',
  'sinaloa': '25',
  'sonora': '26',
  'tabasco': '27',
  'tamaulipas': '28',
  'tlaxcala': '29',
  'veracruz-de-ignacio-de-la-llave': '30',
  'veracruz': '30',
  'yucatan': '31',
  'zacatecas': '32',
};

/** Devuelve la clave de entidad ('01'–'32') o null si no se reconoce el estado. */
function claveEntidad(nombreEstado) {
  return ENTIDADES[slug(nombreEstado)] || null;
}

module.exports = { claveEntidad };

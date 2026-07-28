# Escuelas & Rutas

Aplicación web local para **visualizar, corregir y planear rutas de visita** a escuelas primarias de México (98,615 registros, 32 estados, 2,481 municipios), pensada para equipos de venta de libros que hacen exposiciones escolares.

Node.js + Express + LeafletJS + Tailwind CSS. Sin dependencias nativas: corre en cualquier Node ≥ 18.

---

## Inicio rápido

```bash
npm install          # instala dependencias (express, csv-parse, dotenv)
npm run importar     # procesa data/Primarias_General.csv → db/segmentos/ (una sola vez)
                     # re-ejecutarlo conserva estatus, notas y coordenadas corregidas
npm start            # levanta el servidor en http://localhost:3000
```

Abre **http://localhost:3000**, elige Estado → Municipio y empieza a trabajar.

Para habilitar la validación con INEGI:

```bash
cp .env.example .env
# edita .env y coloca tu DENUE_TOKEN (gratuito):
# https://www.inegi.org.mx/app/api/denue/v1/tokenVerify.aspx
```

El token llega por correo tras registrarte. Si esa página no abre, el formulario alterno es
`https://inegi.org.mx/app/desarrolladores/generatoken/Usuarios/token_Verify` (sin `www`).

---

## Cómo funciona

### 1. Datos y rendimiento (carga bajo demanda)

- `npm run importar` segmenta el CSV en **un archivo JSON por municipio** (`db/segmentos/{estado}/{municipio}.json`) más un índice ligero (`db/indice.json`).
- La interfaz **nunca** carga los ~98 mil registros: primero baja solo el índice (estados y municipios con conteos) y, al elegir un municipio, trae únicamente ese segmento (unas decenas o cientos de escuelas).
- Los municipios con más de 250 escuelas usan agrupación de marcadores (marker clustering) para mantener el mapa fluido.
- **Re-importar es seguro**: el script conserva estatus, notas y correcciones ya capturadas (fusiona por CCT + turno).

### 2. Alertas de geocodificación + corrección con INEGI DENUE

Durante la importación se calculan tres alertas por escuela (aparecen con borde rojo en el pin y detalle en la ficha):

| Alerta | Significado |
|---|---|
| `coord_invalida` | Lat/lng en 0, no numérica o fuera de México |
| `coord_duplicada` | 2+ escuelas del municipio comparten la **misma coordenada exacta** (geocodificación fallida al centroide) |
| `fuera_de_zona` | A más de 30 km de la mediana geográfica de su municipio |

Una alerta es un diagnóstico, no una corrección automática: hay que aplicarla explícitamente.

Compartir coordenada **no** siempre es un error. En México es normal que los turnos de un mismo plantel (registrados con CCT distinta) y que dos escuelas que comparten edificio tengan la misma ubicación, así que `coord_duplicada` solo se marca cuando los registros parecen sitios **distintos** (CCT y domicilio diferentes). Sin ese filtro, 3 de cada 4 alertas de duplicado eran falsas.

Estado de la base incluida en este repositorio:

| | Antes de corregir | Ahora |
|---|---|---|
| Alertas en todo el país | 31,095 | **11,612** |
| Tijuana (704 escuelas) | 630 encimadas en un punto | **173 con alerta** |
| Morelia (552 escuelas) | 166 con alerta | **11 con alerta** |
| Ubicaciones corregidas con INEGI | 0 | **597** |

Tijuana sigue siendo el caso extremo: 173 escuelas continúan sobre el centroide del municipio porque el DENUE no tiene registro de ellas o la coincidencia no fue concluyente. Se atienden desde **«Escuelas con error de ubicación»** y desde la revisión por tanda (ver abajo).

#### Corrección masiva (recomendada para municipios con muchas alertas)

En lugar de una consulta por escuela, se descarga el catálogo de escuelas primarias del municipio con unas pocas llamadas y el cruce se hace localmente.

Desde la interfaz: botón **"Corregir ubicaciones del municipio con INEGI"**. El primer clic simula y muestra el reporte; el segundo aplica.

Desde la terminal:

```bash
# Simula: muestra qué cambiaría sin tocar nada
npm run validar -- --estado=baja-california --municipio=tijuana

# Aplica los cambios
npm run validar -- --estado=baja-california --municipio=tijuana --aplicar

# Más estricto (solo coincidencias muy seguras)
npm run validar -- --estado=baja-california --municipio=tijuana --umbral=85 --aplicar
```

Cada escuela se clasifica en:

- **Corregida** — puntaje ≥ umbral (60 por omisión); se actualiza la coordenada.
- **Dudosa** — hay candidato pero no alcanza el umbral, o su candidato ya se asignó a otra escuela. Se revisa a mano desde la ficha.
- **Sin candidato** — DENUE no tiene un registro parecido. Suele pasar con escuelas rurales o de reciente creación.

Un establecimiento del DENUE es **un plantel físico**, así que se asigna a una sola escuela; de lo contrario volverían a quedar encimadas. Si el mejor candidato de una escuela ya se lo llevó otra, se intenta con el siguiente de su lista en vez de descartarla. Los planteles asignados en corridas anteriores siguen ocupados, así que **volver a correr la corrección no reasigna ni vuelve a encimar**.

#### Revisión por tanda de las dudosas

El reporte de la simulación ofrece **«Revisar N dudosas una por una»**: una vista con todas las coincidencias que no alcanzaron el umbral, ordenadas de mayor a menor puntaje. Cada tarjeta compara el domicilio del registro SEP contra el del DENUE, dice cuántos kilómetros movería el pin y enlaza a Google Maps para confirmar. Se aprueban o descartan una por una (o en bloque con «Aceptar ≥ 80» / «≥ 60») y se aplican todas juntas.

#### Escuelas con error de ubicación

Cuando decenas de escuelas quedan encimadas en un punto, el mapa deja de servir: los pines se tapan. El botón **«Escuelas con error de ubicación (N)»** abre la lista completa con nombre, CCT, turno, dirección, matrícula y docentes, con buscador y con los mismos botones de estatus que la ficha.

#### Corrección individual

El botón **"Validar / Corregir ubicación con INEGI"** de la ficha sigue disponible para casos puntuales:

1. El servidor consulta la API DENUE (primero por cercanía en radio de 5 km; si no hay resultados, en toda la entidad federativa).
2. Los candidatos se puntúan por similitud de nombre, coincidencia de código postal y de colonia.
3. Un clic en "Usar esta ubicación" actualiza lat/lng del registro, limpia sus alertas y lo marca como *corregida con INEGI ✓*.

El token nunca llega al navegador: la consulta pasa por el proxy `/api/denue/validar`.

### 3. Mapa interactivo

- **Pines por estatus** (el color se cambia desde la ficha): gris = sin visitar, ámbar = pendiente, verde = visitada, rojo = descartada/inaccesible.
- **Filtros** por estatus y "solo escuelas con alerta".
- **Ficha** al hacer clic en un pin: nombre, CCT, turno, matrícula, docentes, dirección completa, coordenadas y **notas editables** que se guardan en el servidor local (persisten entre sesiones).
- **Aro de selección**: la escuela abierta se marca con un anillo, porque al abrir su ficha el mapa se recentra y es fácil perderla entre cientos de pines. El mapa nunca se aleja: si ya estabas más acercado, respeta tu zoom.

### 3.1 En celular

El layout de tres columnas no cabe en una pantalla angosta, así que por debajo de 640 px (breakpoint `sm:` de Tailwind) la interfaz se reorganiza sin cambiar nada del escritorio:

- El **mapa ocupa toda la pantalla**; ningún panel le roba espacio de forma permanente.
- La **selección de zona** vive en una barra superior compacta que despliega una hoja; se cierra sola al elegir municipio.
- La **ficha** sube como hoja inferior arrastrable (se asoma al 52 %, se jala hasta el 92 %, se desliza abajo para cerrar).
- La **ruta del día** es un botón flotante con el contador de paradas que abre otra hoja inferior.
- Objetivos táctiles de 44 px como mínimo y campos a 16 px para que iOS no haga zoom al enfocarlos.

Para abrirla desde el teléfono, `npm start` imprime la dirección de red local (misma Wi-Fi).

### 4. Rutas del día + Google Maps

**Varias rutas a la vez.** Cada equipo de campo lleva la suya: con **«+ Agregar nueva ruta»** se crean las que hagan falta y se cambia entre ellas con las pestañas de colores. Las paradas se agregan siempre a la ruta seleccionada, y cada ruta guarda las suyas por separado.

Se guardan **en el servidor**, no en el navegador: persisten al recargar y todos los equipos ven las mismas. Doble clic sobre una pestaña la renombra. En el mapa se dibujan todas a la vez —cada una con su color, la activa resaltada— para repartir la zona sin encimarse.

Viven en `db/rutas.json`, que **no se versiona**: son datos de operación de cada instalación, así que actualizar el servidor no los pisa.


- Botón "Agregar a ruta del día" en cada ficha; las paradas aparecen numeradas en el mapa y en la bandeja lateral.
- **Orden recomendado**: vecino más cercano + mejora 2-opt (en la prueba de ejemplo redujo un recorrido de 32.4 km a 19.8 km).
- **"Abrir ruta en Google Maps"** genera la URL estándar:
  `https://www.google.com/maps/dir/?api=1&origin=LAT,LNG&destination=LAT,LNG&waypoints=LAT1,LNG1|LAT2,LNG2&travelmode=driving`
  Google admite un máximo de 9 waypoints intermedios (11 puntos en total); si la ruta es más larga, la app lo avisa y abre las primeras 11 paradas.

---

## API REST

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/estados` | Estados con número de municipios y escuelas |
| GET | `/api/estados/:estado/municipios` | Municipios del estado con conteos y alertas |
| GET | `/api/escuelas/:estado/:municipio` | Segmento completo del municipio |
| PATCH | `/api/escuelas/:estado/:municipio/:id` | Actualiza `estatus`, `notas`, `lat`/`lng`, `corregida_denue` |
| POST | `/api/denue/validar` | Candidatos de ubicación para una escuela (requiere token) |
| POST | `/api/denue/validar-municipio` | Validación masiva del municipio; `aplicar:false` solo simula |
| POST | `/api/denue/aplicar-correcciones` | Escribe una tanda de correcciones ya revisadas a mano |
| GET | `/api/rutas/:estado/:municipio` | Rutas del día de esa zona |
| POST | `/api/rutas` | Crea una ruta (`{nombre, estado, municipio}`) |
| PATCH | `/api/rutas/:id` | Renombra o cambia sus paradas |
| DELETE | `/api/rutas/:id` | Elimina una ruta |

Los slugs no llevan acentos: `michoacan-de-ocampo/morelia`. El `:id` es `CCT-turno`, p. ej. `16DPR4233O-matutino`.

---

## Estructura del proyecto

```
escuelas-rutas/
├── data/Primarias_General.csv    # fuente original
├── db/                           # generado por npm run importar
│   ├── indice.json               # índice ligero (estados → municipios)
│   └── segmentos/{estado}/{municipio}.json
├── scripts/
│   ├── importar-csv.js           # ETL + detección de alertas
│   ├── validar-municipio.js      # corrección masiva por CLI
│   └── probar-denue.js           # diagnóstico de la conexión con INEGI
├── src/
│   ├── server.js                 # Express: estáticos + API
│   ├── db.js                     # acceso a segmentos (caché + escritura atómica)
│   ├── rutas/escuelas.js         # endpoints de consulta y edición
│   ├── rutas/denue.js            # endpoints de validación individual y por lote
│   ├── denue-cliente.js          # cliente DENUE (paginación, reintentos)
│   ├── validacion-lote.js        # motor de corrección masiva
│   └── util/                     # geo, similitud de nombres, claves de entidad
└── public/
    ├── index.html                # interfaz (Tailwind CDN)
    ├── css/estilos.css
    └── js/
        ├── api.js                # cliente REST
        ├── estado.js             # estado compartido + formato de direcciones
        ├── mapa.js               # Leaflet: pines, aro de selección, ruta
        ├── panel.js              # ficha de la escuela
        ├── ruta.js               # orden de paradas + URL de Google Maps
        ├── revision.js           # revisión por tanda de las dudosas
        ├── lista-alertas.js      # lista de escuelas mal ubicadas
        ├── movil.js              # hojas deslizables en pantallas angostas
        └── app.js                # arranque y cableado
```

## Notas técnicas

- **Diagnóstico de la conexión con INEGI**: `npm run probar-denue` revisa token, DNS, TLS y las dos rutas de la API por separado, y distingue un problema de red (antivirus/proxy/firewall bloqueando `node.exe`) de uno de configuración.
- **Los términos de búsqueda del DENUE se separan con ESPACIO, no con coma.** La documentación oficial dice coma, pero contra la API real cualquier condición con coma deja al servidor colgado: acepta la conexión, manda encabezados y nunca envía el cuerpo. Afecta igual a `Buscar` y a `BuscarEntidad`. Con espacio responde normal y los términos se combinan bien (`"...primaria tijuana"` devuelve solo Tijuana). Todas las consultas pasan por `condicion()` en `src/denue-cliente.js`, que ya une con espacios y aplica un timeout de 30 s.
- **La corrección masiva es idempotente**: los planteles del DENUE asignados en corridas anteriores se marcan como ocupados (por `denue_id`, o por coordenada en datos previos), para que una segunda corrida no los reasigne y vuelva a encimar escuelas.
- **¿Por qué JSON segmentado y no SQLite?** Cero dependencias nativas (better-sqlite3 requiere compilación y `node:sqlite` sigue siendo experimental), archivos pequeños que encajan con la carga bajo demanda, y las escrituras usan `tmp + rename` atómico para no corromper segmentos.
- Los CDN (Tailwind, Leaflet, OpenStreetMap, Google Fonts) requieren conexión a internet la primera vez que se abre la interfaz.
- Cambia el puerto con `PUERTO=4000 npm start` o en `.env`.

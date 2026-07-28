#!/usr/bin/env bash
#
# Actualiza la app en el servidor SIN tocar los datos capturados en campo.
#
# El problema que resuelve: la carpeta db/ está versionada en git (para que
# el repositorio traiga la base ya corregida), así que un `git pull` o un
# `git reset --hard` sobrescribe los estatus, notas y rutas que los equipos
# capturaron. Ya pasó una vez y se perdió trabajo real.
#
# La solución es que los datos vivos estén FUERA del repositorio, en la
# carpeta que indica DATOS_DIR. Este script actualiza solo el código.
#
# Uso en el servidor:   bash scripts/actualizar-servidor.sh
set -euo pipefail

APP=/opt/escuelas-rutas
DATOS=${DATOS_DIR:-/var/lib/escuelas-rutas}
SERVICIO=escuelas-rutas

echo "→ Datos vivos en: $DATOS"
if [ ! -d "$DATOS/segmentos" ]; then
  echo "  ERROR: no existe $DATOS/segmentos"
  echo "  La primera vez hay que sembrarlo:  cp -r $APP/db/. $DATOS/"
  exit 1
fi

# Respaldo antes de cualquier cosa: barato y evita perder el día de trabajo.
RESPALDO="$DATOS/../escuelas-rutas-respaldo-$(date +%Y%m%d-%H%M%S).tar.gz"
tar czf "$RESPALDO" -C "$(dirname "$DATOS")" "$(basename "$DATOS")"
echo "→ Respaldo: $RESPALDO"

echo "→ Actualizando código"
cd "$APP"
git fetch -q origin main
git reset -q --hard origin/main   # seguro: los datos vivos no están aquí
npm ci --omit=dev >/dev/null 2>&1

echo "→ Reiniciando servicio"
systemctl restart "$SERVICIO"
sleep 3

if [ "$(systemctl is-active "$SERVICIO")" = "active" ]; then
  echo "→ Listo. Commit: $(git log --oneline -1)"
  node -e "
    const fs=require('fs'),path=require('path');
    const dir='$DATOS/segmentos';
    let est=0,notas=0;
    for(const e of fs.readdirSync(dir)){
      const p=path.join(dir,e); if(!fs.statSync(p).isDirectory())continue;
      for(const a of fs.readdirSync(p)){
        const s=JSON.parse(fs.readFileSync(path.join(p,a),'utf8'));
        for(const x of s.escuelas){ if(x.estatus!=='sin_visitar')est++; if(x.notas)notas++; }
      }
    }
    console.log('   Datos conservados -> estatus: '+est+' | notas: '+notas);
  "
else
  echo "→ ERROR: el servicio no arrancó. Revisa: journalctl -u $SERVICIO -n 40"
  exit 1
fi

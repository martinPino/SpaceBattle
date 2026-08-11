# Handoff: Space Asset Kit → Unity (vía Claude Code)

## Qué es esto
Kit procedural de assets espaciales para un videojuego en Unity. El paquete
tiene DOS piezas complementarias:

1. **Tools/Blender/** — el pipeline de PRODUCCIÓN. Scripts de Blender Python
   que generan la geometría real, materiales, LODs, colliders y empties, y
   exportan FBX + GLB con los ejes y la escala de Unity. Esto es lo que
   Claude Code debe ejecutar.
2. **viewer/** — referencia VISUAL (HTML + three.js). Réplica en tiempo real
   de los mismos generadores (mismas seeds, misma paleta) para aprobar la
   dirección artística sin abrir Blender. NO es código de producción; sirve
   como especificación visual y de nomenclatura.

## Instrucciones para Claude Code

### Paso 1 — Generar los assets
Requiere Blender 3.6+ (probado contra la API 3.6/4.x). Desde la raíz del
repo del juego:

    # vertical slice (15 assets clave)
    blender --background --python Tools/Blender/generate_all_assets.py -- --slice

    # kit completo + 5 mapas de demostración
    blender --background --python Tools/Blender/generate_all_assets.py

    # omitir el horneado de skyboxes (es la parte lenta, usa Cycles)
    blender --background --python Tools/Blender/generate_all_assets.py -- --skip-skybox

Salidas:

    Assets/Game/Models/Generated/{Ships,Planets,Stars,Asteroids,Stations,Environment,Debris,Props}/  → FBX + GLB
    Assets/Game/Textures/Generated/   → skyboxes equirect 4096×2048 (PNG)
    Tools/Blender/blend/              → .blend editables por asset
    Tools/Blender/generation_report.txt → vértices, tris, materiales, seed y ruta por asset
    Tools/Blender/generation_log.txt    → OK/FAIL por paso

Cada generador acepta seed y parámetros (size, crater_count, ocean_level,
ring_count, mineral_amount…). El mismo seed reproduce exactamente el mismo
asset; cambiar el seed produce una variante coherente.

### Paso 2 — Import settings en Unity
- Model: Scale Factor 1, Convert Units ON, Bake Axis Conversion ON.
- Normals: Import, Smoothing Angle 38.
- El forward de las naves ya llega a +Z de Unity (morro), up = +Y.
- Materiales: el FBX trae NOMBRES de material (MAT_Hull_Dark, MAT_Rock_Grey,
  MAT_Emissive_Cyan…). Crear los materiales URP una vez y usar
  Search & Remap — la tabla de valores está abajo.

### Paso 3 — Ensamblaje por tipo de asset
- **LODs**: cada asset trae *_LOD0/1/2 → LOD Group (transiciones 60% / 25% / 8%).
- **Colliders**: usar los meshes *_Collider (convexos, ya simplificados) como
  Mesh Collider convex. NUNCA la malla visual.
- **Empties → GameObjects vacíos**: FX_Engine_* (VFX de propulsión, apuntan
  -Z local), Muzzle_* (spawn de proyectiles, +Z), FX_Thruster_* (RCS),
  CameraTarget (pivote de cámara third-person), TargetPoint (lock-on),
  DockPoint_*/HangarEntry (estaciones), TurretSocket_* (nave capital),
  WarpFX_Center (portales), LensingFX_Center (agujero negro).
- **Asteroides y restos**: comparten material → marcar GPU Instancing.
  Los campos (ENV_AsteroidField_01, ENV_DebrisField_01) usan 4-5 prototipos
  instanciados; replicar ese patrón si se generan campos en runtime.
- **Skybox**: material Skybox/Panoramic con la textura equirect.
- **Nebulosas**: billboards con shader aditivo, ZWrite Off, render queue
  Transparent; ordenar por distancia. No reducen visibilidad de combate.
- **Estrellas (soles)**: el objeto es solo visual (emissive + sprites de
  glow); la luz real de la escena es una Directional Light apuntando desde
  la posición del sol. Añadir Bloom (post-processing) para el halo.
- **Planetas**: esfera de superficie + esfera de nubes (rotarla ~0.2°/s
  independiente) + cáscara de atmósfera (shader fresnel aditivo, BackSide).

## Escala (1 unidad = 1 m)
- Caza jugador 12 m · interceptor enemigo 8 m · nave pesada 30 m
- Estación ~200 m · nave capital 2.600 m · asteroides 1–1000 m
- Planetas/estrellas: radio 480–1400 m como elementos VISUALES lejanos
  (no distancias astronómicas reales; evita problemas de precisión float).

## Tokens de dirección artística
Paleta PBR (URP/Lit):
- MAT_Hull_Dark   base #33383F · metallic 0.85 · smooth 0.55
- MAT_Hull_Mid    base #6D747C · metallic 0.80 · smooth 0.65
- MAT_Hull_Light  base #C3C9CE · metallic 0.35 · smooth 0.60
- MAT_Hull_Black  base #15181C · metallic 0.70 · smooth 0.40
- MAT_Accent_Amber #D8912A · metallic 0.45 · smooth 0.55
- MAT_Cockpit_Glass #0A1420 · smooth 0.94 · clearcoat
- Emissive: cyan #39D6FF (jugador/estaciones), rojo #FF4A2A (enemigos),
  ámbar #D8912A (balizas). Intensidad HDR ×2–4 con Bloom.
- Roca: gris #6A6660 / oscura #2B2B2E / hielo #9FB4C4 / vetas minerales
  cyan emissive dentro de grietas.
- Fondo: espacio muy oscuro (#05070C), contraste alto, 1-2 colores de
  nebulosa por mapa.

## Nomenclatura
ENV_* (entorno), SHIP_* (naves), PROP_* (estaciones/satélites/balizas),
MAT_* (materiales), sufijos _LOD0/1/2 y _Collider, empties FX_*/Muzzle_*.

## Los 5 mapas (generate_space_environment.py)
MAP_01_DeepSpace · MAP_02_AsteroidBelt · MAP_03_BlueNebula ·
MAP_04_RedSystem · MAP_05_GalacticFrontier — cada uno guarda su .blend con
cámara de composición; usarlos como layout de referencia para las escenas
de Unity.

## Referencia visual rápida (sin Blender)
Abrir viewer/space-kit.html en un navegador (necesita internet para three.js).
Cada asset del catálogo se puede descargar en OBJ+MTL o GLB desde la barra
del visor para inspección rápida — el FBX de producción sale del pipeline.

## Fidelidad
Los modelos del viewer y los de Blender comparten seeds, proporciones,
paleta y nombres, pero el detalle fino de textura difiere (el viewer hornea
en canvas; Blender usa nodos procedurales). La fuente de verdad para Unity
es SIEMPRE la salida del pipeline de Blender.

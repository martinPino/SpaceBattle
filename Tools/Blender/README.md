# Space Asset Kit — Tools/Blender

Generadores procedurales para Unity. Todo por seed: el mismo seed produce
exactamente el mismo asset.

## Ejecutar

    # vertical slice (15 assets)
    blender --background --python Tools/Blender/generate_all_assets.py -- --slice

    # kit completo + los 5 mapas
    blender --background --python Tools/Blender/generate_all_assets.py

    # sin hornear skyboxes (los renders de Cycles son la parte lenta)
    blender --background --python Tools/Blender/generate_all_assets.py -- --skip-skybox

    # un sistema concreto
    blender --background --python Tools/Blender/generate_asteroids.py
    blender --background --python Tools/Blender/generate_planets.py
    blender --background --python Tools/Blender/generate_skybox.py -- --variant BlueNebula

## Módulos

| script | genera |
|---|---|
| sk_core.py | núcleo: seeds, deformación de roca, LODs, colliders, empties, export |
| sk_materials.py | materiales PBR por nodos (casco, roca, planeta, gas, estrella, nebulosa) |
| generate_player_ship.py | SHIP_Player_Fighter_01 (12 m) modular + empties de Unity |
| generate_enemy_ships.py | interceptor (8 m) y nave pesada (30 m), emissive rojo |
| generate_asteroids.py | 10 small / 10 medium / 10 large / 5 giant + especiales + campos |
| generate_planets.py | terrestre, desértico, volcánico, helado, gaseoso, anillado, lunas |
| generate_stars.py | soles (5 tipos) con corona y prominencias + estrellas cercanas |
| generate_nebulas.py | volumen para render + billboards para juego, polvo cósmico |
| generate_galaxies.py | espiral / barrada / elíptica / irregular + agujero negro |
| generate_space_station.py | 9 módulos de estación, satélites, portales, balizas, restos, cometas |
| generate_space_environment.py | los 5 mapas del brief |
| generate_skybox.py | skybox equirect 4096×2048 horneado (5 variantes) |
| export_unity_assets.py | reglas de exportación y reexport de la escena |
| generate_all_assets.py | pipeline completo + generation_report.txt + log |

## Salida

    Assets/Game/Models/Generated/{Ships,Planets,Stars,Asteroids,Stations,Environment,Debris,Props}/   FBX + GLB
    Assets/Game/Textures/Generated/    skyboxes equirect
    Tools/Blender/blend/               .blend por asset
    Tools/Blender/generation_report.txt   vértices, triángulos, materiales, seed, ruta
    Tools/Blender/generation_log.txt      OK/FAIL por paso

## Convenciones

* 1 unidad = 1 metro. Transforms aplicados, origen en el centro geométrico.
* Morro de las naves en +Y de Blender → +Z (forward) en Unity.
* Export FBX con axis_forward=-Z, axis_up=Y, bake_space_transform.
* *_LOD0/1/2 para LOD Group; *_Collider convexo simplificado (nunca la malla visual).
* Empties: FX_Engine_*, Muzzle_*, FX_Thruster_*, CameraTarget, TargetPoint.
* Emissive: cyan = jugador, rojo/naranja = enemigos, ámbar = balizas y estaciones.
* Asteroides y restos comparten material → GPU instancing en Unity.

## Previsualización

space-kit.html (raíz del proyecto) es el visor 3D de la dirección artística:
replica los mismos generadores en tiempo real —misma paleta, mismas seeds— y
permite descargar cualquier asset en OBJ+MTL o GLB para comprobarlo en Blender
o Unity antes de lanzar el pipeline completo.

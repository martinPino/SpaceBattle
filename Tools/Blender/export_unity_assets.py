"""
export_unity_assets.py - reglas de exportacion a Unity.

Convenciones aplicadas por sk_core.export_asset():
  * 1 unidad Blender = 1 metro; apply_unit_scale + FBX_SCALE_UNITS
  * axis_forward = -Z, axis_up = Y  ->  el morro de la nave (+Y Blender)
    llega mirando a +Z en Unity, que es su forward
  * bake_space_transform: sin rotaciones residuales de -90 en X
  * transforms aplicados, normales y UVs generadas antes de exportar
  * GLB adicional (jerarquia + PBR) para revisar en cualquier herramienta
"""
import bpy, sys, os
sys.path.append(os.path.dirname(__file__))
import sk_core as C

SUBDIR_BY_PREFIX = {
    "SHIP_": "Ships",
    "ENV_Planet": "Planets",
    "ENV_Moon": "Planets",
    "ENV_Star": "Stars",
    "ENV_Asteroid": "Asteroids",
    "ENV_Nebula": "Environment",
    "ENV_Galaxy": "Environment",
    "ENV_Comet": "Environment",
    "ENV_Debris": "Debris",
    "PROP_SpaceStation": "Stations",
    "PROP_": "Props",
}

def subdir_for(name):
    for prefix, sub in SUBDIR_BY_PREFIX.items():
        if name.startswith(prefix):
            return sub
    return "Environment"

def export_scene_roots(fbx=True, glb=True):
    """Exporta cada objeto raiz (con sus hijos) como un asset independiente."""
    roots = [o for o in bpy.context.scene.objects if o.parent is None]
    done = []
    for root in roots:
        family = [root] + list(root.children_recursive)
        if not any(o.type == "MESH" for o in family):
            continue
        C.export_asset(family, root.name, subdir_for(root.name), fbx=fbx,
                       glb=glb, notes="reexportado desde la escena")
        done.append(root.name)
    return done

UNITY_IMPORT_NOTES = [
    "Model Import: Scale Factor 1, Convert Units ON, Bake Axis Conversion ON",
    "Normals: Import, Smoothing Angle 38",
    "Materials: crear los materiales en Unity (URP/Lit); el FBX solo trae nombres",
    "Emissive: MAT_Emissive_* -> URP/Lit con Emission + Bloom en el Volume",
    "Colliders: usar los meshes *_Collider como Mesh Collider convex, o",
    "           sustituir por Box/Sphere/Capsule cuando encaje mejor",
    "LODs: LOD Group con LOD0/1/2 (transiciones 60% / 25% / 8%)",
    "Asteroides y restos: activar GPU Instancing en el material",
    "Skybox: Skybox/Panoramic con la equirect de Textures/Generated",
    "Nebulosas: billboards aditivos, sin depth write, ordenados por distancia",
]

if __name__ == "__main__":
    names = export_scene_roots()
    C.REPORT.append(dict(asset="EXPORT_SUMMARY", verts=0, tris=0, materials=[],
                         files=[], seed=None,
                         notes="; ".join(names) or "escena vacia"))
    C.write_report()

"""
generate_nebulas.py - nebulosas y nubes cosmicas.

Dos salidas, porque en Unity nunca se usa un volumen de Cycles:
  1. Un dominio volumetrico en Blender (para render y para hornear).
  2. Un set de planos billboard con la nebulosa horneada -> es lo que se
     exporta al juego (barato, se ordena por distancia, no tapa el combate).
"""
import bpy, sys, os, math
sys.path.append(os.path.dirname(__file__))
import sk_core as C
import sk_materials as M

STYLES = {
    "Blue":      ((0.14, 0.32, 1.0), (0.2, 0.45, 1.0)),
    "Purple":    ((0.42, 0.16, 0.9), (0.5, 0.2, 1.0)),
    "Red":       ((0.9, 0.16, 0.12), (1.0, 0.28, 0.12)),
    "Turquoise": ((0.1, 0.72, 0.7), (0.15, 0.85, 0.8)),
    "Golden":    ((0.95, 0.7, 0.25), (1.0, 0.78, 0.3)),
}

def nebula_volume(name="ENV_Nebula_Blue_01", style="Blue", size=4000.0,
                  density=0.05, seed=611):
    color, emission = STYLES[style]
    bpy.ops.mesh.primitive_cube_add(size=size)
    dom = bpy.context.active_object
    dom.name = name + "_Volume"
    dom.display_type = "WIRE"
    M.assign(dom, M.nebula_volume("MAT_Nebula_%s" % style, color, density,
                                  emission, seed))
    C.REPORT.append(dict(asset=dom.name, verts=8, tris=12,
                         materials=["MAT_Nebula_%s" % style], files=[],
                         seed=seed, notes="dominio volumetrico %.0fm (solo render/bake)" % size))
    return dom

def nebula_billboards(name="ENV_Nebula_Blue_01", style="Blue", planes=26,
                      extent=3500.0, seed=611):
    """Planos orientados al azar con material aditivo: la version de juego."""
    rnd = C.seeded(seed)
    color, emission = STYLES[style]
    col = C.collection(name)
    mat = M.atmosphere("MAT_Nebula_BB_%s" % style, color, 0.5)
    out = []
    for i in range(planes):
        bpy.ops.mesh.primitive_plane_add(size=extent * (0.35 + rnd.random() * 0.8))
        p = bpy.context.active_object
        p.name = "%s_Sheet_%02d" % (name, i + 1)
        a = rnd.random() * math.tau
        r = (rnd.random() ** 0.6) * extent
        p.location = (math.cos(a) * r, math.sin(a) * r * 0.7,
                      (rnd.random() - 0.5) * extent * 0.4)
        p.rotation_euler = (rnd.random() * math.tau,) * 3
        M.assign(p, mat)
        C.link(p, col)
        out.append(p)
    C.export_asset(out, name, "Environment", seed=seed,
                   notes="%d billboards aditivos, extension %.0fm" % (planes, extent))
    return out

def cosmic_dust(name="ENV_CosmicDust_01", planes=14, extent=1800.0, seed=88):
    """Polvo ambiental sutil: da profundidad sin reducir la visibilidad."""
    rnd = C.seeded(seed)
    mat = M.atmosphere("MAT_CosmicDust", (0.35, 0.4, 0.55), 0.12)
    col = C.collection(name)
    out = []
    for i in range(planes):
        bpy.ops.mesh.primitive_plane_add(size=extent * (0.4 + rnd.random() * 0.6))
        p = bpy.context.active_object
        p.name = "%s_Sheet_%02d" % (name, i + 1)
        p.location = ((rnd.random() - 0.5) * extent, (rnd.random() - 0.5) * extent,
                      (rnd.random() - 0.5) * extent * 0.3)
        p.rotation_euler = (rnd.random() * math.tau,) * 3
        M.assign(p, mat)
        C.link(p, col)
        out.append(p)
    C.export_asset(out, name, "Environment", seed=seed, notes="polvo ambiental")
    return out

if __name__ == "__main__":
    C.clean_scene()
    for style in STYLES:
        nebula_volume("ENV_Nebula_%s_01" % style, style)
        nebula_billboards("ENV_Nebula_%s_01" % style, style)
    cosmic_dust()
    C.save_blend("ENV_Nebulas")
    C.write_report()

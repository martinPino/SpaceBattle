"""
generate_planets.py - planetas procedurales (terrestre, desertico, volcanico,
helado, gigante gaseoso, alienigena) + nubes, atmosfera, anillos y LODs.

Escala visual: los planetas se generan con radio de gameplay (no astronomico)
para evitar problemas de precision de coma flotante en Unity.
"""
import bpy, sys, os, math
sys.path.append(os.path.dirname(__file__))
import sk_core as C
import sk_materials as M

def _sphere(radius, subdiv, name):
    ob = C.icosphere(radius, subdiv, name)
    C.uv_sphere_project(ob)
    C.shade_smooth(ob)
    return ob

def displace_terrain(ob, seed, strength=0.02, scale=2.1, ocean_level=0.52):
    """Relieve solo sobre el nivel del mar: los oceanos quedan lisos."""
    radius = max(ob.dimensions) * 0.5
    for v in ob.data.vertices:
        d = v.co.normalized()
        h = C.fbm(d, seed, 6, 2.0, 0.5, scale) * 0.5 + 0.5
        h += C.fbm(d, seed + 91, 4, 2.0, 0.5, scale * 3.6) * 0.12
        land = max(0.0, h - ocean_level)
        v.co = d * (radius * (1.0 + land * strength))
    ob.data.update()
    return ob

def add_clouds(planet, radius, seed, density=0.55, name=None):
    ob = _sphere(radius * 1.012, 5, (name or planet.name) + "_Clouds")
    M.assign(ob, M.clouds("MAT_Clouds_%d" % seed, seed=seed, density=density))
    ob.parent = planet
    return ob

def add_atmosphere(planet, radius, color=(0.28, 0.55, 1.0), density=0.35):
    ob = _sphere(radius * 1.045, 4, planet.name + "_Atmosphere")
    M.assign(ob, M.atmosphere("MAT_Atmosphere_%s" % planet.name, color, density))
    ob.parent = planet
    return ob

def add_rings(planet, radius, seed=3307, ring_count=4):
    """Bandas concentricas con separaciones: nunca un disco solido."""
    rnd = C.seeded(seed)
    rings = []
    r0 = radius * 1.35
    for i in range(ring_count):
        w = radius * (0.1 + rnd.random() * 0.3)
        bpy.ops.mesh.primitive_circle_add(vertices=160, radius=r0 + w,
                                          fill_type="NGON")
        outer = bpy.context.active_object
        bpy.ops.mesh.primitive_circle_add(vertices=160, radius=r0,
                                          fill_type="NGON")
        inner = bpy.context.active_object
        bpy.context.view_layer.objects.active = outer
        bo = outer.modifiers.new("Boolean", "BOOLEAN")
        bo.operation = "DIFFERENCE"
        bo.object = inner
        bpy.ops.object.modifier_apply(modifier=bo.name)
        bpy.data.objects.remove(inner, do_unlink=True)
        outer.name = "%s_Ring_Band_%02d" % (planet.name, i + 1)
        shade = 0.5 + rnd.random() * 0.45
        mat = M.hull("MAT_Ring_Band_%02d" % (i + 1), base="hull_mid",
                     roughness=0.95, metallic=0.1)
        mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (
            shade * 0.62, shade * 0.58, shade * 0.48, 1.0)
        M.assign(outer, mat)
        outer.parent = planet
        rings.append(outer)
        r0 += w + radius * (0.04 + rnd.random() * 0.09)
    return rings

# ------------------------------------------------------------ variantes
def earthlike(name="ENV_Planet_EarthLike_01", seed=4211, radius=600.0,
              ocean_level=0.52, cloud_density=0.55):
    ob = _sphere(radius, 7, name)
    displace_terrain(ob, seed, 0.02, 2.1, ocean_level)
    M.assign(ob, M.planet_surface("MAT_Planet_EarthLike_%d" % seed, seed, ocean_level))
    clouds = add_clouds(ob, radius, seed, cloud_density)
    atmo = add_atmosphere(ob, radius, (0.3, 0.56, 1.0), 0.35)
    lods = C.make_lods(ob, (1.0, 0.3, 0.08), "ENV_Planets")
    C.export_asset(lods + [clouds, atmo], name, "Planets", seed=seed,
                   notes="oceano %.2f, nubes %.2f, atmosfera fresnel" % (ocean_level, cloud_density))
    return lods[0]

def desert(name="ENV_Planet_Desert_01", seed=7781, radius=520.0):
    ob = _sphere(radius, 7, name)
    displace_terrain(ob, seed, 0.03, 2.6, 0.0)
    mat = M.planet_surface("MAT_Planet_Desert_%d" % seed, seed, 0.0)
    cr = mat.node_tree.nodes["Color Ramp"].color_ramp
    cr.elements[0].color = (0.24, 0.13, 0.07, 1)
    cr.elements[1].color = (0.52, 0.32, 0.14, 1)
    M.assign(ob, mat)
    atmo = add_atmosphere(ob, radius, (0.9, 0.62, 0.35), 0.18)
    lods = C.make_lods(ob, (1.0, 0.3, 0.08), "ENV_Planets")
    C.export_asset(lods + [atmo], name, "Planets", seed=seed, notes="desertico")
    return lods[0]

def volcanic(name="ENV_Planet_Volcanic_01", seed=6014, radius=540.0):
    ob = _sphere(radius, 7, name)
    displace_terrain(ob, seed, 0.035, 3.2, 0.0)
    mat = M.rock("MAT_Planet_Volcanic_%d" % seed, tint="rock_dark", seed=seed,
                 mineral="red")
    M.assign(ob, mat)
    atmo = add_atmosphere(ob, radius, (0.9, 0.25, 0.08), 0.22)
    lods = C.make_lods(ob, (1.0, 0.3, 0.08), "ENV_Planets")
    C.export_asset(lods + [atmo], name, "Planets", seed=seed,
                   notes="lava emissive en fracturas")
    return lods[0]

def icy(name="ENV_Planet_Ice_01", seed=1180, radius=480.0):
    ob = _sphere(radius, 7, name)
    displace_terrain(ob, seed, 0.022, 2.4, 0.45)
    mat = M.rock("MAT_Planet_Ice_%d" % seed, tint="rock_ice", seed=seed)
    M.assign(ob, mat)
    atmo = add_atmosphere(ob, radius, (0.45, 0.7, 1.0), 0.2)
    lods = C.make_lods(ob, (1.0, 0.3, 0.08), "ENV_Planets")
    C.export_asset(lods + [atmo], name, "Planets", seed=seed, notes="helado")
    return lods[0]

def gas_giant(name="ENV_Planet_GasGiant_01", seed=9021, radius=900.0,
              tint=(1.0, 0.62, 0.32)):
    ob = _sphere(radius, 6, name)
    M.assign(ob, M.gas_bands("MAT_GasGiant_%d" % seed, seed, tint))
    atmo = add_atmosphere(ob, radius, tuple(min(1.0, c * 1.1) for c in tint), 0.24)
    lods = C.make_lods(ob, (1.0, 0.3, 0.08), "ENV_Planets")
    C.export_asset(lods + [atmo], name, "Planets", seed=seed,
                   notes="bandas + tormenta, sin superficie rocosa")
    return lods[0]

def ringed(name="ENV_Planet_Ringed_01", seed=3307, radius=780.0):
    ob = _sphere(radius, 6, name)
    M.assign(ob, M.gas_bands("MAT_GasGiant_Ringed_%d" % seed, seed, (0.86, 0.8, 0.6)))
    rings = add_rings(ob, radius, seed, ring_count=4)
    atmo = add_atmosphere(ob, radius, (0.95, 0.88, 0.7), 0.2)
    ob.rotation_euler = (0.24, 0.0, 0.0)
    lods = C.make_lods(ob, (1.0, 0.3, 0.08), "ENV_Planets")
    C.export_asset(lods + rings + [atmo], name, "Planets", seed=seed,
                   notes="4 bandas de anillos con separaciones")
    return lods[0]

def moon(name="ENV_Moon_Rocky_01", seed=5150, radius=180.0, kind="Rocky"):
    ob = C.icosphere(radius, 6, name)
    C.deform_rock(ob, seed=seed, terrain_scale=1.3, terrain_strength=0.05,
                  crater_count=48, crater_size=0.3, elongation=(1, 0.98, 1),
                  fractures=0, flats=0)
    C.uv_sphere_project(ob)
    tint = {"Rocky": "rock_grey", "Icy": "rock_ice", "Dark": "rock_dark",
            "Volcanic": "rock_red"}[kind]
    M.assign(ob, M.rock("MAT_Moon_%s" % kind, tint=tint, seed=seed))
    C.apply_transforms(ob)
    lods = C.make_lods(ob, (1.0, 0.35, 0.1), "ENV_Planets")
    col = [C.make_collider(lods[0], ratio=0.03)]
    C.export_asset(lods + col, name, "Planets", seed=seed,
                   notes="luna %s, 48 crateres" % kind)
    return lods[0]

if __name__ == "__main__":
    C.clean_scene()
    earthlike(); gas_giant(); ringed(); moon()
    desert(); volcanic(); icy()
    C.save_blend("ENV_Planets")
    C.write_report()

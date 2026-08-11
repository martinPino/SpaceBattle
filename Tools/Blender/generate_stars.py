"""
generate_stars.py - soles, estrellas cercanas y campo de estrellas de fondo.

El sol NO ilumina la escena en Unity: es un objeto visual (emission alta) y
la luz real se resuelve con una Directional Light orientada desde el sol.
"""
import bpy, sys, os, math
sys.path.append(os.path.dirname(__file__))
import sk_core as C
import sk_materials as M

TINTS = {
    "Yellow": (1.0, 0.78, 0.32),
    "Blue":   (0.55, 0.72, 1.0),
    "Red":    (1.0, 0.32, 0.18),
    "White":  (1.0, 0.96, 0.92),
    "Orange": (1.0, 0.55, 0.2),
}

def star(name=None, kind="Yellow", radius=1200.0, seed=777, prominences=7):
    tint = TINTS[kind]
    name = name or "ENV_Star_%s_01" % kind
    body = C.icosphere(radius, 6, name)
    C.uv_sphere_project(body)
    C.shade_smooth(body)
    M.assign(body, M.star_surface("MAT_Star_%s" % kind, tint, 28.0))

    parts = [body]
    # corona: cascaras aditivas de radio creciente
    for i in range(3):
        shell = C.icosphere(radius * (1.04 + i * 0.16), 4,
                            "%s_Corona_%d" % (name, i + 1))
        mat = M.atmosphere("MAT_Star_Corona_%s_%d" % (kind, i + 1),
                           tuple(c * 0.9 for c in tint), 0.22 - i * 0.06)
        M.assign(shell, mat)
        shell.parent = body
        parts.append(shell)
    # prominencias: arcos de plasma sobre la superficie
    rnd = C.seeded(seed)
    for i in range(prominences):
        bpy.ops.mesh.primitive_torus_add(major_radius=radius * (0.14 + rnd.random() * 0.16),
                                         minor_radius=radius * 0.016,
                                         major_segments=36, minor_segments=8)
        t = bpy.context.active_object
        t.name = "%s_Prominence_%02d" % (name, i + 1)
        d = C.Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1)))
        d.normalize()
        t.location = d * radius * 0.99
        t.rotation_euler = d.to_track_quat("Z", "Y").to_euler()
        M.assign(t, M.emissive("MAT_Star_Prominence_%s" % kind, "accent", 22.0))
        t.parent = body
        parts.append(t)

    light = bpy.data.objects.new("%s_SunLight" % name,
                                 bpy.data.lights.new("%s_Sun" % name, "SUN"))
    light.data.energy = 4.0
    light.data.color = tint
    light.parent = body
    bpy.context.scene.collection.objects.link(light)

    C.export_asset(parts, name, "Stars", seed=seed,
                   notes="granulacion, manchas, corona 3 capas, %d prominencias" % prominences)
    return body

def background_starfield(name="ENV_StarField_Near", seed=31, count=400,
                         radius=8000.0):
    """Estrellas cercanas visibles como puntos: un mesh de vertices sueltos
    para renderizar con shader de puntos / billboards en Unity.
    Las miles de estrellas lejanas van en el skybox, no como geometria."""
    rnd = C.seeded(seed)
    me = bpy.data.meshes.new(name + "_mesh")
    verts = []
    for _ in range(count):
        u = rnd.uniform(-1, 1)
        a = rnd.random() * math.tau
        r2 = math.sqrt(max(0.0, 1 - u * u))
        verts.append((math.cos(a) * r2 * radius, math.sin(a) * r2 * radius, u * radius))
    me.from_pydata(verts, [], [])
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    C.REPORT.append(dict(asset=name, verts=count, tris=0, materials=[],
                         files=[], seed=seed,
                         notes="%d puntos para billboards/VFX Graph" % count))
    return ob

if __name__ == "__main__":
    C.clean_scene()
    star(kind="Yellow")
    for k in ("Blue", "Red", "White", "Orange"):
        C.clean_scene()
        star(kind=k)
    C.clean_scene()
    background_starfield()
    C.save_blend("ENV_Stars")
    C.write_report()

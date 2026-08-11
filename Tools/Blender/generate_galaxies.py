"""
generate_galaxies.py - galaxias lejanas.

Nunca millones de objetos: cada galaxia es un disco de particulas (mesh de
vertices para VFX Graph / billboards) + nucleo luminoso + halo de polvo en
billboard, para verse a enorme distancia sin coste.
"""
import bpy, sys, os, math
sys.path.append(os.path.dirname(__file__))
import sk_core as C
import sk_materials as M

TYPES = ("Spiral", "Barred", "Elliptical", "Irregular")

def galaxy(name="ENV_Galaxy_Spiral_01", kind="Spiral", seed=811,
           radius=6000.0, points=6000, arms=2):
    rnd = C.seeded(seed)
    verts = []
    for i in range(points):
        t = rnd.random()
        if kind == "Elliptical":
            r = radius * (t ** 0.6)
            a = rnd.random() * math.tau
            z = rnd.gauss(0, 0.25) * radius * 0.35
        elif kind == "Irregular":
            r = radius * (t ** 0.5)
            a = rnd.random() * math.tau
            a += C.fbm((math.cos(a), math.sin(a), t), seed, 3) * 2.4
            z = rnd.gauss(0, 0.12) * radius * 0.3
        else:
            arm = i % max(1, arms)
            r = radius * (0.08 + (t ** 0.75) * 0.92)
            twist = 2.2 if kind == "Spiral" else 1.4
            a = arm * math.tau / max(1, arms) + (r / radius) * math.tau * twist
            a += rnd.gauss(0, 0.16)
            if kind == "Barred" and r < radius * 0.3:
                a += 0.5
            z = rnd.gauss(0, 0.05) * radius * (0.2 if r > radius * 0.25 else 0.4)
        verts.append((math.cos(a) * r, math.sin(a) * r, z))
    me = bpy.data.meshes.new(name + "_mesh")
    me.from_pydata(verts, [], [])
    me.update()
    stars = bpy.data.objects.new(name + "_Stars", me)
    bpy.context.scene.collection.objects.link(stars)

    bpy.ops.mesh.primitive_uv_sphere_add(radius=radius * 0.11, segments=24,
                                         ring_count=14)
    core = bpy.context.active_object
    core.name = name + "_Core"
    core.scale = (1, 1, 0.55)
    C.apply_transforms(core)
    M.assign(core, M.star_surface("MAT_Galaxy_Core", (1.0, 0.88, 0.62), 6.0))

    bpy.ops.mesh.primitive_plane_add(size=radius * 2.3)
    halo = bpy.context.active_object
    halo.name = name + "_Halo"
    M.assign(halo, M.atmosphere("MAT_Galaxy_Halo", (0.45, 0.55, 0.9), 0.3))

    root = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(root)
    for o in (stars, core, halo):
        o.parent = root
    C.export_asset([root, core, halo], name, "Environment", seed=seed,
                   notes="%s: %d puntos + nucleo + halo billboard" % (kind, points))
    return root

def black_hole(name="ENV_BlackHole_01", seed=999, radius=140.0):
    parts = []
    bpy.ops.mesh.primitive_uv_sphere_add(radius=radius, segments=48, ring_count=24)
    horizon = bpy.context.active_object
    horizon.name = name + "_EventHorizon"
    mat = M.hull("MAT_BlackHole_Horizon", "hull_black", 1.0, 0.0)
    mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0, 0, 0, 1)
    M.assign(horizon, mat)
    parts.append(horizon)
    for i in range(3):
        bpy.ops.mesh.primitive_torus_add(major_radius=radius * (2.2 + i * 0.9),
                                         minor_radius=radius * (0.5 - i * 0.12),
                                         major_segments=72, minor_segments=16)
        disc = bpy.context.active_object
        disc.name = "%s_AccretionDisc_%d" % (name, i + 1)
        disc.scale = (1, 1, 0.08)
        C.apply_transforms(disc)
        M.assign(disc, M.star_surface("MAT_Accretion_%d" % (i + 1),
                                      (1.0, 0.62 - i * 0.14, 0.2), 22.0 - i * 6))
        parts.append(disc)
    root = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(root)
    for p in parts:
        p.parent = root
    empties = [C.empty("LensingFX_Center", (0, 0, 0), (0, 1, 0), 12.0, root)]
    C.export_asset([root] + parts + empties, name, "Environment", seed=seed,
                   notes="horizonte + 3 discos de acrecion para shader de distorsion")
    return root

if __name__ == "__main__":
    C.clean_scene()
    galaxy("ENV_Galaxy_Spiral_01", "Spiral", 811, arms=2)
    galaxy("ENV_Galaxy_Spiral_02", "Spiral", 812, arms=4)
    galaxy("ENV_Galaxy_Barred_01", "Barred", 813)
    galaxy("ENV_Galaxy_Elliptical_01", "Elliptical", 814)
    galaxy("ENV_Galaxy_Irregular_01", "Irregular", 815)
    black_hole()
    C.save_blend("ENV_Galaxies")
    C.write_report()

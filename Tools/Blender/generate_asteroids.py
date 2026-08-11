"""
generate_asteroids.py - sistema procedural de asteroides y campos.

Uso:
  blender --background --python Tools/Blender/generate_asteroids.py
  blender --background --python Tools/Blender/generate_asteroids.py -- --only medium
"""
import bpy, sys, os, math, random, zlib
sys.path.append(os.path.dirname(__file__))
import sk_core as C
import sk_materials as M

CLASSES = {                     # clase: (radio_m, subdiv, crateres, flats)
    "Small":  ((1.0, 5.0), 3, 8, 4),
    "Medium": ((10.0, 30.0), 5, 16, 3),
    "Large":  ((50.0, 150.0), 6, 34, 6),
    "Giant":  ((300.0, 1000.0), 7, 60, 8),
}
TYPES = {                       # tipo: (material, mineral emissive)
    "Rocky":     ("rock_grey", None),
    "Dark":      ("rock_dark", None),
    "Red":       ("rock_red", None),
    "Metallic":  ("rock_grey", None),
    "Icy":       ("rock_ice", None),
    "Mineral":   ("rock_dark", "cyan"),
}

def build_asteroid(name, seed, radius, subdiv, crater_count, flats,
                   kind="Rocky", elongation=None):
    rnd = C.seeded(seed)
    elong = elongation or (1.0,
                           0.62 + rnd.random() * 0.45,
                           0.85 + rnd.random() * 0.6)
    ob = C.icosphere(radius, subdiv, name)
    C.deform_rock(ob, seed=seed, terrain_scale=1.0 + rnd.random() * 0.5,
                  terrain_strength=0.22 + rnd.random() * 0.12,
                  crater_count=crater_count,
                  crater_size=0.3 + rnd.random() * 0.18,
                  elongation=elong,
                  fractures=1 + int(rnd.random() * 4), flats=flats)
    C.uv_sphere_project(ob)
    tint, mineral = TYPES[kind]
    mat = M.rock("MAT_Rock_%s" % kind, tint=tint, seed=seed, mineral=mineral)
    if kind == "Metallic":
        mat.node_tree.nodes["Principled BSDF"].inputs["Metallic"].default_value = 0.55
    M.assign(ob, mat)
    C.apply_transforms(ob)
    C.set_origin_center(ob)
    return ob

def generate(only=None):
    col = C.collection("ENV_Asteroids")
    made = []
    plan = [
        ("Small", 10, "Rocky"), ("Medium", 10, "Rocky"),
        ("Large", 10, "Dark"), ("Giant", 5, "Dark"),
    ]
    for cls, count, default_kind in plan:
        if only and only.lower() != cls.lower():
            continue
        (rmin, rmax), subdiv, craters, flats = CLASSES[cls]
        for i in range(1, count + 1):
            # crc32 estable entre procesos (hash() de Python va salteado y rompía el determinismo)
            seed = zlib.crc32(("%s:%d" % (cls, i)).encode()) & 0xFFFF
            rnd = C.seeded(seed)
            kind = default_kind
            if i % 5 == 0:
                kind = "Metallic"
            if i % 7 == 0:
                kind = "Icy"
            radius = rmin + (rmax - rmin) * rnd.random()
            name = "ENV_Asteroid_%s_%02d" % (cls, i)
            ob = build_asteroid(name, seed, radius, subdiv, craters, flats, kind)
            lods = C.make_lods(ob, (1.0, 0.4, 0.14), "ENV_Asteroids")
            colliders = [C.make_collider(lods[0],
                         ratio=0.04 if cls in ("Large", "Giant") else 0.12)]
            for o in colliders:
                C.link(o, col)
            C.export_asset(lods + colliders, name, "Asteroids", seed=seed,
                           notes="%s %s r=%.1fm" % (cls, kind, radius))
            made.append(name)
    # variantes especiales del brief
    for name, kind, radius, seed in (
            ("ENV_Asteroid_Mineral_01", "Mineral", 38.0, 4242),
            ("ENV_Asteroid_Ice_01", "Icy", 26.0, 909),
            ("ENV_Asteroid_Volcanic_01", "Red", 44.0, 7311)):
        if only:
            break
        ob = build_asteroid(name, seed, radius, 6, 30, 6, kind)
        lods = C.make_lods(ob, (1.0, 0.4, 0.14), "ENV_Asteroids")
        colliders = [C.make_collider(lods[0], ratio=0.05)]
        for o in colliders:
            C.link(o, col)
        C.export_asset(lods + colliders, name, "Asteroids", seed=seed,
                       notes="variante especial %s" % kind)
        made.append(name)
    return made

def asteroid_field(name="ENV_AsteroidField_01", seed=2024, count=60,
                   radius=800.0, thickness=0.22, size_min=2.0, size_max=24.0,
                   separation=1.35):
    """Instancias (linked duplicates) de 4 prototipos -> 1 draw call por proto
    con GPU instancing en Unity. Distribucion irregular, sin patron visible."""
    rnd = C.seeded(seed)
    col = C.collection(name)
    protos = []
    for i in range(4):
        p = build_asteroid("%s_Proto_%d" % (name, i), seed + i * 977, 1.0, 4,
                           8, 4, ["Rocky", "Dark", "Rocky", "Metallic"][i])
        p.hide_set(True)
        C.link(p, col)
        protos.append(p)
    placed = []
    tries = 0
    while len(placed) < count and tries < count * 40:
        tries += 1
        a = rnd.random() * math.tau
        rr = radius * (0.2 + (rnd.random() ** 0.7) * 0.8)
        pos = (math.cos(a) * rr,
               math.sin(a) * rr * 0.75,
               (rnd.random() - 0.5) * radius * thickness)
        size = size_min + (rnd.random() ** 2.2) * (size_max - size_min)
        if any((abs(pos[0] - q[0][0]) ** 2 + abs(pos[1] - q[0][1]) ** 2 +
                abs(pos[2] - q[0][2]) ** 2) < ((size + q[1]) * separation) ** 2
               for q in placed):
            continue
        placed.append((pos, size))
        src = protos[len(placed) % 4]
        inst = src.copy()                      # linked: comparte la malla
        inst.name = "%s_Rock_%02d" % (name, len(placed))
        inst.location = pos
        inst.scale = (size, size, size)
        inst.rotation_euler = (rnd.random() * math.tau,) * 3
        inst.hide_set(False)
        bpy.context.scene.collection.objects.link(inst)
        C.link(inst, col)
    C.REPORT.append(dict(asset=name, verts=0, tris=0,
                         materials=["MAT_Rock_Rocky", "MAT_Rock_Dark"],
                         files=[], seed=seed,
                         notes="%d instancias, radio %.0fm, 4 prototipos" % (len(placed), radius)))
    return col

if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    only = argv[argv.index("--only") + 1] if "--only" in argv else None
    C.clean_scene()
    generate(only)
    asteroid_field()
    C.save_blend("ENV_Asteroids")
    C.write_report()

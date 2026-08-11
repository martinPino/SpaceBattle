"""
generate_space_station.py - estacion modular + satelites, balizas, portales
y restos espaciales. Cada modulo se exporta por separado para poder combinar
estaciones distintas desde Unity.
"""
import bpy, sys, os, math
sys.path.append(os.path.dirname(__file__))
import sk_core as C
import sk_materials as M
from generate_player_ship import prism

def _mats():
    return dict(
        dark=M.hull("MAT_Hull_Dark", "hull_dark", 0.46, 0.85, 12.0, 0.35),
        mid=M.hull("MAT_Hull_Mid", "hull_mid", 0.36, 0.8, 14.0, 0.3),
        light=M.hull("MAT_Hull_Light", "hull_light", 0.4, 0.35, 16.0, 0.25),
        black=M.hull("MAT_Hull_Black", "hull_black", 0.6, 0.7, 20.0, 0.4),
        cyan=M.emissive("MAT_Emissive_Cyan", "cyan", 10.0),
        amber=M.emissive("MAT_Emissive_Amber", "accent", 9.0),
    )

MODULES = {}

def module(fn):
    MODULES[fn.__name__] = fn
    return fn

@module
def Station_Core(m, size=40.0):
    bits = [prism(size * 0.35, size * 0.35, size, 12, "Core_Drum", (0, 0, 0)),
            prism(size * 0.4, size * 0.4, size * 0.12, 12, "Core_CollarA", (0, size * 0.4, 0)),
            prism(size * 0.4, size * 0.4, size * 0.12, 12, "Core_CollarB", (0, -size * 0.4, 0))]
    for b in bits[:1]:
        M.assign(b, m["dark"])
    for b in bits[1:]:
        M.assign(b, m["mid"])
    return C.join(bits, "Station_Core")

@module
def Station_Habitat(m, size=26.0):
    bpy.ops.mesh.primitive_torus_add(major_radius=size, minor_radius=size * 0.14,
                                     major_segments=48, minor_segments=12)
    ring = bpy.context.active_object
    ring.name = "Station_Habitat"
    M.assign(ring, m["light"])
    spokes = []
    for i in range(4):
        a = i * math.pi / 2
        sp = prism(1.2, 1.2, size, 6, "Habitat_Spoke_%d" % (i + 1), (0, 0, 0))
        sp.rotation_euler = (0, 0, a)
        sp.location = (math.cos(a) * size * 0.5, math.sin(a) * size * 0.5, 0)
        C.apply_transforms(sp)
        M.assign(sp, m["mid"])
        spokes.append(sp)
    return C.join([ring] + spokes, "Station_Habitat")

@module
def Station_Docking(m, size=18.0):
    bits = [prism(size * 0.2, size * 0.3, size, 8, "Dock_Arm", (0, 0, 0))]
    for i in (-1, 1):
        c = prism(size * 0.16, size * 0.16, size * 0.3, 8, "Dock_Clamp_%d" % (i + 2),
                  (i * size * 0.28, size * 0.4, 0))
        M.assign(c, m["black"])
        bits.append(c)
        bpy.ops.mesh.primitive_cube_add(size=1.0,
                                        location=(i * size * 0.28, size * 0.56, 0))
        lamp = bpy.context.active_object
        lamp.name = "Dock_Light_%d" % (i + 2)
        lamp.scale = (0.6, 0.2, 0.2)
        C.apply_transforms(lamp)
        M.assign(lamp, m["cyan"])
        bits.append(lamp)
    M.assign(bits[0], m["mid"])
    return C.join(bits, "Station_Docking")

@module
def Station_Hangar(m, size=30.0):
    bpy.ops.mesh.primitive_cube_add(size=1.0)
    box = bpy.context.active_object
    box.name = "Hangar_Shell"
    box.scale = (size * 0.6, size, size * 0.35)
    C.apply_transforms(box)
    M.assign(box, m["dark"])
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, size * 0.5, 0))
    mouth = bpy.context.active_object
    mouth.name = "Hangar_Mouth"
    mouth.scale = (size * 0.45, 0.4, size * 0.2)
    C.apply_transforms(mouth)
    M.assign(mouth, m["cyan"])
    return C.join([box, mouth], "Station_Hangar")

@module
def Station_Antenna(m, size=14.0):
    bits = [prism(0.2, 0.5, size, 6, "Antenna_Mast", (0, 0, 0))]
    bpy.ops.mesh.primitive_cone_add(vertices=24, radius1=size * 0.3, radius2=0.1,
                                    depth=size * 0.25,
                                    location=(0, size * 0.6, 0),
                                    rotation=(math.pi / 2, 0, 0))
    dish = bpy.context.active_object
    dish.name = "Antenna_Dish"
    M.assign(dish, m["light"])
    M.assign(bits[0], m["mid"])
    bits.append(dish)
    return C.join(bits, "Station_Antenna")

@module
def Station_SolarPanel(m, size=24.0):
    bpy.ops.mesh.primitive_cube_add(size=1.0)
    p = bpy.context.active_object
    p.name = "Solar_Wing"
    p.scale = (size, size * 0.35, 0.12)
    C.apply_transforms(p)
    M.assign(p, m["black"])
    arm = prism(0.3, 0.3, size * 0.5, 6, "Solar_Arm", (0, 0, 0))
    M.assign(arm, m["mid"])
    return C.join([p, arm], "Station_SolarPanel")

@module
def Station_Cargo(m, size=12.0):
    bits = []
    for i in range(3):
        bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, 0, i * size * 0.42))
        b = bpy.context.active_object
        b.name = "Cargo_Pod_%d" % (i + 1)
        b.scale = (size * 0.4, size, size * 0.4)
        C.apply_transforms(b)
        M.assign(b, m["mid" if i % 2 else "dark"])
        bits.append(b)
    return C.join(bits, "Station_Cargo")

@module
def Station_Connector(m, size=16.0):
    bits = [prism(1.4, 1.4, size, 8, "Connector_Tube", (0, 0, 0))]
    for i in range(4):
        r = prism(1.8, 1.8, size * 0.06, 8, "Connector_Rib_%d" % (i + 1),
                  (0, -size * 0.4 + i * size * 0.26, 0))
        M.assign(r, m["light"])
        bits.append(r)
    M.assign(bits[0], m["dark"])
    return C.join(bits, "Station_Connector")

@module
def Station_Tower(m, size=34.0):
    bits = [prism(1.0, 2.4, size, 6, "Tower_Mast", (0, 0, 0))]
    for i in range(3):
        bpy.ops.mesh.primitive_cube_add(size=1.0,
                                        location=(0, -size * 0.2 + i * size * 0.3, 0))
        d = bpy.context.active_object
        d.name = "Tower_Deck_%d" % (i + 1)
        d.scale = (4.5 - i, 0.6, 4.5 - i)
        C.apply_transforms(d)
        M.assign(d, m["mid"])
        bits.append(d)
    M.assign(bits[0], m["dark"])
    return C.join(bits, "Station_Tower")

def station_01(name="PROP_SpaceStation_01", seed=5001):
    """Estacion completa: nucleo + habitat + muelles + hangar + antenas."""
    m = _mats()
    col = C.collection("PROP_Stations")
    root = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(root)
    layout = [
        ("Station_Core", (0, 0, 0), (0, 0, 0), 1.0),
        ("Station_Habitat", (0, 0, -30), (math.pi / 2, 0, 0), 1.0),
        ("Station_Connector", (0, 0, -18), (math.pi / 2, 0, 0), 1.0),
        ("Station_Hangar", (0, 46, -6), (0, 0, 0), 1.0),
        ("Station_Docking", (34, 8, 0), (0, 0, -math.pi / 2), 1.0),
        ("Station_Docking", (-34, 8, 0), (0, 0, math.pi / 2), 1.0),
        ("Station_SolarPanel", (0, -14, 34), (math.pi / 2, 0, 0), 1.0),
        ("Station_SolarPanel", (0, -14, -34), (math.pi / 2, 0, 0), 1.0),
        ("Station_Antenna", (10, -26, 12), (-0.4, 0, 0.3), 1.0),
        ("Station_Tower", (0, 0, 36), (math.pi / 2, 0, 0), 1.0),
        ("Station_Cargo", (26, -20, -10), (0, 0, 0.4), 1.0),
    ]
    parts = []
    for i, (mod, loc, rot, sc) in enumerate(layout):
        ob = MODULES[mod](m)
        ob.name = "%s_%s_%02d" % (name, mod.replace("Station_", ""), i + 1)
        ob.location = loc
        ob.rotation_euler = rot
        ob.scale = (sc, sc, sc)
        C.apply_transforms(ob)
        C.uv_smart(ob)
        ob.parent = root
        C.link(ob, col)
        parts.append(ob)
    # luces de navegacion de la estacion
    for i, loc in enumerate(((0, 50, -6), (36, 8, 0), (-36, 8, 0), (0, 0, 40))):
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.7, segments=10, ring_count=6,
                                             location=loc)
        l = bpy.context.active_object
        l.name = "%s_NavLight_%02d" % (name, i + 1)
        M.assign(l, m["amber"] if i % 2 else m["cyan"])
        l.parent = root
        C.link(l, col)
        parts.append(l)
    empties = [C.empty("DockPoint_A", (44, 8, 0), (1, 0, 0), 2.0, root),
               C.empty("DockPoint_B", (-44, 8, 0), (-1, 0, 0), 2.0, root),
               C.empty("HangarEntry", (0, 56, -6), (0, 1, 0), 3.0, root),
               C.empty("CameraTarget", (0, 0, 0), (0, 1, 0), 3.0, root)]
    lods = C.make_lods(parts[0], (1.0, 0.4, 0.15), "PROP_Stations")
    colliders = [C.make_collider(p, ratio=0.05) for p in parts[:6]]
    for c in colliders:
        c.parent = root
        C.link(c, col)
    C.export_asset([root] + parts + empties + colliders, name, "Stations",
                   seed=seed, notes="11 modulos combinables, %d colliders" % len(colliders))
    return root

def satellite(name="PROP_Satellite_Comms_01", seed=5100, kind="Comms"):
    m = _mats()
    col = C.collection("PROP_Satellites")
    body = prism(0.9, 1.1, 3.2, 6, "Sat_Body", (0, 0, 0))
    M.assign(body, m["dark"])
    parts = [body]
    for side in (1, -1):
        bpy.ops.mesh.primitive_cube_add(size=1.0, location=(side * 3.4, 0, 0))
        p = bpy.context.active_object
        p.name = "Sat_Panel_%s" % ("R" if side > 0 else "L")
        p.scale = (4.6, 1.6, 0.08)
        C.apply_transforms(p)
        M.assign(p, m["black"])
        parts.append(p)
    if kind == "Comms":
        bpy.ops.mesh.primitive_cone_add(vertices=24, radius1=1.3, radius2=0.1,
                                        depth=0.9, location=(0, 1.9, 0),
                                        rotation=(math.pi / 2, 0, 0))
        dish = bpy.context.active_object
        dish.name = "Sat_Dish"
        M.assign(dish, m["light"])
        parts.append(dish)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.18, segments=10, ring_count=6,
                                         location=(0, -1.8, 0.4))
    beacon = bpy.context.active_object
    beacon.name = "Sat_Beacon"
    M.assign(beacon, m["cyan"])
    parts.append(beacon)
    root = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(root)
    for p in parts:
        p.parent = root
        C.uv_smart(p)
        C.link(p, col)
    C.export_asset([root] + parts, name, "Props", seed=seed,
                   notes="satelite %s con paneles y baliza" % kind)
    return root

def warp_gate(name="PROP_WarpGate_01", seed=5200, radius=90.0):
    m = _mats()
    col = C.collection("PROP_Gates")
    parts = []
    bpy.ops.mesh.primitive_torus_add(major_radius=radius, minor_radius=radius * 0.09,
                                     major_segments=64, minor_segments=16)
    ring = bpy.context.active_object
    ring.name = "Gate_Ring"
    M.assign(ring, m["dark"])
    parts.append(ring)
    for i in range(6):
        a = i * math.tau / 6
        bpy.ops.mesh.primitive_cube_add(size=1.0,
                                        location=(math.cos(a) * radius,
                                                  math.sin(a) * radius, 0))
        pod = bpy.context.active_object
        pod.name = "Gate_Pod_%02d" % (i + 1)
        pod.scale = (radius * 0.09, radius * 0.09, radius * 0.16)
        pod.rotation_euler = (0, 0, a)
        C.apply_transforms(pod)
        M.assign(pod, m["mid"])
        parts.append(pod)
        bpy.ops.mesh.primitive_cube_add(size=1.0,
                                        location=(math.cos(a) * radius * 0.86,
                                                  math.sin(a) * radius * 0.86, 0))
        gl = bpy.context.active_object
        gl.name = "Gate_Glow_%02d" % (i + 1)
        gl.scale = (radius * 0.05, radius * 0.05, radius * 0.02)
        gl.rotation_euler = (0, 0, a)
        C.apply_transforms(gl)
        M.assign(gl, m["cyan"])
        parts.append(gl)
    root = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(root)
    for p in parts:
        p.parent = root
        C.uv_smart(p)
        C.link(p, col)
    empties = [C.empty("WarpFX_Center", (0, 0, 0), (0, 1, 0), 6.0, root)]
    C.export_asset([root] + parts + empties, name, "Props", seed=seed,
                   notes="portal r=%.0fm, zona central para VFX" % radius)
    return root

def beacon(name="PROP_NavigationBeacon_01", seed=5300, color="cyan"):
    m = _mats()
    col = C.collection("PROP_Beacons")
    mast = prism(0.3, 0.5, 6.0, 6, "Beacon_Mast", (0, 0, 0))
    M.assign(mast, m["mid"])
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.9, segments=16, ring_count=10,
                                         location=(0, 3.6, 0))
    lamp = bpy.context.active_object
    lamp.name = "Beacon_Lamp"
    M.assign(lamp, M.emissive("MAT_Beacon_%s" % color, color, 16.0))
    parts = [mast, lamp]
    root = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(root)
    for p in parts:
        p.parent = root
        C.uv_smart(p)
        C.link(p, col)
    C.export_asset([root] + parts, name, "Props", seed=seed, notes="baliza %s" % color)
    return root

def debris_field(name="ENV_DebrisField_01", seed=6100, count=40, radius=260.0):
    """DebrisFieldGenerator: paneles, motores destruidos, fuselajes, cajas."""
    m = _mats()
    rnd = C.seeded(seed)
    col = C.collection(name)
    protos = []
    for i, kind in enumerate(("Panel", "Engine", "Fuselage", "Container", "Antenna")):
        if kind == "Panel":
            bpy.ops.mesh.primitive_cube_add(size=1.0)
            ob = bpy.context.active_object
            ob.scale = (3.2, 2.4, 0.14)
        elif kind == "Engine":
            ob = prism(0.9, 1.1, 2.6, 10, "d", (0, 0, 0))
        elif kind == "Fuselage":
            ob = prism(1.4, 1.0, 4.4, 6, "d", (0, 0, 0))
        elif kind == "Container":
            bpy.ops.mesh.primitive_cube_add(size=1.0)
            ob = bpy.context.active_object
            ob.scale = (1.4, 2.6, 1.4)
        else:
            ob = prism(0.14, 0.3, 5.0, 6, "d", (0, 0, 0))
        ob.name = "%s_Proto_%s" % (name, kind)
        C.apply_transforms(ob)
        M.assign(ob, m["dark"] if i % 2 else m["mid"])
        C.uv_smart(ob)
        ob.hide_set(True)
        C.link(ob, col)
        protos.append(ob)
    for i in range(count):
        src = protos[i % len(protos)]
        inst = src.copy()
        inst.name = "%s_Piece_%02d" % (name, i + 1)
        a = rnd.random() * math.tau
        r = radius * (0.2 + (rnd.random() ** 0.7) * 0.8)
        inst.location = (math.cos(a) * r, math.sin(a) * r * 0.8,
                         (rnd.random() - 0.5) * radius * 0.25)
        inst.rotation_euler = (rnd.random() * math.tau,) * 3
        s = 0.5 + rnd.random() * 2.0
        inst.scale = (s, s, s)
        inst.hide_set(False)
        bpy.context.scene.collection.objects.link(inst)
        C.link(inst, col)
    C.REPORT.append(dict(asset=name, verts=0, tris=0, materials=["MAT_Hull_Dark"],
                         files=[], seed=seed,
                         notes="%d instancias de 5 prototipos" % count))
    return col

def comet(name="ENV_Comet_01", seed=6200, radius=18.0, tail=900.0):
    m = _mats()
    col = C.collection("ENV_Comets")
    nucleus = C.icosphere(radius, 5, name + "_Nucleus")
    C.deform_rock(nucleus, seed=seed, terrain_strength=0.3, crater_count=12,
                  crater_size=0.35, elongation=(1.0, 0.8, 1.1), fractures=2, flats=3)
    C.uv_sphere_project(nucleus)
    M.assign(nucleus, M.rock("MAT_Rock_Ice", tint="rock_ice", seed=seed))
    parts = [nucleus]
    # colas: planos aditivos que se estrechan (polvo + ion)
    for i, (w, tint, dens) in enumerate(((radius * 4.0, (0.7, 0.75, 0.85), 0.35),
                                         (radius * 2.2, (0.35, 0.7, 1.0), 0.5))):
        bpy.ops.mesh.primitive_plane_add(size=1.0)
        p = bpy.context.active_object
        p.name = "%s_Tail_%s" % (name, "Dust" if i == 0 else "Ion")
        p.scale = (w, tail, 1.0)
        p.location = (0, -tail * 0.5, 0)
        p.rotation_euler = (math.pi / 2 if i else 0, 0, 0)
        C.apply_transforms(p)
        M.assign(p, M.atmosphere("MAT_Comet_Tail_%d" % (i + 1), tint, dens))
        parts.append(p)
    root = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(root)
    for p in parts:
        p.parent = root
        C.link(p, col)
    empties = [C.empty("FX_TailEmitter", (0, -radius, 0), (0, -1, 0), 4.0, root)]
    C.export_asset([root] + parts + empties, name, "Environment", seed=seed,
                   notes="nucleo helado r=%.0fm + 2 colas" % radius)
    return root

if __name__ == "__main__":
    C.clean_scene()
    station_01()
    C.save_blend("PROP_SpaceStation_01")
    C.clean_scene()
    satellite(); warp_gate(); beacon(); debris_field(); comet()
    C.save_blend("PROP_Environment")
    C.write_report()

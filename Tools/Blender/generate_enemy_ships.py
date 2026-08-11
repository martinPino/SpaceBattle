"""
generate_enemy_ships.py - flota enemiga con el mismo lenguaje visual que el
jugador pero emissive rojo/naranja: interceptor ligero, caza, nave pesada,
bombardero, carguero, minera y patrulla.

Comparten el kit de piezas de generate_player_ship.prism() para que la
silueta pertenezca al mismo universo.
"""
import bpy, sys, os, math
sys.path.append(os.path.dirname(__file__))
import sk_core as C
import sk_materials as M
from generate_player_ship import prism

def _base_materials():
    return dict(
        dark=M.hull("MAT_Hull_Dark", "hull_dark", 0.46, 0.85, 16.0, 0.45),
        mid=M.hull("MAT_Hull_Mid", "hull_mid", 0.36, 0.8, 20.0, 0.4),
        black=M.hull("MAT_Hull_Black", "hull_black", 0.6, 0.7, 26.0, 0.5),
        glass=M.glass(),
        red=M.emissive("MAT_Emissive_Red", "red", 12.0),
        core=M.emissive("MAT_Emissive_EngineCore_Red", "red", 24.0),
    )

def interceptor(name="SHIP_Enemy_Interceptor_01", seed=2001, length=8.0):
    """Mas pequeno, mas afilado, menos blindaje, silueta amenazante."""
    m = _base_materials()
    col = C.collection("SHIP_Enemies")
    s = length / 12.0
    bits = [
        prism(0.12, 0.62, 4.4 * s, 4, "Body_Spear", (0, 2.6 * s, 0), 0.9, 0.5, math.pi / 4),
        prism(0.62, 0.80, 3.0 * s, 6, "Body_Core", (0, -0.4 * s, 0), 1.1, 0.55),
        prism(0.80, 0.55, 1.6 * s, 6, "Body_Tail", (0, -2.6 * s, 0), 1.0, 0.5),
    ]
    for b in bits:
        M.assign(b, m["dark"])
    body = C.join(bits, "Ship_Body")
    parts = [body]
    # alas en flecha invertida, muy afiladas
    for side in (1, -1):
        pts = [(0.5, 1.6), (2.9, -1.2), (2.6, -1.9), (0.5, -1.4)]
        me = bpy.data.meshes.new("wing")
        verts = [(side * x * s, y * s, 0.0) for (x, y) in pts]
        me.from_pydata(verts, [], [[0, 1, 2, 3]])
        me.update()
        ob = bpy.data.objects.new("Wing_R" if side > 0 else "Wing_L", me)
        bpy.context.scene.collection.objects.link(ob)
        bpy.context.view_layer.objects.active = ob
        sol = ob.modifiers.new("Solidify", "SOLIDIFY")
        sol.thickness = 0.16
        bpy.ops.object.modifier_apply(modifier=sol.name)
        ob.rotation_euler = (0, side * 0.5, 0)
        C.apply_transforms(ob)
        M.assign(ob, m["mid"])
        parts.append(ob)
        eng = prism(0.42, 0.46, 1.9 * s, 10, "Engine_R" if side > 0 else "Engine_L",
                    (side * 0.95 * s, -2.4 * s, 0), 1.0, 1.0)
        M.assign(eng, m["black"])
        parts.append(eng)
        bpy.ops.mesh.primitive_cylinder_add(radius=0.3 * s, depth=0.16,
                                            rotation=(math.pi / 2, 0, 0),
                                            location=(side * 0.95 * s, -3.35 * s, 0))
        cm = bpy.context.active_object
        cm.name = ("Engine_R" if side > 0 else "Engine_L") + "_Core"
        M.assign(cm, m["core"])
        parts.append(cm)
    # cabina pequena y oscura
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.46 * s, segments=20, ring_count=10,
                                         location=(0, 1.2 * s, 0.28 * s))
    canopy = bpy.context.active_object
    canopy.name = "Cockpit"
    canopy.scale = (0.8, 1.5, 0.55)
    C.apply_transforms(canopy)
    M.assign(canopy, m["glass"])
    parts.append(canopy)
    # un solo canon bajo el morro + franja emissive roja
    gun = prism(0.1, 0.16, 2.4 * s, 8, "Weapon_C", (0, 2.2 * s, -0.35 * s))
    M.assign(gun, m["mid"])
    parts.append(gun)
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, 0.2 * s, 0.42 * s))
    strip = bpy.context.active_object
    strip.name = "Emissive_Strip"
    strip.scale = (0.08 * s, 1.6 * s, 0.04 * s)
    C.apply_transforms(strip)
    M.assign(strip, m["red"])
    parts.append(strip)

    root = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(root)
    for p in parts:
        p.parent = root
        C.uv_smart(p)
        C.link(p, col)
    C.link(root, col)
    markers = {
        "FX_Engine_L": ((-0.95 * s, -3.5 * s, 0), (0, -1, 0)),
        "FX_Engine_R": ((0.95 * s, -3.5 * s, 0), (0, -1, 0)),
        "Muzzle_C": ((0, 3.5 * s, -0.35 * s), (0, 1, 0)),
        "CameraTarget": ((0, -1.0 * s, 0.7 * s), (0, 1, 0)),
        "TargetPoint": ((0, 0, 0), (0, 1, 0)),
    }
    empties = [C.empty(k, loc, look, 0.3, root) for k, (loc, look) in markers.items()]
    collider = C.make_collider(body, ratio=0.1, name=name + "_Collider")
    collider.parent = root
    C.export_asset([root] + parts + empties + [collider], name, "Ships",
                   seed=seed, notes="interceptor enemigo %.0fm, emissive rojo" % length)
    return root

def heavy(name="SHIP_Enemy_Heavy_01", seed=2002, length=30.0):
    """2-3x el jugador: fuselaje pesado, blindaje visible, varias torretas."""
    m = _base_materials()
    col = C.collection("SHIP_Enemies")
    s = length / 12.0
    bits = [
        prism(1.6, 2.6, 6.0 * s / 2.5, 8, "Body_Prow", (0, 3.2, 0), 1.5, 0.8),
        prism(2.6, 3.0, 8.0 * s / 2.5, 8, "Body_Hull", (0, -1.2, 0), 1.7, 0.9),
        prism(3.0, 2.2, 4.0 * s / 2.5, 8, "Body_Stern", (0, -6.0, 0), 1.5, 0.85),
    ]
    for b in bits:
        M.assign(b, m["dark"])
    # placas de blindaje
    for i, y in enumerate((2.0, 0.0, -2.0, -4.0)):
        bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, y, 1.5))
        pl = bpy.context.active_object
        pl.name = "Armor_Plate_%02d" % (i + 1)
        pl.scale = (3.6, 0.9, 0.22)
        C.apply_transforms(pl)
        M.assign(pl, m["mid"])
        bits.append(pl)
    body = C.join(bits, "Ship_Body")
    parts = [body]
    for side in (1, -1):
        eng = prism(1.3, 1.4, 4.0, 12, "Engine_R" if side > 0 else "Engine_L",
                    (side * 2.2, -7.0, 0))
        M.assign(eng, m["black"])
        parts.append(eng)
        bpy.ops.mesh.primitive_cylinder_add(radius=0.95, depth=0.4,
                                            rotation=(math.pi / 2, 0, 0),
                                            location=(side * 2.2, -8.9, 0))
        cm = bpy.context.active_object
        cm.name = ("Engine_R" if side > 0 else "Engine_L") + "_Core"
        M.assign(cm, m["core"])
        parts.append(cm)
        for i, y in enumerate((2.4, -0.6, -3.4)):
            bpy.ops.mesh.primitive_cylinder_add(radius=0.5, depth=0.5,
                                                location=(side * 2.6, y, 1.2))
            tur = bpy.context.active_object
            tur.name = "Turret_%s_%02d" % ("R" if side > 0 else "L", i + 1)
            M.assign(tur, m["mid"])
            gun = prism(0.1, 0.14, 1.6, 6, tur.name + "_Barrel",
                        (side * 2.6, y + 0.9, 1.3))
            M.assign(gun, m["black"])
            parts += [tur, gun]
    root = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(root)
    for p in parts:
        p.parent = root
        C.uv_smart(p)
        C.link(p, col)
    C.link(root, col)
    empties = [C.empty("FX_Engine_L", (-2.2, -9.2, 0), (0, -1, 0), 0.6, root),
               C.empty("FX_Engine_R", (2.2, -9.2, 0), (0, -1, 0), 0.6, root),
               C.empty("CameraTarget", (0, -3.0, 2.4), (0, 1, 0), 0.6, root),
               C.empty("TargetPoint", (0, 0, 0), (0, 1, 0), 0.6, root)]
    collider = C.make_collider(body, ratio=0.06, name=name + "_Collider")
    collider.parent = root
    C.export_asset([root] + parts + empties + [collider], name, "Ships",
                   seed=seed, notes="nave pesada %.0fm, 6 torretas" % length)
    return root

if __name__ == "__main__":
    C.clean_scene()
    interceptor()
    C.save_blend("SHIP_Enemy_Interceptor_01")
    C.clean_scene()
    heavy()
    C.save_blend("SHIP_Enemy_Heavy_01")
    C.write_report()

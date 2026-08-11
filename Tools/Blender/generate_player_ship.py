"""
generate_player_ship.py - SHIP_Player_Fighter_01 (caza ligero, 12 m).

Modular por partes (Ship_Body, Cockpit, Wing_L/R, Engine_L/R, Weapon_L/R,
Thruster_*) + empties tecnicos orientados para Unity. Morro en +Y de Blender,
que al exportar con axis_forward=-Z queda mirando a +Z en Unity.
"""
import bpy, sys, os, math
sys.path.append(os.path.dirname(__file__))
import sk_core as C
import sk_materials as M
from mathutils import Vector

def prism(r_front, r_back, length, verts=6, name="part", loc=(0, 0, 0),
          sx=1.0, sz=1.0, phase=math.pi / 6):
    """Prisma conico a lo largo de +Y: el bloque base del fuselaje."""
    # Eulers XYZ de Blender: Rz@Ry@Rx. Rx(-90) lleva la punta del cono (radius2=r_front)
    # a +Y (morro), y la componente Y hace girar el perfil sobre el propio eje del prisma.
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r_back,
                                    radius2=r_front, depth=length,
                                    rotation=(-math.pi / 2, phase, 0),
                                    location=loc)
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = (sx, 1.0, sz)
    C.apply_transforms(ob)
    C.shade_smooth(ob)
    return ob

def build(name="SHIP_Player_Fighter_01", seed=1001):
    col = C.collection("SHIP_Player")
    dark = M.hull("MAT_Hull_Dark", "hull_dark", 0.46, 0.85, 16.0, 0.35)
    mid = M.hull("MAT_Hull_Mid", "hull_mid", 0.36, 0.8, 20.0, 0.3)
    light = M.hull("MAT_Hull_Light", "hull_light", 0.4, 0.35, 22.0, 0.25)
    black = M.hull("MAT_Hull_Black", "hull_black", 0.6, 0.7, 26.0, 0.4)
    accent = M.hull("MAT_Accent_Amber", "accent", 0.44, 0.4, 18.0, 0.2)
    glass = M.glass()
    cyan = M.emissive("MAT_Emissive_Cyan", "cyan", 12.0)
    core = M.emissive("MAT_Emissive_EngineCore", "cyan", 26.0)
    nav_g = M.emissive("MAT_NavLight_Green", "cyan", 8.0)
    nav_r = M.emissive("MAT_NavLight_Red", "red", 8.0)

    parts = {}

    # ------------------------------------------------ Ship_Body
    body_bits = [
        prism(0.28, 1.05, 3.6, 6, "Body_Nose", (0, 4.0, 0), 1.25, 0.62),
        prism(1.05, 1.30, 4.2, 6, "Body_Mid", (0, 0.1, 0), 1.30, 0.68),
        prism(1.30, 1.05, 2.6, 6, "Body_Rear", (0, -3.3, 0), 1.25, 0.70),
        prism(0.34, 0.50, 5.4, 4, "Body_Spine", (0, 1.0, 0.72), 1.0, 0.55,
              math.pi / 4),
        prism(0.42, 0.62, 2.2, 6, "Body_SensorPod", (0, 3.0, -0.62), 1.1, 0.6),
    ]
    for m, bit in zip([dark, dark, mid, light, black], body_bits):
        M.assign(bit, m)
    parts["Ship_Body"] = C.join(body_bits, "Ship_Body")

    # ------------------------------------------------ Cockpit
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.92, segments=28, ring_count=14,
                                         location=(0, 2.35, 0.62))
    canopy = bpy.context.active_object
    canopy.name = "Cockpit_Glass"
    canopy.scale = (0.86, 1.45, 0.62)
    C.apply_transforms(canopy)
    C.shade_smooth(canopy)
    M.assign(canopy, glass)
    parts["Cockpit"] = canopy

    # ------------------------------------------------ Wings (delta invertida)
    def wing(side):
        pts = [(0.85, 2.35), (3.05, 0.55), (4.45, -0.75),
               (4.45, -1.85), (2.60, -2.15), (0.85, -2.95)]
        me = bpy.data.meshes.new("Wing_mesh")
        verts = [(side * x, y, 0.0) for (x, y) in pts]
        faces = [list(range(len(pts)))] if side > 0 else [list(reversed(range(len(pts))))]
        me.from_pydata(verts, [], faces)
        me.update()
        ob = bpy.data.objects.new("Wing_R" if side > 0 else "Wing_L", me)
        bpy.context.scene.collection.objects.link(ob)
        bpy.context.view_layer.objects.active = ob
        sol = ob.modifiers.new("Solidify", "SOLIDIFY")
        sol.thickness = 0.34
        sol.offset = 0.0
        bev = ob.modifiers.new("Bevel", "BEVEL")
        bev.width = 0.06
        bev.segments = 2
        bpy.ops.object.modifier_apply(modifier=sol.name)
        bpy.ops.object.modifier_apply(modifier=bev.name)
        ob.rotation_euler = (0, side * -0.14, 0)
        C.apply_transforms(ob)
        M.assign(ob, dark)
        tip = prism(0.16, 0.30, 1.5, 6, ("Wing_R" if side > 0 else "Wing_L") + "_TipPylon",
                    (side * 4.35, -0.7, 0.16), 1.0, 1.0)
        M.assign(tip, mid)
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.14, segments=12, ring_count=8,
                                             location=(side * 4.35, 0.1, 0.2))
        nav = bpy.context.active_object
        nav.name = "NavLight_%s" % ("R" if side > 0 else "L")
        M.assign(nav, nav_g if side > 0 else nav_r)
        return C.join([ob, tip], ob.name), nav
    for s in (1, -1):
        w, nav = wing(s)
        parts[w.name] = w
        parts[nav.name] = nav

    # ------------------------------------------------ Weapons
    def weapon(side):
        x = side * 1.95
        tag = "Weapon_R" if side > 0 else "Weapon_L"
        barrel = prism(0.17, 0.28, 3.3, 8, tag + "_Barrel", (x, 2.4, -0.05))
        breech = prism(0.34, 0.42, 1.2, 6, tag + "_Breech", (x, 0.5, -0.05))
        M.assign(barrel, mid); M.assign(breech, black)
        bpy.ops.mesh.primitive_cylinder_add(radius=0.13, depth=0.08,
                                            rotation=(math.pi / 2, 0, 0),
                                            location=(x, 4.02, -0.05))
        muzzle = bpy.context.active_object
        muzzle.name = tag + "_MuzzleGlow"
        M.assign(muzzle, cyan)
        return C.join([barrel, breech], tag), muzzle
    for s in (1, -1):
        w, mz = weapon(s)
        parts[w.name] = w
        parts[mz.name] = mz

    # ------------------------------------------------ Engines
    def engine(side):
        x, y0 = side * 1.7, -3.6
        tag = "Engine_R" if side > 0 else "Engine_L"
        bits = [prism(0.95, 1.02, 3.2, 12, tag + "_Housing", (x, y0 + 0.4, 0.05)),
                prism(1.02, 0.72, 1.0, 12, tag + "_Nozzle", (x, y0 - 1.7, 0.05)),
                prism(0.55, 0.90, 0.7, 12, tag + "_Intake", (x, y0 + 2.3, 0.05))]
        M.assign(bits[0], dark); M.assign(bits[1], black); M.assign(bits[2], black)
        for i in range(3):
            bpy.ops.mesh.primitive_torus_add(major_radius=1.0 + i * 0.02,
                                             minor_radius=0.09,
                                             major_segments=26, minor_segments=8,
                                             location=(x, y0 + 0.9 - i * 0.9, 0.05))
            r = bpy.context.active_object
            r.name = "%s_Ring_%d" % (tag, i + 1)
            M.assign(r, mid)
            bits.append(r)
        for i in range(4):
            a = (i / 4) * math.tau + 0.4
            c = prism(0.09, 0.09, 2.6, 6, "%s_Conduit_%d" % (tag, i + 1),
                      (x + math.cos(a) * 0.98, y0 + 0.4, 0.05 + math.sin(a) * 0.98))
            M.assign(c, light)
            bits.append(c)
        bpy.ops.mesh.primitive_cylinder_add(radius=0.62, depth=0.5,
                                            rotation=(math.pi / 2, 0, 0),
                                            location=(x, y0 - 2.05, 0.05))
        core_m = bpy.context.active_object
        core_m.name = tag + "_Core"
        M.assign(core_m, core)
        return C.join(bits, tag), core_m
    for s in (1, -1):
        e, cm = engine(s)
        parts[e.name] = e
        parts[cm.name] = cm

    # ------------------------------------------------ Fins + thrusters
    for s in (1, -1):
        pts = [(-1.0, 0.0), (0.9, 0.0), (0.25, 1.35), (-0.85, 1.0)]
        me = bpy.data.meshes.new("Fin_mesh")
        verts = [(s * 0.95, -3.4 + x, z + 0.55) for (x, z) in pts]
        me.from_pydata(verts, [], [[0, 1, 2, 3]])
        me.update()
        fin = bpy.data.objects.new("Fin_R" if s > 0 else "Fin_L", me)
        bpy.context.scene.collection.objects.link(fin)
        bpy.context.view_layer.objects.active = fin
        sol = fin.modifiers.new("Solidify", "SOLIDIFY")
        sol.thickness = 0.12
        bpy.ops.object.modifier_apply(modifier=sol.name)
        M.assign(fin, mid)
        parts[fin.name] = fin

    thrusters = {
        "Thruster_L": ((-2.2, 2.9, 0.05), (-1, 0, 0)),
        "Thruster_R": ((2.2, 2.9, 0.05), (1, 0, 0)),
        "Thruster_Up": ((0, -1.4, 0.95), (0, 0, 1)),
        "Thruster_Down": ((0, -1.4, -0.72), (0, 0, -1)),
    }
    for tag, (loc, d) in thrusters.items():
        bpy.ops.mesh.primitive_cone_add(vertices=10, radius1=0.24, radius2=0.2,
                                        depth=0.28, location=loc)
        noz = bpy.context.active_object
        noz.name = tag + "_Nozzle"
        noz.rotation_euler = Vector(d).to_track_quat("Z", "Y").to_euler()
        C.apply_transforms(noz)
        M.assign(noz, black)
        parts[noz.name] = noz

    # ------------------------------------------------ montaje final
    root = bpy.data.objects.new(name, None)
    root.empty_display_type = "PLAIN_AXES"
    bpy.context.scene.collection.objects.link(root)
    for ob in parts.values():
        ob.parent = root
        C.uv_smart(ob)
        C.link(ob, col)
    C.link(root, col)

    # empties tecnicos: VFX de motores, bocas de disparo, camara, lock-on
    markers = {
        "FX_Engine_L": ((-1.7, -6.0, 0.05), (0, -1, 0)),
        "FX_Engine_R": ((1.7, -6.0, 0.05), (0, -1, 0)),
        "Muzzle_L": ((-1.95, 4.1, -0.05), (0, 1, 0)),
        "Muzzle_R": ((1.95, 4.1, -0.05), (0, 1, 0)),
        "CameraTarget": ((0, -1.2, 0.9), (0, 1, 0)),
        "TargetPoint": ((0, 0, 0.1), (0, 1, 0)),
        "FX_Thruster_Left": ((-2.4, 2.9, 0.05), (-1, 0, 0)),
        "FX_Thruster_Right": ((2.4, 2.9, 0.05), (1, 0, 0)),
        "FX_Thruster_Up": ((0, -1.4, 1.15), (0, 0, 1)),
        "FX_Thruster_Down": ((0, -1.4, -0.92), (0, 0, -1)),
    }
    empties = [C.empty(k, loc, look, 0.4, root) for k, (loc, look) in markers.items()]
    for e in empties:
        C.link(e, col)

    meshes = [o for o in parts.values()]
    # colliders: capsula/caja aproximadas, nunca la malla visual
    collider = C.make_collider(parts["Ship_Body"], ratio=0.08,
                               name=name + "_Collider")
    collider.parent = root
    C.link(collider, col)

    C.export_asset([root] + meshes + empties + [collider], name, "Ships",
                   seed=seed,
                   notes="caza ligero 12m, %d partes, empties Unity" % len(meshes))
    return root

if __name__ == "__main__":
    C.clean_scene()
    build()
    C.save_blend("SHIP_Player_Fighter_01")
    C.write_report()

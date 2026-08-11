"""
sk_core.py - nucleo comun del Space Asset Kit (Blender 3.6+ / 4.x)

Todo generador importa este modulo. Contiene:
  * escala real (1 unidad = 1 metro), limpieza de escena, colecciones
  * ruido determinista por seed (mismo seed -> mismo asset)
  * desplazamiento de malla por vertices (crateres, planos de fractura, fbm)
  * LOD0/1/2 por decimate, colliders convexos simplificados
  * empties tecnicos orientados (motores, armas, CameraTarget, TargetPoint)
  * exportacion FBX + GLB con ejes de Unity y registro para el report
"""
import bpy, bmesh, math, os, random
from mathutils import Vector, noise

UNIT = 1.0                      # 1 unidad de Blender = 1 metro
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT_MODELS = os.path.join(ROOT, "Assets", "Game", "Models", "Generated")
OUT_BLEND = os.path.join(ROOT, "Tools", "Blender", "blend")
OUT_TEX = os.path.join(ROOT, "Assets", "Game", "Textures", "Generated")
REPORT = []

def ensure_dirs(*paths):
    for p in paths:
        os.makedirs(p, exist_ok=True)

def clean_scene():
    # Si un paso anterior murio en EDIT mode, los operadores de seleccion fallarian.
    if bpy.context.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')
    # Borrado por data API: no depende del estado de seleccion.
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.images,
                  bpy.data.curves, bpy.data.node_groups):
        for item in list(block):
            if item.users == 0:
                block.remove(item)
    sc = bpy.context.scene
    sc.unit_settings.system = "METRIC"
    sc.unit_settings.scale_length = 1.0

def collection(name, parent=None):
    col = bpy.data.collections.get(name)
    if col is None:
        col = bpy.data.collections.new(name)
        (parent or bpy.context.scene.collection).children.link(col)
    return col

def link(obj, col):
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    col.objects.link(obj)
    return obj

# ---------------------------------------------------------------- ruido
def seeded(seed):
    """Generador aleatorio reproducible."""
    r = random.Random(seed)
    return r

def fbm(v, seed=0, octaves=4, lacunarity=2.0, gain=0.5, scale=1.0):
    """fBm sobre mathutils.noise, desplazado por seed."""
    p = Vector(v) * scale + Vector((seed * 0.137, seed * 0.311, seed * 0.517))
    amp, freq, total, norm = 1.0, 1.0, 0.0, 0.0
    for _ in range(octaves):
        total += amp * noise.noise(p * freq)
        norm += amp
        amp *= gain
        freq *= lacunarity
    return total / max(norm, 1e-6)

# ------------------------------------------------- geometria procedural
def icosphere(radius=1.0, subdiv=4, name="Mesh"):
    bpy.ops.mesh.primitive_ico_sphere_add(radius=radius, subdivisions=subdiv,
                                          location=(0, 0, 0))
    ob = bpy.context.active_object
    ob.name = name
    ob.data.name = name + "_mesh"
    return ob

def shade_smooth(ob, angle=math.radians(38)):
    for p in ob.data.polygons:
        p.use_smooth = True
    try:                                   # Blender <=4.0: auto_smooth clasico
        ob.data.use_auto_smooth = True
        ob.data.auto_smooth_angle = angle
    except AttributeError:
        # Blender 4.1+: el reemplazo real es el operador de suavizado por angulo.
        bpy.context.view_layer.objects.active = ob
        ob.select_set(True)
        if hasattr(bpy.ops.object, "shade_smooth_by_angle"):
            bpy.ops.object.shade_smooth_by_angle(angle=angle)      # 4.2+
        elif hasattr(bpy.ops.object, "shade_auto_smooth"):
            bpy.ops.object.shade_auto_smooth(angle=angle)          # 4.1
        ob.select_set(False)
    return ob

def deform_rock(ob, seed=1, terrain_scale=1.1, terrain_strength=0.28,
                crater_count=16, crater_size=0.34, elongation=(1.0, 0.8, 1.25),
                fractures=2, flats=4):
    """Convierte una icoesfera en roca: fbm de baja frecuencia + crateres
    (compuestos por minimo, nunca sumados) + surcos + truncados planos."""
    rnd = seeded(seed * 7919 + 13)
    radius = max(ob.dimensions) * 0.5
    craters, grooves, planes = [], [], []
    for _ in range(crater_count):
        d = Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1)))
        d.normalize()
        big = rnd.random() > 0.72
        craters.append((d, crater_size * ((1.1 + rnd.random() * 0.8) if big
                        else (0.25 + rnd.random() * 0.5)),
                        (0.16 if big else 0.07) + rnd.random() * 0.09,
                        0.35 + rnd.random() * 0.3))
    for _ in range(fractures):
        n = Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1)))
        n.normalize()
        grooves.append((n, (rnd.random() - 0.5) * 0.7,
                        0.04 + rnd.random() * 0.07, 0.12 + rnd.random() * 0.14))
    for _ in range(flats):
        n = Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1)))
        n.normalize()
        planes.append((n, radius * (0.55 + rnd.random() * 0.3)))

    me = ob.data
    for vert in me.vertices:
        d = vert.co.normalized()
        h = fbm(d, seed, 3, 1.9, 0.55, terrain_scale) * terrain_strength
        mask = max(0.0, fbm(d, seed + 411, 2, 2.0, 0.5, 1.7) * 0.5 + 0.5)
        h += fbm(d, seed + 71, 3, 2.0, 0.5, terrain_scale * 5.5) * terrain_strength * 0.28 * mask
        cav, rim = 0.0, 0.0
        for (cd, cr, depth, floor) in craters:
            ang = math.acos(max(-1.0, min(1.0, d.dot(cd))))
            if ang < cr * 1.2:
                t = ang / cr
                if t < 1.0:
                    bowl = -depth * min(1.0, (1.0 - t) / floor)
                    cav = min(cav, bowl)
                rim = max(rim, depth * 0.45 * math.exp(-((t - 0.97) * 10) ** 2))
        cav += rim
        gr = 0.0
        for (n, off, w, depth) in grooves:
            dist = abs(d.dot(n) - off)
            if dist < w:
                gr -= (1.0 - dist / w) * depth
        r = radius * (1.0 + h + cav + gr)
        p = Vector((d.x * elongation[0], d.y * elongation[1], d.z * elongation[2]))
        p.normalize()
        p *= r
        for (n, pd) in planes:
            dp = p.dot(n)
            if dp > pd:
                p += n * ((pd - dp) * 0.82)
        vert.co = p
    me.update()
    shade_smooth(ob)
    return ob

def uv_sphere_project(ob):
    """UV esfericas: suficiente para roca y planetas."""
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.sphere_project(direction="ALIGN_TO_OBJECT")
    bpy.ops.object.mode_set(mode="OBJECT")
    return ob

def uv_smart(ob, angle=66.0, margin=0.02):
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(angle), island_margin=margin)
    bpy.ops.object.mode_set(mode="OBJECT")
    return ob

# ------------------------------------------------------- utilidades obj
def join(objs, name):
    objs = [o for o in objs if o is not None]
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    ob = bpy.context.active_object
    ob.name = name
    return ob

def apply_transforms(ob):
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    return ob

def set_origin_center(ob):
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="BOUNDS")
    return ob

def empty(name, location=(0, 0, 0), look=None, size=0.5, parent=None):
    e = bpy.data.objects.new(name, None)
    e.empty_display_type = "ARROWS"
    e.empty_display_size = size
    e.location = location
    if look is not None:
        e.rotation_euler = Vector(look).to_track_quat("Z", "Y").to_euler()
    bpy.context.scene.collection.objects.link(e)
    if parent:
        e.parent = parent
    return e

def tri_count(ob):
    me = ob.data
    return sum(len(p.vertices) - 2 for p in me.polygons)

# ------------------------------------------------------------- LOD / col
def make_lods(ob, ratios=(1.0, 0.45, 0.18), collection_name=None):
    """Devuelve [LOD0, LOD1, LOD2]; LOD0 es el objeto original renombrado."""
    out = []
    base_name = ob.name
    ob.name = base_name + "_LOD0"
    out.append(ob)
    for i, ratio in enumerate(ratios[1:], start=1):
        cp = ob.copy()
        cp.data = ob.data.copy()
        cp.name = base_name + "_LOD%d" % i
        bpy.context.scene.collection.objects.link(cp)
        dec = cp.modifiers.new("Decimate", "DECIMATE")
        dec.ratio = ratio
        bpy.context.view_layer.objects.active = cp
        bpy.ops.object.modifier_apply(modifier=dec.name)
        out.append(cp)
    if collection_name:
        col = collection(collection_name)
        for o in out:
            link(o, col)
    return out

def make_collider(ob, ratio=0.06, name=None):
    """Collider convexo simplificado (no usar la malla visual en Unity)."""
    cp = ob.copy()
    cp.data = ob.data.copy()
    cp.name = name or (ob.name.replace("_LOD0", "") + "_Collider")
    bpy.context.scene.collection.objects.link(cp)
    bpy.context.view_layer.objects.active = cp
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.convex_hull()
    bpy.ops.object.mode_set(mode="OBJECT")
    dec = cp.modifiers.new("Decimate", "DECIMATE")
    dec.ratio = ratio
    bpy.ops.object.modifier_apply(modifier=dec.name)
    cp.display_type = "WIRE"
    return cp

# --------------------------------------------------------------- export
def export_asset(objs, name, subdir, fbx=True, glb=True, seed=None, notes=""):
    """Exporta a Assets/Game/Models/Generated/<subdir>/ y anota el report."""
    folder = os.path.join(OUT_MODELS, subdir)
    ensure_dirs(folder)
    objs = [o for o in objs if o is not None]
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    paths = []
    if fbx:
        p = os.path.join(folder, name + ".fbx")
        bpy.ops.export_scene.fbx(
            filepath=p, use_selection=True, apply_unit_scale=True,
            global_scale=1.0, apply_scale_options="FBX_SCALE_UNITS",
            axis_forward="-Z", axis_up="Y", mesh_smooth_type="FACE",
            use_mesh_modifiers=True, bake_space_transform=True,
            add_leaf_bones=False, path_mode="COPY", embed_textures=False)
        paths.append(p)
    if glb:
        p = os.path.join(folder, name + ".glb")
        bpy.ops.export_scene.gltf(filepath=p, export_format="GLB",
                                  use_selection=True, export_apply=True,
                                  export_yup=True)
        paths.append(p)
    tris = sum(tri_count(o) for o in objs if o.type == "MESH")
    verts = sum(len(o.data.vertices) for o in objs if o.type == "MESH")
    mats = sorted({m.name for o in objs if o.type == "MESH"
                   for m in o.data.materials if m})
    REPORT.append(dict(asset=name, verts=verts, tris=tris, materials=mats,
                       files=paths, seed=seed, notes=notes))
    return paths

def save_blend(name):
    ensure_dirs(OUT_BLEND)
    p = os.path.join(OUT_BLEND, name + ".blend")
    bpy.ops.wm.save_as_mainfile(filepath=p, copy=True)
    return p

def write_report(path=None):
    path = path or os.path.join(ROOT, "Tools", "Blender", "generation_report.txt")
    ensure_dirs(os.path.dirname(path))
    lines = ["SPACE ASSET KIT - generation report", "=" * 62, ""]
    for r in REPORT:
        lines += [
            "ASSET      : %s" % r["asset"],
            "  seed     : %s" % r["seed"],
            "  vertices : %d" % r["verts"],
            "  triangles: %d" % r["tris"],
            "  materials: %s" % (", ".join(r["materials"]) or "-"),
            "  files    : %s" % "\n             ".join(r["files"]),
        ]
        if r["notes"]:
            lines.append("  notas    : %s" % r["notes"])
        lines.append("")
    lines.append("total assets: %d" % len(REPORT))
    lines.append("total triangulos: %d" % sum(r["tris"] for r in REPORT))
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    return path

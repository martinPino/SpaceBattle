"""
generate_skybox.py - skybox espacial equirectangular horneado.

Genera el fondo como TEXTURA (no geometria): miles de estrellas, nebulosas
lejanas, galaxias tenues y zonas oscuras. Se renderiza con una camara
panoramica equirectangular y se guarda en 4096x2048 (PNG + EXR opcional)
para usarlo en un material de Skybox/Panoramic en Unity.

  blender --background --python Tools/Blender/generate_skybox.py -- --variant DeepSpace
"""
import bpy, sys, os, math
sys.path.append(os.path.dirname(__file__))
import sk_core as C

VARIANTS = {
    "DeepSpace":    dict(neb=(0.06, 0.1, 0.22), density=0.35, stars=1.0),
    "BlueNebula":   dict(neb=(0.1, 0.28, 0.85), density=0.9, stars=0.9),
    "RedNebula":    dict(neb=(0.7, 0.14, 0.1), density=0.85, stars=0.85),
    "GalacticCore": dict(neb=(0.95, 0.78, 0.5), density=1.0, stars=1.2),
    "DarkVoid":     dict(neb=(0.03, 0.035, 0.05), density=0.12, stars=0.6),
}

def build_world(variant="DeepSpace", seed=31):
    cfg = VARIANTS[variant]
    world = bpy.data.worlds.new("SKY_%s" % variant)
    bpy.context.scene.world = world
    world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputWorld"); out.location = (600, 0)
    bg = nt.nodes.new("ShaderNodeBackground"); bg.location = (400, 0)
    nt.links.new(bg.outputs[0], out.inputs["Surface"])

    coord = nt.nodes.new("ShaderNodeTexCoord"); coord.location = (-1200, 0)
    # estrellas: voronoi de puntos brillantes + variacion de temperatura
    star = nt.nodes.new("ShaderNodeTexVoronoi"); star.location = (-980, 220)
    star.feature = "F1"
    star.inputs["Scale"].default_value = 420.0
    nt.links.new(coord.outputs["Generated"], star.inputs["Vector"])
    sramp = nt.nodes.new("ShaderNodeValToRGB"); sramp.location = (-740, 220)
    sramp.color_ramp.elements[0].position = 0.0
    sramp.color_ramp.elements[0].color = (1, 1, 1, 1)
    sramp.color_ramp.elements[1].position = 0.055
    sramp.color_ramp.elements[1].color = (0, 0, 0, 1)
    nt.links.new(star.outputs["Distance"], sramp.inputs["Fac"])
    temp = nt.nodes.new("ShaderNodeTexNoise"); temp.location = (-980, -20)
    temp.inputs["Scale"].default_value = 90.0
    nt.links.new(coord.outputs["Generated"], temp.inputs["Vector"])
    tramp = nt.nodes.new("ShaderNodeValToRGB"); tramp.location = (-740, -20)
    for pos, col in ((0.0, (0.55, 0.7, 1.0, 1)), (0.45, (1, 1, 1, 1)),
                     (0.75, (1, 0.85, 0.6, 1)), (1.0, (1, 0.5, 0.35, 1))):
        if pos in (0.0, 1.0):
            e = tramp.color_ramp.elements[0 if pos == 0.0 else 1]
            e.color = col
        else:
            tramp.color_ramp.elements.new(pos).color = col
    nt.links.new(temp.outputs["Fac"], tramp.inputs["Fac"])
    starcol = nt.nodes.new("ShaderNodeMixRGB"); starcol.location = (-500, 160)
    starcol.blend_type = "MULTIPLY"
    starcol.inputs["Fac"].default_value = 1.0
    nt.links.new(sramp.outputs["Color"], starcol.inputs["Color1"])
    nt.links.new(tramp.outputs["Color"], starcol.inputs["Color2"])

    # nebulosa de fondo: fbm con zonas densas y oscuras
    neb = nt.nodes.new("ShaderNodeTexNoise"); neb.location = (-980, -320)
    neb.noise_dimensions = '4D'  # Blender 4/5: el socket "W" solo existe en modo 4D
    neb.inputs["Scale"].default_value = 1.8
    neb.inputs["Detail"].default_value = 14.0
    neb.inputs["W"].default_value = seed * 0.13
    nt.links.new(coord.outputs["Generated"], neb.inputs["Vector"])
    nramp = nt.nodes.new("ShaderNodeValToRGB"); nramp.location = (-740, -320)
    nramp.color_ramp.elements[0].position = 0.42
    nramp.color_ramp.elements[0].color = (0, 0, 0, 1)
    nramp.color_ramp.elements[1].position = 0.78
    nramp.color_ramp.elements[1].color = cfg["neb"] + (1.0,)
    nt.links.new(neb.outputs["Fac"], nramp.inputs["Fac"])
    nscale = nt.nodes.new("ShaderNodeMixRGB"); nscale.location = (-500, -320)
    nscale.blend_type = "MULTIPLY"
    nscale.inputs["Fac"].default_value = 1.0
    nscale.inputs["Color2"].default_value = (cfg["density"],) * 3 + (1,)
    nt.links.new(nramp.outputs["Color"], nscale.inputs["Color1"])

    add = nt.nodes.new("ShaderNodeMixRGB"); add.location = (-220, 0)
    add.blend_type = "ADD"
    add.inputs["Fac"].default_value = 1.0
    nt.links.new(nscale.outputs["Color"], add.inputs["Color1"])
    nt.links.new(starcol.outputs["Color"], add.inputs["Color2"])
    nt.links.new(add.outputs["Color"], bg.inputs["Color"])
    bg.inputs["Strength"].default_value = 1.0
    return world

def bake_equirect(variant="DeepSpace", width=4096, exr=False):
    C.ensure_dirs(C.OUT_TEX)
    build_world(variant)
    cam_data = bpy.data.cameras.new("SKY_Cam")
    cam_data.type = "PANO"
    try:
        cam_data.panorama_type = "EQUIRECTANGULAR"        # Cycles 3.x
    except AttributeError:
        cam_data.cycles.panorama_type = "EQUIRECTANGULAR"
    cam = bpy.data.objects.new("SKY_Cam", cam_data)
    bpy.context.scene.collection.objects.link(cam)
    bpy.context.scene.camera = cam
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.samples = 64
    sc.render.resolution_x = width
    sc.render.resolution_y = width // 2
    sc.render.film_transparent = False
    name = "Skybox_%s" % variant
    ext = "exr" if exr else "png"
    sc.render.image_settings.file_format = "OPEN_EXR" if exr else "PNG"
    sc.render.filepath = os.path.join(C.OUT_TEX, name + "." + ext)
    bpy.ops.render.render(write_still=True)
    C.REPORT.append(dict(asset=name, verts=0, tris=0,
                         materials=["World SKY_%s" % variant],
                         files=[sc.render.filepath], seed=31,
                         notes="equirect %dx%d para Skybox/Panoramic en Unity" % (width, width // 2)))
    return sc.render.filepath

if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    variant = argv[argv.index("--variant") + 1] if "--variant" in argv else None
    C.clean_scene()
    for v in ([variant] if variant else list(VARIANTS)):
        bake_equirect(v)
    C.write_report()

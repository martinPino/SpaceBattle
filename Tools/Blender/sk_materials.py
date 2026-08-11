"""
sk_materials.py - materiales PBR procedurales compartidos.

Un solo lenguaje visual: metal gris oscuro + gris medio + paneles claros,
acentos ambar, emissive cyan (jugador) / rojo-naranja (enemigos).
Todo por nodos: no dependemos de texturas externas, y cada material puede
hornearse a Base Color / Normal / Roughness / AO / Emission con
bake_pbr_set() antes de exportar a Unity.
"""
import bpy

PALETTE = {
    "hull_dark":  (0.055, 0.062, 0.072, 1.0),
    "hull_mid":   (0.22, 0.24, 0.27, 1.0),
    "hull_light": (0.62, 0.65, 0.68, 1.0),
    "hull_black": (0.017, 0.019, 0.022, 1.0),
    "accent":     (0.72, 0.34, 0.04, 1.0),
    "cyan":       (0.10, 0.72, 1.0, 1.0),
    "red":        (1.0, 0.16, 0.05, 1.0),
    "rock_grey":  (0.19, 0.185, 0.175, 1.0),
    "rock_dark":  (0.055, 0.055, 0.06, 1.0),
    "rock_red":   (0.17, 0.075, 0.05, 1.0),
    "rock_ice":   (0.55, 0.68, 0.78, 1.0),
}

def _new(name):
    m = bpy.data.materials.get(name)
    if m:
        return m, False
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.node_tree.nodes.clear()
    return m, True

def _out(nt, shader, x=420):
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    out.location = (x, 0)
    nt.links.new(shader.outputs[0], out.inputs["Surface"])
    return out

def hull(name="MAT_Hull_Dark", base="hull_dark", roughness=0.44, metallic=0.85,
         panel_scale=14.0, wear=0.35):
    """Metal con panel lines, desgaste sutil y variacion de roughness."""
    m, fresh = _new(name)
    if not fresh:
        return m
    nt = m.node_tree
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (140, 0)
    bsdf.inputs["Base Color"].default_value = PALETTE[base]
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness

    tex = nt.nodes.new("ShaderNodeTexCoord"); tex.location = (-980, 0)
    # panel lines: brick como rejilla de placas
    brick = nt.nodes.new("ShaderNodeTexBrick"); brick.location = (-780, 180)
    brick.inputs["Scale"].default_value = panel_scale
    brick.inputs["Mortar Size"].default_value = 0.012
    brick.inputs["Color1"].default_value = (1, 1, 1, 1)
    brick.inputs["Color2"].default_value = (0.85, 0.85, 0.85, 1)
    brick.inputs["Mortar"].default_value = (0, 0, 0, 1)
    nt.links.new(tex.outputs["Object"], brick.inputs["Vector"])
    # variacion de metal + suciedad
    nz = nt.nodes.new("ShaderNodeTexNoise"); nz.location = (-780, -120)
    nz.inputs["Scale"].default_value = 3.2
    nz.inputs["Detail"].default_value = 8.0
    nt.links.new(tex.outputs["Object"], nz.inputs["Vector"])
    ramp = nt.nodes.new("ShaderNodeValToRGB"); ramp.location = (-560, -120)
    ramp.color_ramp.elements[0].position = 0.42
    ramp.color_ramp.elements[1].position = 0.62
    nt.links.new(nz.outputs["Fac"], ramp.inputs["Fac"])

    mixc = nt.nodes.new("ShaderNodeMixRGB"); mixc.location = (-330, 60)
    mixc.blend_type = "MULTIPLY"
    mixc.inputs["Fac"].default_value = 0.55
    mixc.inputs["Color1"].default_value = PALETTE[base]
    nt.links.new(brick.outputs["Color"], mixc.inputs["Color2"])
    grime = nt.nodes.new("ShaderNodeMixRGB"); grime.location = (-120, 60)
    grime.blend_type = "MIX"
    grime.inputs["Fac"].default_value = wear * 0.4
    nt.links.new(mixc.outputs["Color"], grime.inputs["Color1"])
    grime.inputs["Color2"].default_value = (0.03, 0.028, 0.026, 1)
    nt.links.new(ramp.outputs["Color"], grime.inputs["Fac"])
    nt.links.new(grime.outputs["Color"], bsdf.inputs["Base Color"])

    rmix = nt.nodes.new("ShaderNodeMixRGB"); rmix.location = (-120, -200)
    rmix.inputs["Color1"].default_value = (roughness, roughness, roughness, 1)
    rmix.inputs["Color2"].default_value = (min(1.0, roughness + 0.3),) * 3 + (1,)
    nt.links.new(ramp.outputs["Color"], rmix.inputs["Fac"])
    nt.links.new(rmix.outputs["Color"], bsdf.inputs["Roughness"])

    bump = nt.nodes.new("ShaderNodeBump"); bump.location = (-120, -420)
    bump.inputs["Strength"].default_value = 0.35
    nt.links.new(brick.outputs["Color"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    _out(nt, bsdf)
    return m

def emissive(name="MAT_Emissive_Cyan", color="cyan", strength=14.0):
    m, fresh = _new(name)
    if not fresh:
        return m
    nt = m.node_tree
    em = nt.nodes.new("ShaderNodeEmission")
    em.location = (140, 0)
    em.inputs["Color"].default_value = PALETTE[color]
    em.inputs["Strength"].default_value = strength
    _out(nt, em)
    return m

def glass(name="MAT_Cockpit_Glass"):
    m, fresh = _new(name)
    if not fresh:
        return m
    nt = m.node_tree
    b = nt.nodes.new("ShaderNodeBsdfPrincipled")
    b.location = (140, 0)
    b.inputs["Base Color"].default_value = (0.015, 0.035, 0.06, 1)
    b.inputs["Metallic"].default_value = 0.1
    b.inputs["Roughness"].default_value = 0.06
    try:
        b.inputs["Coat Weight"].default_value = 1.0        # 4.x
    except KeyError:
        b.inputs["Clearcoat"].default_value = 1.0          # 3.x
    _out(nt, b)
    return m

def rock(name="MAT_Rock_Grey", tint="rock_grey", seed=0, mineral=None):
    """Regolito: manchas de albedo, grano fino, crateres y vetas minerales
    solo dentro de las grietas."""
    m, fresh = _new(name)
    if not fresh:
        return m
    nt = m.node_tree
    b = nt.nodes.new("ShaderNodeBsdfPrincipled"); b.location = (240, 0)
    b.inputs["Metallic"].default_value = 0.0
    b.inputs["Roughness"].default_value = 0.92

    coord = nt.nodes.new("ShaderNodeTexCoord"); coord.location = (-1100, 0)
    patch = nt.nodes.new("ShaderNodeTexNoise"); patch.location = (-900, 200)
    patch.inputs["Scale"].default_value = 1.6 + seed % 3
    patch.inputs["Detail"].default_value = 4.0
    nt.links.new(coord.outputs["Object"], patch.inputs["Vector"])
    grain = nt.nodes.new("ShaderNodeTexNoise"); grain.location = (-900, -40)
    grain.inputs["Scale"].default_value = 42.0
    grain.inputs["Detail"].default_value = 6.0
    nt.links.new(coord.outputs["Object"], grain.inputs["Vector"])
    crack = nt.nodes.new("ShaderNodeTexVoronoi"); crack.location = (-900, -300)
    crack.feature = "DISTANCE_TO_EDGE"
    crack.inputs["Scale"].default_value = 6.0
    nt.links.new(coord.outputs["Object"], crack.inputs["Vector"])
    crampa = nt.nodes.new("ShaderNodeValToRGB"); crampa.location = (-680, -300)
    crampa.color_ramp.elements[0].position = 0.0
    crampa.color_ramp.elements[1].position = 0.06
    nt.links.new(crack.outputs["Distance"], crampa.inputs["Fac"])

    ramp = nt.nodes.new("ShaderNodeValToRGB"); ramp.location = (-620, 200)
    ramp.color_ramp.elements[0].position = 0.32
    ramp.color_ramp.elements[0].color = tuple(c * 0.65 for c in PALETTE[tint][:3]) + (1,)
    ramp.color_ramp.elements[1].position = 0.72
    ramp.color_ramp.elements[1].color = tuple(min(1, c * 1.5) for c in PALETTE[tint][:3]) + (1,)
    nt.links.new(patch.outputs["Fac"], ramp.inputs["Fac"])

    darken = nt.nodes.new("ShaderNodeMixRGB"); darken.location = (-360, 120)
    darken.blend_type = "MULTIPLY"
    darken.inputs["Fac"].default_value = 0.85
    nt.links.new(ramp.outputs["Color"], darken.inputs["Color1"])
    nt.links.new(crampa.outputs["Color"], darken.inputs["Color2"])
    color_out = darken

    if mineral:
        vein = nt.nodes.new("ShaderNodeMixRGB"); vein.location = (-120, 120)
        vein.blend_type = "MIX"
        veinmask = nt.nodes.new("ShaderNodeMath"); veinmask.location = (-360, -160)
        veinmask.operation = "MULTIPLY"
        veinmask.inputs[1].default_value = 0.9
        inv = nt.nodes.new("ShaderNodeInvert"); inv.location = (-520, -160)
        nt.links.new(crampa.outputs["Color"], inv.inputs["Color"])
        nt.links.new(inv.outputs["Color"], veinmask.inputs[0])
        nt.links.new(veinmask.outputs["Value"], vein.inputs["Fac"])
        nt.links.new(darken.outputs["Color"], vein.inputs["Color1"])
        vein.inputs["Color2"].default_value = PALETTE[mineral]
        color_out = vein
        em = nt.nodes.new("ShaderNodeMath"); em.location = (-120, -260)
        em.operation = "MULTIPLY"
        em.inputs[1].default_value = 1.6
        nt.links.new(veinmask.outputs["Value"], em.inputs[0])
        em_socket = "Emission Color" if "Emission Color" in b.inputs else "Emission"
        b.inputs[em_socket].default_value = PALETTE[mineral]
        nt.links.new(em.outputs["Value"], b.inputs["Emission Strength"])

    nt.links.new(color_out.outputs["Color"], b.inputs["Base Color"])
    bump = nt.nodes.new("ShaderNodeBump"); bump.location = (-120, -460)
    bump.inputs["Strength"].default_value = 0.55
    nt.links.new(grain.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    _out(nt, b)
    return m

def planet_surface(name="MAT_Planet_EarthLike", seed=0, ocean_level=0.52):
    """Continentes, oceanos, desierto, montanas y hielo polar por altura+latitud."""
    m, fresh = _new(name)
    if not fresh:
        return m
    nt = m.node_tree
    b = nt.nodes.new("ShaderNodeBsdfPrincipled"); b.location = (320, 0)
    coord = nt.nodes.new("ShaderNodeTexCoord"); coord.location = (-1100, 0)
    cont = nt.nodes.new("ShaderNodeTexNoise"); cont.location = (-880, 120)
    cont.noise_dimensions = '4D'  # Blender 4/5: el socket "W" solo existe en modo 4D
    cont.inputs["Scale"].default_value = 2.1
    cont.inputs["Detail"].default_value = 8.0
    cont.inputs["W"].default_value = seed * 0.31
    nt.links.new(coord.outputs["Object"], cont.inputs["Vector"])
    ramp = nt.nodes.new("ShaderNodeValToRGB"); ramp.location = (-620, 120)
    cr = ramp.color_ramp
    cr.elements[0].position = max(0.0, ocean_level - 0.09)
    cr.elements[0].color = (0.006, 0.02, 0.06, 1)          # oceano profundo
    cr.elements[1].position = ocean_level
    cr.elements[1].color = (0.02, 0.08, 0.17, 1)           # plataforma
    for pos, col in ((ocean_level + 0.02, (0.28, 0.24, 0.13, 1)),
                     (ocean_level + 0.09, (0.05, 0.12, 0.05, 1)),
                     (ocean_level + 0.19, (0.19, 0.16, 0.09, 1)),
                     (ocean_level + 0.3, (0.42, 0.42, 0.40, 1))):
        e = cr.elements.new(min(0.99, pos)); e.color = col
    nt.links.new(cont.outputs["Fac"], ramp.inputs["Fac"])
    # hielo polar por latitud (Z del objeto)
    sep = nt.nodes.new("ShaderNodeSeparateXYZ"); sep.location = (-880, -200)
    nt.links.new(coord.outputs["Object"], sep.inputs["Vector"])
    absz = nt.nodes.new("ShaderNodeMath"); absz.location = (-700, -200)
    absz.operation = "ABSOLUTE"
    nt.links.new(sep.outputs["Z"], absz.inputs[0])
    ice = nt.nodes.new("ShaderNodeValToRGB"); ice.location = (-520, -200)
    ice.color_ramp.elements[0].position = 0.78
    ice.color_ramp.elements[1].position = 0.94
    nt.links.new(absz.outputs["Value"], ice.inputs["Fac"])
    mixice = nt.nodes.new("ShaderNodeMixRGB"); mixice.location = (-260, 0)
    mixice.inputs["Color2"].default_value = (0.82, 0.87, 0.92, 1)
    nt.links.new(ice.outputs["Color"], mixice.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], mixice.inputs["Color1"])
    nt.links.new(mixice.outputs["Color"], b.inputs["Base Color"])
    # oceano liso / tierra rugosa
    rgh = nt.nodes.new("ShaderNodeValToRGB"); rgh.location = (-260, -380)
    rgh.color_ramp.elements[0].position = ocean_level - 0.01
    rgh.color_ramp.elements[0].color = (0.12,) * 3 + (1,)
    rgh.color_ramp.elements[1].position = ocean_level + 0.01
    rgh.color_ramp.elements[1].color = (0.92,) * 3 + (1,)
    nt.links.new(cont.outputs["Fac"], rgh.inputs["Fac"])
    nt.links.new(rgh.outputs["Color"], b.inputs["Roughness"])
    bump = nt.nodes.new("ShaderNodeBump"); bump.location = (-60, -520)
    bump.inputs["Strength"].default_value = 0.25
    nt.links.new(cont.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    _out(nt, b)
    return m

def gas_bands(name="MAT_GasGiant", seed=0, tint=(1.0, 0.62, 0.32)):
    m, fresh = _new(name)
    if not fresh:
        return m
    nt = m.node_tree
    b = nt.nodes.new("ShaderNodeBsdfPrincipled"); b.location = (320, 0)
    b.inputs["Roughness"].default_value = 1.0
    coord = nt.nodes.new("ShaderNodeTexCoord"); coord.location = (-1100, 0)
    # distorsion de bandas: ruido que empuja la coordenada Z
    warp = nt.nodes.new("ShaderNodeTexNoise"); warp.location = (-900, -200)
    warp.noise_dimensions = '4D'
    warp.inputs["Scale"].default_value = 2.4
    warp.inputs["Detail"].default_value = 6.0
    warp.inputs["W"].default_value = seed * 0.17
    nt.links.new(coord.outputs["Object"], warp.inputs["Vector"])
    wave = nt.nodes.new("ShaderNodeTexWave"); wave.location = (-640, 0)
    wave.wave_type = "BANDS"
    wave.bands_direction = "Z"
    wave.inputs["Scale"].default_value = 3.2
    wave.inputs["Distortion"].default_value = 12.0
    wave.inputs["Detail"].default_value = 6.0
    nt.links.new(coord.outputs["Object"], wave.inputs["Vector"])
    nt.links.new(warp.outputs["Fac"], wave.inputs["Phase Offset"])
    ramp = nt.nodes.new("ShaderNodeValToRGB"); ramp.location = (-380, 0)
    ramp.color_ramp.elements[0].color = tuple(c * 0.45 for c in tint) + (1,)
    ramp.color_ramp.elements[1].color = tuple(min(1, c * 1.25) for c in tint) + (1,)
    nt.links.new(wave.outputs["Fac"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], b.inputs["Base Color"])
    _out(nt, b)
    return m

def atmosphere(name="MAT_Atmosphere", color=(0.28, 0.55, 1.0), density=0.35):
    """Capa fresnel translucida; en Unity se replica con shader propio."""
    m, fresh = _new(name)
    if not fresh:
        return m
    m.blend_method = "BLEND"
    nt = m.node_tree
    em = nt.nodes.new("ShaderNodeEmission"); em.location = (60, 120)
    em.inputs["Color"].default_value = color + (1.0,)
    em.inputs["Strength"].default_value = 1.6
    tr = nt.nodes.new("ShaderNodeBsdfTransparent"); tr.location = (60, -60)
    mix = nt.nodes.new("ShaderNodeMixShader"); mix.location = (280, 0)
    lw = nt.nodes.new("ShaderNodeLayerWeight"); lw.location = (-180, 60)
    lw.inputs["Blend"].default_value = 0.32
    fac = nt.nodes.new("ShaderNodeMath"); fac.location = (-20, -220)
    fac.operation = "MULTIPLY"
    fac.inputs[1].default_value = density
    nt.links.new(lw.outputs["Fresnel"], fac.inputs[0])
    nt.links.new(tr.outputs[0], mix.inputs[1])
    nt.links.new(em.outputs[0], mix.inputs[2])
    nt.links.new(fac.outputs["Value"], mix.inputs["Fac"])
    _out(nt, mix, 500)
    return m

def clouds(name="MAT_Clouds", seed=0, density=0.55, color=(1, 1, 1)):
    m, fresh = _new(name)
    if not fresh:
        return m
    m.blend_method = "BLEND"
    nt = m.node_tree
    b = nt.nodes.new("ShaderNodeBsdfPrincipled"); b.location = (240, 60)
    b.inputs["Base Color"].default_value = color + (1.0,)
    b.inputs["Roughness"].default_value = 1.0
    tr = nt.nodes.new("ShaderNodeBsdfTransparent"); tr.location = (240, -160)
    mix = nt.nodes.new("ShaderNodeMixShader"); mix.location = (460, 0)
    coord = nt.nodes.new("ShaderNodeTexCoord"); coord.location = (-820, 0)
    nz = nt.nodes.new("ShaderNodeTexNoise"); nz.location = (-620, 0)
    nz.noise_dimensions = '4D'
    nz.inputs["Scale"].default_value = 3.4
    nz.inputs["Detail"].default_value = 9.0
    nz.inputs["W"].default_value = seed * 0.29
    nt.links.new(coord.outputs["Object"], nz.inputs["Vector"])
    ramp = nt.nodes.new("ShaderNodeValToRGB"); ramp.location = (-380, 0)
    ramp.color_ramp.elements[0].position = 1.0 - density
    ramp.color_ramp.elements[1].position = min(0.99, 1.15 - density)
    nt.links.new(nz.outputs["Fac"], ramp.inputs["Fac"])
    nt.links.new(tr.outputs[0], mix.inputs[1])
    nt.links.new(b.outputs[0], mix.inputs[2])
    nt.links.new(ramp.outputs["Color"], mix.inputs["Fac"])
    _out(nt, mix, 660)
    return m

def star_surface(name="MAT_Star_Yellow", tint=(1.0, 0.72, 0.28), strength=28.0):
    m, fresh = _new(name)
    if not fresh:
        return m
    nt = m.node_tree
    em = nt.nodes.new("ShaderNodeEmission"); em.location = (240, 0)
    em.inputs["Strength"].default_value = strength
    coord = nt.nodes.new("ShaderNodeTexCoord"); coord.location = (-900, 0)
    gran = nt.nodes.new("ShaderNodeTexNoise"); gran.location = (-700, 120)
    gran.inputs["Scale"].default_value = 24.0
    gran.inputs["Detail"].default_value = 8.0
    nt.links.new(coord.outputs["Object"], gran.inputs["Vector"])
    spots = nt.nodes.new("ShaderNodeTexNoise"); spots.location = (-700, -140)
    spots.inputs["Scale"].default_value = 3.0
    nt.links.new(coord.outputs["Object"], spots.inputs["Vector"])
    ramp = nt.nodes.new("ShaderNodeValToRGB"); ramp.location = (-440, 120)
    ramp.color_ramp.elements[0].color = tuple(c * 0.5 for c in tint) + (1,)
    ramp.color_ramp.elements[1].color = (1, 1, 0.92, 1)
    nt.links.new(gran.outputs["Fac"], ramp.inputs["Fac"])
    dark = nt.nodes.new("ShaderNodeValToRGB"); dark.location = (-440, -140)
    dark.color_ramp.elements[0].position = 0.62
    dark.color_ramp.elements[1].position = 0.72
    dark.color_ramp.elements[0].color = (1, 1, 1, 1)
    dark.color_ramp.elements[1].color = (0.16, 0.08, 0.04, 1)
    nt.links.new(spots.outputs["Fac"], dark.inputs["Fac"])
    mul = nt.nodes.new("ShaderNodeMixRGB"); mul.location = (-180, 0)
    mul.blend_type = "MULTIPLY"
    mul.inputs["Fac"].default_value = 1.0
    nt.links.new(ramp.outputs["Color"], mul.inputs["Color1"])
    nt.links.new(dark.outputs["Color"], mul.inputs["Color2"])
    nt.links.new(mul.outputs["Color"], em.inputs["Color"])
    _out(nt, em, 460)
    return m

def nebula_volume(name="MAT_Nebula_Blue", color=(0.16, 0.35, 1.0), density=0.06,
                  emission=(0.2, 0.45, 1.0), seed=0):
    m, fresh = _new(name)
    if not fresh:
        return m
    nt = m.node_tree
    vol = nt.nodes.new("ShaderNodePrincipledVolume"); vol.location = (240, 0)
    vol.inputs["Color"].default_value = color + (1.0,)
    vol.inputs["Emission Color"].default_value = emission + (1.0,)
    vol.inputs["Emission Strength"].default_value = 0.6
    coord = nt.nodes.new("ShaderNodeTexCoord"); coord.location = (-900, 0)
    nz = nt.nodes.new("ShaderNodeTexNoise"); nz.location = (-680, 0)
    nz.noise_dimensions = '4D'
    nz.inputs["Scale"].default_value = 1.4
    nz.inputs["Detail"].default_value = 12.0
    nz.inputs["W"].default_value = seed * 0.41
    nt.links.new(coord.outputs["Object"], nz.inputs["Vector"])
    ramp = nt.nodes.new("ShaderNodeValToRGB"); ramp.location = (-440, 0)
    ramp.color_ramp.elements[0].position = 0.45
    ramp.color_ramp.elements[1].position = 0.75
    nt.links.new(nz.outputs["Fac"], ramp.inputs["Fac"])
    dens = nt.nodes.new("ShaderNodeMath"); dens.location = (-200, 0)
    dens.operation = "MULTIPLY"
    dens.inputs[1].default_value = density
    nt.links.new(ramp.outputs["Color"], dens.inputs[0])
    nt.links.new(dens.outputs["Value"], vol.inputs["Density"])
    out = nt.nodes.new("ShaderNodeOutputMaterial"); out.location = (480, 0)
    nt.links.new(vol.outputs[0], out.inputs["Volume"])
    return m

def assign(ob, mat, slot=None):
    if slot is None:
        ob.data.materials.append(mat)
    else:
        while len(ob.data.materials) <= slot:
            ob.data.materials.append(None)
        ob.data.materials[slot] = mat
    return ob

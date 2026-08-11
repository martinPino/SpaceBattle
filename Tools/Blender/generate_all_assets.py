"""
generate_all_assets.py - pipeline completo del Space Asset Kit.

  blender --background --python Tools/Blender/generate_all_assets.py
  blender --background --python Tools/Blender/generate_all_assets.py -- --slice
  blender --background --python Tools/Blender/generate_all_assets.py -- --skip-skybox

Pasos por asset: limpiar escena -> geometria -> materiales procedurales ->
UVs -> transforms aplicados -> LOD0/1/2 -> colliders -> empties tecnicos ->
guardar .blend -> exportar FBX + GLB -> anotar en generation_report.txt.

--slice genera solo el vertical slice (15 assets).
"""
import bpy, sys, os, time, traceback
sys.path.append(os.path.dirname(__file__))
import sk_core as C

LOG = []

def step(label, fn, *args, **kwargs):
    t0 = time.time()
    try:
        C.clean_scene()
        out = fn(*args, **kwargs)
        msg = "OK   %-38s %5.1fs" % (label, time.time() - t0)
        LOG.append(msg)
        print(msg)
        return out
    except Exception as exc:                     # nunca abortar todo el lote
        msg = "FAIL %-38s %s" % (label, exc)
        LOG.append(msg)
        LOG.append(traceback.format_exc(limit=3))
        print(msg)
        return None

def vertical_slice(skip_skybox=False):
    import generate_player_ship as PS
    import generate_enemy_ships as ES
    import generate_planets as PLA
    import generate_asteroids as AST
    import generate_stars as STA
    import generate_nebulas as NEB
    import generate_galaxies as GAL
    import generate_space_station as STN
    import generate_skybox as SKY

    step("SHIP_Player_Fighter_01", PS.build)
    C.save_blend("SHIP_Player_Fighter_01")
    step("SHIP_Enemy_Interceptor_01", ES.interceptor)
    C.save_blend("SHIP_Enemy_Interceptor_01")
    step("ENV_Planet_EarthLike_01", PLA.earthlike)
    step("ENV_Planet_GasGiant_01", PLA.gas_giant)
    step("ENV_Planet_Ringed_01", PLA.ringed)
    step("ENV_Moon_Rocky_01", PLA.moon)
    C.save_blend("ENV_Planets")
    step("ENV_Star_Yellow_01", STA.star, kind="Yellow")
    C.save_blend("ENV_Star_Yellow_01")
    step("ENV_Asteroid_Medium_01", AST.build_asteroid,
         "ENV_Asteroid_Medium_01", 20481, 11.0, 5, 16, 3, "Rocky")
    step("ENV_Asteroid_Large_01", AST.build_asteroid,
         "ENV_Asteroid_Large_01", 88117, 46.0, 6, 34, 6, "Dark")
    step("ENV_AsteroidField_01", AST.asteroid_field)
    C.save_blend("ENV_Asteroids")
    step("ENV_Nebula_Blue_01", NEB.nebula_billboards,
         "ENV_Nebula_Blue_01", "Blue")
    step("ENV_Galaxy_Spiral_01", GAL.galaxy)
    step("PROP_SpaceStation_01", STN.station_01)
    step("ENV_Comet_01", STN.comet)
    if not skip_skybox:
        step("Skybox_DeepSpace", SKY.bake_equirect, "DeepSpace")

def full_kit(skip_skybox=False):
    import generate_enemy_ships as ES
    import generate_planets as PLA
    import generate_asteroids as AST
    import generate_stars as STA
    import generate_nebulas as NEB
    import generate_galaxies as GAL
    import generate_space_station as STN
    import generate_skybox as SKY
    import generate_space_environment as ENV

    vertical_slice(skip_skybox)
    step("SHIP_Enemy_Heavy_01", ES.heavy)
    step("ENV_Planet_Desert_01", PLA.desert)
    step("ENV_Planet_Volcanic_01", PLA.volcanic)
    step("ENV_Planet_Ice_01", PLA.icy)
    for kind in ("Blue", "Red", "White", "Orange"):
        step("ENV_Star_%s_01" % kind, STA.star, kind=kind)
    step("ENV_Asteroids_All", AST.generate)
    for style in ("Purple", "Red", "Turquoise", "Golden"):
        step("ENV_Nebula_%s_01" % style, NEB.nebula_billboards,
             "ENV_Nebula_%s_01" % style, style)
    step("ENV_CosmicDust_01", NEB.cosmic_dust)
    step("ENV_Galaxy_Spiral_02", GAL.galaxy, "ENV_Galaxy_Spiral_02", "Spiral", 812)
    step("ENV_Galaxy_Barred_01", GAL.galaxy, "ENV_Galaxy_Barred_01", "Barred", 813)
    step("ENV_Galaxy_Elliptical_01", GAL.galaxy, "ENV_Galaxy_Elliptical_01", "Elliptical", 814)
    step("ENV_Galaxy_Irregular_01", GAL.galaxy, "ENV_Galaxy_Irregular_01", "Irregular", 815)
    step("ENV_BlackHole_01", GAL.black_hole)
    step("PROP_Satellite_Comms_01", STN.satellite)
    step("PROP_WarpGate_01", STN.warp_gate)
    step("PROP_NavigationBeacon_01", STN.beacon)
    step("ENV_DebrisField_01", STN.debris_field)
    if not skip_skybox:
        for v in ("BlueNebula", "RedNebula", "GalacticCore", "DarkVoid"):
            step("Skybox_%s" % v, SKY.bake_equirect, v)
    for fn in ENV.MAPS:
        step(fn.__name__, fn)

if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    only_slice = "--slice" in argv
    skip_skybox = "--skip-skybox" in argv
    t0 = time.time()
    C.ensure_dirs(C.OUT_MODELS, C.OUT_BLEND, C.OUT_TEX)
    (vertical_slice if only_slice else full_kit)(skip_skybox)
    report = C.write_report()
    log_path = os.path.join(os.path.dirname(__file__), "generation_log.txt")
    with open(log_path, "w", encoding="utf-8") as f:
        f.write("\n".join(LOG))
        f.write("\n\ntotal %.1fs\n" % (time.time() - t0))
    print("report:", report)
    print("log:", log_path)

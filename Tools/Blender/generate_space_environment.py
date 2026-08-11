"""
generate_space_environment.py - composicion de los 5 mapas del brief.

Distancias de gameplay: nada mas alla de ~20 km para evitar problemas de
precision de coma flotante; los planetas, estrellas y galaxias se colocan
lejos con escala visual reducida en lugar de distancias astronomicas.
"""
import bpy, sys, os, math
sys.path.append(os.path.dirname(__file__))
import sk_core as C
import generate_asteroids as AST
import generate_planets as PLA
import generate_stars as STA
import generate_nebulas as NEB
import generate_galaxies as GAL
import generate_space_station as STN
from generate_player_ship import build as build_player
from generate_enemy_ships import interceptor, heavy
from mathutils import Vector

def _camera(loc, look_at=(0, 0, 0), lens=32.0):
    cam_data = bpy.data.cameras.new("DemoCam")
    cam_data.lens = lens
    cam = bpy.data.objects.new("DemoCam", cam_data)
    cam.location = loc
    d = Vector(look_at) - Vector(loc)
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.collection.objects.link(cam)
    bpy.context.scene.camera = cam
    return cam

def map_deep_space(name="MAP_01_DeepSpace"):
    C.clean_scene()
    build_player().location = (0, 0, 0)
    PLA.earthlike(radius=600.0).location = (-2600, 7200, -600)
    PLA.moon("ENV_Moon_Rocky_01", 5150, 160.0).location = (-1400, 4200, 500)
    PLA.moon("ENV_Moon_Dark_01", 5151, 110.0, "Dark").location = (900, 5200, -300)
    STA.star(kind="Yellow", radius=900.0).location = (6000, 12000, 2600)
    STA.background_starfield(radius=14000.0)
    GAL.galaxy("ENV_Galaxy_Spiral_01", "Spiral", 811, radius=5000.0).location = (-9000, 15000, 3800)
    AST.asteroid_field(count=26, radius=900.0, size_max=14.0)
    _camera((-26, -70, 16), (0, 10, 2))
    C.save_blend(name)
    return name

def map_asteroid_belt(name="MAP_02_AsteroidBelt"):
    C.clean_scene()
    build_player().location = (0, 0, 0)
    AST.asteroid_field(count=90, radius=1400.0, size_max=40.0)
    PLA.gas_giant(radius=900.0).location = (3200, 9000, -400)
    PLA.moon("ENV_Moon_Rocky_02", 5152, 140.0).location = (1800, 5200, 300)
    NEB.nebula_billboards("ENV_Nebula_Golden_01", "Golden", 18, 4000.0)
    STN.station_01("PROP_MiningStation_01").location = (-300, 900, 60)
    STN.debris_field(count=30, radius=320.0)
    interceptor().location = (40, 160, 12)
    _camera((-40, -90, 22), (0, 20, 4))
    C.save_blend(name)
    return name

def map_blue_nebula(name="MAP_03_BlueNebula"):
    C.clean_scene()
    build_player().location = (0, 0, 0)
    NEB.nebula_billboards("ENV_Nebula_Blue_01", "Blue", 30, 5200.0)
    NEB.cosmic_dust(extent=2200.0)
    PLA.icy(radius=520.0).location = (-2200, 6800, -300)
    STA.star(kind="Blue", radius=700.0).location = (5200, 11000, 1800)
    STN.comet("ENV_Comet_01", 6200, 20.0, 1100.0).location = (-600, 2400, 260)
    AST.asteroid_field(count=30, radius=900.0, size_max=18.0)
    _camera((-30, -80, 14), (0, 16, 2))
    C.save_blend(name)
    return name

def map_red_system(name="MAP_04_RedSystem"):
    C.clean_scene()
    build_player().location = (0, 0, 0)
    STA.star(kind="Red", radius=1400.0).location = (4200, 10000, 1200)
    PLA.volcanic(radius=560.0).location = (-1800, 6200, -500)
    PLA.moon("ENV_Moon_Broken_01", 5153, 120.0, "Dark").location = (-900, 3600, 420)
    NEB.nebula_billboards("ENV_Nebula_Red_01", "Red", 22, 4200.0)
    AST.asteroid_field(count=44, radius=1100.0, size_max=26.0)
    STN.debris_field("ENV_DebrisField_02", 6101, 46, 400.0)
    heavy().location = (120, 320, -20)
    _camera((-44, -96, 18), (0, 24, 2))
    C.save_blend(name)
    return name

def map_galactic_frontier(name="MAP_05_GalacticFrontier"):
    C.clean_scene()
    build_player().location = (0, 0, 0)
    GAL.galaxy("ENV_Galaxy_Barred_01", "Barred", 813, radius=6000.0).location = (-8000, 16000, 4200)
    PLA.ringed(radius=780.0).location = (2800, 8200, -300)
    for i, (r, loc) in enumerate(((130.0, (1200, 4200, 260)),
                                  (90.0, (2100, 5400, -180)),
                                  (60.0, (600, 3200, 420)))):
        PLA.moon("ENV_Moon_Rocky_%02d" % (i + 3), 5160 + i, r).location = loc
    STN.station_01("PROP_SpaceStation_01").location = (-400, 1200, 40)
    AST.asteroid_field(count=22, radius=700.0, size_max=12.0)
    interceptor().location = (-60, 240, 18)
    interceptor("SHIP_Enemy_Interceptor_02", 2003).location = (30, 300, -14)
    _camera((-34, -84, 20), (0, 18, 4))
    C.save_blend(name)
    return name

MAPS = [map_deep_space, map_asteroid_belt, map_blue_nebula,
        map_red_system, map_galactic_frontier]

if __name__ == "__main__":
    for fn in MAPS:
        fn()
    C.write_report()

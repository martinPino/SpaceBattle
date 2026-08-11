#if UNITY_EDITOR
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.SceneManagement;

/// <summary>
/// Construye la escena SpaceBattle con un click: menú Tools → Space Battle → Montar escena base.
/// Genera el campo de estrellas procedural (2 capas), nebulosas, sol, planetas, luna, campo de
/// asteroides con colliders, y el prefab PlayerShip con modelo visual intercambiable.
/// Re-ejecutable: regenera escena, prefab, mallas y texturas sobrescribiendo.
/// </summary>
public static class SpaceSceneBuilder
{
    private const int Seed = 12345; // starfield y asteroides deterministas entre re-ejecuciones

    // Nave placeholder por orden de preferencia (Kenney mira a -Z: yaw 180).
    // Rutas completas: primero el caza del kit propio (ya llega con +Z como morro),
    // después los placeholders CC0 (que miran a -Z: yaw 180).
    private static readonly (string path, float yaw)[] ShipCandidates =
    {
        ("Assets/Game/Models/Generated/Ships/SHIP_Player_Fighter_01.glb", 0f),
        ("Assets/ThirdParty/Ships/quaternius_fighter.glb", 180f),
        ("Assets/ThirdParty/Ships/craft_racer.glb", 180f),
    };

    /// <summary>Nave usada en el último montaje (para el VERIFY).</summary>
    public static string UsedShipFile { get; private set; } = "(ninguna)";

    [MenuItem("Tools/Space Battle/Montar escena base")]
    public static void BuildScene()
    {
        if (Application.isPlaying)
        {
            EditorUtility.DisplayDialog("Space Battle",
                "Detén el modo Play (botón ▶) antes de montar la escena.", "OK");
            return;
        }

        EditorSceneManager.NewScene(NewSceneSetup.DefaultGameObjects, NewSceneMode.Single);

        Directory.CreateDirectory("Assets/Game/Materials");
        Directory.CreateDirectory("Assets/Game/VFX");
        Directory.CreateDirectory("Assets/Game/Scenes");
        Directory.CreateDirectory("Assets/Game/Prefabs/Player");
        Directory.CreateDirectory("Assets/Game/Prefabs/Environment");
        Directory.CreateDirectory("Assets/Game/Prefabs/Weapons");
        AssetDatabase.Refresh();

        // --- Ambiente espacial: negro casi absoluto con un toque azul ---
        RenderSettings.fog = false;
        RenderSettings.ambientMode = AmbientMode.Flat;
        RenderSettings.ambientLight = new Color(0.03f, 0.035f, 0.06f); // espacio: casi negro
        RenderSettings.skybox = null;

        // --- Sol: luz direccional + esfera emissive lejana alineada ---
        var environment = new GameObject("Environment");
        Vector3 sunDirection = new Vector3(-0.35f, -0.25f, 0.9f).normalized; // de dónde viene la luz
        GameObject lightObject = GameObject.Find("Directional Light");
        if (lightObject != null)
        {
            Light sun = lightObject.GetComponent<Light>();
            sun.intensity = 1.5f; // iluminación contrastada: sol duro sobre negro

            sun.color = new Color(1f, 0.96f, 0.88f);
            lightObject.transform.rotation = Quaternion.LookRotation(sunDirection);
        }
        Material sunMat = CreateEmissiveMaterial("Sun", Color.black, new Color(1f, 0.93f, 0.75f) * 5f);
        GameObject sunSphere = GameObject.CreatePrimitive(PrimitiveType.Sphere);
        sunSphere.name = "Sun";
        sunSphere.transform.SetParent(environment.transform);
        sunSphere.transform.position = -sunDirection * 18000f;
        sunSphere.transform.localScale = Vector3.one * 1400f;
        Object.DestroyImmediate(sunSphere.GetComponent<Collider>());
        sunSphere.GetComponent<Renderer>().sharedMaterial = sunMat;

        // Resplandor del sol: halo aditivo gigante de cara al centro del mapa.
        GameObject sunHalo = GameObject.CreatePrimitive(PrimitiveType.Quad);
        sunHalo.name = "SunHalo";
        Object.DestroyImmediate(sunHalo.GetComponent<Collider>());
        sunHalo.transform.SetParent(environment.transform);
        sunHalo.transform.position = sunSphere.transform.position;
        sunHalo.transform.rotation = Quaternion.LookRotation(sunSphere.transform.position);
        sunHalo.transform.localScale = Vector3.one * 5500f;
        sunHalo.GetComponent<Renderer>().sharedMaterial =
            CreateAdditiveTexturedMaterial("SunHalo", EnsureDotTexture(), new Color(1f, 0.85f, 0.6f, 0.6f));

        var rng = new System.Random(Seed);

        BuildStarfield(environment.transform, rng);
        BuildNebulas(environment.transform, rng);
        BuildPlanets(environment.transform);
        BuildAsteroidField(environment.transform, rng);

        // Piezas del kit como decorado: estación (con sus colliders), galaxia lejana y cometa.
        GameObject station = TryKitBody("Stations/PROP_SpaceStation_01", environment.transform,
            new Vector3(650f, 130f, 1900f), 260f, 0.05f);
        if (station != null)
        {
            station.name = "SpaceStation";
            foreach (Transform part in station.GetComponentsInChildren<Transform>(true))
            {
                if (!part.name.EndsWith("_Collider")) continue;
                MeshFilter meshFilter = part.GetComponent<MeshFilter>();
                if (meshFilter == null || meshFilter.sharedMesh == null) continue;
                foreach (Renderer r in part.GetComponentsInChildren<Renderer>(true)) r.enabled = false;
                MeshCollider meshCollider = part.gameObject.AddComponent<MeshCollider>();
                meshCollider.sharedMesh = meshFilter.sharedMesh;
                meshCollider.convex = true;
            }
        }
        TryKitBody("Environment/ENV_Galaxy_Spiral_01", environment.transform,
            new Vector3(-12000f, 4500f, -15000f), 7000f, 0.01f);
        TryKitBody("Environment/ENV_Comet_01", environment.transform,
            new Vector3(-350f, 90f, 1500f), 35f, 2f);

        // --- PlayerShip (prefab con modelo visual intercambiable) ---
        GameObject playerPrefab = BuildPlayerShipPrefab();
        GameObject player = (GameObject)PrefabUtility.InstantiatePrefab(playerPrefab);
        player.transform.position = Vector3.zero;

        // --- Cámara third-person ---
        Camera mainCamera = Camera.main;
        mainCamera.clearFlags = CameraClearFlags.SolidColor;
        mainCamera.backgroundColor = Color.black;
        mainCamera.farClipPlane = 40000f;
        mainCamera.fieldOfView = 62f;
        ApplySkybox(mainCamera); // skybox equirect horneado por el kit (si existe)
        mainCamera.transform.position = player.transform.TransformPoint(new Vector3(0f, 4f, -14f));
        mainCamera.transform.rotation = Quaternion.LookRotation(player.transform.forward);
        SpaceCamera spaceCamera = mainCamera.gameObject.AddComponent<SpaceCamera>();
        SetPrivateReference(spaceCamera, "target", player.transform);
        SetPrivateReference(spaceCamera, "controller", player.GetComponent<PlayerShipController>());

        // --- GameManager (marcador de posición para fases posteriores) ---
        new GameObject("GameManager");

        EditorSceneManager.SaveScene(SceneManager.GetActiveScene(), "Assets/Game/Scenes/SpaceBattle.unity");

        EditorUtility.DisplayDialog("Space Battle",
            "Escena montada y guardada en Assets/Game/Scenes/SpaceBattle.unity.\n\n" +
            "W/S acelerar-frenar · ratón orientar · A/D lateral · R/F vertical · Q/E roll · Shift turbo.",
            "OK");
    }

    /// <summary>Solo para pruebas batch: construye y comprueba el montaje esencial.</summary>
    public static void BuildAndVerify()
    {
        BuildScene();

        bool ok = true;
        GameObject player = GameObject.Find("PlayerShip");
        if (player == null || player.GetComponent<Rigidbody>() == null || player.GetComponent<PlayerShipController>() == null)
        { Debug.Log("VERIFY FAIL: PlayerShip sin Rigidbody o controlador"); ok = false; }
        if (player != null && player.GetComponentsInChildren<Renderer>().Length == 0)
        { Debug.Log("VERIFY FAIL: PlayerShip sin modelo visual (¿glb no importado?)"); ok = false; }
        SpaceCamera cam = Object.FindFirstObjectByType<SpaceCamera>();
        if (cam == null) { Debug.Log("VERIFY FAIL: sin SpaceCamera"); ok = false; }
        GameObject starfield = GameObject.Find("Starfield");
        MeshFilter stars = starfield != null ? starfield.GetComponent<MeshFilter>() : null;
        if (stars == null || stars.sharedMesh == null || stars.sharedMesh.vertexCount < 1000)
        { Debug.Log("VERIFY FAIL: campo de estrellas vacío"); ok = false; }
        int asteroids = GameObject.Find("AsteroidField")?.transform.childCount ?? 0;
        if (asteroids < 10) { Debug.Log($"VERIFY FAIL: solo {asteroids} asteroides"); ok = false; }
        if (Object.FindFirstObjectByType<ShipWeapons>() == null)
        { Debug.Log("VERIFY FAIL: sin armas"); ok = false; }
        if (Object.FindFirstObjectByType<EngineEffects>() == null)
        { Debug.Log("VERIFY FAIL: sin efectos de motor"); ok = false; }
        bool hasRings = Object.FindObjectsByType<Transform>(FindObjectsSortMode.None)
            .Any(t => t.name.Contains("Ring"));
        if (!hasRings)
        { Debug.Log("VERIFY FAIL: sin anillos (ni procedurales ni del kit)"); ok = false; }
        Debug.Log($"VERIFY nave: {UsedShipFile} · skybox: {(RenderSettings.skybox != null ? "kit" : "no")}");
        if (GameObject.Find("SpaceDust") == null)
        { Debug.Log("VERIFY FAIL: sin polvo espacial"); ok = false; }
        Debug.Log(ok ? $"VERIFY PASS: nave, cámara, armas, motores, {stars.sharedMesh.vertexCount / 4} estrellas y {asteroids} asteroides"
                     : "VERIFY FAIL: revisar montaje");
    }

    /// <summary>Dos capas de estrellas como UNA malla de quads orientados al centro,
    /// con color y brillo variados por vértice (shader aditivo, inmune a la luz).</summary>
    private static void BuildStarfield(Transform parent, System.Random rng)
    {
        var vertices = new System.Collections.Generic.List<Vector3>();
        var colors = new System.Collections.Generic.List<Color>();
        var uvs = new System.Collections.Generic.List<Vector2>();
        var triangles = new System.Collections.Generic.List<int>();

        void AddStars(int count, float radius, float minSize, float maxSize, float brightness)
        {
            for (int i = 0; i < count; i++)
            {
                Vector3 direction = RandomDirection(rng);
                Vector3 center = direction * (radius * (0.9f + 0.2f * (float)rng.NextDouble()));
                float size = Mathf.Lerp(minSize, maxSize, (float)rng.NextDouble());

                // Tinte estelar: blanco, azulado, amarillento o rojizo.
                float roll = (float)rng.NextDouble();
                Color tint = roll < 0.55f ? Color.white
                    : roll < 0.75f ? new Color(0.75f, 0.85f, 1f)
                    : roll < 0.92f ? new Color(1f, 0.93f, 0.75f)
                    : new Color(1f, 0.72f, 0.6f);
                tint *= brightness * (0.35f + 0.65f * (float)rng.NextDouble());

                Vector3 normal = -direction;
                Vector3 right = Vector3.Cross(normal, Vector3.up).normalized;
                if (right.sqrMagnitude < 0.01f) right = Vector3.right;
                Vector3 up = Vector3.Cross(right, normal);

                int baseIndex = vertices.Count;
                vertices.Add(center - right * size - up * size);
                vertices.Add(center + right * size - up * size);
                vertices.Add(center + right * size + up * size);
                vertices.Add(center - right * size + up * size);
                for (int v = 0; v < 4; v++) colors.Add(tint);
                uvs.Add(new Vector2(0, 0)); uvs.Add(new Vector2(1, 0));
                uvs.Add(new Vector2(1, 1)); uvs.Add(new Vector2(0, 1));
                triangles.AddRange(new[] { baseIndex, baseIndex + 2, baseIndex + 1, baseIndex, baseIndex + 3, baseIndex + 2 });
            }
        }

        AddStars(1400, 18000f, 25f, 70f, 1.7f);  // fondo lejano
        AddStars(600, 12000f, 30f, 90f, 2.3f);   // capa media, más brillante
        AddStars(45, 10000f, 150f, 280f, 1.1f);  // estrellas destacadas con halo grande

        var mesh = new Mesh { name = "StarfieldMesh" };
        mesh.indexFormat = UnityEngine.Rendering.IndexFormat.UInt32;
        mesh.SetVertices(vertices);
        mesh.SetColors(colors);
        mesh.SetUVs(0, uvs);
        mesh.SetTriangles(triangles, 0);
        mesh.bounds = new Bounds(Vector3.zero, Vector3.one * 40000f); // nunca se recorta por culling
        AssetDatabase.DeleteAsset("Assets/Game/VFX/StarfieldMesh.asset");
        AssetDatabase.CreateAsset(mesh, "Assets/Game/VFX/StarfieldMesh.asset");

        Material starMat = CreateAdditiveTexturedMaterial("Stars", EnsureDotTexture());

        var starfield = new GameObject("Starfield");
        starfield.transform.SetParent(parent);
        starfield.AddComponent<MeshFilter>().sharedMesh = mesh;
        starfield.AddComponent<MeshRenderer>().sharedMaterial = starMat;
    }

    /// <summary>Nebulosas: quads gigantes lejanos con textura de nubes Perlin, aditivos.</summary>
    private static void BuildNebulas(Transform parent, System.Random rng)
    {
        Material nebulaMat = CreateAdditiveTexturedMaterial("Nebula", EnsureNebulaTexture());
        Color[] tints =
        {
            new Color(0.35f, 0.3f, 0.9f, 0.5f),   // violeta
            new Color(0.2f, 0.45f, 0.95f, 0.5f),  // azul
            new Color(0.2f, 0.85f, 0.8f, 0.4f),   // turquesa
            new Color(0.85f, 0.25f, 0.45f, 0.4f), // rojiza
            new Color(0.5f, 0.3f, 0.85f, 0.45f),  // púrpura
        };

        var root = new GameObject("Nebulas");
        root.transform.SetParent(parent);
        for (int i = 0; i < tints.Length; i++)
        {
            Vector3 direction = RandomDirection(rng);
            GameObject quad = GameObject.CreatePrimitive(PrimitiveType.Quad);
            quad.name = $"Nebula_{i}";
            quad.transform.SetParent(root.transform);
            Object.DestroyImmediate(quad.GetComponent<Collider>());
            quad.transform.position = direction * 16000f;
            quad.transform.rotation = Quaternion.LookRotation(direction); // de cara al centro
            quad.transform.localScale = Vector3.one * Mathf.Lerp(6000f, 10000f, (float)rng.NextDouble());

            var instanceMat = new Material(nebulaMat);
            instanceMat.SetColor("_TintColor", tints[i]); // el shader aditivo tiñe con _TintColor
            AssetDatabase.CreateAsset(instanceMat, $"Assets/Game/Materials/Nebula_{i}.mat");
            quad.GetComponent<Renderer>().sharedMaterial = instanceMat;
        }
    }

    /// <summary>Planetas 3D con texturas procedurales realistas (fBm desaturado), halo de
    /// atmósfera donde corresponde, anillos en el gigante, y rotación lenta.</summary>
    private static void BuildPlanets(Transform parent)
    {
        var root = new GameObject("Planets");
        root.transform.SetParent(parent);

        GameObject Planet(string name, Vector3 pos, float scale, Texture2D texture, float rotationSpeed)
        {
            GameObject sphere = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            sphere.name = name;
            sphere.transform.SetParent(root.transform);
            sphere.transform.position = pos;
            sphere.transform.localScale = Vector3.one * scale;
            Object.DestroyImmediate(sphere.GetComponent<Collider>());
            // Tinte blanco: el color lo pone la textura (el doble tinte saturaba los planetas).
            var material = new Material(Shader.Find("Standard")) { color = Color.white, mainTexture = texture };
            material.SetFloat("_Glossiness", 0.06f);
            AssetDatabase.CreateAsset(material, $"Assets/Game/Materials/{name}.mat");
            sphere.GetComponent<Renderer>().sharedMaterial = material;
            sphere.AddComponent<PlanetRotator>().Configure(new Vector3(0f, rotationSpeed, 0f));
            return sphere;
        }

        void Atmosphere(GameObject planet, Color tint)
        {
            // Halo aditivo fijo (no cuelga del planeta: la rotación no debe girarlo).
            GameObject halo = GameObject.CreatePrimitive(PrimitiveType.Quad);
            halo.name = planet.name + "_Atmosphere";
            Object.DestroyImmediate(halo.GetComponent<Collider>());
            halo.transform.SetParent(root.transform);
            halo.transform.position = planet.transform.position;
            halo.transform.rotation = Quaternion.LookRotation(planet.transform.position); // de cara al origen
            halo.transform.localScale = Vector3.one * planet.transform.localScale.x * 2.7f;
            halo.GetComponent<Renderer>().sharedMaterial =
                CreateAdditiveTexturedMaterial(planet.name + "_Halo", EnsureHaloTexture(), tint);
        }

        // Planetas del kit propio primero; esferas con textura procedural como plan B.
        GameObject giant = TryKitBody("Planets/ENV_Planet_GasGiant_01", root.transform,
                new Vector3(9000f, 2200f, 14000f), 2600f, 0.15f)
            ?? Planet("Planet_Giant", new Vector3(9000f, 2200f, 14000f), 2600f,
                EnsurePlanetTexture("planet_gas_v2", GasGiantPixel), 0.15f);
        giant.name = "Planet_Giant";
        Atmosphere(giant, new Color(0.75f, 0.6f, 0.4f, 0.35f));
        if (giant.GetComponent<MeshFilter>() != null)
            BuildRing(giant); // el anillo procedural solo sobre la esfera del plan B

        GameObject rocky = TryKitBody("Planets/ENV_Planet_EarthLike_01", root.transform,
                new Vector3(-4200f, -900f, 6000f), 700f, 0.4f)
            ?? Planet("Planet_02", new Vector3(-4200f, -900f, 6000f), 700f,
                EnsurePlanetTexture("planet_rocky_v2", RockyPixel), 0.4f);
        rocky.name = "Planet_02";
        Atmosphere(rocky, new Color(0.35f, 0.55f, 0.95f, 0.45f));

        GameObject third = TryKitBody("Planets/ENV_Planet_Ringed_01", root.transform,
                new Vector3(5200f, -1600f, -7500f), 900f, 0.3f)
            ?? Planet("Planet_03", new Vector3(5200f, -1600f, -7500f), 420f,
                EnsurePlanetTexture("planet_ice_v2", IcePixel), 0.3f);
        third.name = "Planet_03";

        GameObject moon = TryKitBody("Planets/ENV_Moon_Rocky_01", root.transform,
                new Vector3(-3400f, -700f, 5300f), 130f, 0.6f)
            ?? Planet("Moon_01", new Vector3(-3400f, -700f, 5300f), 130f,
                EnsurePlanetTexture("moon_v2", MoonPixel), 0.6f);
        moon.name = "Moon_01";
    }

    /// <summary>Anillos del gigante: malla anular de doble cara, hija del planeta
    /// (hereda escala y rotación lenta), con bandas procedurales semitransparentes.</summary>
    private static void BuildRing(GameObject planet)
    {
        const int segments = 96;
        var vertices = new System.Collections.Generic.List<Vector3>();
        var uvs = new System.Collections.Generic.List<Vector2>();
        var triangles = new System.Collections.Generic.List<int>();
        for (int i = 0; i <= segments; i++)
        {
            float angle = i / (float)segments * Mathf.PI * 2f;
            Vector3 direction = new Vector3(Mathf.Cos(angle), 0f, Mathf.Sin(angle));
            vertices.Add(direction * 0.7f);  uvs.Add(new Vector2(0f, 0.5f)); // la esfera tiene radio 0.5
            vertices.Add(direction * 1.25f); uvs.Add(new Vector2(1f, 0.5f));
        }
        for (int i = 0; i < segments; i++)
        {
            int a = i * 2;
            triangles.AddRange(new[] { a, a + 1, a + 2, a + 1, a + 3, a + 2 });
            triangles.AddRange(new[] { a, a + 2, a + 1, a + 1, a + 2, a + 3 }); // cara inferior
        }
        var mesh = new Mesh { name = "PlanetRing" };
        mesh.SetVertices(vertices);
        mesh.SetUVs(0, uvs);
        mesh.SetTriangles(triangles, 0);
        mesh.RecalculateNormals();
        AssetDatabase.DeleteAsset("Assets/Game/VFX/PlanetRing.asset");
        AssetDatabase.CreateAsset(mesh, "Assets/Game/VFX/PlanetRing.asset");

        var material = new Material(Shader.Find("Legacy Shaders/Particles/Alpha Blended"));
        material.mainTexture = EnsureRingTexture();
        material.SetColor("_TintColor", new Color(0.55f, 0.5f, 0.42f, 0.55f));
        AssetDatabase.CreateAsset(material, "Assets/Game/Materials/PlanetRingMat.mat");

        var ring = new GameObject("Ring");
        ring.transform.SetParent(planet.transform, false);
        ring.transform.localRotation = Quaternion.Euler(14f, 0f, 7f); // inclinación elegante
        ring.AddComponent<MeshFilter>().sharedMesh = mesh;
        ring.AddComponent<MeshRenderer>().sharedMaterial = material;
    }

    /// <summary>Campo de asteroides cercano: rocas Kenney con collider esférico y deriva lenta.</summary>
    private static void BuildAsteroidField(Transform parent, System.Random rng)
    {
        // Rocas lunares fotorrealistas de Poly Haven; Kenney como plan B.
        string[] rockPaths = new[]
        {
            "Assets/Game/Models/Generated/Asteroids/ENV_Asteroid_Medium_01.glb",
            "Assets/Game/Models/Generated/Asteroids/ENV_Asteroid_Large_01.glb",
            "Assets/ThirdParty/Asteroids/polyhaven/moon_rock_01/moon_rock_01.gltf",
            "Assets/ThirdParty/Asteroids/polyhaven/moon_rock_02/moon_rock_02.gltf",
            "Assets/ThirdParty/Asteroids/polyhaven/moon_rock_03/moon_rock_03.gltf",
            "Assets/ThirdParty/Asteroids/polyhaven/boulder_01/boulder_01.gltf",
        }.Where(p => AssetDatabase.LoadMainAssetAtPath(p) != null).ToArray();

        if (rockPaths.Length == 0 && Directory.Exists("Assets/ThirdParty/Asteroids"))
            rockPaths = Directory.GetFiles("Assets/ThirdParty/Asteroids", "*.glb")
                .Select(p => p.Replace('\\', '/')).ToArray();

        var root = new GameObject("AsteroidField");
        root.transform.SetParent(parent);
        if (rockPaths.Length == 0) return;

        Vector3 fieldCenter = new Vector3(0f, 0f, 900f);
        for (int i = 0; i < 70; i++)
        {
            var asset = AssetDatabase.LoadMainAssetAtPath(rockPaths[rng.Next(rockPaths.Length)]) as GameObject;
            if (asset == null) continue;

            Vector3 offset = RandomDirection(rng) * Mathf.Lerp(120f, 750f, (float)rng.NextDouble());
            GameObject asteroid = (GameObject)PrefabUtility.InstantiatePrefab(asset);
            asteroid.transform.SetParent(root.transform);
            asteroid.transform.position = fieldCenter + offset;

            // Normaliza al tamaño objetivo midiendo bounds (cada fuente trae su escala)
            // y ajusta el collider esférico ANTES de girar (bounds alineados al mundo).
            Renderer[] renderers = asteroid.GetComponentsInChildren<Renderer>();
            if (renderers.Length > 0)
            {
                Bounds bounds = renderers[0].bounds;
                foreach (Renderer r in renderers) bounds.Encapsulate(r.bounds);
                float maxDimension = Mathf.Max(bounds.size.x, Mathf.Max(bounds.size.y, bounds.size.z));
                float targetSize = Mathf.Lerp(8f, 45f, (float)rng.NextDouble());
                if (maxDimension > 0.01f)
                    asteroid.transform.localScale = Vector3.one * (targetSize / maxDimension);

                bounds = renderers[0].bounds;
                foreach (Renderer r in renderers) bounds.Encapsulate(r.bounds);
                SphereCollider sphere = asteroid.AddComponent<SphereCollider>();
                sphere.center = asteroid.transform.InverseTransformPoint(bounds.center);
                sphere.radius = bounds.extents.magnitude * 0.55f / asteroid.transform.localScale.x;
            }

            asteroid.transform.rotation = Quaternion.Euler(
                (float)rng.NextDouble() * 360f, (float)rng.NextDouble() * 360f, (float)rng.NextDouble() * 360f);
            asteroid.AddComponent<PlanetRotator>().Configure(new Vector3(
                Mathf.Lerp(-4f, 4f, (float)rng.NextDouble()), Mathf.Lerp(-4f, 4f, (float)rng.NextDouble()), 0f));
        }
    }

    /// <summary>PlayerShip: gameplay en la raíz, modelo Kenney intercambiable bajo VisualModel,
    /// y los empties de la spec (armas, motores, cámara, audio, daños).</summary>
    private static GameObject BuildPlayerShipPrefab()
    {
        GameObject root = new GameObject("PlayerShip");
        Rigidbody body = root.AddComponent<Rigidbody>();
        body.mass = 8f;
        body.useGravity = false;
        root.AddComponent<PlayerShipController>();

        var visual = new GameObject("VisualModel");
        visual.transform.SetParent(root.transform);
        visual.transform.localPosition = Vector3.zero;

        Bounds shipBounds = new Bounds(Vector3.zero, new Vector3(8f, 3f, 12f));
        foreach (var (path, yaw) in ShipCandidates)
        {
            var asset = AssetDatabase.LoadMainAssetAtPath(path) as GameObject;
            if (asset == null) continue;
            UsedShipFile = Path.GetFileName(path);

            GameObject model = (GameObject)PrefabUtility.InstantiatePrefab(asset);
            model.transform.SetParent(visual.transform);
            model.transform.localPosition = Vector3.zero;
            model.transform.localRotation = Quaternion.Euler(0f, yaw, 0f);
            foreach (Collider c in model.GetComponentsInChildren<Collider>())
                Object.DestroyImmediate(c);

            Renderer[] renderers = model.GetComponentsInChildren<Renderer>();
            if (renderers.Length > 0)
            {
                // Normaliza a ~12 m de eslora y centra en el origen de la raíz.
                Bounds bounds = renderers[0].bounds;
                foreach (Renderer r in renderers) bounds.Encapsulate(r.bounds);
                float scale = 12f / Mathf.Max(bounds.size.z, 0.01f);
                model.transform.localScale = Vector3.one * scale;
                bounds = renderers[0].bounds;
                foreach (Renderer r in renderers) bounds.Encapsulate(r.bounds);
                model.transform.localPosition = -bounds.center;
                bounds = renderers[0].bounds;
                foreach (Renderer r in renderers) bounds.Encapsulate(r.bounds);
                shipBounds = bounds;
            }
            break;
        }

        // Kit propio: aprovecha empties (FX_Engine_*, Muzzle_*), mallas _Collider y LODs.
        var engineMounts = new System.Collections.Generic.List<Transform>();
        var muzzleMounts = new System.Collections.Generic.List<Transform>();
        bool kitCollider = false;
        foreach (Transform part in visual.GetComponentsInChildren<Transform>(true))
        {
            if (part.name.StartsWith("FX_Engine")) engineMounts.Add(part);
            else if (part.name.StartsWith("Muzzle")) muzzleMounts.Add(part);
            else if (part.name.EndsWith("_Collider"))
            {
                // Malla de colisión convexa del kit: se usa tal cual y no se dibuja.
                foreach (Renderer r in part.GetComponentsInChildren<Renderer>(true)) r.enabled = false;
                MeshFilter meshFilter = part.GetComponent<MeshFilter>();
                if (meshFilter != null && meshFilter.sharedMesh != null)
                {
                    MeshCollider meshCollider = part.gameObject.AddComponent<MeshCollider>();
                    meshCollider.sharedMesh = meshFilter.sharedMesh;
                    meshCollider.convex = true;
                    kitCollider = true;
                }
            }
            else if (part.name.Contains("_LOD1") || part.name.Contains("_LOD2"))
            {
                // Por ahora solo se dibuja LOD0 (el LODGroup llegará en la fase de optimización).
                foreach (Renderer r in part.GetComponentsInChildren<Renderer>(true)) r.enabled = false;
            }
        }

        if (!kitCollider)
        {
            // Sin malla del kit: caja ajustada a los bounds como plan B.
            var colliders = new GameObject("Colliders");
            colliders.transform.SetParent(root.transform);
            colliders.transform.localPosition = Vector3.zero;
            BoxCollider hull = colliders.AddComponent<BoxCollider>();
            hull.center = shipBounds.center;
            hull.size = shipBounds.size;
        }

        // Empties de referencia según la spec.
        Transform Empty(string name, Vector3 localPos, Transform parent = null)
        {
            var point = new GameObject(name);
            point.transform.SetParent(parent != null ? parent : root.transform);
            point.transform.localPosition = localPos;
            return point.transform;
        }

        // --- Motores: luz + estela + partículas reaccionando al acelerador y al turbo ---
        PlayerShipController controller = root.GetComponent<PlayerShipController>();
        Material engineMat = CreateAdditiveTexturedMaterial("EngineGlow", EnsureDotTexture(),
            new Color(0.45f, 0.75f, 1f, 0.6f));
        var engines = new GameObject("EngineEffects");
        engines.transform.SetParent(root.transform);
        engines.transform.localPosition = Vector3.zero;
        if (engineMounts.Count > 0)
        {
            // Los empties del kit marcan las toberas exactas (en construcción el root está
            // en el origen: las posiciones de mundo coinciden con las locales al root).
            for (int i = 0; i < engineMounts.Count && i < 2; i++)
                BuildEngineFx(engineMounts[i].position.x <= 0f ? "EngineFX_L" : "EngineFX_R",
                    engineMounts[i].position, engines.transform, controller, engineMat);
        }
        else
        {
            BuildEngineFx("EngineFX_L", new Vector3(-shipBounds.extents.x * 0.4f, 0f, shipBounds.min.z),
                engines.transform, controller, engineMat);
            BuildEngineFx("EngineFX_R", new Vector3(shipBounds.extents.x * 0.4f, 0f, shipBounds.min.z),
                engines.transform, controller, engineMat);
        }

        // --- Armas láser con pool ---
        var weapons = new GameObject("Weapons");
        weapons.transform.SetParent(root.transform);
        weapons.transform.localPosition = Vector3.zero;
        Vector3 muzzleLeft = muzzleMounts.Count >= 2
            ? muzzleMounts.OrderBy(m => m.position.x).First().position
            : new Vector3(-shipBounds.extents.x * 0.8f, 0f, shipBounds.max.z * 0.6f);
        Vector3 muzzleRight = muzzleMounts.Count >= 2
            ? muzzleMounts.OrderBy(m => m.position.x).Last().position
            : new Vector3(shipBounds.extents.x * 0.8f, 0f, shipBounds.max.z * 0.6f);
        Transform weaponL = Empty("Weapon_L", muzzleLeft, weapons.transform);
        Transform weaponR = Empty("Weapon_R", muzzleRight, weapons.transform);
        GameObject impactPrefab = BuildLaserImpactPrefab();
        GameObject laserPrefab = BuildLaserPrefab(impactPrefab);
        ShipWeapons shipWeapons = root.AddComponent<ShipWeapons>();
        SetPrivateArray(shipWeapons, "muzzles", new Object[] { weaponL, weaponR });
        SetPrivateReference(shipWeapons, "projectilePrefab", laserPrefab.GetComponent<LaserProjectile>());

        // --- Polvo espacial: motas a la deriva que venden velocidad y escala ---
        var dust = new GameObject("SpaceDust");
        dust.transform.SetParent(root.transform);
        dust.transform.localPosition = Vector3.zero;
        ParticleSystem dustParticles = dust.AddComponent<ParticleSystem>();
        var dustMain = dustParticles.main;
        dustMain.simulationSpace = ParticleSystemSimulationSpace.World;
        dustMain.startSpeed = 0.5f;
        dustMain.startSize = new ParticleSystem.MinMaxCurve(0.2f, 0.9f);
        dustMain.startLifetime = 14f;
        dustMain.maxParticles = 1000;
        dustMain.startColor = new Color(0.75f, 0.8f, 1f, 0.45f);
        dustMain.prewarm = true;
        var dustEmission = dustParticles.emission;
        dustEmission.rateOverTime = 70f;
        var dustShape = dustParticles.shape;
        dustShape.shapeType = ParticleSystemShapeType.Box;
        dustShape.scale = new Vector3(320f, 320f, 320f);
        dust.GetComponent<ParticleSystemRenderer>().sharedMaterial =
            CreateAdditiveTexturedMaterial("SpaceDust", EnsureDotTexture(), new Color(0.6f, 0.65f, 0.8f, 0.35f));

        Empty("CameraTarget", new Vector3(0f, 4f, -14f));
        Empty("Audio", Vector3.zero);
        Empty("DamageEffects", Vector3.zero);

        GameObject prefab = PrefabUtility.SaveAsPrefabAsset(root, "Assets/Game/Prefabs/Player/PlayerShip.prefab");
        Object.DestroyImmediate(root);
        return prefab;
    }

    /// <summary>Un motor: luz puntual, estela y chorro de partículas, con EngineEffects al mando.</summary>
    private static void BuildEngineFx(string name, Vector3 localPos, Transform parent,
        PlayerShipController controller, Material engineMat)
    {
        var engine = new GameObject(name);
        engine.transform.SetParent(parent);
        engine.transform.localPosition = localPos;
        engine.transform.localRotation = Quaternion.Euler(0f, 180f, 0f); // su +Z apunta hacia atrás

        Light glow = engine.AddComponent<Light>();
        glow.type = LightType.Point;
        glow.range = 30f;
        glow.intensity = 1.5f;
        glow.color = new Color(0.45f, 0.8f, 1f);

        TrailRenderer trail = engine.AddComponent<TrailRenderer>();
        trail.sharedMaterial = engineMat;
        trail.startWidth = 0.7f;
        trail.endWidth = 0f;
        trail.time = 0.3f;
        trail.minVertexDistance = 0.5f;
        trail.startColor = new Color(0.5f, 0.85f, 1f, 0.9f);
        trail.endColor = new Color(0.2f, 0.4f, 1f, 0f);

        var exhaustObject = new GameObject("Exhaust");
        exhaustObject.transform.SetParent(engine.transform, false);
        ParticleSystem exhaust = exhaustObject.AddComponent<ParticleSystem>();
        var main = exhaust.main;
        main.startSpeed = 30f;
        main.startSize = new ParticleSystem.MinMaxCurve(0.4f, 1.1f);
        main.startLifetime = 0.35f;
        main.startColor = new Color(0.6f, 0.9f, 1f, 0.8f);
        main.maxParticles = 400;
        main.simulationSpace = ParticleSystemSimulationSpace.World;
        var shape = exhaust.shape;
        shape.shapeType = ParticleSystemShapeType.Cone;
        shape.angle = 7f;
        shape.radius = 0.25f;
        exhaustObject.GetComponent<ParticleSystemRenderer>().sharedMaterial = engineMat;

        EngineEffects effects = engine.AddComponent<EngineEffects>();
        effects.controller = controller;
        effects.glow = glow;
        effects.trail = trail;
        effects.exhaust = exhaust;
    }

    /// <summary>Destello de impacto láser: esfera emissive + luz, con auto-desvanecido.</summary>
    private static GameObject BuildLaserImpactPrefab()
    {
        Material impactMat = CreateEmissiveMaterial("LaserImpact", Color.black, new Color(0.5f, 0.9f, 1f) * 4f);
        GameObject temp = GameObject.CreatePrimitive(PrimitiveType.Sphere);
        temp.name = "LaserImpact";
        Object.DestroyImmediate(temp.GetComponent<Collider>());
        temp.transform.localScale = Vector3.one * 1.4f;
        temp.GetComponent<Renderer>().sharedMaterial = impactMat;

        var flashObject = new GameObject("Flash");
        flashObject.transform.SetParent(temp.transform, false);
        Light flash = flashObject.AddComponent<Light>();
        flash.type = LightType.Point;
        flash.range = 20f;
        flash.intensity = 4f;
        flash.color = new Color(0.5f, 0.9f, 1f);
        temp.AddComponent<ImpactFlash>();

        GameObject prefab = PrefabUtility.SaveAsPrefabAsset(temp, "Assets/Game/Prefabs/Weapons/LaserImpact.prefab");
        Object.DestroyImmediate(temp);
        return prefab;
    }

    /// <summary>Proyectil láser: barra emissive con estela, listo para el pool de ShipWeapons.</summary>
    private static GameObject BuildLaserPrefab(GameObject impactPrefab)
    {
        Material laserMat = CreateEmissiveMaterial("Laser", Color.black, new Color(0.4f, 0.9f, 1f) * 5f);
        GameObject temp = new GameObject("Laser");
        LaserProjectile projectile = temp.AddComponent<LaserProjectile>();
        SetPrivateReference(projectile, "impactPrefab", impactPrefab);

        GameObject beam = GameObject.CreatePrimitive(PrimitiveType.Cube);
        beam.name = "Beam";
        Object.DestroyImmediate(beam.GetComponent<Collider>());
        beam.transform.SetParent(temp.transform, false);
        beam.transform.localScale = new Vector3(0.09f, 0.09f, 3.4f);
        beam.GetComponent<Renderer>().sharedMaterial = laserMat;

        TrailRenderer trail = temp.AddComponent<TrailRenderer>();
        trail.sharedMaterial = CreateAdditiveTexturedMaterial("LaserTrail", EnsureDotTexture(),
            new Color(0.4f, 0.8f, 1f, 0.5f));
        trail.startWidth = 0.18f;
        trail.endWidth = 0f;
        trail.time = 0.1f;
        trail.startColor = new Color(0.4f, 0.9f, 1f, 0.8f);
        trail.endColor = new Color(0.2f, 0.5f, 1f, 0f);

        GameObject prefab = PrefabUtility.SaveAsPrefabAsset(temp, "Assets/Game/Prefabs/Weapons/Laser.prefab");
        Object.DestroyImmediate(temp);
        return prefab;
    }

    private static void SetPrivateArray(Component target, string fieldName, Object[] values)
    {
        var serialized = new SerializedObject(target);
        SerializedProperty property = serialized.FindProperty(fieldName);
        property.arraySize = values.Length;
        for (int i = 0; i < values.Length; i++)
            property.GetArrayElementAtIndex(i).objectReferenceValue = values[i];
        serialized.ApplyModifiedPropertiesWithoutUndo();
    }

    // ------------------------------------------------------------------ utilidades

    /// <summary>Instancia un asset del kit generado (Assets/Game/Models/Generated/),
    /// normalizado a un diámetro objetivo midiendo bounds. Null si no existe.</summary>
    private static GameObject TryKitBody(string relativePath, Transform parent, Vector3 position,
        float targetDiameter, float rotationSpeed)
    {
        var asset = AssetDatabase.LoadMainAssetAtPath($"Assets/Game/Models/Generated/{relativePath}.glb") as GameObject;
        if (asset == null) return null;

        GameObject body = (GameObject)PrefabUtility.InstantiatePrefab(asset);
        body.transform.SetParent(parent);
        body.transform.position = position;

        // Solo se dibuja LOD0 (los assets del kit traen LOD1/2 que se superpondrían).
        foreach (Transform part in body.GetComponentsInChildren<Transform>(true))
            if (part.name.Contains("_LOD1") || part.name.Contains("_LOD2"))
                foreach (Renderer r in part.GetComponentsInChildren<Renderer>(true)) r.enabled = false;

        Renderer[] renderers = body.GetComponentsInChildren<Renderer>();
        if (renderers.Length > 0)
        {
            Bounds bounds = renderers[0].bounds;
            foreach (Renderer r in renderers) bounds.Encapsulate(r.bounds);
            float maxDimension = Mathf.Max(bounds.size.x, Mathf.Max(bounds.size.y, bounds.size.z));
            if (maxDimension > 0.01f)
                body.transform.localScale = Vector3.one * (targetDiameter / maxDimension);
        }

        if (rotationSpeed != 0f)
            body.AddComponent<PlanetRotator>().Configure(new Vector3(0f, rotationSpeed, 0f));
        return body;
    }

    /// <summary>Skybox equirect horneado por la pipeline de Blender del kit (si existe).</summary>
    private static void ApplySkybox(Camera cam)
    {
        const string path = "Assets/Game/Textures/Generated/Skybox_DeepSpace.png";
        var importer = AssetImporter.GetAtPath(path) as TextureImporter;
        if (importer != null && importer.maxTextureSize < 4096)
        {
            importer.maxTextureSize = 4096; // que no se comprima a 2048: se vería borroso
            importer.SaveAndReimport();
        }
        var texture = AssetDatabase.LoadAssetAtPath<Texture2D>(path);
        if (texture == null) return;

        var material = new Material(Shader.Find("Skybox/Panoramic"));
        material.SetTexture("_MainTex", texture);
        AssetDatabase.CreateAsset(material, "Assets/Game/Materials/SkyboxDeepSpace.mat");
        RenderSettings.skybox = material;
        cam.clearFlags = CameraClearFlags.Skybox;
    }

    private static Vector3 RandomDirection(System.Random rng)
    {
        // Distribución uniforme en la esfera.
        float z = 2f * (float)rng.NextDouble() - 1f;
        float t = 2f * Mathf.PI * (float)rng.NextDouble();
        float r = Mathf.Sqrt(1f - z * z);
        return new Vector3(r * Mathf.Cos(t), r * Mathf.Sin(t), z);
    }

    private static Texture2D EnsureDotTexture()
    {
        return EnsureTexture("star_dot", 64, (x, y) =>
        {
            float dx = (x - 32f) / 32f, dy = (y - 32f) / 32f;
            float d = Mathf.Sqrt(dx * dx + dy * dy);
            float a = Mathf.Clamp01(1f - d);
            a = a * a * a; // núcleo pequeño y brillante con halo suave
            return new Color(1f, 1f, 1f, a);
        });
    }

    private static Texture2D EnsureNebulaTexture()
    {
        return EnsureTexture("nebula_clouds", 256, (x, y) =>
        {
            float n = Mathf.PerlinNoise(x * 0.02f, y * 0.02f) * 0.6f
                    + Mathf.PerlinNoise(x * 0.06f, y * 0.06f) * 0.4f;
            float dx = (x - 128f) / 128f, dy = (y - 128f) / 128f;
            float falloff = Mathf.Clamp01(1f - Mathf.Sqrt(dx * dx + dy * dy));
            float a = Mathf.Clamp01((n - 0.35f) * 1.6f) * falloff * falloff;
            return new Color(1f, 1f, 1f, a);
        });
    }

    /// <summary>Ruido fraccional: varias octavas de Perlin para detalle natural.</summary>
    private static float Fbm(float x, float y, int octaves)
    {
        float value = 0f, amplitude = 0.5f, frequency = 1f;
        for (int i = 0; i < octaves; i++)
        {
            value += Mathf.PerlinNoise(x * frequency, y * frequency) * amplitude;
            amplitude *= 0.5f;
            frequency *= 2f;
        }
        return value;
    }

    private static Color GasGiantPixel(int x, int y)
    {
        float turbulence = Fbm(x * 0.015f, y * 0.015f, 4);
        float band = Mathf.PerlinNoise(0.5f, y * 0.035f + turbulence * 1.4f);
        Color dark = new Color(0.42f, 0.36f, 0.3f);
        Color mid = new Color(0.62f, 0.55f, 0.46f);
        Color light = new Color(0.78f, 0.73f, 0.64f);
        Color color = band < 0.45f ? Color.Lerp(dark, mid, band / 0.45f)
                                   : Color.Lerp(mid, light, (band - 0.45f) / 0.55f);
        float streak = Mathf.PerlinNoise(x * 0.002f, y * 0.12f);
        return Color.Lerp(color, dark, Mathf.Clamp01((streak - 0.6f) * 1.2f) * 0.35f);
    }

    private static Color RockyPixel(int x, int y)
    {
        float continents = Fbm(x * 0.012f, y * 0.012f, 5);
        float detail = Fbm(x * 0.05f + 80f, y * 0.05f, 3);
        Color ocean = new Color(0.05f, 0.09f, 0.16f);
        Color shallows = new Color(0.09f, 0.16f, 0.24f);
        Color land = new Color(0.22f, 0.24f, 0.18f);
        Color mountain = new Color(0.38f, 0.34f, 0.28f);
        Color surface = continents < 0.5f
            ? Color.Lerp(ocean, shallows, continents / 0.5f)
            : Color.Lerp(land, mountain, Mathf.Clamp01((continents - 0.5f) * 2f + detail * 0.3f - 0.15f));
        // casquetes polares
        float latitude = Mathf.Abs(y / 512f - 0.5f) * 2f;
        float ice = Mathf.Clamp01((latitude - 0.78f) * 8f + detail * 0.3f);
        surface = Color.Lerp(surface, new Color(0.88f, 0.9f, 0.92f), ice);
        // nubes sutiles
        float clouds = Mathf.Clamp01((Fbm(x * 0.02f + 300f, y * 0.02f, 4) - 0.52f) * 2.2f);
        return Color.Lerp(surface, new Color(0.85f, 0.87f, 0.9f), clouds * 0.55f);
    }

    private static Color IcePixel(int x, int y)
    {
        float n = Fbm(x * 0.02f, y * 0.02f, 4);
        float cracks = Mathf.Abs(Mathf.PerlinNoise(x * 0.04f + 50f, y * 0.04f) - 0.5f);
        Color baseColor = Color.Lerp(new Color(0.55f, 0.62f, 0.68f), new Color(0.78f, 0.82f, 0.85f), n);
        return Color.Lerp(baseColor, new Color(0.35f, 0.42f, 0.5f), Mathf.Clamp01((0.06f - cracks) * 8f));
    }

    private static Color MoonPixel(int x, int y)
    {
        float n = Fbm(x * 0.03f, y * 0.03f, 4);
        float maria = Mathf.Clamp01((Fbm(x * 0.008f + 200f, y * 0.008f, 3) - 0.5f) * 3f);
        Color color = Color.Lerp(new Color(0.32f, 0.32f, 0.33f), new Color(0.55f, 0.55f, 0.56f), n);
        return Color.Lerp(color, new Color(0.22f, 0.22f, 0.24f), maria * 0.5f);
    }

    private static Texture2D EnsureHaloTexture()
    {
        return EnsureTexture("atmo_halo", 256, (x, y) =>
        {
            float dx = (x - 128f) / 128f, dy = (y - 128f) / 128f;
            float d = Mathf.Sqrt(dx * dx + dy * dy);
            // pico de brillo justo en el limbo del planeta (radio 0.385 del quad)
            float rim = Mathf.Exp(-Mathf.Pow((d - 0.385f) / 0.11f, 2f));
            return new Color(1f, 1f, 1f, Mathf.Clamp01(rim));
        });
    }

    private static Texture2D EnsureRingTexture()
    {
        return EnsureTexture("planet_ring", 256, (x, y) =>
        {
            float u = x / 256f;
            float bands = Mathf.PerlinNoise(u * 9f, 0.5f);
            float edgeFade = Mathf.Clamp01(u * 8f) * Mathf.Clamp01((1f - u) * 8f);
            float alpha = Mathf.Clamp01((bands - 0.28f) * 1.3f) * edgeFade;
            float shade = 0.75f + bands * 0.25f;
            return new Color(shade, shade * 0.95f, shade * 0.85f, alpha);
        });
    }

    private static Texture2D EnsurePlanetTexture(string name, System.Func<int, int, Color> pixel)
    {
        return EnsureTexture(name, 512, pixel);
    }

    private static Texture2D EnsureTexture(string name, int size, System.Func<int, int, Color> pixel)
    {
        string path = $"Assets/Game/VFX/{name}.png";
        if (AssetDatabase.LoadAssetAtPath<Texture2D>(path) == null)
        {
            var texture = new Texture2D(size, size, TextureFormat.RGBA32, false);
            for (int y = 0; y < size; y++)
            for (int x = 0; x < size; x++)
                texture.SetPixel(x, y, pixel(x, y));
            texture.Apply();
            File.WriteAllBytes(path, texture.EncodeToPNG());
            Object.DestroyImmediate(texture);
            AssetDatabase.ImportAsset(path);
        }
        return AssetDatabase.LoadAssetAtPath<Texture2D>(path);
    }

    private static Material CreateAdditiveTexturedMaterial(string name, Texture2D texture, Color? tint = null)
    {
        var material = new Material(Shader.Find("Legacy Shaders/Particles/Additive"));
        material.mainTexture = texture;
        // Ojo: este shader tiñe con _TintColor, no con la propiedad .color estándar.
        material.SetColor("_TintColor", tint ?? new Color(0.5f, 0.5f, 0.5f, 0.5f));
        AssetDatabase.CreateAsset(material, $"Assets/Game/Materials/{name}.mat");
        return material;
    }

    private static Material CreateEmissiveMaterial(string name, Color baseColor, Color emission)
    {
        var material = new Material(Shader.Find("Standard")) { color = baseColor };
        material.EnableKeyword("_EMISSION");
        material.SetColor("_EmissionColor", emission);
        AssetDatabase.CreateAsset(material, $"Assets/Game/Materials/{name}.mat");
        return material;
    }

    private static void SetPrivateReference(Component target, string fieldName, Object value)
    {
        var serialized = new SerializedObject(target);
        serialized.FindProperty(fieldName).objectReferenceValue = value;
        serialized.ApplyModifiedPropertiesWithoutUndo();
    }
}
#endif

using System.Collections.Generic;
using UnityEngine;

/// <summary>
/// Armas láser de la nave: Espacio o click izquierdo, alternando cañones L/R.
/// Pool de proyectiles pre-creado en Awake: cero Instantiate/Destroy durante el combate.
/// Va en la raíz "PlayerShip"; el constructor de escena conecta cañones y prefab.
/// </summary>
public class ShipWeapons : MonoBehaviour
{
    [SerializeField] private Transform[] muzzles;
    [SerializeField] private LaserProjectile projectilePrefab;
    [SerializeField] private float fireRate = 7f;          // disparos por segundo
    [SerializeField] private float projectileSpeed = 350f;
    [SerializeField] private int poolSize = 40;

    private readonly Queue<LaserProjectile> pool = new Queue<LaserProjectile>();
    private float nextFireTime;
    private int muzzleIndex;
    private Rigidbody body;

    private void Awake()
    {
        body = GetComponent<Rigidbody>();
        if (projectilePrefab == null) return;
        for (int i = 0; i < poolSize; i++)
        {
            LaserProjectile laser = Instantiate(projectilePrefab);
            laser.gameObject.SetActive(false);
            laser.Pool = pool;
            pool.Enqueue(laser);
        }
    }

    private void Update()
    {
        bool firing = Input.GetKey(KeyCode.Space) || Input.GetButton("Fire1");
        if (!firing || Time.time < nextFireTime || muzzles == null || muzzles.Length == 0 || pool.Count == 0)
            return;

        nextFireTime = Time.time + 1f / fireRate;
        Transform muzzle = muzzles[muzzleIndex++ % muzzles.Length];

        // El láser hereda la velocidad de la nave: si no, a toda máquina "alcanzarías" tus disparos.
        Vector3 inherited = Vector3.zero;
        if (body != null)
#if UNITY_6000_0_OR_NEWER
            inherited = body.linearVelocity;
#else
            inherited = body.velocity;
#endif

        LaserProjectile laser = pool.Dequeue();
        laser.Fire(muzzle.position, transform.rotation, transform.forward * projectileSpeed + inherited);
    }
}

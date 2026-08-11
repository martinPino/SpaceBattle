using System.Collections.Generic;
using UnityEngine;

/// <summary>
/// Proyectil láser del pool: vuela recto, detecta impactos por raycast entre frames
/// (a 350 m/s ningún collider se le escapa) y vuelve al pool al impactar o expirar.
/// </summary>
public class LaserProjectile : MonoBehaviour
{
    [SerializeField] private float lifeTime = 2.5f;
    [SerializeField] private GameObject impactPrefab;

    public Queue<LaserProjectile> Pool { get; set; }

    private Vector3 velocity;
    private float deadline;
    private TrailRenderer trail;

    private void Awake()
    {
        trail = GetComponentInChildren<TrailRenderer>();
    }

    public void Fire(Vector3 position, Quaternion rotation, Vector3 launchVelocity)
    {
        transform.SetPositionAndRotation(position, rotation);
        velocity = launchVelocity;
        deadline = Time.time + lifeTime;
        gameObject.SetActive(true);
        if (trail != null) trail.Clear();
    }

    private void Update()
    {
        Vector3 step = velocity * Time.deltaTime;
        if (Physics.Raycast(transform.position, step.normalized, out RaycastHit hit, step.magnitude))
        {
            if (impactPrefab != null)
                Instantiate(impactPrefab, hit.point + hit.normal * 0.2f, Quaternion.LookRotation(hit.normal));
            Recycle();
            return;
        }

        transform.position += step;
        if (Time.time >= deadline) Recycle();
    }

    private void Recycle()
    {
        gameObject.SetActive(false);
        Pool?.Enqueue(this);
    }
}

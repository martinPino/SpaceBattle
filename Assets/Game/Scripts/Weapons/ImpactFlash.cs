using UnityEngine;

/// <summary>Destello de impacto: esfera emissive con luz que encoge y desaparece.</summary>
public class ImpactFlash : MonoBehaviour
{
    [SerializeField] private float duration = 0.18f;

    private float life;
    private Vector3 initialScale;
    private Light flashLight;
    private float initialIntensity;

    private void Awake()
    {
        initialScale = transform.localScale;
        flashLight = GetComponentInChildren<Light>();
        if (flashLight != null) initialIntensity = flashLight.intensity;
    }

    private void Update()
    {
        life += Time.deltaTime;
        float remaining = 1f - life / duration;
        if (remaining <= 0f)
        {
            Destroy(gameObject);
            return;
        }
        transform.localScale = initialScale * remaining;
        if (flashLight != null) flashLight.intensity = initialIntensity * remaining;
    }
}

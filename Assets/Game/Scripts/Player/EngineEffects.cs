using UnityEngine;

/// <summary>
/// Efectos de un motor: luz, estela y partículas reaccionan al acelerador y al turbo.
/// El constructor de escena lo coloca en cada EngineFX y conecta las referencias.
/// </summary>
public class EngineEffects : MonoBehaviour
{
    public PlayerShipController controller;
    public Light glow;
    public TrailRenderer trail;
    public ParticleSystem exhaust;

    [Header("Intensidades de la luz")]
    public float idleGlow = 1.5f;
    public float fullGlow = 8f;
    public float boostGlow = 16f;

    private void Update()
    {
        if (controller == null) return;
        float throttle = controller.Thrust01;
        bool boost = controller.Boosting;

        if (glow != null)
        {
            float target = boost ? boostGlow : Mathf.Lerp(idleGlow, fullGlow, throttle);
            glow.intensity = Mathf.Lerp(glow.intensity, target, 1f - Mathf.Exp(-6f * Time.deltaTime));
        }

        if (trail != null)
        {
            trail.time = boost ? 1.2f : Mathf.Lerp(0.12f, 0.45f, throttle);
            trail.emitting = throttle > 0.05f || boost;
        }

        if (exhaust != null)
        {
            var emission = exhaust.emission;
            emission.rateOverTime = boost ? 250f : Mathf.Lerp(10f, 100f, throttle);
        }
    }
}

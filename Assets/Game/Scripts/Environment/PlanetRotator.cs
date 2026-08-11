using UnityEngine;

/// <summary>Rotación lenta y constante para planetas, lunas y asteroides a la deriva.</summary>
public class PlanetRotator : MonoBehaviour
{
    [SerializeField] private Vector3 degreesPerSecond = new Vector3(0f, 0.3f, 0f);

    public void Configure(Vector3 rotation) => degreesPerSecond = rotation;

    private void Update()
    {
        transform.Rotate(degreesPerSecond * Time.deltaTime, Space.Self);
    }
}

using UnityEngine;

/// <summary>
/// Cámara de tercera persona para la nave: seguimiento suave con retardo, look-ahead
/// hacia donde apunta la nave, y FOV dinámico según velocidad y turbo.
/// Va en la Main Camera (SIN parentarla a la nave: el suavizado hace el trabajo).
/// </summary>
public class SpaceCamera : MonoBehaviour
{
    [Header("Objetivo (lo conecta el constructor de escena)")]
    [SerializeField] private Transform target;                 // raíz PlayerShip
    [SerializeField] private PlayerShipController controller;

    [Header("Encuadre")]
    [SerializeField] private Vector3 followOffset = new Vector3(0f, 4f, -14f); // detrás y arriba (local)
    [SerializeField] private float lookAhead = 40f;            // mira por delante del morro

    [Header("Suavizado")]
    [SerializeField] private float positionSmoothing = 5f;     // mayor = sigue más pegada
    [SerializeField] private float rotationSmoothing = 6f;

    [Header("FOV dinámico")]
    [SerializeField] private float baseFov = 62f;
    [SerializeField] private float speedFovGain = 8f;          // extra a velocidad máxima
    [SerializeField] private float boostFovGain = 14f;         // extra adicional en turbo
    [SerializeField] private float fovSmoothing = 4f;

    private Camera cam;

    private void Awake()
    {
        cam = GetComponent<Camera>();
    }

    private void LateUpdate()
    {
        if (target == null) return;

        // Suavizado exponencial independiente del framerate.
        float positionT = 1f - Mathf.Exp(-positionSmoothing * Time.deltaTime);
        float rotationT = 1f - Mathf.Exp(-rotationSmoothing * Time.deltaTime);

        // Compensación de velocidad: el retardo estacionario del suavizado es v/k,
        // sin esto la cámara se aplasta contra el casco al volar marcha atrás.
        Vector3 velocity = Vector3.zero;
        if (controller != null && controller.Body != null)
#if UNITY_6000_0_OR_NEWER
            velocity = controller.Body.linearVelocity;
#else
            velocity = controller.Body.velocity;
#endif
        Vector3 desiredPosition = target.TransformPoint(followOffset) + velocity / positionSmoothing;
        transform.position = Vector3.Lerp(transform.position, desiredPosition, positionT);

        // Banda de seguridad: nunca dentro del casco ni perdida en la lejanía.
        Vector3 fromShip = transform.position - target.position;
        float distance = fromShip.magnitude;
        if (distance < 9f) transform.position = target.position + fromShip.normalized * 9f;
        else if (distance > 34f) transform.position = target.position + fromShip.normalized * 34f;

        Vector3 lookPoint = target.position + target.forward * lookAhead;
        Quaternion desiredRotation = Quaternion.LookRotation(lookPoint - transform.position, target.up);
        transform.rotation = Quaternion.Slerp(transform.rotation, desiredRotation, rotationT);

        if (cam != null && controller != null)
        {
            float targetFov = baseFov
                + speedFovGain * Mathf.Clamp01(controller.Speed01)
                + (controller.Boosting ? boostFovGain : 0f);
            float fovT = 1f - Mathf.Exp(-fovSmoothing * Time.deltaTime);
            cam.fieldOfView = Mathf.Lerp(cam.fieldOfView, targetFov, fovT);
        }
    }
}

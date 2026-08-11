using UnityEngine;

/// <summary>
/// Vuelo espacial 6DOF con Rigidbody: empuje adelante/atrás (W/S), strafe lateral (A/D),
/// vertical (R/F), orientación con el ratón (pitch/yaw), roll con Q/E y turbo con Shift.
/// Los deltas de ratón se ACUMULAN en Update y se consumen como impulso en FixedUpdate:
/// así el giro es idéntico a 30, 60 o 240 fps y no se pierde ninguna muestra.
/// Va en la raíz "PlayerShip" — nunca en el modelo visual, que es intercambiable.
/// </summary>
[RequireComponent(typeof(Rigidbody))]
public class PlayerShipController : MonoBehaviour
{
    [Header("Propulsión")]
    [SerializeField] private float acceleration = 45f;      // empuje principal (m/s²)
    [SerializeField] private float maxSpeed = 60f;
    [SerializeField] private float boostSpeed = 115f;
    [SerializeField] private float boostAcceleration = 90f;

    [Header("Maniobra")]
    [SerializeField] private float strafeSpeed = 30f;       // empuje lateral (A/D)
    [SerializeField] private float verticalSpeed = 30f;     // empuje vertical (R/F)

    [Header("Rotación")]
    [SerializeField] private float pitchSensitivity = 0.55f; // rad/s añadidos por unidad de ratón
    [SerializeField] private float yawSensitivity = 0.45f;
    [SerializeField] private float rollSpeed = 8f;           // Q/E (aceleración angular)

    [Header("Inercia")]
    [SerializeField] private float linearDrag = 0.6f;
    [SerializeField] private float angularDrag = 3f;

    /// <summary>0..1 de velocidad respecto al máximo (cámara y motores leen esto).</summary>
    public float Speed01 { get; private set; }
    /// <summary>0..1 del acelerador hacia delante (los efectos de motor leen esto).</summary>
    public float Thrust01 { get; private set; }
    public bool Boosting { get; private set; }
    public float CurrentSpeed { get; private set; }
    public Rigidbody Body => body;

    private Rigidbody body;
    private Vector3 thrustInput;    // x = strafe, y = vertical, z = adelante/atrás
    private Vector2 mouseAccum;     // deltas de ratón acumulados entre ticks de física
    private float rollInput;

    private void Awake()
    {
        body = GetComponent<Rigidbody>();
        body.useGravity = false;
#if UNITY_6000_0_OR_NEWER
        body.linearDamping = linearDrag;
        body.angularDamping = angularDrag;
#else
        body.drag = linearDrag;
        body.angularDrag = angularDrag;
#endif
        body.interpolation = RigidbodyInterpolation.Interpolate;
        body.maxAngularVelocity = 4f;
    }

    private void Start()
    {
        Cursor.lockState = CursorLockMode.Locked;
        Cursor.visible = false;
    }

    private void Update()
    {
        thrustInput = new Vector3(
            Input.GetAxis("Horizontal"),
            (Input.GetKey(KeyCode.R) ? 1f : 0f) - (Input.GetKey(KeyCode.F) ? 1f : 0f),
            Input.GetAxis("Vertical"));

        // ACUMULAR (no sobrescribir): a >50 fps ninguna muestra de ratón se pierde.
        mouseAccum += new Vector2(-Input.GetAxis("Mouse Y"), Input.GetAxis("Mouse X"));

        rollInput = (Input.GetKey(KeyCode.Q) ? 1f : 0f) - (Input.GetKey(KeyCode.E) ? 1f : 0f);
        Boosting = Input.GetKey(KeyCode.LeftShift) && thrustInput.z > 0.1f;
        Thrust01 = Mathf.Clamp01(thrustInput.z);

#if UNITY_6000_0_OR_NEWER
        CurrentSpeed = body.linearVelocity.magnitude;
#else
        CurrentSpeed = body.velocity.magnitude;
#endif
        Speed01 = CurrentSpeed / maxSpeed;
    }

    private void FixedUpdate()
    {
        float thrustPower = Boosting ? boostAcceleration : acceleration;
        float speedLimit = Boosting ? boostSpeed : maxSpeed;

        Vector3 force = new Vector3(
            thrustInput.x * strafeSpeed,
            thrustInput.y * verticalSpeed,
            thrustInput.z * thrustPower);
        body.AddRelativeForce(force, ForceMode.Acceleration);

        // Límite de velocidad suave.
#if UNITY_6000_0_OR_NEWER
        Vector3 velocity = body.linearVelocity;
        if (velocity.magnitude > speedLimit)
            body.linearVelocity = Vector3.Lerp(velocity, velocity.normalized * speedLimit, 0.08f);
#else
        Vector3 velocity = body.velocity;
        if (velocity.magnitude > speedLimit)
            body.velocity = Vector3.Lerp(velocity, velocity.normalized * speedLimit, 0.08f);
#endif

        // Ratón: se consume el desplazamiento acumulado como impulso de giro
        // (independiente del framerate) y se vacía el acumulador.
        body.AddRelativeTorque(
            new Vector3(mouseAccum.x * pitchSensitivity, mouseAccum.y * yawSensitivity, 0f),
            ForceMode.VelocityChange);
        mouseAccum = Vector2.zero;

        // Roll continuo por teclado: el amortiguado angular le da la inercia.
        body.AddRelativeTorque(new Vector3(0f, 0f, rollInput * rollSpeed), ForceMode.Acceleration);
    }
}

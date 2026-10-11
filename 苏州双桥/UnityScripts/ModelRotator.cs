using UnityEngine;

public class ModelRotator : MonoBehaviour
{
    [Header("旋转")]
    public float rotateSpeedX = 180f;   // 左右拖拽，绕本地Y轴
    public float rotateSpeedY = 120f;   // 上下拖拽，绕本地X轴
    public bool invertX = false;
    public bool invertY = false;

    [Header("缩放模型")]
    public float scaleSpeed = 0.2f;
    public float minScaleMultiplier = 0.5f;
    public float maxScaleMultiplier = 3f;
    public float scaleSmoothTime = 0.08f;

    [Header("俯仰限制")]
    public float minPitch = -80f;
    public float maxPitch = 80f;

    [Header("打开面板时是否恢复初始状态")]
    public bool resetWhenOpen = false;

    private Quaternion initialLocalRotation;
    private Vector3 initialLocalScale;

    private float yaw;
    private float pitch;

    private float currentScaleMultiplier = 1f;
    private float targetScaleMultiplier = 1f;
    private float scaleVelocity = 0f;

    private bool initialized = false;
    private bool waitForMouseRelease = false;

    private void Awake()
    {
        initialLocalRotation = transform.localRotation;
        initialLocalScale = transform.localScale;

        Vector3 euler = transform.localEulerAngles;
        pitch = NormalizeAngle(euler.x);
        yaw = NormalizeAngle(euler.y);
    }

    /// <summary>
    /// 初始化，不改相机，只接管模型自身旋转
    /// </summary>
    public void InitializeFromCurrentCamera(bool preserveExactPose = true)
    {
        if (resetWhenOpen)
        {
            ResetView();
        }
        else
        {
            Vector3 euler = transform.localEulerAngles;
            pitch = NormalizeAngle(euler.x);
            yaw = NormalizeAngle(euler.y);
        }

        initialized = true;
        waitForMouseRelease = true;

        Debug.Log("[ModelRotator] 已初始化：模型将绕自身 Pivot 旋转。");
    }

    public void ResetView()
    {
        transform.localRotation = initialLocalRotation;
        transform.localScale = initialLocalScale;

        currentScaleMultiplier = 1f;
        targetScaleMultiplier = 1f;
        scaleVelocity = 0f;

        Vector3 euler = transform.localEulerAngles;
        pitch = NormalizeAngle(euler.x);
        yaw = NormalizeAngle(euler.y);

        Debug.Log("[ModelRotator] 已恢复模型初始旋转和缩放。");
    }

    private void LateUpdate()
    {
        if (!initialized)
            return;

        if (waitForMouseRelease)
        {
            if (Input.GetMouseButton(0))
            {
                return;
            }

            waitForMouseRelease = false;
        }

        if (Input.GetMouseButton(0))
        {
            float mouseX = Input.GetAxis("Mouse X");
            float mouseY = Input.GetAxis("Mouse Y");

            if (Mathf.Abs(mouseX) > 0.0001f || Mathf.Abs(mouseY) > 0.0001f)
            {
                float xSign = invertX ? -1f : 1f;
                float ySign = invertY ? -1f : 1f;

                yaw += mouseX * rotateSpeedX * Time.deltaTime * xSign;
                pitch -= mouseY * rotateSpeedY * Time.deltaTime * ySign;
                pitch = Mathf.Clamp(pitch, minPitch, maxPitch);

                // 关键：只改模型自身 localRotation
                // 这样就是绕自己的 Pivot 转
                transform.localRotation = Quaternion.Euler(pitch, yaw, 0f);
            }
        }

        float scroll = Input.mouseScrollDelta.y;
        if (Mathf.Abs(scroll) > 0.001f)
        {
            targetScaleMultiplier += scroll * scaleSpeed;
            targetScaleMultiplier = Mathf.Clamp(
                targetScaleMultiplier,
                minScaleMultiplier,
                maxScaleMultiplier
            );
        }

        if (Mathf.Abs(currentScaleMultiplier - targetScaleMultiplier) > 0.0001f)
        {
            currentScaleMultiplier = Mathf.SmoothDamp(
                currentScaleMultiplier,
                targetScaleMultiplier,
                ref scaleVelocity,
                scaleSmoothTime
            );

            transform.localScale = initialLocalScale * currentScaleMultiplier;
        }
    }

    private float NormalizeAngle(float angle)
    {
        while (angle > 180f) angle -= 360f;
        while (angle < -180f) angle += 360f;
        return angle;
    }
}
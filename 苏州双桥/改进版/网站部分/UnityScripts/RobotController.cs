using UnityEngine;

public class RobotController : MonoBehaviour
{
    private Animator animator;
    private bool isSpeaking = false;
    private bool isListening = false;

    // ????????????????????Animator Controller??????
    [Header("????????")]
    [SerializeField] private string speakBoolParam = "IsSpeaking";
    [SerializeField] private string listenBoolParam = "IsListening";
    [SerializeField] private string speakTriggerParam = "StartTalking";
    [SerializeField] private string listenTriggerParam = "StartListening";

    void Start()
    {
        animator = GetComponent<Animator>();
        if (animator == null)
        {
            Debug.LogError("[RobotController] ¦Ä??? Animator ???");
        }
        else
        {
            Debug.Log("[RobotController] ?????????????????");
        }
    }

    // ????????????????????????????
    public void OnUserStartSpeaking(string dummy)
    {
        if (!isListening)
        {
            isListening = true;
            isSpeaking = false;

            if (animator != null)
            {
                animator.SetBool(listenBoolParam, true);
                animator.SetBool(speakBoolParam, false);
                animator.SetTrigger(listenTriggerParam);
            }
            Debug.Log("[Robot] ????????? -> ???????????????");
        }
    }

    // ?????????????????
    public void OnUserStopSpeaking(string dummy)
    {
        if (isListening)
        {
            isListening = false;
            if (animator != null)
            {
                animator.SetBool(listenBoolParam, false);
            }
            Debug.Log("[Robot] ????????");
        }
    }

    // ????????????????????
    public void OnRobotStartSpeaking(string dummy)
    {
        if (!isSpeaking)
        {
            isSpeaking = true;
            isListening = false;

            if (animator != null)
            {
                animator.SetBool(speakBoolParam, true);
                animator.SetBool(listenBoolParam, false);
                animator.SetTrigger(speakTriggerParam);
            }
            Debug.Log("[Robot] ???????????");
        }
    }

    // ????????????????????
    public void OnRobotStopSpeaking(string dummy)
    {
        if (isSpeaking)
        {
            isSpeaking = false;
            if (animator != null)
            {
                animator.SetBool(speakBoolParam, false);
            }
            Debug.Log("[Robot] ???????????");
        }
    }

    // ??????????????????????????
    public void OnStartListening(string dummy)
    {
        Debug.Log("[Robot] ???????????");
        // ??????????"????"????
        if (animator != null)
        {
            animator.SetTrigger("WakeUp");
        }
    }

    // ????????????????
    public void ResetState()
    {
        isSpeaking = false;
        isListening = false;
        if (animator != null)
        {
            animator.SetBool(speakBoolParam, false);
            animator.SetBool(listenBoolParam, false);
        }
    }
}
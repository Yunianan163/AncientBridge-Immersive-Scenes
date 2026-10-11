using UnityEngine;
using Random = UnityEngine.Random;

public class RobotConversationAnimator : MonoBehaviour
{
    [Header("?????? Animator")]
    [SerializeField] private Animator robotAnimator;

    [Header("Animator Trigger ????")]
    [SerializeField] private string listenNodTrigger = "ListenNod";
    [SerializeField] private string afterUserNodTrigger = "AfterUserNod";
    [SerializeField] private string talk1Trigger = "Talk1";
    [SerializeField] private string talk2Trigger = "Talk2";

    [Header("????????")]
    [SerializeField] private float listenNodCooldown = 1.2f;
    [SerializeField] private float talkGestureCooldown = 1.0f;

    private float lastListenNodTime = -999f;
    private float lastTalkGestureTime = -999f;

    private void Awake()
    {
        if (robotAnimator == null)
        {
            robotAnimator = GetComponentInChildren<Animator>(true);
        }
    }

    // ?????????????
    public void OnUserListening()
    {
        if (robotAnimator == null) return;
        if (Time.time - lastListenNodTime < listenNodCooldown) return;

        lastListenNodTime = Time.time;
        robotAnimator.SetTrigger(listenNodTrigger);
        Debug.Log("[RobotConversationAnimator] ?????????????????");
    }

    // ??????????
    public void OnUserFinished()
    {
        if (robotAnimator == null) return;

        robotAnimator.SetTrigger(afterUserNodTrigger);
        Debug.Log("[RobotConversationAnimator] ????????????????");
    }

    // ????????????????
    public void OnRobotReplyStart()
    {
        PlayRandomTalkGesture(true);
    }

    // ?????????????§á????????
    public void OnRobotReplying()
    {
        PlayRandomTalkGesture(false);
    }

    private void PlayRandomTalkGesture(bool forcePlay)
    {
        if (robotAnimator == null) return;

        if (!forcePlay && Time.time - lastTalkGestureTime < talkGestureCooldown)
            return;

        lastTalkGestureTime = Time.time;

        if (Random.value > 0.5f)
        {
            robotAnimator.SetTrigger(talk1Trigger);
            Debug.Log("[RobotConversationAnimator] ??????Talk1");
        }
        else
        {
            robotAnimator.SetTrigger(talk2Trigger);
            Debug.Log("[RobotConversationAnimator] ??????Talk2");
        }
    }
}
using UnityEngine;
using UnityEngine.EventSystems;

public class ModelDisplayPointerDebug : MonoBehaviour, IPointerEnterHandler, IPointerMoveHandler, IPointerExitHandler, IPointerClickHandler
{
    public void OnPointerEnter(PointerEventData eventData)
    {
        Debug.Log("[ModelDisplayPointerDebug] 鼠标进入 ModelDisplay");
    }

    public void OnPointerMove(PointerEventData eventData)
    {
        Debug.Log("[ModelDisplayPointerDebug] 鼠标正在 ModelDisplay 上移动");
    }

    public void OnPointerExit(PointerEventData eventData)
    {
        Debug.Log("[ModelDisplayPointerDebug] 鼠标离开 ModelDisplay");
    }

    public void OnPointerClick(PointerEventData eventData)
    {
        Debug.Log("[ModelDisplayPointerDebug] 鼠标点击了 ModelDisplay");
    }
}
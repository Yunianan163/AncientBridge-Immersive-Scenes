using UnityEngine;

[ExecuteAlways]
[RequireComponent(typeof(MeshFilter), typeof(MeshRenderer))]
public class GenerateWaterMesh : MonoBehaviour
{
    [Header("网格尺寸")]
    public float width = 50f;
    public float length = 50f;

    [Header("细分数量")]
    [Range(2, 300)] public int xSegments = 100;
    [Range(2, 300)] public int zSegments = 100;

    [Header("自动生成")]
    public bool generateInEditor = true;
    public bool generateOnStart = true;

    private void Start()
    {
        if (Application.isPlaying && generateOnStart)
        {
            Generate();
        }
    }

    private void OnEnable()
    {
        if (!Application.isPlaying && generateInEditor)
        {
            Generate();
        }
    }

#if UNITY_EDITOR
    private void OnValidate()
    {
        xSegments = Mathf.Max(2, xSegments);
        zSegments = Mathf.Max(2, zSegments);
        width = Mathf.Max(0.1f, width);
        length = Mathf.Max(0.1f, length);

        if (!Application.isPlaying && generateInEditor)
        {
            Generate();
        }
    }
#endif

    [ContextMenu("Generate Water Mesh")]
    public void Generate()
    {
        MeshFilter meshFilter = GetComponent<MeshFilter>();
        if (meshFilter == null)
        {
            Debug.LogError("缺少 MeshFilter 组件。");
            return;
        }

        Mesh mesh = new Mesh();
        mesh.name = "GeneratedWaterMesh";

        int vertCountX = xSegments + 1;
        int vertCountZ = zSegments + 1;

        Vector3[] vertices = new Vector3[vertCountX * vertCountZ];
        Vector2[] uv = new Vector2[vertices.Length];
        int[] triangles = new int[xSegments * zSegments * 6];

        float halfWidth = width * 0.5f;
        float halfLength = length * 0.5f;

        for (int z = 0; z < vertCountZ; z++)
        {
            for (int x = 0; x < vertCountX; x++)
            {
                int i = z * vertCountX + x;

                float xPos = ((float)x / xSegments) * width - halfWidth;
                float zPos = ((float)z / zSegments) * length - halfLength;

                vertices[i] = new Vector3(xPos, 0f, zPos);
                uv[i] = new Vector2((float)x / xSegments, (float)z / zSegments);
            }
        }

        int triIndex = 0;
        for (int z = 0; z < zSegments; z++)
        {
            for (int x = 0; x < xSegments; x++)
            {
                int i = z * vertCountX + x;

                triangles[triIndex++] = i;
                triangles[triIndex++] = i + vertCountX;
                triangles[triIndex++] = i + 1;

                triangles[triIndex++] = i + 1;
                triangles[triIndex++] = i + vertCountX;
                triangles[triIndex++] = i + vertCountX + 1;
            }
        }

        mesh.vertices = vertices;
        mesh.uv = uv;
        mesh.triangles = triangles;
        mesh.RecalculateNormals();
        mesh.RecalculateBounds();

        meshFilter.sharedMesh = mesh;
    }
}
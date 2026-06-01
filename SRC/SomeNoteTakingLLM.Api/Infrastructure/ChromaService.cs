using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using SomeNoteTakingLLM.Api.Domain;

namespace SomeNoteTakingLLM.Api.Infrastructure;

public class ChromaService
{
    private readonly IHttpClientFactory _http;
    private readonly IConfiguration _config;
    private readonly ILogger<ChromaService> _logger;

    private const string CollectionName = "sntllm_notes";
    private string? _collectionId;

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNameCaseInsensitive = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    public ChromaService(IHttpClientFactory http, IConfiguration config, ILogger<ChromaService> logger)
    {
        _http = http;
        _config = config;
        _logger = logger;
    }

    private string? ChromaUrl => _config["Chroma:Url"];

    // ── Collection ────────────────────────────────────────────────────────────

    private async Task<string?> GetOrCreateCollectionAsync(HttpClient client)
    {
        if (_collectionId is not null) return _collectionId;

        try
        {
            var payload = new { name = CollectionName, metadata = new Dictionary<string, string> { ["hnsw:space"] = "cosine" }, get_or_create = true };
            var resp = await client.PostAsJsonAsync("api/v1/collections", payload, JsonOpts);
            if (resp.IsSuccessStatusCode)
            {
                var col = await resp.Content.ReadFromJsonAsync<ChromaCollection>(JsonOpts);
                _collectionId = col?.Id;
                return _collectionId;
            }
            // Fallback: try GET
            var getResp = await client.GetAsync($"api/v1/collections/{CollectionName}");
            if (getResp.IsSuccessStatusCode)
            {
                var col = await getResp.Content.ReadFromJsonAsync<ChromaCollection>(JsonOpts);
                _collectionId = col?.Id;
                return _collectionId;
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "ChromaDB: failed to get/create collection");
        }
        return null;
    }

    private HttpClient BuildChromaClient()
    {
        var client = _http.CreateClient();
        client.BaseAddress = new Uri(ChromaUrl!.TrimEnd('/') + "/");
        client.Timeout = TimeSpan.FromSeconds(15);
        return client;
    }

    // ── Embeddings ────────────────────────────────────────────────────────────

    private async Task<float[]?> GetEmbeddingAsync(string text, string ollamaUrl, string model)
    {
        try
        {
            using var hc = _http.CreateClient();
            hc.Timeout = TimeSpan.FromSeconds(60);
            var payload = new { model, prompt = text };
            var resp = await hc.PostAsJsonAsync($"{ollamaUrl.TrimEnd('/')}/api/embeddings", payload, JsonOpts);
            if (!resp.IsSuccessStatusCode) return null;
            var result = await resp.Content.ReadFromJsonAsync<OllamaEmbeddingResponse>(JsonOpts);
            return result?.Embedding;
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "ChromaDB: embedding failed (will skip ChromaDB)");
            return null;
        }
    }

    // ── Upsert ────────────────────────────────────────────────────────────────

    public async Task UpsertNoteAsync(Note note, string ollamaUrl, string embeddingModel)
    {
        if (string.IsNullOrWhiteSpace(ChromaUrl)) return;
        try
        {
            var text = $"{note.Title}\n{note.Content}".Trim();
            if (string.IsNullOrWhiteSpace(text)) return;

            var embedding = await GetEmbeddingAsync(text, ollamaUrl, embeddingModel);
            if (embedding is null || embedding.Length == 0) return;

            using var client = BuildChromaClient();
            var colId = await GetOrCreateCollectionAsync(client);
            if (colId is null) return;

            var payload = new JsonObject
            {
                ["ids"] = new JsonArray { JsonValue.Create(note.Id.ToString()) },
                ["embeddings"] = new JsonArray { JsonSerializer.SerializeToNode(embedding) },
                ["documents"] = new JsonArray { JsonValue.Create(text) },
                ["metadatas"] = new JsonArray
                {
                    new JsonObject
                    {
                        ["userId"]    = JsonValue.Create(note.OwnerId.ToString()),
                        ["projectId"] = JsonValue.Create(note.ProjectId?.ToString() ?? ""),
                        ["title"]     = JsonValue.Create(note.Title ?? ""),
                        ["noteType"]  = JsonValue.Create((int)note.NoteType),
                        ["updatedAt"] = JsonValue.Create(note.UpdatedAt.ToString("O")),
                    }
                }
            };

            var resp = await client.PostAsJsonAsync($"api/v1/collections/{colId}/upsert", payload, JsonOpts);
            if (!resp.IsSuccessStatusCode)
                _logger.LogWarning("ChromaDB upsert failed for note {NoteId}: {Status}", note.Id, resp.StatusCode);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "ChromaDB: failed to upsert note {NoteId}", note.Id);
        }
    }

    // ── Delete ────────────────────────────────────────────────────────────────

    public async Task DeleteNoteAsync(Guid noteId)
    {
        if (string.IsNullOrWhiteSpace(ChromaUrl)) return;
        try
        {
            using var client = BuildChromaClient();
            var colId = await GetOrCreateCollectionAsync(client);
            if (colId is null) return;

            var payload = new JsonObject
            {
                ["ids"] = new JsonArray { JsonValue.Create(noteId.ToString()) }
            };
            await client.PostAsJsonAsync($"api/v1/collections/{colId}/delete", payload, JsonOpts);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "ChromaDB: failed to delete note {NoteId}", noteId);
        }
    }

    // ── Search ────────────────────────────────────────────────────────────────

    public async Task<List<ChromaSearchResult>> SearchAsync(
        string query, Guid userId, Guid? projectId,
        string ollamaUrl, string embeddingModel, int topK = 5)
    {
        if (string.IsNullOrWhiteSpace(ChromaUrl)) return [];
        try
        {
            var embedding = await GetEmbeddingAsync(query, ollamaUrl, embeddingModel);
            if (embedding is null || embedding.Length == 0) return [];

            using var client = BuildChromaClient();
            var colId = await GetOrCreateCollectionAsync(client);
            if (colId is null) return [];

            JsonNode whereClause;
            if (projectId.HasValue)
            {
                whereClause = new JsonObject
                {
                    ["$and"] = new JsonArray
                    {
                        new JsonObject { ["userId"]    = new JsonObject { ["$eq"] = JsonValue.Create(userId.ToString()) } },
                        new JsonObject { ["projectId"] = new JsonObject { ["$eq"] = JsonValue.Create(projectId.Value.ToString()) } }
                    }
                };
            }
            else
            {
                whereClause = new JsonObject
                {
                    ["userId"] = new JsonObject { ["$eq"] = JsonValue.Create(userId.ToString()) }
                };
            }

            var payload = new JsonObject
            {
                ["query_embeddings"] = new JsonArray { JsonSerializer.SerializeToNode(embedding) },
                ["n_results"]        = JsonValue.Create(topK),
                ["where"]            = whereClause,
                ["include"]          = new JsonArray { "documents", "metadatas", "distances" }
            };

            var resp = await client.PostAsJsonAsync($"api/v1/collections/{colId}/query", payload, JsonOpts);
            if (!resp.IsSuccessStatusCode) return [];

            var result = await resp.Content.ReadFromJsonAsync<ChromaQueryResult>(JsonOpts);
            if (result?.Ids is null || result.Ids.Count == 0) return [];

            var results = new List<ChromaSearchResult>();
            var ids       = result.Ids[0];
            var docs      = result.Documents?[0];
            var distances = result.Distances?[0];
            var metas     = result.Metadatas?[0];

            for (int i = 0; i < ids.Count; i++)
            {
                var meta = metas?.ElementAtOrDefault(i);
                results.Add(new ChromaSearchResult
                {
                    Id       = ids[i],
                    Document = docs?.ElementAtOrDefault(i) ?? "",
                    Distance = distances?.ElementAtOrDefault(i) ?? 1f,
                    Title    = meta is not null && meta.TryGetValue("title", out var t) ? t?.ToString() ?? "" : "",
                });
            }
            return results;
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "ChromaDB: search failed (will skip)");
            return [];
        }
    }

    // ── Sync all ──────────────────────────────────────────────────────────────

    public async Task<int> SyncAllNotesAsync(IEnumerable<Note> notes, string ollamaUrl, string embeddingModel)
    {
        int count = 0;
        foreach (var note in notes)
        {
            await UpsertNoteAsync(note, ollamaUrl, embeddingModel);
            count++;
        }
        return count;
    }
}

// ── DTOs ──────────────────────────────────────────────────────────────────────

public record ChromaCollection(string? Id, string? Name);

public class OllamaEmbeddingResponse
{
    [JsonPropertyName("embedding")]
    public float[]? Embedding { get; set; }
}

public class ChromaQueryResult
{
    public List<List<string>>?                          Ids       { get; set; }
    public List<List<string?>>?                         Documents { get; set; }
    public List<List<float>>?                           Distances { get; set; }
    public List<List<Dictionary<string, object?>>>?     Metadatas { get; set; }
}

public class ChromaSearchResult
{
    public string Id       { get; set; } = "";
    public string Document { get; set; } = "";
    public float  Distance { get; set; }
    public string Title    { get; set; } = "";
}

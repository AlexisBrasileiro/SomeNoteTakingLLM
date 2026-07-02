using Microsoft.Extensions.Caching.Distributed;
using SomeNoteTakingLLM.Api.Domain;

namespace SomeNoteTakingLLM.Api.Infrastructure;

/// <summary>
/// Cache opcional de snapshots de ImportSession. Implementação fica inerte quando
/// não há Redis configurado (best-effort sobre o banco).
/// </summary>
public interface IImportSessionCache
{
    Task<ImportSession?> GetAsync(Guid importId, CancellationToken cancellationToken);
    Task SetAsync(ImportSession session, CancellationToken cancellationToken);
    Task RemoveAsync(Guid importId, CancellationToken cancellationToken);
}

public sealed class ImportSessionCache : IImportSessionCache
{
    private readonly IDistributedCache _cache;
    private readonly TimeSpan _ttl;
    private readonly bool _enabled;
    private static readonly System.Text.Json.JsonSerializerOptions _jsonOptions = new()
    {
        PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase,
        WriteIndented = false,
    };

    public ImportSessionCache(IDistributedCache cache, IConfiguration config)
    {
        _cache = cache;
        _ttl = TimeSpan.FromMinutes(30);
        var redisCs = config["Redis:ConnectionString"];
        _enabled = !string.IsNullOrWhiteSpace(redisCs);
    }

    private static string Key(Guid id) => $"sntllm:import:{id}";

    public async Task<ImportSession?> GetAsync(Guid importId, CancellationToken cancellationToken)
    {
        if (!_enabled) return null;
        try
        {
            var raw = await _cache.GetAsync(Key(importId), cancellationToken);
            if (raw is null || raw.Length == 0) return null;
            return System.Text.Json.JsonSerializer.Deserialize<ImportSession>(raw, _jsonOptions);
        }
        catch
        {
            return null;
        }
    }

    public async Task SetAsync(ImportSession session, CancellationToken cancellationToken)
    {
        if (!_enabled) return;
        try
        {
            var json = System.Text.Json.JsonSerializer.Serialize(session, _jsonOptions);
            var bytes = System.Text.UTF8Encoding.UTF8.GetBytes(json);
            await _cache.SetAsync(Key(session.Id), bytes, new DistributedCacheEntryOptions
            {
                SlidingExpiration = _ttl,
            }, cancellationToken);
        }
        catch
        {
            // best-effort: falhas no Redis nao devem quebrar o fluxo principal
        }
    }

    public async Task RemoveAsync(Guid importId, CancellationToken cancellationToken)
    {
        if (!_enabled) return;
        try
        {
            await _cache.RemoveAsync(Key(importId), cancellationToken);
        }
        catch
        {
            // best-effort
        }
    }
}

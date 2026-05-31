using System.IdentityModel.Tokens.Jwt;
using System.Net.Http.Headers;
using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using SomeNoteTakingLLM.Api.Data;

namespace SomeNoteTakingLLM.Api.Modules.Paperless;

public static class PaperlessEndpoints
{
    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNameCaseInsensitive = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    public static IEndpointRouteBuilder MapPaperlessEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/paperless").WithTags("Paperless").RequireAuthorization();

    // ── GET /tags — lista as tags do Paperless (server-side, sem CORS)
    group.MapGet("/tags", GetTags);

    // ── POST /test — testa conexão com URL/token fornecidos (server-side, sem CORS)
    group.MapPost("/test", TestConnection);

    // ── GET /documents — consulta documentos com lógica de fallback por projeto
    group.MapGet("/documents", GetDocuments);

        return app;
    }

    private static Guid GetUserId(ClaimsPrincipal user) =>
        Guid.Parse(user.FindFirstValue(JwtRegisteredClaimNames.Sub)!);

    private static async Task<(string url, string token, int? globalTagId)?> GetConfig(SomeNoteTakingLlmDbContext db)
    {
        var settings = await db.AppSettings
            .Where(s => s.Key == "paperless.url" || s.Key == "paperless.token" || s.Key == "paperless.globalTagId")
            .ToListAsync();

        var url   = settings.FirstOrDefault(s => s.Key == "paperless.url")?.Value;
        var token = settings.FirstOrDefault(s => s.Key == "paperless.token")?.Value;
        var tagStr = settings.FirstOrDefault(s => s.Key == "paperless.globalTagId")?.Value;

        if (string.IsNullOrWhiteSpace(url) || string.IsNullOrWhiteSpace(token))
            return null;

        int? globalTagId = int.TryParse(tagStr, out var tid) ? tid : null;
        return (url.TrimEnd('/'), token, globalTagId);
    }

    private static HttpClient BuildClient(string token)
    {
        var client = new HttpClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Token", token);
        client.Timeout = TimeSpan.FromSeconds(15);
        return client;
    }

    private static async Task<PaperlessDocument[]> FetchDocuments(HttpClient client, string baseUrl, int[] tagIds)
    {
        if (tagIds.Length == 0) return [];

        // tags__id__all=1,2,3
        var tagParam = string.Join(",", tagIds);
        var resp = await client.GetAsync($"{baseUrl}/api/documents/?tags__id__all={tagParam}&page_size=100");
        if (!resp.IsSuccessStatusCode) return [];

        var json = await resp.Content.ReadAsStringAsync();
        var list = JsonSerializer.Deserialize<PaperlessDocumentList>(json, JsonOpts);

        return list?.Results ?? [];
    }

    private static string StrategyLabel(string strategy) => strategy switch
    {
        "project+global" => "Tag Projeto + Tag Global",
        "project"        => "Apenas Tag Projeto",
        "global"         => "Apenas Tag Global",
        _                => strategy,
    };

    // POST /api/v1/paperless/test — testa conexão sem depender de config salva (evita CORS no browser)
    private static async Task<IResult> TestConnection(
        TestConnectionRequest request,
        ClaimsPrincipal user)
    {
        if (string.IsNullOrWhiteSpace(request.Url) || string.IsNullOrWhiteSpace(request.Token))
            return Results.BadRequest(new { message = "URL e token são obrigatórios." });

        using var client = BuildClient(request.Token);
        try
        {
            var resp = await client.GetAsync($"{request.Url.TrimEnd('/')}/api/");
            return resp.IsSuccessStatusCode
                ? Results.Ok(new { ok = true, statusCode = (int)resp.StatusCode })
                : Results.Ok(new { ok = false, statusCode = (int)resp.StatusCode });
        }
        catch (Exception ex)
        {
            return Results.Ok(new { ok = false, error = ex.Message });
        }
    }

    // GET /api/v1/paperless/tags
    private static async Task<IResult> GetTags(
        ClaimsPrincipal user,
        SomeNoteTakingLlmDbContext db)
    {
        var config = await GetConfig(db);
        if (config is null)
            return Results.BadRequest(new { message = "Paperless-ng não configurado." });

        var (url, token, _) = config.Value;
        using var client = BuildClient(token);
        try
        {
            var resp = await client.GetAsync($"{url}/api/tags/?page_size=500");
            if (!resp.IsSuccessStatusCode)
                return Results.Problem("Erro ao consultar tags do Paperless.", statusCode: 502);

            var json = await resp.Content.ReadAsStringAsync();
            // retorna o JSON raw do Paperless para o frontend
            using var doc = JsonDocument.Parse(json);
            return Results.Ok(doc.RootElement.Clone());
        }
        catch (Exception ex)
        {
            return Results.Problem(ex.Message, statusCode: 502, title: "Erro ao conectar no Paperless");
        }
    }

    // GET /api/v1/paperless/documents?projectId={guid}
    private static async Task<IResult> GetDocuments(
        ClaimsPrincipal user,
        SomeNoteTakingLlmDbContext db,
        Guid? projectId = null)
    {
        var config = await GetConfig(db);
        if (config is null)
            return Results.BadRequest(new { message = "Paperless-ng não configurado." });

        var (url, token, globalTagId) = config.Value;
        using var client = BuildClient(token);

        int? projectTagId = null;
        if (projectId.HasValue)
        {
            var ownerId = GetUserId(user);
            var project = await db.Projects.FirstOrDefaultAsync(p => p.Id == projectId.Value && p.OwnerId == ownerId);
            if (project is null) return Results.NotFound(new { message = "Projeto não encontrado." });
            projectTagId = project.PaperlessTagId;
        }

        try
        {
            var results = new List<DocumentQueryResult>();

            if (projectTagId.HasValue)
            {
                // Estratégia 1: Tag Projeto + Tag Global
                if (globalTagId.HasValue)
                {
                    var docs = await FetchDocuments(client, url, [projectTagId.Value, globalTagId.Value]);
                    results.Add(new DocumentQueryResult("project+global", StrategyLabel("project+global"), docs));
                }

                // Estratégia 2: Apenas Tag Projeto
                {
                    var docs = await FetchDocuments(client, url, [projectTagId.Value]);
                    results.Add(new DocumentQueryResult("project", StrategyLabel("project"), docs));
                }

                // Estratégia 3: Apenas Tag Global
                if (globalTagId.HasValue)
                {
                    var docs = await FetchDocuments(client, url, [globalTagId.Value]);
                    results.Add(new DocumentQueryResult("global", StrategyLabel("global"), docs));
                }
            }
            else
            {
                // Sem tag de projeto → apenas tag global
                if (globalTagId.HasValue)
                {
                    var docs = await FetchDocuments(client, url, [globalTagId.Value]);
                    results.Add(new DocumentQueryResult("global", StrategyLabel("global"), docs));
                }
            }

            return Results.Ok(results);
        }
        catch (Exception ex)
        {
            return Results.Problem(ex.Message, statusCode: 502, title: "Erro ao conectar no Paperless");
        }
    }
}

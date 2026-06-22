using System.Text.Json;
using System.Text.Json.Nodes;
using System.Security.Claims;
using System.IdentityModel.Tokens.Jwt;

namespace SomeNoteTakingLLM.Api.Modules.Search;

public static class SearchEndpoints
{
    public static IEndpointRouteBuilder MapSearchEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/search").WithTags("Search").RequireAuthorization();
        group.MapGet("/info", GetInfo);
        group.MapGet("/", Search);
        group.MapGet("/notes", SearchNotes);
        group.MapGet("/projects", SearchProjects);
        group.MapGet("/tags", SearchTags);
        return app;
    }

    private sealed record SearchItem(string Id, string Title, string Type, string? CreatedAt);

    private static IResult GetInfo(IConfiguration config)
    {
        var publicUrl = config["Searxng:PublicUrl"];
        return Results.Ok(new { searxngUrl = publicUrl });
    }

    private static async Task<IResult> Search(
        string q,
        IConfiguration config,
        IHttpClientFactory httpFactory,
        int? pageno = 1,
        string? categories = null,
        string? language = null)
    {
        var searxUrl = config["Searxng:Url"];
        if (string.IsNullOrWhiteSpace(searxUrl))
            return Results.BadRequest(new { message = "SearxNG não configurado." });

        try
        {
            using var client = httpFactory.CreateClient();
            client.Timeout = TimeSpan.FromSeconds(15);

            var qs = $"?q={Uri.EscapeDataString(q)}&format=json&pageno={pageno ?? 1}";
            if (!string.IsNullOrWhiteSpace(categories)) qs += $"&categories={Uri.EscapeDataString(categories)}";
            if (!string.IsNullOrWhiteSpace(language))   qs += $"&language={Uri.EscapeDataString(language)}";

            var resp = await client.GetAsync($"{searxUrl.TrimEnd('/')}/search{qs}");
            if (!resp.IsSuccessStatusCode)
                return Results.StatusCode((int)resp.StatusCode);

            var json = await resp.Content.ReadAsStringAsync();
            return Results.Content(json, "application/json");
        }
        catch (TaskCanceledException)
        {
            return Results.Problem(detail: "Timeout ao acessar SearxNG", statusCode: 504, title: "Gateway Timeout");
        }
        catch (Exception ex)
        {
            return Results.Problem(detail: ex.Message, statusCode: 503, title: "Erro ao acessar SearxNG");
        }
    }

    private static Task<IResult> SearchNotes(
        string query,
        IConfiguration config,
        IHttpClientFactory httpFactory,
        string? category = null,
        int? pageno = 1,
        string? language = null)
    {
        var searxCategory = MapFrontendCategory(category, "general");
        return SearchTyped(query, "note", searxCategory, config, httpFactory, pageno, language);
    }

    private static Task<IResult> SearchProjects(
        string query,
        IConfiguration config,
        IHttpClientFactory httpFactory,
        int? pageno = 1,
        string? language = null)
    {
        return SearchTyped(query, "project", "it", config, httpFactory, pageno, language);
    }

    private static Task<IResult> SearchTags(
        string query,
        IConfiguration config,
        IHttpClientFactory httpFactory,
        int? pageno = 1,
        string? language = null)
    {
        return SearchTyped(query, "tag", "science", config, httpFactory, pageno, language);
    }

    private static async Task<IResult> SearchTyped(
        string query,
        string resultType,
        string? categories,
        IConfiguration config,
        IHttpClientFactory httpFactory,
        int? pageno,
        string? language)
    {
        if (string.IsNullOrWhiteSpace(query))
            return Results.Ok(Array.Empty<SearchItem>());

        var searxUrl = config["Searxng:Url"];
        if (string.IsNullOrWhiteSpace(searxUrl))
            return Results.BadRequest(new { message = "SearxNG nao configurado." });

        try
        {
            using var client = httpFactory.CreateClient();
            client.Timeout = TimeSpan.FromSeconds(15);

            var qs = $"?q={Uri.EscapeDataString(query)}&format=json&pageno={pageno ?? 1}";
            if (!string.IsNullOrWhiteSpace(categories)) qs += $"&categories={Uri.EscapeDataString(categories)}";
            if (!string.IsNullOrWhiteSpace(language)) qs += $"&language={Uri.EscapeDataString(language)}";

            var resp = await client.GetAsync($"{searxUrl.TrimEnd('/')}/search{qs}");
            if (!resp.IsSuccessStatusCode)
                return Results.StatusCode((int)resp.StatusCode);

            var json = await resp.Content.ReadAsStringAsync();
            var items = MapResults(json, resultType);
            return Results.Ok(items);
        }
        catch (TaskCanceledException)
        {
            return Results.Problem(detail: "Timeout ao acessar SearxNG", statusCode: 504, title: "Gateway Timeout");
        }
        catch (JsonException ex)
        {
            return Results.Problem(detail: ex.Message, statusCode: 502, title: "Resposta invalida do SearxNG");
        }
        catch (Exception ex)
        {
            return Results.Problem(detail: ex.Message, statusCode: 503, title: "Erro ao acessar SearxNG");
        }
    }

    private static SearchItem[] MapResults(string json, string resultType)
    {
        var root = JsonNode.Parse(json)?.AsObject();
        var results = root?["results"]?.AsArray();
        if (results is null || results.Count == 0)
            return Array.Empty<SearchItem>();

        return results
            .Select((node, index) => ToSearchItem(node, resultType, index))
            .Where(item => item is not null)
            .Cast<SearchItem>()
            .ToArray();
    }

    private static SearchItem? ToSearchItem(JsonNode? node, string resultType, int index)
    {
        if (node is not JsonObject result)
            return null;

        var title = result["title"]?.GetValue<string>()?.Trim();
        var url = result["url"]?.GetValue<string>()?.Trim();
        var content = result["content"]?.GetValue<string>()?.Trim();
        var publishedDate = result["publishedDate"]?.GetValue<string>()?.Trim();
        var id = string.IsNullOrWhiteSpace(url) ? $"{resultType}:{index}" : url;
        var normalizedTitle = !string.IsNullOrWhiteSpace(title)
            ? title
            : !string.IsNullOrWhiteSpace(content)
                ? content[..Math.Min(content.Length, 120)]
                : "Sem titulo";

        return new SearchItem(id, normalizedTitle, resultType, publishedDate);
    }

    private static string? MapFrontendCategory(string? category, string fallback)
    {
        return category?.ToLowerInvariant() switch
        {
            null => fallback,
            "all" => null,
            "tags" => "science",
            "dates" => "news",
            "projects" => "it",
            _ => fallback,
        };
    }
}

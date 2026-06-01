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
        return app;
    }

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
}

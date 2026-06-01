using System.Net;

namespace SomeNoteTakingLLM.Api.Modules.Ollama;

public static class OllamaEndpoints
{
    public static IEndpointRouteBuilder MapOllamaEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/ollama").WithTags("Ollama").RequireAuthorization();

        // POST /test — testa conexão com URL fornecida (server-side, sem CORS)
        group.MapPost("/test", TestConnection);

        return app;
    }

    private static async Task<IResult> TestConnection(
        TestOllamaConnectionRequest request,
        IHttpClientFactory httpClientFactory,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Url))
            return Results.BadRequest(new { message = "URL é obrigatória." });

        if (!Uri.TryCreate(request.Url, UriKind.Absolute, out var baseUri) ||
            (baseUri.Scheme != Uri.UriSchemeHttp && baseUri.Scheme != Uri.UriSchemeHttps))
        {
            return Results.BadRequest(new { message = "URL inválida. Use http:// ou https://" });
        }

        var client = httpClientFactory.CreateClient();
        client.Timeout = TimeSpan.FromSeconds(10);

        var tagsUrl = new Uri(baseUri, "/api/tags");

        try
        {
            using var resp = await client.GetAsync(tagsUrl, cancellationToken);
            return Results.Ok(new { ok = resp.IsSuccessStatusCode, statusCode = (int)resp.StatusCode });
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return Results.Ok(new { ok = false, statusCode = (int)HttpStatusCode.RequestTimeout, error = "Timeout ao conectar no Ollama." });
        }
        catch (HttpRequestException ex)
        {
            return Results.Ok(new { ok = false, statusCode = (int)HttpStatusCode.BadGateway, error = ex.Message });
        }
        catch (Exception ex)
        {
            return Results.Ok(new { ok = false, statusCode = (int)HttpStatusCode.InternalServerError, error = ex.Message });
        }
    }
}

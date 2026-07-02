using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using SomeNoteTakingLLM.Api.Data;
using SomeNoteTakingLLM.Api.Infrastructure;

namespace SomeNoteTakingLLM.Api.Modules.Import;

public static class ImportEndpoints
{
    public static IEndpointRouteBuilder MapImportEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/import").WithTags("Import").RequireAuthorization();

        group.MapPost("/zip", UploadZip);
        group.MapPost("/md", UploadMarkdown);
        group.MapPost("/{importId:guid}/convert", ConvertHtml);
        group.MapGet("/{importId:guid}", GetStatus);
        group.MapPost("/{importId:guid}/heartbeat", Heartbeat);
        group.MapPost("/{importId:guid}/execute", ExecuteImport);
        group.MapPost("/{importId:guid}/cancel", CancelImport);

        return app;
    }

    private static Guid GetUserId(ClaimsPrincipal user) =>
        Guid.Parse(user.FindFirstValue(JwtRegisteredClaimNames.Sub)!);

    private static async Task<IResult> UploadZip(
        HttpRequest request,
        ClaimsPrincipal user,
        ZipImportService importService,
        CancellationToken cancellationToken)
    {
        var ownerId = GetUserId(user);

        if (!request.HasFormContentType)
            return Results.BadRequest(new { message = "Content-Type deve ser multipart/form-data." });

        var form = await request.ReadFormAsync(cancellationToken);
        var file = form.Files.GetFile("file");

        if (file is null || file.Length == 0)
            return Results.BadRequest(new { message = "Arquivo ZIP é obrigatório (campo 'file')." });

        if (!file.FileName.EndsWith(".zip", StringComparison.OrdinalIgnoreCase))
            return Results.BadRequest(new { message = "Apenas arquivos .zip são aceitos." });

        var ollamaUrl = form["ollamaUrl"].FirstOrDefault();
        var ollamaModel = form["ollamaModel"].FirstOrDefault();

        using var stream = file.OpenReadStream();
        var result = await importService.ExtractAndAnalyzeAsync(
            stream, ownerId, ollamaUrl, ollamaModel, cancellationToken);

        return Results.Ok(result);
    }

    private static async Task<IResult> ConvertHtml(
        Guid importId,
        ZipImportService importService,
        CancellationToken cancellationToken)
    {
        try
        {
            var result = await importService.ConvertHtmlFilesAsync(importId, cancellationToken);
            return Results.Accepted($"/api/v1/import/{importId}", result);
        }
        catch (InvalidOperationException)
        {
            return Results.NotFound(new { message = "Sessão de importação não encontrada." });
        }
    }

    /// <summary>
    /// POST /api/v1/import/md
    /// Recebe um arquivo .md (multipart/form-data, campo "file").
    /// Cria uma sessão de importação com um único arquivo markdown.
    /// </summary>
    private static async Task<IResult> UploadMarkdown(
        HttpRequest request,
        ClaimsPrincipal user,
        ZipImportService importService,
        CancellationToken cancellationToken)
    {
        var ownerId = GetUserId(user);

        if (!request.HasFormContentType)
            return Results.BadRequest(new { message = "Content-Type deve ser multipart/form-data." });

        var form = await request.ReadFormAsync(cancellationToken);
        var file = form.Files.GetFile("file");

        if (file is null || file.Length == 0)
            return Results.BadRequest(new { message = "Arquivo .md é obrigatório (campo 'file')." });

        var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
        if (ext != ".md" && ext != ".markdown")
            return Results.BadRequest(new { message = "Apenas arquivos .md ou .markdown são aceitos." });

        using var stream = file.OpenReadStream();
        var result = await importService.ExtractMarkdownAsync(
            stream, file.FileName, ownerId, cancellationToken);

        return Results.Ok(result);
    }

    private static async Task<IResult> GetStatus(
        Guid importId,
        ZipImportService importService,
        CancellationToken cancellationToken)
    {
        var session = await importService.GetSessionAsync(importId, cancellationToken);
        return session is null
            ? Results.NotFound(new { message = "Sessão de importação não encontrada." })
            : Results.Ok(session);
    }

    private static async Task<IResult> Heartbeat(
        Guid importId,
        ZipImportService importService,
        CancellationToken cancellationToken)
    {
        var session = await importService.TouchSessionAsync(importId, cancellationToken);
        return session is null
            ? Results.NotFound(new { message = "Sessão de importação não encontrada." })
            : Results.Ok(session);
    }

    private static async Task<IResult> ExecuteImport(
        Guid importId,
        ImportExecuteRequest request,
        ClaimsPrincipal user,
        ZipImportService importService,
        CancellationToken cancellationToken)
    {
        try
        {
            var result = await importService.ExecuteImportAsync(
                importId, request.ProjectId, request.ParentNoteId, cancellationToken);

            return Results.Accepted($"/api/v1/import/{importId}", result);
        }
        catch (InvalidOperationException)
        {
            return Results.NotFound(new { message = "Sessão de importação não encontrada." });
        }
    }

    /// <summary>
    /// POST /api/v1/import/{importId}/cancel
    /// Cancela a operação em andamento (conversão ou importação).
    /// </summary>
    private static async Task<IResult> CancelImport(
        Guid importId,
        ZipImportService importService,
        CancellationToken cancellationToken)
    {
        try
        {
            var result = await importService.CancelAsync(importId, cancellationToken);
            return Results.Ok(result);
        }
        catch (InvalidOperationException)
        {
            return Results.NotFound(new { message = "Sessão de importação não encontrada." });
        }
    }
}

using System.IdentityModel.Tokens.Jwt;
using System.Net.Http.Headers;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using SomeNoteTakingLLM.Api.Data;
using SomeNoteTakingLLM.Api.Domain;

namespace SomeNoteTakingLLM.Api.Modules.Chat;

public static class ChatEndpoints
{
    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNameCaseInsensitive = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    public static IEndpointRouteBuilder MapChatEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/chats").WithTags("Chat").RequireAuthorization();

        group.MapGet("/", GetChats);
        group.MapPost("/", CreateChat);
        group.MapGet("/{id:guid}", GetChat);
        group.MapDelete("/{id:guid}", DeleteChat);
        group.MapPost("/{id:guid}/messages", SendMessage);

        return app;
    }

    private static Guid GetUserId(ClaimsPrincipal user) =>
        Guid.Parse(user.FindFirstValue(JwtRegisteredClaimNames.Sub)!);

    private static ChatReference[]? DeserializeRefs(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try { return JsonSerializer.Deserialize<ChatReference[]>(json, JsonOpts); }
        catch { return null; }
    }

    private static ChatMessageResponse ToMessageResponse(ChatMessage m) =>
        new(m.Id, m.Role, m.Content, DeserializeRefs(m.ReferencesJson), m.CreatedAt);

    // GET /api/v1/chats
    private static async Task<IResult> GetChats(ClaimsPrincipal user, SomeNoteTakingLlmDbContext db)
    {
        var ownerId = GetUserId(user);
        var chats = await db.Notes
            .Where(n => n.OwnerId == ownerId && n.NoteType == NoteType.Chat)
            .OrderByDescending(n => n.UpdatedAt)
            .Select(n => new
            {
                n.Id, n.Title, n.ProjectId, n.CreatedAt, n.UpdatedAt,
                MessageCount = db.ChatMessages.Count(m => m.ChatNoteId == n.Id)
            })
            .ToListAsync();

        var result = chats.Select(c => new ChatSummaryResponse(
            c.Id, c.Title ?? "Chat sem título",
            c.ProjectId.HasValue ? c.ProjectId.Value.ToString() : null,
            c.MessageCount, c.CreatedAt, c.UpdatedAt)).ToList();

        return Results.Ok(result);
    }

    // POST /api/v1/chats
    private static async Task<IResult> CreateChat(CreateChatRequest request, ClaimsPrincipal user, SomeNoteTakingLlmDbContext db)
    {
        var ownerId = GetUserId(user);

        Guid? projectId = null;
        if (!string.IsNullOrWhiteSpace(request.ProjectId) && Guid.TryParse(request.ProjectId, out var pid))
            projectId = pid;

        var now = DateTime.UtcNow;
        var note = new Note
        {
            Id = Guid.NewGuid(),
            OwnerId = ownerId,
            ProjectId = projectId,
            Title = request.Title,
            NoteType = NoteType.Chat,
            Depth = 0,
            CreatedAt = now,
            UpdatedAt = now
        };
        db.Notes.Add(note);
        await db.SaveChangesAsync();

        return Results.Created($"/api/v1/chats/{note.Id}",
            new ChatDetailResponse(note.Id, note.Title ?? "Chat sem título",
                projectId.HasValue ? projectId.Value.ToString() : null,
                note.CreatedAt, []));
    }

    // GET /api/v1/chats/{id}
    private static async Task<IResult> GetChat(Guid id, ClaimsPrincipal user, SomeNoteTakingLlmDbContext db)
    {
        var ownerId = GetUserId(user);
        var note = await db.Notes.FirstOrDefaultAsync(n => n.Id == id && n.OwnerId == ownerId && n.NoteType == NoteType.Chat);
        if (note is null) return Results.NotFound();

        var messages = await db.ChatMessages
            .Where(m => m.ChatNoteId == id)
            .OrderBy(m => m.CreatedAt)
            .ToListAsync();

        return Results.Ok(new ChatDetailResponse(
            note.Id, note.Title ?? "Chat sem título",
            note.ProjectId.HasValue ? note.ProjectId.Value.ToString() : null,
            note.CreatedAt,
            messages.Select(ToMessageResponse).ToArray()));
    }

    // DELETE /api/v1/chats/{id}
    private static async Task<IResult> DeleteChat(Guid id, ClaimsPrincipal user, SomeNoteTakingLlmDbContext db)
    {
        var ownerId = GetUserId(user);
        var note = await db.Notes.FirstOrDefaultAsync(n => n.Id == id && n.OwnerId == ownerId && n.NoteType == NoteType.Chat);
        if (note is null) return Results.NotFound();

        // Messages are deleted by cascade
        db.Notes.Remove(note);
        await db.SaveChangesAsync();
        return Results.NoContent();
    }

    // POST /api/v1/chats/{id}/messages
    private static async Task<IResult> SendMessage(
        Guid id,
        SendMessageRequest request,
        ClaimsPrincipal user,
        SomeNoteTakingLlmDbContext db)
    {
        var ownerId = GetUserId(user);
        var note = await db.Notes.FirstOrDefaultAsync(n => n.Id == id && n.OwnerId == ownerId && n.NoteType == NoteType.Chat);
        if (note is null) return Results.NotFound();

        // 1. Save user message
        var refsJson = request.References is { Length: > 0 }
            ? JsonSerializer.Serialize(request.References, JsonOpts)
            : null;

        var userMessage = new ChatMessage
        {
            Id = Guid.NewGuid(),
            ChatNoteId = id,
            Role = "user",
            Content = request.Content,
            ReferencesJson = refsJson,
            CreatedAt = DateTime.UtcNow
        };
        db.ChatMessages.Add(userMessage);
        await db.SaveChangesAsync();

        // 2. Load all messages in conversation
        var allMessages = await db.ChatMessages
            .Where(m => m.ChatNoteId == id)
            .OrderBy(m => m.CreatedAt)
            .ToListAsync();

        // 3. Collect ALL unique references from entire conversation
        var allRefs = allMessages
            .SelectMany(m => DeserializeRefs(m.ReferencesJson) ?? [])
            .GroupBy(r => $"{r.Type}:{r.Id}")
            .Select(g => g.First())
            .ToList();

        // 4. Fetch Ollama config
        var ollamaSettings = await db.AppSettings
            .Where(s => s.Key == "ollama.primaryUrl" || s.Key == "ollama.primaryModel")
            .ToListAsync();

        var ollamaUrl = ollamaSettings.FirstOrDefault(s => s.Key == "ollama.primaryUrl")?.Value;
        var ollamaModel = ollamaSettings.FirstOrDefault(s => s.Key == "ollama.primaryModel")?.Value;

        if (string.IsNullOrWhiteSpace(ollamaUrl))
            return Results.BadRequest(new { message = "Ollama não configurado. Configure 'ollama.primaryUrl' nas configurações." });

        ollamaModel ??= "llama3";

        // 5. Build context from references
        var contextBuilder = new StringBuilder();

        if (allRefs.Count > 0)
        {
            var paperlessSettings = await db.AppSettings
                .Where(s => s.Key == "paperless.url" || s.Key == "paperless.token")
                .ToListAsync();

            var paperlessUrl = paperlessSettings.FirstOrDefault(s => s.Key == "paperless.url")?.Value?.TrimEnd('/');
            var paperlessToken = paperlessSettings.FirstOrDefault(s => s.Key == "paperless.token")?.Value;

            foreach (var refItem in allRefs)
            {
                if (refItem.Type == "note")
                {
                    if (Guid.TryParse(refItem.Id, out var noteId))
                    {
                        var referencedNote = await db.Notes.FirstOrDefaultAsync(n => n.Id == noteId && n.OwnerId == ownerId);
                        if (referencedNote is not null)
                        {
                            contextBuilder.AppendLine($"### Nota: {referencedNote.Title ?? "Sem título"}");
                            if (!string.IsNullOrWhiteSpace(referencedNote.Content))
                                contextBuilder.AppendLine(referencedNote.Content);
                            contextBuilder.AppendLine();
                        }
                    }
                }
                else if (refItem.Type == "paperless_document" && !string.IsNullOrWhiteSpace(paperlessUrl) && !string.IsNullOrWhiteSpace(paperlessToken))
                {
                    try
                    {
                        using var client = BuildPaperlessClient(paperlessToken);
                        var resp = await client.GetAsync($"{paperlessUrl}/api/documents/{refItem.Id}/");
                        if (resp.IsSuccessStatusCode)
                        {
                            var json = await resp.Content.ReadAsStringAsync();
                            using var doc = JsonDocument.Parse(json);
                            var root = doc.RootElement;
                            var docTitle = root.TryGetProperty("title", out var titleProp) ? titleProp.GetString() : refItem.Title;
                            var content = root.TryGetProperty("content", out var contentProp) ? contentProp.GetString() : null;
                            contextBuilder.AppendLine($"### Documento Paperless: {docTitle}");
                            if (!string.IsNullOrWhiteSpace(content))
                                contextBuilder.AppendLine(content);
                            contextBuilder.AppendLine();
                        }
                    }
                    catch { /* silently skip if paperless fails */ }
                }
                else if (refItem.Type == "paperless_tag" && !string.IsNullOrWhiteSpace(paperlessUrl) && !string.IsNullOrWhiteSpace(paperlessToken))
                {
                    try
                    {
                        using var client = BuildPaperlessClient(paperlessToken);
                        var resp = await client.GetAsync($"{paperlessUrl}/api/documents/?tags__id__all={refItem.Id}&page_size=20");
                        if (resp.IsSuccessStatusCode)
                        {
                            var json = await resp.Content.ReadAsStringAsync();
                            using var doc = JsonDocument.Parse(json);
                            var root = doc.RootElement;
                            contextBuilder.AppendLine($"### Tag Paperless: {refItem.Title}");
                            contextBuilder.AppendLine("Documentos com esta tag:");
                            if (root.TryGetProperty("results", out var results))
                            {
                                foreach (var docEl in results.EnumerateArray())
                                {
                                    var docTitle = docEl.TryGetProperty("title", out var tp) ? tp.GetString() : "Sem título";
                                    contextBuilder.AppendLine($"- {docTitle}");
                                }
                            }
                            contextBuilder.AppendLine();
                        }
                    }
                    catch { /* silently skip if paperless fails */ }
                }
            }
        }

        // 6. Build system prompt
        var systemContent = "Você é um assistente inteligente de anotações. Responda de forma clara, precisa e útil.";
        if (contextBuilder.Length > 0)
            systemContent += $"\n\n## Contexto disponível:\n{contextBuilder}";

        // 7. Build message list for Ollama
        var ollamaMessages = new List<object>
        {
            new { role = "system", content = systemContent }
        };

        // All messages except the last (user just saved) were already in history
        foreach (var msg in allMessages)
        {
            ollamaMessages.Add(new { role = msg.Role, content = msg.Content });
        }

        // 8. Call Ollama
        var ollamaPayload = new
        {
            model = ollamaModel,
            messages = ollamaMessages,
            stream = false
        };

        string assistantContent;
        try
        {
            using var httpClient = new HttpClient { Timeout = TimeSpan.FromSeconds(120) };
            var ollamaJson = JsonSerializer.Serialize(ollamaPayload, JsonOpts);
            using var httpContent = new StringContent(ollamaJson, Encoding.UTF8, "application/json");
            var ollamaResp = await httpClient.PostAsync($"{ollamaUrl.TrimEnd('/')}/api/chat", httpContent);

            if (!ollamaResp.IsSuccessStatusCode)
            {
                var errBody = await ollamaResp.Content.ReadAsStringAsync();
                return Results.Problem(
                    detail: $"Ollama retornou status {(int)ollamaResp.StatusCode}: {errBody}",
                    statusCode: 502,
                    title: "Erro ao chamar Ollama");
            }

            var ollamaRespJson = await ollamaResp.Content.ReadAsStringAsync();
            using var ollamaDoc = JsonDocument.Parse(ollamaRespJson);
            var ollamaRoot = ollamaDoc.RootElement;

            if (!ollamaRoot.TryGetProperty("message", out var messageProp) ||
                !messageProp.TryGetProperty("content", out var contentProp2))
            {
                return Results.Problem(
                    detail: "Resposta do Ollama em formato inesperado.",
                    statusCode: 502,
                    title: "Erro ao processar resposta do Ollama");
            }

            assistantContent = contentProp2.GetString() ?? string.Empty;
        }
        catch (TaskCanceledException)
        {
            return Results.Problem(
                detail: "Ollama demorou muito para responder (timeout).",
                statusCode: 504,
                title: "Timeout ao chamar Ollama");
        }
        catch (HttpRequestException ex)
        {
            return Results.Problem(
                detail: $"Não foi possível conectar ao Ollama: {ex.Message}",
                statusCode: 502,
                title: "Erro ao conectar ao Ollama");
        }

        // 9. Save assistant response
        var assistantMessage = new ChatMessage
        {
            Id = Guid.NewGuid(),
            ChatNoteId = id,
            Role = "assistant",
            Content = assistantContent,
            ReferencesJson = null,
            CreatedAt = DateTime.UtcNow
        };
        db.ChatMessages.Add(assistantMessage);

        // Update note's UpdatedAt
        note.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();

        return Results.Ok(ToMessageResponse(assistantMessage));
    }

    private static HttpClient BuildPaperlessClient(string token)
    {
        var client = new HttpClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Token", token);
        client.Timeout = TimeSpan.FromSeconds(15);
        return client;
    }
}

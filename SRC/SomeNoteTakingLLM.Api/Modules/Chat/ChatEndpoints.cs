using System.IdentityModel.Tokens.Jwt;
using System.Net.Http.Headers;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using SomeNoteTakingLLM.Api.Data;
using SomeNoteTakingLLM.Api.Domain;
using SomeNoteTakingLLM.Api.Infrastructure;

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
        group.MapPatch("/{id:guid}", PatchChat);
        group.MapDelete("/{id:guid}", DeleteChat);
        group.MapPost("/{id:guid}/messages", SendMessage);
        group.MapPost("/{id:guid}/messages/stream", StreamMessage);

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

    // PATCH /api/v1/chats/{id}
    private static async Task<IResult> PatchChat(Guid id, PatchChatRequest request, ClaimsPrincipal user, SomeNoteTakingLlmDbContext db)
    {
        var ownerId = GetUserId(user);
        var note = await db.Notes.FirstOrDefaultAsync(n => n.Id == id && n.OwnerId == ownerId && n.NoteType == NoteType.Chat);
        if (note is null) return Results.NotFound();

        if (request.ProjectId is not null)
        {
            if (string.IsNullOrWhiteSpace(request.ProjectId))
                note.ProjectId = null;
            else if (Guid.TryParse(request.ProjectId, out var pid))
                note.ProjectId = pid;
        }
        else
        {
            note.ProjectId = null;
        }

        note.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        return Results.NoContent();
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
        SomeNoteTakingLlmDbContext db,
        ChromaService chroma,
        IConfiguration config,
        IHttpClientFactory httpFactory)
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
            .Where(s => s.Key == "llm.primary.url" || s.Key == "llm.primary.model"
                     || s.Key == "llm.fallback.enabled" || s.Key == "llm.fallback.url" || s.Key == "llm.fallback.model"
                     || s.Key == "llm.embedding.model")
            .ToListAsync();

        var ollamaUrl = ollamaSettings.FirstOrDefault(s => s.Key == "llm.primary.url")?.Value;
        var ollamaModel = ollamaSettings.FirstOrDefault(s => s.Key == "llm.primary.model")?.Value;
        var fallbackEnabled = ollamaSettings.FirstOrDefault(s => s.Key == "llm.fallback.enabled")?.Value == "true";
        var fallbackUrl   = ollamaSettings.FirstOrDefault(s => s.Key == "llm.fallback.url")?.Value;
        var fallbackModel = ollamaSettings.FirstOrDefault(s => s.Key == "llm.fallback.model")?.Value;
        var embeddingModel = ollamaSettings.FirstOrDefault(s => s.Key == "llm.embedding.model")?.Value ?? "nomic-embed-text";

        if (string.IsNullOrWhiteSpace(ollamaUrl))
            return Results.BadRequest(new { message = "Ollama não configurado. Configure a URL primária em Configurações → LLM." });

        ollamaModel = string.IsNullOrWhiteSpace(ollamaModel) ? "llama3" : ollamaModel;

        // 5. Build full context (user refs + automatic project context)
        var contextString = await BuildContextAsync(
            db, ownerId, allRefs,
            note.ProjectId, request.ContextDays ?? 90,
            request.Content, chroma, ollamaUrl, embeddingModel,
            config, httpFactory);

        // 6. Build system prompt + Ollama messages
        var systemContent = "Você é um assistente inteligente de anotações. Responda de forma clara, precisa e útil.";
        if (!string.IsNullOrWhiteSpace(contextString))
            systemContent += $"\n\n## Contexto disponível:\n{contextString}";

        var ollamaMessages = new List<object> { new { role = "system", content = systemContent } };
        foreach (var msg in allMessages)
            ollamaMessages.Add(new { role = msg.Role, content = msg.Content });

        // 7. Call Ollama (with fallback)
        string assistantContent;
        var lastError = string.Empty;

        async Task<(bool ok, string content, string error)> CallOllama(string url, string model)
        {
            try
            {
                var payload = new { model, messages = ollamaMessages, stream = false };
                using var hc = new HttpClient { Timeout = TimeSpan.FromSeconds(120) };
                var json = JsonSerializer.Serialize(payload, JsonOpts);
                using var body = new StringContent(json, Encoding.UTF8, "application/json");
                var resp = await hc.PostAsync($"{url.TrimEnd('/')}/api/chat", body);
                if (!resp.IsSuccessStatusCode)
                {
                    var errBody = await resp.Content.ReadAsStringAsync();
                    return (false, string.Empty, $"Ollama {url} retornou {(int)resp.StatusCode}: {errBody}");
                }
                var respJson = await resp.Content.ReadAsStringAsync();
                using var doc = JsonDocument.Parse(respJson);
                var root = doc.RootElement;
                if (!root.TryGetProperty("message", out var mp) || !root.TryGetProperty("message", out _) || !mp.TryGetProperty("content", out var cp))
                    return (false, string.Empty, "Resposta do Ollama em formato inesperado.");
                return (true, cp.GetString() ?? string.Empty, string.Empty);
            }
            catch (TaskCanceledException) { return (false, string.Empty, $"Timeout ao chamar Ollama em {url}."); }
            catch (HttpRequestException ex) { return (false, string.Empty, $"Erro ao conectar ao Ollama em {url}: {ex.Message}"); }
        }

        var (ok, content2, err) = await CallOllama(ollamaUrl, ollamaModel);
        if (!ok && fallbackEnabled && !string.IsNullOrWhiteSpace(fallbackUrl))
        {
            lastError = err;
            var fbModel = string.IsNullOrWhiteSpace(fallbackModel) ? ollamaModel : fallbackModel;
            (ok, content2, err) = await CallOllama(fallbackUrl, fbModel);
        }

        if (!ok)
            return Results.Problem(detail: err, statusCode: 502, title: "Erro ao chamar Ollama");

        assistantContent = content2;

        // 8. Save assistant response
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

    // POST /api/v1/chats/{id}/messages/stream  — SSE streaming response
    private static async Task StreamMessage(
        Guid id,
        HttpContext httpContext,
        ClaimsPrincipal user,
        SomeNoteTakingLlmDbContext db,
        ChromaService chroma,
        IConfiguration config,
        IHttpClientFactory httpFactory)
    {
        var ownerId = GetUserId(user);
        var request = await httpContext.Request.ReadFromJsonAsync<SendMessageRequest>(JsonOpts);
        if (request is null) { httpContext.Response.StatusCode = 400; return; }

        var note = await db.Notes.FirstOrDefaultAsync(n => n.Id == id && n.OwnerId == ownerId && n.NoteType == NoteType.Chat);
        if (note is null) { httpContext.Response.StatusCode = 404; return; }

        // ── Open SSE stream immediately so nginx doesn't time out ────────────
        httpContext.Response.ContentType = "text/event-stream; charset=utf-8";
        httpContext.Response.Headers.CacheControl = "no-cache";
        httpContext.Response.Headers.Connection = "keep-alive";
        httpContext.Response.Headers["X-Accel-Buffering"] = "no";

        var responseLock = new SemaphoreSlim(1, 1);
        async Task WriteEvent(string data)
        {
            await responseLock.WaitAsync();
            try
            {
                if (!httpContext.RequestAborted.IsCancellationRequested)
                {
                    await httpContext.Response.WriteAsync($"data: {data}\n\n", httpContext.RequestAborted);
                    await httpContext.Response.Body.FlushAsync(httpContext.RequestAborted);
                }
            }
            catch { /* client disconnected */ }
            finally { responseLock.Release(); }
        }

        // Send immediate ping — resets nginx's proxy_read_timeout clock
        await WriteEvent("{\"type\":\"ping\"}");

        // Background keep-alive: ping every 10 s while processing
        using var pingCts = new CancellationTokenSource();
        var keepAlive = Task.Run(async () =>
        {
            try
            {
                while (!pingCts.Token.IsCancellationRequested)
                {
                    await Task.Delay(10_000, pingCts.Token);
                    await WriteEvent("{\"type\":\"ping\"}");
                }
            }
            catch { /* cancelled */ }
        });

        // 1. Save user message
        var refsJson = request.References is { Length: > 0 }
            ? JsonSerializer.Serialize(request.References, JsonOpts) : null;

        var userMessage = new ChatMessage
        {
            Id = Guid.NewGuid(), ChatNoteId = id, Role = "user",
            Content = request.Content, ReferencesJson = refsJson, CreatedAt = DateTime.UtcNow
        };
        db.ChatMessages.Add(userMessage);
        await db.SaveChangesAsync();

        // 2. Load conversation + refs
        var allMessages = await db.ChatMessages
            .Where(m => m.ChatNoteId == id).OrderBy(m => m.CreatedAt).ToListAsync();
        var allRefs = allMessages
            .SelectMany(m => DeserializeRefs(m.ReferencesJson) ?? [])
            .GroupBy(r => $"{r.Type}:{r.Id}").Select(g => g.First()).ToList();

        // 3. Ollama config
        var ollamaSettings = await db.AppSettings
            .Where(s => s.Key == "llm.primary.url" || s.Key == "llm.primary.model"
                     || s.Key == "llm.fallback.enabled" || s.Key == "llm.fallback.url" || s.Key == "llm.fallback.model"
                     || s.Key == "llm.embedding.model")
            .ToListAsync();

        var ollamaUrl   = ollamaSettings.FirstOrDefault(s => s.Key == "llm.primary.url")?.Value;
        var ollamaModel = ollamaSettings.FirstOrDefault(s => s.Key == "llm.primary.model")?.Value ?? "llama3";
        var fallbackEnabled = ollamaSettings.FirstOrDefault(s => s.Key == "llm.fallback.enabled")?.Value == "true";
        var fallbackUrl   = ollamaSettings.FirstOrDefault(s => s.Key == "llm.fallback.url")?.Value;
        var fallbackModel = ollamaSettings.FirstOrDefault(s => s.Key == "llm.fallback.model")?.Value;
        var embeddingModel = ollamaSettings.FirstOrDefault(s => s.Key == "llm.embedding.model")?.Value ?? "nomic-embed-text";

        if (string.IsNullOrWhiteSpace(ollamaUrl))
        {
            await pingCts.CancelAsync();
            await WriteEvent("{\"type\":\"error\",\"detail\":\"Ollama não configurado. Configure a URL primária em Configurações → LLM.\"}");
            return;
        }

        // 4. Build full context (user refs + automatic project context)
        var contextString = await BuildContextAsync(
            db, ownerId, allRefs,
            note.ProjectId, request.ContextDays ?? 90,
            request.Content, chroma, ollamaUrl, embeddingModel,
            config, httpFactory);

        // 5. Build Ollama messages
        var systemContent = "Você é um assistente inteligente de anotações. Responda de forma clara, precisa e útil.";
        if (!string.IsNullOrWhiteSpace(contextString))
            systemContent += $"\n\n## Contexto disponível:\n{contextString}";

        var ollamaMessages = new List<object> { new { role = "system", content = systemContent } };
        foreach (var msg in allMessages)
            ollamaMessages.Add(new { role = msg.Role, content = msg.Content });

        // Signal frontend that we're about to call the LLM
        await WriteEvent("{\"type\":\"thinking\"}");

        // 6. Streaming Ollama call
        var fullContent = new StringBuilder();
        bool streamOk = false;
        string streamError = string.Empty;

        async Task<bool> TryStream(string url, string model)
        {
            try
            {
                var payload = new { model, messages = ollamaMessages, stream = true };
                using var hc = new HttpClient { Timeout = TimeSpan.FromSeconds(300) };
                using var req = new HttpRequestMessage(HttpMethod.Post, $"{url.TrimEnd('/')}/api/chat")
                    { Content = new StringContent(JsonSerializer.Serialize(payload, JsonOpts), Encoding.UTF8, "application/json") };
                using var resp = await hc.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, httpContext.RequestAborted);
                if (!resp.IsSuccessStatusCode)
                {
                    streamError = $"Ollama {url} retornou {(int)resp.StatusCode}";
                    return false;
                }
                await using var stream = await resp.Content.ReadAsStreamAsync(httpContext.RequestAborted);
                using var reader = new System.IO.StreamReader(stream);
                while (!reader.EndOfStream)
                {
                    var line = await reader.ReadLineAsync();
                    if (string.IsNullOrWhiteSpace(line)) continue;
                    using var doc = JsonDocument.Parse(line);
                    var root = doc.RootElement;
                    if (root.TryGetProperty("message", out var mp) && mp.TryGetProperty("content", out var cp))
                    {
                        var token = cp.GetString();
                        if (!string.IsNullOrEmpty(token))
                        {
                            fullContent.Append(token);
                            await WriteEvent(JsonSerializer.Serialize(new { type = "token", content = token }));
                        }
                    }
                    if (root.TryGetProperty("done", out var done) && done.GetBoolean()) break;
                }
                return true;
            }
            catch (OperationCanceledException) { streamError = "Conexão encerrada pelo cliente."; return false; }
            catch (Exception ex) { streamError = ex.Message; return false; }
        }

        streamOk = await TryStream(ollamaUrl, ollamaModel);
        if (!streamOk && fallbackEnabled && !string.IsNullOrWhiteSpace(fallbackUrl))
        {
            fullContent.Clear();
            var fbModel = string.IsNullOrWhiteSpace(fallbackModel) ? ollamaModel : fallbackModel;
            streamOk = await TryStream(fallbackUrl, fbModel);
        }

        // Stop keep-alive
        await pingCts.CancelAsync();
        await keepAlive.ConfigureAwait(false);

        if (!streamOk)
        {
            await WriteEvent(JsonSerializer.Serialize(new { type = "error", detail = streamError }));
            return;
        }

        // 7. Save assistant response
        var assistantMessage = new ChatMessage
        {
            Id = Guid.NewGuid(), ChatNoteId = id, Role = "assistant",
            Content = fullContent.ToString(), ReferencesJson = null, CreatedAt = DateTime.UtcNow
        };
        db.ChatMessages.Add(assistantMessage);
        note.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();

        await WriteEvent(JsonSerializer.Serialize(new { type = "done", message = ToMessageResponse(assistantMessage) }, JsonOpts));
    }

    private static HttpClient BuildPaperlessClient(string token)
    {
        var client = new HttpClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Token", token);
        client.Timeout = TimeSpan.FromSeconds(15);
        return client;
    }

    /// <summary>
    /// Builds the full LLM context string:
    ///  1. User-selected refs (notes, paperless docs, paperless tags, web results)
    ///  2. All notes from the project edited within <paramref name="contextDays"/> days
    ///  3. Paperless docs belonging to the project's tag (if configured)
    /// </summary>
    private static async Task<string> BuildContextAsync(
        SomeNoteTakingLlmDbContext db,
        Guid ownerId,
        List<ChatReference> userRefs,
        Guid? projectId,
        int contextDays,
        string userQuery,
        ChromaService chroma,
        string ollamaUrl,
        string embeddingModel,
        IConfiguration config,
        IHttpClientFactory httpFactory)
    {
        var sb = new StringBuilder();
        var allNoteIds = new HashSet<Guid>();

        // Load Paperless settings once
        var plSettings = await db.AppSettings
            .Where(s => s.Key == "paperless.url" || s.Key == "paperless.token")
            .ToListAsync();
        var plUrl   = plSettings.FirstOrDefault(s => s.Key == "paperless.url")?.Value?.TrimEnd('/');
        var plToken = plSettings.FirstOrDefault(s => s.Key == "paperless.token")?.Value;

        // ── 1. User-selected refs ─────────────────────────────────────────────
        var refNoteIds = new HashSet<Guid>();
        var refDocIds  = new HashSet<string>();

        if (userRefs.Count > 0)
        {
            sb.AppendLine("## Referências selecionadas manualmente");
            sb.AppendLine();
            foreach (var refItem in userRefs)
            {
                if (refItem.Type == "note" && Guid.TryParse(refItem.Id, out var nid))
                {
                    refNoteIds.Add(nid);
                    allNoteIds.Add(nid);
                    var refNote = await db.Notes.FirstOrDefaultAsync(n => n.Id == nid && n.OwnerId == ownerId);
                    if (refNote is not null)
                    {
                        sb.AppendLine($"### Nota: {refNote.Title ?? "Sem título"}");
                        if (!string.IsNullOrWhiteSpace(refNote.Content)) sb.AppendLine(refNote.Content);
                        sb.AppendLine();
                    }
                }
                else if (refItem.Type == "paperless_document" && !string.IsNullOrWhiteSpace(plUrl) && !string.IsNullOrWhiteSpace(plToken))
                {
                    refDocIds.Add(refItem.Id);
                    try
                    {
                        using var pc = BuildPaperlessClient(plToken);
                        var pr = await pc.GetAsync($"{plUrl}/api/documents/{refItem.Id}/");
                        if (pr.IsSuccessStatusCode)
                        {
                            using var pd = JsonDocument.Parse(await pr.Content.ReadAsStringAsync());
                            var t = pd.RootElement.TryGetProperty("title", out var tp) ? tp.GetString() : refItem.Title;
                            var c = pd.RootElement.TryGetProperty("content", out var cp) ? cp.GetString() : null;
                            sb.AppendLine($"### Documento Paperless: {t}");
                            if (!string.IsNullOrWhiteSpace(c)) sb.AppendLine(c);
                            sb.AppendLine();
                        }
                    }
                    catch { /* silently skip */ }
                }
                else if (refItem.Type == "paperless_tag" && !string.IsNullOrWhiteSpace(plUrl) && !string.IsNullOrWhiteSpace(plToken))
                {
                    try
                    {
                        using var pc = BuildPaperlessClient(plToken);
                        var pr = await pc.GetAsync($"{plUrl}/api/documents/?tags__id__all={refItem.Id}&page_size=50");
                        if (pr.IsSuccessStatusCode)
                        {
                            using var pd = JsonDocument.Parse(await pr.Content.ReadAsStringAsync());
                            sb.AppendLine($"### Tag Paperless: {refItem.Title}");
                            if (pd.RootElement.TryGetProperty("results", out var results))
                                foreach (var de in results.EnumerateArray())
                                {
                                    var dt = de.TryGetProperty("title", out var dtp) ? dtp.GetString() : "Sem título";
                                    var did = de.TryGetProperty("id", out var didp) ? didp.GetInt32().ToString() : null;
                                    if (did is not null) refDocIds.Add(did);
                                    sb.AppendLine($"- {dt}");
                                }
                            sb.AppendLine();
                        }
                    }
                    catch { /* silently skip */ }
                }
                else if (refItem.Type == "web" && !string.IsNullOrWhiteSpace(refItem.Id))
                {
                    var webSnippet = await FetchSearxSnippetAsync(refItem.Id, refItem.Title, config, httpFactory);
                    if (!string.IsNullOrWhiteSpace(webSnippet))
                    {
                        sb.AppendLine($"### Fonte web: {refItem.Title}");
                        sb.AppendLine($"URL: {refItem.Id}");
                        sb.AppendLine(webSnippet);
                        sb.AppendLine();
                    }
                }
            }
        }

        // ── 2. Automatic project context ──────────────────────────────────────
        if (projectId.HasValue)
        {
            var project = await db.Set<SomeNoteTakingLLM.Api.Domain.Project>()
                .FirstOrDefaultAsync(p => p.Id == projectId.Value && p.OwnerId == ownerId);

            if (project is not null)
            {
                var since = DateTime.UtcNow.AddDays(-contextDays);

                // 2a. Project notes edited within contextDays
                var projectNotes = await db.Notes
                    .Where(n => n.ProjectId == projectId && n.OwnerId == ownerId
                             && n.NoteType != NoteType.Chat
                             && n.UpdatedAt >= since
                             && !refNoteIds.Contains(n.Id))
                    .OrderByDescending(n => n.UpdatedAt)
                    .Take(50)
                    .ToListAsync();

                if (projectNotes.Count > 0)
                {
                    sb.AppendLine($"## Notas do projeto \"{project.Name}\" (últimos {contextDays} dias)");
                    sb.AppendLine();
                    foreach (var pn in projectNotes)
                    {
                        allNoteIds.Add(pn.Id);
                        sb.AppendLine($"### {pn.Title ?? "Sem título"} (atualizado {pn.UpdatedAt:dd/MM/yyyy})");
                        if (!string.IsNullOrWhiteSpace(pn.Content)) sb.AppendLine(pn.Content);
                        sb.AppendLine();
                    }
                }

                // 2b. Paperless docs via project tag
                if (project.PaperlessTagId.HasValue && !string.IsNullOrWhiteSpace(plUrl) && !string.IsNullOrWhiteSpace(plToken))
                {
                    try
                    {
                        using var pc = BuildPaperlessClient(plToken);
                        var pr = await pc.GetAsync($"{plUrl}/api/documents/?tags__id__all={project.PaperlessTagId}&page_size=50");
                        if (pr.IsSuccessStatusCode)
                        {
                            using var pd = JsonDocument.Parse(await pr.Content.ReadAsStringAsync());
                            if (pd.RootElement.TryGetProperty("results", out var results))
                            {
                                var newDocs = results.EnumerateArray()
                                    .Where(d => {
                                        var did = d.TryGetProperty("id", out var dp) ? dp.GetInt32().ToString() : null;
                                        return did is not null && !refDocIds.Contains(did);
                                    })
                                    .ToList();

                                if (newDocs.Count > 0)
                                {
                                    sb.AppendLine($"## Documentos Paperless do projeto \"{project.Name}\" (tag #{project.PaperlessTagId})");
                                    foreach (var de in newDocs)
                                    {
                                        var dt = de.TryGetProperty("title", out var dtp) ? dtp.GetString() : "Sem título";
                                        sb.AppendLine($"- {dt}");
                                    }
                                    sb.AppendLine();
                                }
                            }
                        }
                    }
                    catch { /* silently skip */ }
                }
            }
        }

        // Semantic search via ChromaDB
        if (!string.IsNullOrWhiteSpace(userQuery) && !string.IsNullOrWhiteSpace(ollamaUrl))
        {
            var chromaResults = await chroma.SearchAsync(userQuery, ownerId, projectId, ollamaUrl, embeddingModel, topK: 5);
            var alreadyIncluded = new HashSet<string>(allNoteIds.Select(id => id.ToString()));
            var semanticNotes = chromaResults
                .Where(r => !alreadyIncluded.Contains(r.Id) && r.Distance < 0.9f)
                .ToList();
            if (semanticNotes.Count > 0)
            {
                sb.AppendLine("\n### Notas semanticamente relevantes:");
                foreach (var r in semanticNotes)
                {
                    sb.AppendLine($"**{r.Title}** (relevância: {(1f - r.Distance):P0})");
                    var snippet = r.Document.Length > 500 ? r.Document[..500] + "…" : r.Document;
                    sb.AppendLine(snippet);
                    sb.AppendLine("---");
                }
            }
        }

        return sb.ToString();
    }

    /// <summary>
    /// Queries SearxNG for a result matching the given URL and returns its snippet/content.
    /// Falls back to searching by title if URL match is not found.
    /// </summary>
    private static async Task<string?> FetchSearxSnippetAsync(string url, string? title, IConfiguration config, IHttpClientFactory httpFactory)
    {
        var searxUrl = config["Searxng:Url"];
        if (string.IsNullOrWhiteSpace(searxUrl)) return null;

        var query = !string.IsNullOrWhiteSpace(title) ? $"{title} {url}" : url;

        try
        {
            using var client = httpFactory.CreateClient();
            client.Timeout = TimeSpan.FromSeconds(15);

            var qs = $"?q={Uri.EscapeDataString(query)}&format=json&pageno=1";
            var resp = await client.GetAsync($"{searxUrl.TrimEnd('/')}/search{qs}");
            if (!resp.IsSuccessStatusCode) return null;

            var json = await resp.Content.ReadAsStringAsync();
            using var doc = JsonDocument.Parse(json);
            if (!doc.RootElement.TryGetProperty("results", out var results)) return null;

            foreach (var r in results.EnumerateArray())
            {
                if (r.TryGetProperty("url", out var u) &&
                    string.Equals(u.GetString(), url, StringComparison.OrdinalIgnoreCase) &&
                    r.TryGetProperty("content", out var c))
                {
                    return c.GetString();
                }
            }

            // Fallback: return first result whose content contains the URL domain or title words
            foreach (var r in results.EnumerateArray())
            {
                if (r.TryGetProperty("content", out var c))
                {
                    var content = c.GetString();
                    if (!string.IsNullOrWhiteSpace(content))
                    {
                        if (!string.IsNullOrWhiteSpace(title) && content.Contains(title, StringComparison.OrdinalIgnoreCase))
                            return content;
                        if (content.Contains(new Uri(url).Host, StringComparison.OrdinalIgnoreCase))
                            return content;
                    }
                }
            }
        }
        catch { /* silently skip */ }

        return null;
    }
}

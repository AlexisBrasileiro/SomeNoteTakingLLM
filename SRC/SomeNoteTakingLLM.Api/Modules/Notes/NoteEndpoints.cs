using System.Security.Claims;
using System.IdentityModel.Tokens.Jwt;
using Microsoft.EntityFrameworkCore;
using SomeNoteTakingLLM.Api.Data;
using SomeNoteTakingLLM.Api.Domain;
using SomeNoteTakingLLM.Api.Infrastructure;

namespace SomeNoteTakingLLM.Api.Modules.Notes;

public static class NoteEndpoints
{
    private const int MaxDepth = 10;

    public static IEndpointRouteBuilder MapNoteEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/notes").WithTags("Notes").RequireAuthorization();

        group.MapGet("/", GetAll);
        group.MapGet("/{id:guid}", GetById);
        group.MapGet("/{id:guid}/children", GetChildren);
        group.MapPost("/", Create);
        group.MapPut("/{id:guid}", Update);
        group.MapPatch("/{id:guid}/move", Move);
        group.MapDelete("/{id:guid}", Delete);

        return app;
        }

    private static Guid GetUserId(ClaimsPrincipal user) =>
        Guid.Parse(user.FindFirstValue(JwtRegisteredClaimNames.Sub)!);

    private static NoteResponse ToResponse(Note n, IReadOnlyList<string> tags) =>
        new(
            n.Id,
            n.OwnerId,
            n.ProjectId,
            n.ParentNoteId,
            n.Title,
            n.Content,
            n.NoteDate,
            n.Depth,
            n.NoteType,
            tags,
            n.NoteTags
                .Where(noteTag => noteTag.Tag is not null)
                .Select(noteTag => noteTag.Tag!.Name)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .OrderBy(tag => tag, StringComparer.OrdinalIgnoreCase)
                .ToArray(),
            n.CreatedAt,
            n.UpdatedAt);

    private static string NormalizeTag(string value) => value.Trim().ToLowerInvariant();

    private static string[] SanitizeTags(IEnumerable<string>? tags) =>
        tags?
            .Where(tag => !string.IsNullOrWhiteSpace(tag))
            .Select(tag => tag.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(tag => tag, StringComparer.OrdinalIgnoreCase)
            .ToArray() ?? [];

    private static async Task<List<Note>> LoadOwnerNotesAsync(Guid ownerId, SomeNoteTakingLlmDbContext db) =>
        await db.Notes
            .Where(note => note.OwnerId == ownerId)
            .Include(note => note.NoteTags)
                .ThenInclude(noteTag => noteTag.Tag)
            .OrderBy(note => note.CreatedAt)
            .ToListAsync();

    private static IReadOnlyDictionary<Guid, IReadOnlyList<string>> BuildEffectiveTagMap(IEnumerable<Note> notes)
    {
        var noteList = notes.ToList();
        var notesById = noteList.ToDictionary(note => note.Id);
        var cache = new Dictionary<Guid, IReadOnlyList<string>>();

        IReadOnlyList<string> Resolve(Guid noteId, HashSet<Guid> trail)
        {
            if (cache.TryGetValue(noteId, out var cached))
                return cached;

            if (!notesById.TryGetValue(noteId, out var note) || !trail.Add(noteId))
                return [];

            var inherited = note.ParentNoteId.HasValue
                ? Resolve(note.ParentNoteId.Value, trail)
                : [];

            var combined = inherited
                .Concat(note.NoteTags
                    .Select(noteTag => noteTag.Tag?.Name)
                    .Where(name => !string.IsNullOrWhiteSpace(name))
                    .Select(name => name!))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .OrderBy(name => name, StringComparer.OrdinalIgnoreCase)
                .ToArray();

            trail.Remove(noteId);
            cache[noteId] = combined;
            return combined;
        }

        foreach (var note in noteList)
            _ = Resolve(note.Id, []);

        return cache;
    }

    private static async Task<List<Tag>> EnsureTagsAsync(SomeNoteTakingLlmDbContext db, Guid ownerId, IEnumerable<string>? rawTags)
    {
        var sanitizedTags = SanitizeTags(rawTags);
        if (sanitizedTags.Length == 0)
            return [];

        var normalizedTags = sanitizedTags.Select(NormalizeTag).ToArray();
        var existingTags = await db.Tags
            .Where(tag => tag.OwnerId == ownerId && normalizedTags.Contains(tag.NormalizedName))
            .ToListAsync();

        var tagsByNormalizedName = existingTags.ToDictionary(tag => tag.NormalizedName, StringComparer.OrdinalIgnoreCase);
        var result = new List<Tag>(sanitizedTags.Length);

        foreach (var tagName in sanitizedTags)
        {
            var normalizedName = NormalizeTag(tagName);
            if (!tagsByNormalizedName.TryGetValue(normalizedName, out var tag))
            {
                tag = new Tag
                {
                    Id = Guid.NewGuid(),
                    OwnerId = ownerId,
                    Name = tagName,
                    NormalizedName = normalizedName,
                    CreatedAt = DateTime.UtcNow,
                };
                db.Tags.Add(tag);
                tagsByNormalizedName[normalizedName] = tag;
            }

            result.Add(tag);
        }

        return result;
    }

    private static async Task SetNoteTagsAsync(Note note, Guid ownerId, IEnumerable<string>? rawTags, SomeNoteTakingLlmDbContext db)
    {
        var tags = await EnsureTagsAsync(db, ownerId, rawTags);

        if (note.NoteTags.Count > 0)
        {
            db.NoteTags.RemoveRange(note.NoteTags);
            note.NoteTags.Clear();
        }

        foreach (var tag in tags)
        {
            note.NoteTags.Add(new NoteTag
            {
                NoteId = note.Id,
                Note = note,
                TagId = tag.Id,
                Tag = tag,
            });
        }
    }

    private static async Task<NoteResponse?> BuildResponseAsync(Guid ownerId, Guid noteId, SomeNoteTakingLlmDbContext db)
    {
        var notes = await LoadOwnerNotesAsync(ownerId, db);
        var note = notes.FirstOrDefault(candidate => candidate.Id == noteId);
        if (note is null)
            return null;

        var tagMap = BuildEffectiveTagMap(notes);
        return ToResponse(note, tagMap[note.Id]);
    }

    private static async Task<IResult> GetAll(ClaimsPrincipal user, SomeNoteTakingLlmDbContext db,
        Guid? projectId = null, DateTime? noteDate = null, string? title = null, string? content = null, string? tag = null)
    {
        var ownerId = GetUserId(user);
        var notes = await LoadOwnerNotesAsync(ownerId, db);
        var effectiveTags = BuildEffectiveTagMap(notes);
        var normalizedTag = string.IsNullOrWhiteSpace(tag) ? null : NormalizeTag(tag);

        var filteredNotes = notes.Where(note =>
        {
            if (projectId.HasValue && note.ProjectId != projectId.Value)
                return false;

            if (noteDate.HasValue && (!note.NoteDate.HasValue || note.NoteDate.Value.Date != noteDate.Value.Date))
                return false;

            if (!string.IsNullOrWhiteSpace(title) && !(note.Title?.Contains(title, StringComparison.OrdinalIgnoreCase) ?? false))
                return false;

            if (!string.IsNullOrWhiteSpace(content) && !(note.Content?.Contains(content, StringComparison.OrdinalIgnoreCase) ?? false))
                return false;

            if (normalizedTag is not null && !effectiveTags[note.Id].Any(value => NormalizeTag(value) == normalizedTag))
                return false;

            return true;
        });

        return Results.Ok(filteredNotes.Select(note => ToResponse(note, effectiveTags[note.Id])));
    }

    private static async Task<IResult> GetById(Guid id, ClaimsPrincipal user, SomeNoteTakingLlmDbContext db)
    {
        var ownerId = GetUserId(user);
        var response = await BuildResponseAsync(ownerId, id, db);
        if (response is null) return Results.NotFound();
        return Results.Ok(response);
    }

    private static async Task<IResult> GetChildren(Guid id, ClaimsPrincipal user, SomeNoteTakingLlmDbContext db)
    {
        var ownerId = GetUserId(user);
        var notes = await LoadOwnerNotesAsync(ownerId, db);
        var tagMap = BuildEffectiveTagMap(notes);
        var children = notes
            .Where(note => note.ParentNoteId == id)
            .Select(note => ToResponse(note, tagMap[note.Id]))
            .ToList();
        return Results.Ok(children);
    }

    private static async Task<IResult> Create(CreateNoteRequest request, ClaimsPrincipal user, SomeNoteTakingLlmDbContext db, ChromaService chroma, IConfiguration config)
    {
        var ownerId = GetUserId(user);
        int depth = 0;
        Guid? parentNoteId = request.ParentNoteId;

        // Para CalendarNote sem pai explícito, auto-criar/reutilizar nota-container do dia
        if (request.NoteType == NoteType.CalendarNote && request.NoteDate.HasValue && parentNoteId is null)
        {
            var dateOnly = request.NoteDate.Value.Date;
            var dayTitle = dateOnly.ToString("dd/MM/yyyy");

            var dayContainer = await db.Notes.FirstOrDefaultAsync(n =>
                n.OwnerId == ownerId &&
                n.NoteType == NoteType.CalendarNote &&
                n.ProjectId == request.ProjectId &&
                n.ParentNoteId == null &&
                n.NoteDate.HasValue &&
                n.NoteDate.Value.Date == dateOnly &&
                n.Title == dayTitle);

            if (dayContainer is null)
            {
                var now2 = DateTime.UtcNow;
                dayContainer = new Note
                {
                    Id = Guid.NewGuid(),
                    OwnerId = ownerId,
                    ProjectId = request.ProjectId,
                    ParentNoteId = null,
                    Title = dayTitle,
                    Content = null,
                    NoteDate = dateOnly,
                    NoteType = NoteType.CalendarNote,
                    Depth = 0,
                    CreatedAt = now2,
                    UpdatedAt = now2,
                };
                db.Notes.Add(dayContainer);
                await db.SaveChangesAsync();
            }

            parentNoteId = dayContainer.Id;
            depth = 1;
        }
        else if (parentNoteId.HasValue)
        {
            var parent = await db.Notes.FirstOrDefaultAsync(n => n.Id == parentNoteId.Value && n.OwnerId == ownerId);
            if (parent is null) return Results.BadRequest(new { message = "Nota pai nao encontrada." });
            depth = parent.Depth + 1;
            if (depth > MaxDepth)
                return Results.BadRequest(new { message = $"Profundidade maxima de {MaxDepth} niveis atingida." });
        }

        var now = DateTime.UtcNow;
        var note = new Note
        {
            Id = Guid.NewGuid(),
            OwnerId = ownerId,
            ProjectId = request.ProjectId,
            ParentNoteId = parentNoteId,
            Title = request.Title,
            Content = request.Content,
            NoteDate = request.NoteDate,
            NoteType = request.NoteType,
            Depth = depth,
            CreatedAt = now,
            UpdatedAt = now
        };
        await SetNoteTagsAsync(note, ownerId, request.Tags, db);
        db.Notes.Add(note);
        await db.SaveChangesAsync();
        _ = Task.Run(() => SyncToChromaAsync(note, db, chroma, config));
        var response = await BuildResponseAsync(ownerId, note.Id, db);
        return Results.Created($"/api/v1/notes/{note.Id}", response!);
    }

    private static async Task<IResult> Update(Guid id, UpdateNoteRequest request, ClaimsPrincipal user, SomeNoteTakingLlmDbContext db, ChromaService chroma, IConfiguration config)
    {
        var ownerId = GetUserId(user);
        var note = await db.Notes
            .Include(candidate => candidate.NoteTags)
                .ThenInclude(noteTag => noteTag.Tag)
            .FirstOrDefaultAsync(n => n.Id == id && n.OwnerId == ownerId);
        if (note is null) return Results.NotFound();
        note.Title = request.Title;
        note.Content = request.Content;
        note.ProjectId = request.ProjectId;
        note.NoteDate = request.NoteDate;
        note.NoteType = request.NoteType;
            if (request.Tags is not null)
                await SetNoteTagsAsync(note, ownerId, request.Tags, db);

        // Se houve mudança de parent, validar e recalcular profundidade
        if (request.ParentNoteId != note.ParentNoteId)
        {
            int newDepth = 0;
            if (request.ParentNoteId.HasValue)
            {
                var parent = await db.Notes.FirstOrDefaultAsync(n => n.Id == request.ParentNoteId.Value && n.OwnerId == ownerId);
                if (parent is null) return Results.BadRequest(new { message = "Nota pai nao encontrada." });

                // Evitar ciclos: parent nao pode ser um descendente da nota
                var cursor = parent;
                while (cursor is not null)
                {
                    if (cursor.Id == note.Id)
                        return Results.BadRequest(new { message = "Nao e permitido aninhar uma nota dentro de sua propria sub-arvore." });
                    if (cursor.ParentNoteId is null) break;
                    cursor = await db.Notes.FirstOrDefaultAsync(n => n.Id == cursor.ParentNoteId && n.OwnerId == ownerId);
                }

                newDepth = parent.Depth + 1;
                if (newDepth > MaxDepth)
                    return Results.BadRequest(new { message = $"Profundidade maxima de {MaxDepth} niveis atingida." });
            }

            note.ParentNoteId = request.ParentNoteId;
            note.Depth = newDepth;
        }

        note.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        _ = Task.Run(() => SyncToChromaAsync(note, db, chroma, config));
        var response = await BuildResponseAsync(ownerId, note.Id, db);
        return Results.Ok(response);
    }

    private static async Task<IResult> Move(Guid id, MoveNoteRequest request, ClaimsPrincipal user, SomeNoteTakingLlmDbContext db)
    {
        var ownerId = GetUserId(user);
        var note = await db.Notes.FirstOrDefaultAsync(n => n.Id == id && n.OwnerId == ownerId);
        if (note is null) return Results.NotFound();
        note.ProjectId = request.ProjectId;
        note.ParentNoteId = request.ParentNoteId;
        note.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        var response = await BuildResponseAsync(ownerId, note.Id, db);
        return Results.Ok(response);
    }

    private static async Task<IResult> Delete(Guid id, ClaimsPrincipal user, SomeNoteTakingLlmDbContext db, ChromaService chroma)
    {
        var ownerId = GetUserId(user);
        var note = await db.Notes.FirstOrDefaultAsync(n => n.Id == id && n.OwnerId == ownerId);
        if (note is null) return Results.NotFound();

        var hasChildren = await db.Notes.AnyAsync(n => n.ParentNoteId == id);
        if (hasChildren)
            return Results.Conflict(new { message = "Nao e possivel excluir nota com subnotas." });

        db.Notes.Remove(note);
        await db.SaveChangesAsync();
        _ = Task.Run(() => chroma.DeleteNoteAsync(id));
        return Results.NoContent();
    }

    private static async Task SyncToChromaAsync(Note note, SomeNoteTakingLlmDbContext db, ChromaService chroma, IConfiguration config)
    {
        try
        {
            var ollamaUrl = (await db.AppSettings.FindAsync("llm.primary.url"))?.Value;
            var embModel  = (await db.AppSettings.FindAsync("llm.embedding.model"))?.Value ?? "nomic-embed-text";
            if (!string.IsNullOrWhiteSpace(ollamaUrl))
                await chroma.UpsertNoteAsync(note, ollamaUrl, embModel);
        }
        catch { /* best effort */ }
    }
}
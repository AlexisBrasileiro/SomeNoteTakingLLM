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

    private static NoteResponse ToResponse(Note n) =>
        new(n.Id, n.OwnerId, n.ProjectId, n.ParentNoteId, n.Title, n.Content, n.NoteDate, n.Depth, n.NoteType, n.CreatedAt, n.UpdatedAt);

    private static async Task<IResult> GetAll(ClaimsPrincipal user, SomeNoteTakingLlmDbContext db,
        Guid? projectId = null, DateTime? noteDate = null)
    {
        var ownerId = GetUserId(user);
        var query = db.Notes.Where(n => n.OwnerId == ownerId);
        if (projectId.HasValue) query = query.Where(n => n.ProjectId == projectId);
        if (noteDate.HasValue) query = query.Where(n => n.NoteDate.HasValue && n.NoteDate.Value.Date == noteDate.Value.Date);
        var notes = await query.OrderBy(n => n.CreatedAt).Select(n => ToResponse(n)).ToListAsync();
        return Results.Ok(notes);
    }

    private static async Task<IResult> GetById(Guid id, ClaimsPrincipal user, SomeNoteTakingLlmDbContext db)
    {
        var ownerId = GetUserId(user);
        var note = await db.Notes.FirstOrDefaultAsync(n => n.Id == id && n.OwnerId == ownerId);
        if (note is null) return Results.NotFound();
        return Results.Ok(ToResponse(note));
    }

    private static async Task<IResult> GetChildren(Guid id, ClaimsPrincipal user, SomeNoteTakingLlmDbContext db)
    {
        var ownerId = GetUserId(user);
        var notes = await db.Notes
            .Where(n => n.ParentNoteId == id && n.OwnerId == ownerId)
            .OrderBy(n => n.CreatedAt)
            .Select(n => ToResponse(n))
            .ToListAsync();
        return Results.Ok(notes);
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
        db.Notes.Add(note);
        await db.SaveChangesAsync();
        _ = Task.Run(() => SyncToChromaAsync(note, db, chroma, config));
        return Results.Created($"/api/v1/notes/{note.Id}", ToResponse(note));
    }

    private static async Task<IResult> Update(Guid id, UpdateNoteRequest request, ClaimsPrincipal user, SomeNoteTakingLlmDbContext db, ChromaService chroma, IConfiguration config)
    {
        var ownerId = GetUserId(user);
        var note = await db.Notes.FirstOrDefaultAsync(n => n.Id == id && n.OwnerId == ownerId);
        if (note is null) return Results.NotFound();
        note.Title = request.Title;
        note.Content = request.Content;
        note.ProjectId = request.ProjectId;
        note.NoteDate = request.NoteDate;
        note.NoteType = request.NoteType;
        note.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        _ = Task.Run(() => SyncToChromaAsync(note, db, chroma, config));
        return Results.Ok(ToResponse(note));
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
        return Results.Ok(ToResponse(note));
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
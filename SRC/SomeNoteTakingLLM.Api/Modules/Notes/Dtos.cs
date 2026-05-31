using SomeNoteTakingLLM.Api.Domain;

namespace SomeNoteTakingLLM.Api.Modules.Notes;

public sealed record CreateNoteRequest(string? Title, string? Content, Guid? ProjectId, Guid? ParentNoteId, DateTime? NoteDate, NoteType NoteType = NoteType.FreeNote);
public sealed record UpdateNoteRequest(string? Title, string? Content, Guid? ProjectId, DateTime? NoteDate, NoteType NoteType = NoteType.FreeNote);

public sealed record NoteResponse(
    Guid Id, Guid OwnerId, Guid? ProjectId, Guid? ParentNoteId,
    string? Title, string? Content, DateTime? NoteDate, int Depth, NoteType NoteType,
    DateTime CreatedAt, DateTime UpdatedAt);
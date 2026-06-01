using SomeNoteTakingLLM.Api.Domain;

namespace SomeNoteTakingLLM.Api.Modules.Notes;

public sealed record CreateNoteRequest(string? Title, string? Content, Guid? ProjectId, Guid? ParentNoteId, DateTime? NoteDate, NoteType NoteType = NoteType.FreeNote, IReadOnlyCollection<string>? Tags = null);
public sealed record UpdateNoteRequest(string? Title, string? Content, Guid? ProjectId, Guid? ParentNoteId, DateTime? NoteDate, NoteType NoteType = NoteType.FreeNote, IReadOnlyCollection<string>? Tags = null);
public sealed record MoveNoteRequest(Guid? ProjectId, Guid? ParentNoteId);

public sealed record NoteResponse(
    Guid Id, Guid OwnerId, Guid? ProjectId, Guid? ParentNoteId,
    string? Title, string? Content, DateTime? NoteDate, int Depth, NoteType NoteType, IReadOnlyList<string> Tags, IReadOnlyList<string> DirectTags,
    DateTime CreatedAt, DateTime UpdatedAt);
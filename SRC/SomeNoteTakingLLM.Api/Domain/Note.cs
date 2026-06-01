namespace SomeNoteTakingLLM.Api.Domain;

public sealed class Note
{
    public Guid Id { get; set; }
    public Guid OwnerId { get; set; }
    public User? Owner { get; set; }
    public Guid? ProjectId { get; set; }
    public Project? Project { get; set; }
    public Guid? ParentNoteId { get; set; }
    public Note? ParentNote { get; set; }
    public ICollection<Note> SubNotes { get; set; } = new List<Note>();
    public string? Title { get; set; }
    public string? Content { get; set; }
    public DateTime? NoteDate { get; set; }
    public int Depth { get; set; }
    public NoteType NoteType { get; set; } = NoteType.FreeNote;
    public ICollection<NoteTag> NoteTags { get; set; } = new List<NoteTag>();
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}
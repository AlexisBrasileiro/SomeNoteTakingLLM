namespace SomeNoteTakingLLM.Api.Domain;

public sealed class Tag
{
    public Guid Id { get; set; }
    public Guid OwnerId { get; set; }
    public User? Owner { get; set; }
    public string Name { get; set; } = string.Empty;
    public string NormalizedName { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
    public ICollection<NoteTag> NoteTags { get; set; } = new List<NoteTag>();
}
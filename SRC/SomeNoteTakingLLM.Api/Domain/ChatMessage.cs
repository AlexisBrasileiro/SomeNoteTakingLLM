namespace SomeNoteTakingLLM.Api.Domain;

public class ChatMessage
{
    public Guid Id { get; set; }
    public Guid ChatNoteId { get; set; }
    public Note? ChatNote { get; set; }
    public string Role { get; set; } = "user"; // "user" | "assistant"
    public string Content { get; set; } = string.Empty;
    public string? ReferencesJson { get; set; } // JSON array of ChatReference
    public DateTime CreatedAt { get; set; }
}

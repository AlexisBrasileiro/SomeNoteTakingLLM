namespace SomeNoteTakingLLM.Api.Modules.Chat;

public sealed record ChatReference(string Type, string Id, string Title);
// Type: "note" | "paperless_document" | "paperless_tag" | "web"

public sealed record CreateChatRequest(string Title, string? ProjectId);
public sealed record SendMessageRequest(string Content, ChatReference[]? References, int? ContextDays);
public sealed record ChatMessageResponse(Guid Id, string Role, string Content, ChatReference[]? References, DateTime CreatedAt);
public sealed record ChatDetailResponse(Guid Id, string Title, string? ProjectId, DateTime CreatedAt, ChatMessageResponse[] Messages);
public sealed record ChatSummaryResponse(Guid Id, string Title, string? ProjectId, int MessageCount, DateTime CreatedAt, DateTime UpdatedAt);
public sealed record PatchChatRequest(string? ProjectId);

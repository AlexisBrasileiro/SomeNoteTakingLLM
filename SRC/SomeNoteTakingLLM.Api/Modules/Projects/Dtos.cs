namespace SomeNoteTakingLLM.Api.Modules.Projects;

public sealed record CreateProjectRequest(string Name, string? Description, int? PaperlessTagId = null);
public sealed record UpdateProjectRequest(string Name, string? Description, bool IsArchived, int? PaperlessTagId = null);

public sealed record ProjectResponse(Guid Id, Guid OwnerId, string Name, string? Description, bool IsArchived, int? PaperlessTagId, DateTime CreatedAt, DateTime UpdatedAt);
namespace SomeNoteTakingLLM.Api.Modules.Admin;

public sealed record UserSummary(Guid Id, string UserName, string Email, string Role, DateTime CreatedAt);
public sealed record UpdateUserRoleRequest(string Role);
public sealed record CreateUserRequest(string UserName, string Email, string Password, string Role);
public sealed record ProjectSummaryAdmin(Guid Id, Guid OwnerId, string OwnerName, string Name, bool IsArchived, int? PaperlessTagId, DateTime CreatedAt);
public sealed record SaveSettingsRequest(Dictionary<string, string> Settings);

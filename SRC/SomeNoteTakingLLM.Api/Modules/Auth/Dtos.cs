namespace SomeNoteTakingLLM.Api.Modules.Auth;

public sealed record RegisterRequest(string UserName, string Email, string Password);
public sealed record LoginRequest(string Email, string Password);
public sealed record AuthResponse(string AccessToken, string TokenType, int ExpiresIn, Guid UserId, string UserName, string Email, string Role);
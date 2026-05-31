namespace SomeNoteTakingLLM.Api.Modules.Setup;

public sealed record SetupStatusResponse(
    bool OnboardingAvailable,
    int RemainingSeconds,
    string Reason);

public sealed record CreateAdminRequest(
    string UserName,
    string Email,
    string Password);

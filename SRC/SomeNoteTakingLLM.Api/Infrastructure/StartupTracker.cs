namespace SomeNoteTakingLLM.Api.Infrastructure;

/// <summary>
/// Registra o instante em que a aplicação iniciou.
/// Usado para controlar a janela de onboarding (primeiros 10 minutos).
/// </summary>
public sealed class StartupTracker
{
    public DateTimeOffset StartedAt { get; } = DateTimeOffset.UtcNow;

    public bool IsWithinOnboardingWindow(int windowMinutes = 10)
        => (DateTimeOffset.UtcNow - StartedAt).TotalMinutes < windowMinutes;

    public int RemainingOnboardingSeconds(int windowMinutes = 10)
    {
        var remaining = TimeSpan.FromMinutes(windowMinutes) - (DateTimeOffset.UtcNow - StartedAt);
        return remaining.TotalSeconds > 0 ? (int)remaining.TotalSeconds : 0;
    }
}

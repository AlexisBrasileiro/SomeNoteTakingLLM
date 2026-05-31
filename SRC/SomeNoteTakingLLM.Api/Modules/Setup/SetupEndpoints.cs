using Microsoft.EntityFrameworkCore;
using SomeNoteTakingLLM.Api.Data;
using SomeNoteTakingLLM.Api.Domain;
using SomeNoteTakingLLM.Api.Infrastructure;
using SomeNoteTakingLLM.Api.Infrastructure.Auth;

namespace SomeNoteTakingLLM.Api.Modules.Setup;

public static class SetupEndpoints
{
    public static IEndpointRouteBuilder MapSetupEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/setup").WithTags("Setup");

        // Consulta pública — sem autenticação
        group.MapGet("/status", GetStatus).AllowAnonymous();
        group.MapPost("/admin", CreateAdmin).AllowAnonymous();

        return app;
    }

    private static async Task<IResult> GetStatus(
        SomeNoteTakingLlmDbContext db,
        StartupTracker tracker)
    {
        var hasAdmin = await db.Users.AnyAsync(u => u.Role == UserRole.Admin);

        if (hasAdmin)
            return Results.Ok(new SetupStatusResponse(false, 0, "admin_exists"));

        if (!tracker.IsWithinOnboardingWindow())
            return Results.Ok(new SetupStatusResponse(false, 0, "window_expired"));

        return Results.Ok(new SetupStatusResponse(
            true,
            tracker.RemainingOnboardingSeconds(),
            "onboarding_open"));
    }

    private static async Task<IResult> CreateAdmin(
        CreateAdminRequest request,
        SomeNoteTakingLlmDbContext db,
        StartupTracker tracker,
        JwtService jwtService,
        IConfiguration config)
    {
        // Revalida as condições a cada chamada para evitar race conditions e abuso
        var hasAdmin = await db.Users.AnyAsync(u => u.Role == UserRole.Admin);
        if (hasAdmin)
            return Results.Conflict(new { message = "Um admin já existe. Onboarding encerrado." });

        if (!tracker.IsWithinOnboardingWindow())
            return Results.Conflict(new { message = "Janela de onboarding encerrada (10 minutos)." });

        if (string.IsNullOrWhiteSpace(request.UserName) || request.UserName.Length < 2)
            return Results.BadRequest(new { message = "Nome de usuário deve ter pelo menos 2 caracteres." });

        if (string.IsNullOrWhiteSpace(request.Password) || request.Password.Length < 8)
            return Results.BadRequest(new { message = "Senha deve ter pelo menos 8 caracteres." });

        if (await db.Users.AnyAsync(u => u.Email == request.Email))
            return Results.Conflict(new { message = "Email já cadastrado." });

        var now = DateTime.UtcNow;
        var admin = new User
        {
            Id = Guid.NewGuid(),
            UserName = request.UserName,
            Email = request.Email,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.Password),
            Role = UserRole.Admin,
            CreatedAt = now,
            UpdatedAt = now
        };

        db.Users.Add(admin);
        await db.SaveChangesAsync();

        var expiresIn = int.Parse(config["Jwt:AccessTokenExpirationMinutes"] ?? "60") * 60;
        return Results.Created($"/api/v1/users/{admin.Id}", new
        {
            message = "Admin criado com sucesso.",
            accessToken = jwtService.GenerateAccessToken(admin),
            tokenType = "Bearer",
            expiresIn,
            userId = admin.Id,
            userName = admin.UserName,
            email = admin.Email,
            role = admin.Role.ToString()
        });
    }
}

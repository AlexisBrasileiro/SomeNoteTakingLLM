using Microsoft.EntityFrameworkCore;
using SomeNoteTakingLLM.Api.Data;
using SomeNoteTakingLLM.Api.Domain;
using SomeNoteTakingLLM.Api.Infrastructure.Auth;

namespace SomeNoteTakingLLM.Api.Modules.Auth;

public static class AuthEndpoints
{
    public static IEndpointRouteBuilder MapAuthEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/auth").WithTags("Auth");

        group.MapPost("/register", Register).AllowAnonymous();
        group.MapPost("/login", Login).AllowAnonymous();

        return app;
    }

    private static async Task<IResult> Register(
        RegisterRequest request,
        SomeNoteTakingLlmDbContext db,
        JwtService jwtService,
        IConfiguration config)
    {
        if (await db.Users.AnyAsync(u => u.Email == request.Email))
            return Results.Conflict(new { message = "Email ja cadastrado." });

        var now = DateTime.UtcNow;
        var user = new User
        {
            Id = Guid.NewGuid(),
            UserName = request.UserName,
            Email = request.Email,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.Password),
            Role = UserRole.Contributor,
            CreatedAt = now,
            UpdatedAt = now
        };

        db.Users.Add(user);
        await db.SaveChangesAsync();

        var expiresIn = int.Parse(config["Jwt:AccessTokenExpirationMinutes"] ?? "60") * 60;
        var response = new AuthResponse(
            jwtService.GenerateAccessToken(user),
            "Bearer",
            expiresIn,
            user.Id,
            user.UserName,
            user.Email,
            user.Role.ToString());

        return Results.Created($"/api/v1/users/{user.Id}", response);
    }

    private static async Task<IResult> Login(
        LoginRequest request,
        SomeNoteTakingLlmDbContext db,
        JwtService jwtService,
        IConfiguration config)
    {
        var user = await db.Users.FirstOrDefaultAsync(u => u.Email == request.Email);
        if (user is null || !BCrypt.Net.BCrypt.Verify(request.Password, user.PasswordHash))
            return Results.Unauthorized();

        var expiresIn = int.Parse(config["Jwt:AccessTokenExpirationMinutes"] ?? "60") * 60;
        var response = new AuthResponse(
            jwtService.GenerateAccessToken(user),
            "Bearer",
            expiresIn,
            user.Id,
            user.UserName,
            user.Email,
            user.Role.ToString());

        return Results.Ok(response);
    }
}
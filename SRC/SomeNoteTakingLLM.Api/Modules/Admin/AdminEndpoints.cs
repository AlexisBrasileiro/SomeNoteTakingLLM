using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using SomeNoteTakingLLM.Api.Data;
using SomeNoteTakingLLM.Api.Domain;

namespace SomeNoteTakingLLM.Api.Modules.Admin;

public static class AdminEndpoints
{
    public static IEndpointRouteBuilder MapAdminEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/admin").WithTags("Admin").RequireAuthorization();

        group.MapGet("/users", GetUsers);
        group.MapPost("/users", CreateUser);
        group.MapPut("/users/{id:guid}/role", UpdateUserRole);
        group.MapDelete("/users/{id:guid}", DeleteUser);
        group.MapGet("/projects", GetProjects);
        group.MapGet("/settings", GetSettings);
        group.MapPut("/settings", SaveSettings);

        return app;
    }

    private static async Task<IResult> GetUsers(
        ClaimsPrincipal user,
        SomeNoteTakingLlmDbContext db)
    {
        var role = user.FindFirstValue(ClaimTypes.Role);
        if (role != "Admin") return Results.Forbid();

        var users = await db.Users
            .OrderBy(u => u.CreatedAt)
            .Select(u => new UserSummary(u.Id, u.UserName, u.Email, u.Role.ToString(), u.CreatedAt))
            .ToListAsync();

        return Results.Ok(users);
    }

    private static async Task<IResult> CreateUser(
        CreateUserRequest request,
        ClaimsPrincipal user,
        SomeNoteTakingLlmDbContext db)
    {
        var role = user.FindFirstValue(ClaimTypes.Role);
        if (role != "Admin") return Results.Forbid();

        if (await db.Users.AnyAsync(u => u.Email == request.Email))
            return Results.Conflict(new { message = "Email já cadastrado." });

        if (!Enum.TryParse<UserRole>(request.Role, ignoreCase: true, out var userRole))
            userRole = UserRole.Reader;

        var now = DateTime.UtcNow;
        var newUser = new User
        {
            Id = Guid.NewGuid(),
            UserName = request.UserName,
            Email = request.Email,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.Password),
            Role = userRole,
            CreatedAt = now,
            UpdatedAt = now
        };
        db.Users.Add(newUser);

        var project = new Project
        {
            Id = Guid.NewGuid(),
            OwnerId = newUser.Id,
            Name = $"Particular.{request.UserName}",
            Description = string.Empty,
            IsArchived = false,
            CreatedAt = now,
            UpdatedAt = now
        };
        db.Projects.Add(project);

        await db.SaveChangesAsync();

        return Results.Created($"/api/v1/admin/users/{newUser.Id}",
            new UserSummary(newUser.Id, newUser.UserName, newUser.Email, newUser.Role.ToString(), newUser.CreatedAt));
    }

    private static async Task<IResult> UpdateUserRole(
        Guid id,
        UpdateUserRoleRequest request,
        ClaimsPrincipal user,
        SomeNoteTakingLlmDbContext db)
    {
        var role = user.FindFirstValue(ClaimTypes.Role);
        if (role != "Admin") return Results.Forbid();

        var callerId = Guid.Parse(user.FindFirstValue("sub")!);
        if (callerId == id)
            return Results.BadRequest(new { message = "Não é possível alterar sua própria role." });

        if (!Enum.TryParse<UserRole>(request.Role, ignoreCase: true, out var newRole))
            return Results.BadRequest(new { message = "Role inválida." });

        var target = await db.Users.FindAsync(id);
        if (target is null) return Results.NotFound();

        target.Role = newRole;
        target.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();

        return Results.Ok(new UserSummary(target.Id, target.UserName, target.Email, target.Role.ToString(), target.CreatedAt));
    }

    private static async Task<IResult> DeleteUser(
        Guid id,
        ClaimsPrincipal user,
        SomeNoteTakingLlmDbContext db)
    {
        var role = user.FindFirstValue(ClaimTypes.Role);
        if (role != "Admin") return Results.Forbid();

        var callerId = Guid.Parse(user.FindFirstValue("sub")!);
        if (callerId == id)
            return Results.BadRequest(new { message = "Não é possível excluir a si mesmo." });

        var target = await db.Users
            .Include(u => u.Projects)
            .Include(u => u.Notes)
            .FirstOrDefaultAsync(u => u.Id == id);
        if (target is null) return Results.NotFound();

        if (target.Projects.Count > 0 || target.Notes.Count > 0)
            return Results.BadRequest(new { message = "Usuário possui projetos ou notas. Remova-os antes de excluir." });

        // Prevent deleting last admin
        if (target.Role == UserRole.Admin)
        {
            var adminCount = await db.Users.CountAsync(u => u.Role == UserRole.Admin);
            if (adminCount <= 1)
                return Results.BadRequest(new { message = "Não é possível excluir o último administrador." });
        }

        db.Users.Remove(target);
        await db.SaveChangesAsync();

        return Results.NoContent();
    }

    private static async Task<IResult> GetProjects(
        ClaimsPrincipal user,
        SomeNoteTakingLlmDbContext db)
    {
        var role = user.FindFirstValue(ClaimTypes.Role);
        if (role != "Admin") return Results.Forbid();

        var projects = await db.Projects
            .Include(p => p.Owner)
            .OrderBy(p => p.CreatedAt)
            .Select(p => new ProjectSummaryAdmin(
                p.Id,
                p.OwnerId,
                p.Owner != null ? p.Owner.UserName : string.Empty,
                p.Name,
                p.IsArchived,
                p.PaperlessTagId,
                p.CreatedAt))
            .ToListAsync();

        return Results.Ok(projects);
    }

    private static async Task<IResult> GetSettings(
        ClaimsPrincipal user,
        SomeNoteTakingLlmDbContext db)
    {
        var role = user.FindFirstValue(ClaimTypes.Role);
        if (role != "Admin") return Results.Forbid();

        var settings = await db.AppSettings.ToListAsync();
        var dict = settings.ToDictionary(s => s.Key, s => s.Value);

        return Results.Ok(dict);
    }

    private static async Task<IResult> SaveSettings(
        SaveSettingsRequest request,
        ClaimsPrincipal user,
        SomeNoteTakingLlmDbContext db)
    {
        var role = user.FindFirstValue(ClaimTypes.Role);
        if (role != "Admin") return Results.Forbid();

        var now = DateTime.UtcNow;
        foreach (var (key, value) in request.Settings)
        {
            var existing = await db.AppSettings.FindAsync(key);
            if (existing is null)
            {
                db.AppSettings.Add(new AppSetting { Key = key, Value = value, UpdatedAt = now });
            }
            else
            {
                existing.Value = value;
                existing.UpdatedAt = now;
            }
        }

        await db.SaveChangesAsync();
        return Results.NoContent();
    }
}

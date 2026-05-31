using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using SomeNoteTakingLLM.Api.Data;
using SomeNoteTakingLLM.Api.Domain;

namespace SomeNoteTakingLLM.Api.Modules.Projects;

public static class ProjectEndpoints
{
    public static IEndpointRouteBuilder MapProjectEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/projects").WithTags("Projects").RequireAuthorization();

        group.MapGet("/", GetAll);
        group.MapGet("/{id:guid}", GetById);
        group.MapPost("/", Create);
        group.MapPut("/{id:guid}", Update);
        group.MapDelete("/{id:guid}", Delete);

        return app;
    }

    private static Guid GetUserId(ClaimsPrincipal user) =>
        Guid.Parse(user.FindFirstValue(System.IdentityModel.Tokens.Jwt.JwtRegisteredClaimNames.Sub)!);

    private static async Task<IResult> GetAll(ClaimsPrincipal user, SomeNoteTakingLlmDbContext db)
    {
        var ownerId = GetUserId(user);
        var projects = await db.Projects
            .Where(p => p.OwnerId == ownerId)
            .Select(p => new ProjectResponse(p.Id, p.OwnerId, p.Name, p.Description, p.IsArchived, p.PaperlessTagId, p.CreatedAt, p.UpdatedAt))
            .ToListAsync();
        return Results.Ok(projects);
    }

    private static async Task<IResult> GetById(Guid id, ClaimsPrincipal user, SomeNoteTakingLlmDbContext db)
    {
        var ownerId = GetUserId(user);
        var project = await db.Projects.FirstOrDefaultAsync(p => p.Id == id && p.OwnerId == ownerId);
        if (project is null) return Results.NotFound();
        return Results.Ok(new ProjectResponse(project.Id, project.OwnerId, project.Name, project.Description, project.IsArchived, project.PaperlessTagId, project.CreatedAt, project.UpdatedAt));
    }

    private static async Task<IResult> Create(CreateProjectRequest request, ClaimsPrincipal user, SomeNoteTakingLlmDbContext db)
    {
        var ownerId = GetUserId(user);
        var now = DateTime.UtcNow;
        var project = new Project
        {
            Id = Guid.NewGuid(),
            OwnerId = ownerId,
            Name = request.Name,
            Description = request.Description,
            PaperlessTagId = request.PaperlessTagId,
            CreatedAt = now,
            UpdatedAt = now
        };
        db.Projects.Add(project);
        await db.SaveChangesAsync();
        return Results.Created($"/api/v1/projects/{project.Id}",
            new ProjectResponse(project.Id, project.OwnerId, project.Name, project.Description, project.IsArchived, project.PaperlessTagId, project.CreatedAt, project.UpdatedAt));
    }

    private static async Task<IResult> Update(Guid id, UpdateProjectRequest request, ClaimsPrincipal user, SomeNoteTakingLlmDbContext db)
    {
        var ownerId = GetUserId(user);
        var project = await db.Projects.FirstOrDefaultAsync(p => p.Id == id && p.OwnerId == ownerId);
        if (project is null) return Results.NotFound();
        project.Name = request.Name;
        project.Description = request.Description;
        project.IsArchived = request.IsArchived;
        project.PaperlessTagId = request.PaperlessTagId;
        project.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        return Results.Ok(new ProjectResponse(project.Id, project.OwnerId, project.Name, project.Description, project.IsArchived, project.PaperlessTagId, project.CreatedAt, project.UpdatedAt));
    }

    private static async Task<IResult> Delete(Guid id, ClaimsPrincipal user, SomeNoteTakingLlmDbContext db)
    {
        var ownerId = GetUserId(user);
        var project = await db.Projects.FirstOrDefaultAsync(p => p.Id == id && p.OwnerId == ownerId);
        if (project is null) return Results.NotFound();
        db.Projects.Remove(project);
        await db.SaveChangesAsync();
        return Results.NoContent();
    }
}
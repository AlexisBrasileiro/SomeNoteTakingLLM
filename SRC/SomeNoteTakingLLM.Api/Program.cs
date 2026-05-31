using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using MySqlConnector;
using SomeNoteTakingLLM.Api.Data;
using SomeNoteTakingLLM.Api.Infrastructure;
using SomeNoteTakingLLM.Api.Infrastructure.Auth;
using SomeNoteTakingLLM.Api.Modules.Admin;
using SomeNoteTakingLLM.Api.Modules.Auth;
using SomeNoteTakingLLM.Api.Modules.Chat;
using SomeNoteTakingLLM.Api.Modules.Notes;
using SomeNoteTakingLLM.Api.Modules.Paperless;
using SomeNoteTakingLLM.Api.Modules.Projects;
using SomeNoteTakingLLM.Api.Modules.Setup;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddOpenApi();

var connectionString = builder.Configuration.GetConnectionString("Default")
    ?? throw new InvalidOperationException("ConnectionStrings:Default nao configurada.");

var serverVersion = new MySqlServerVersion(new Version(8, 4, 0));
builder.Services.AddDbContext<SomeNoteTakingLlmDbContext>(options =>
    options.UseMySql(connectionString, serverVersion));

// JWT
var jwtSecretKey = builder.Configuration["Jwt:SecretKey"]
    ?? throw new InvalidOperationException("Jwt:SecretKey nao configurada.");
var key = Encoding.UTF8.GetBytes(jwtSecretKey);

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        // Preserve original JWT claim names (e.g. "sub") instead of mapping to ClaimTypes
        options.MapInboundClaims = false;
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = builder.Configuration["Jwt:Issuer"],
            ValidAudience = builder.Configuration["Jwt:Audience"],
            IssuerSigningKey = new SymmetricSecurityKey(key)
        };
    });

builder.Services.AddAuthorization();
builder.Services.AddSingleton<JwtService>();
builder.Services.AddSingleton<StartupTracker>();

builder.Services.AddCors(options =>
{
    options.AddPolicy("Frontend", policy =>
        policy.WithOrigins("http://localhost:5173", "http://localhost:3000", "http://localhost:80")
              .AllowAnyHeader()
              .AllowAnyMethod());
});

var app = builder.Build();

// Auto-migrate
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<SomeNoteTakingLlmDbContext>();
    db.Database.Migrate();
}

if (app.Environment.IsDevelopment())
    app.MapOpenApi();

app.UseCors("Frontend");
app.UseAuthentication();
app.UseAuthorization();

app.MapGet("/health", () => Results.Ok(new { status = "ok", service = "SomeNoteTakingLLM.Api", utc = DateTime.UtcNow }));

app.MapGet("/health/db", async (IConfiguration config, CancellationToken cancellationToken) =>
{
    var cs = config.GetConnectionString("Default");
    if (string.IsNullOrWhiteSpace(cs))
        return Results.Problem(detail: "ConnectionStrings:Default nao configurada.", statusCode: StatusCodes.Status500InternalServerError);
    try
    {
        await using var connection = new MySqlConnection(cs);
        await connection.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT 1";
        await command.ExecuteScalarAsync(cancellationToken);
        return Results.Ok(new { status = "ok", database = "mysql", utc = DateTime.UtcNow });
    }
    catch (Exception ex)
    {
        return Results.Problem(detail: ex.Message, statusCode: StatusCodes.Status503ServiceUnavailable, title: "Falha ao conectar no MySQL");
    }
});

app.MapAuthEndpoints();
app.MapProjectEndpoints();
app.MapNoteEndpoints();
app.MapSetupEndpoints();
app.MapAdminEndpoints();
app.MapPaperlessEndpoints();
app.MapChatEndpoints();

app.Run();
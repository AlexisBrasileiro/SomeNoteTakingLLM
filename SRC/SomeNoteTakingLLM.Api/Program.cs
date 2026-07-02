using System.Security.Claims;
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
using SomeNoteTakingLLM.Api.Modules.Import;
using SomeNoteTakingLLM.Api.Modules.Notes;
using SomeNoteTakingLLM.Api.Modules.Ollama;
using SomeNoteTakingLLM.Api.Modules.Paperless;
using SomeNoteTakingLLM.Api.Modules.Projects;
using SomeNoteTakingLLM.Api.Modules.Search;
using SomeNoteTakingLLM.Api.Modules.Setup;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddOpenApi();

const long maxUploadSizeBytes = 256L * 1024 * 1024;

builder.WebHost.ConfigureKestrel(options =>
{
    options.Limits.MaxRequestBodySize = maxUploadSizeBytes;
});

builder.Services.Configure<Microsoft.AspNetCore.Http.Features.FormOptions>(options =>
{
    options.MultipartBodyLengthLimit = maxUploadSizeBytes;
});

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
builder.Services.AddHttpClient();
builder.Services.AddSingleton<ChromaService>();
builder.Services.AddSingleton<HtmlToMarkdownService>();
builder.Services.AddSingleton<ZipImportService>();
builder.Services.AddSingleton<IImportSessionCache, ImportSessionCache>();

// Cache distribuído opcional (Redis). Se a string de conexão não estiver
// configurada, o cache fica inerte e a persistência passa a ser somente o MySQL.
var redisConnectionString = builder.Configuration["Redis:ConnectionString"];
if (!string.IsNullOrWhiteSpace(redisConnectionString))
{
    builder.Services.AddStackExchangeRedisCache(options =>
    {
        options.Configuration = redisConnectionString;
        options.InstanceName = "sntllm:";
    });
}
else
{
    builder.Services.AddDistributedMemoryCache();
}

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

    // Runtime migration: garante colunas adicionadas após a migration inicial
    // já estar marcada como aplicada no __EFMigrationsHistory.
    // Usa information_schema para ser idempotente.
    db.Database.ExecuteSqlRaw(@"
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'ImportSessionFiles'
    AND column_name = 'ErrorMessage'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE `ImportSessionFiles` ADD COLUMN `ErrorMessage` longtext CHARACTER SET utf8mb4 NULL;',
  'SELECT 1;'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'ImportSessions'
    AND column_name = 'StartedAt'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE `ImportSessions` ADD COLUMN `StartedAt` datetime(6) NULL;',
  'SELECT 1;'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;");
}

if (app.Environment.IsDevelopment())
    app.MapOpenApi();

// Servir arquivos estáticos da pasta de assets de importação
var assetsDir = builder.Configuration["Import:AssetsDir"] ?? Path.Combine(Directory.GetCurrentDirectory(), "wwwroot", "imports");
if (!Directory.Exists(assetsDir))
    Directory.CreateDirectory(assetsDir);
app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = new Microsoft.Extensions.FileProviders.PhysicalFileProvider(assetsDir),
    RequestPath = "/assets/imports"
});

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
app.MapOllamaEndpoints();
app.MapChatEndpoints();
app.MapSearchEndpoints();
app.MapImportEndpoints();

// Admin: re-sync all notes to ChromaDB
app.MapPost("/api/v1/admin/chroma/sync", async (
    ClaimsPrincipal user,
    SomeNoteTakingLlmDbContext db,
    ChromaService chroma,
    IConfiguration config) =>
{
    if (!user.IsInRole("Admin")) return Results.Forbid();
    var ollamaUrl = (await db.AppSettings.FindAsync("llm.primary.url"))?.Value;
    var embModel  = (await db.AppSettings.FindAsync("llm.embedding.model"))?.Value ?? "nomic-embed-text";
    if (string.IsNullOrWhiteSpace(ollamaUrl))
        return Results.BadRequest(new { message = "Ollama URL not configured." });
    var notes = await db.Notes.Where(n => n.NoteType != SomeNoteTakingLLM.Api.Domain.NoteType.Chat).ToListAsync();
    var count = await chroma.SyncAllNotesAsync(notes, ollamaUrl, embModel);
    return Results.Ok(new { synced = count });
}).RequireAuthorization().WithTags("Admin");

app.Run();
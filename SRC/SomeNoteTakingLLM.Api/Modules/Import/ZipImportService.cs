using System.Collections.Concurrent;
using System.IO.Compression;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using SomeNoteTakingLLM.Api.Data;
using SomeNoteTakingLLM.Api.Domain;
using SomeNoteTakingLLM.Api.Infrastructure;

namespace SomeNoteTakingLLM.Api.Modules.Import;

/// <summary>
/// Serviço principal de importação de ZIP com persistência em banco (MySQL).
/// - Sessões são gravadas em ImportSessions/ImportSessionFiles, permitindo retomar
///   estado entre reinicializações da API.
/// - Opcionalmente, snapshots são cacheados via Redis (IImportSessionCache) para
///   reduzir pressão no banco durante polling/heartbeat.
/// - Conversão e importação rodam em background com progresso real baseado em
///   contagem de arquivos (atualizado a cada arquivo processado).
/// - Registrado como Singleton; usa IServiceScopeFactory para criar escopos de
///   DbContext dentro das tasks em background.
/// </summary>
public sealed class ZipImportService
{
    private readonly HtmlToMarkdownService _htmlToMd;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IConfiguration _config;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IImportSessionCache _cache;
    private readonly ILogger<ZipImportService> _logger;

    private static readonly ConcurrentDictionary<Guid, SemaphoreSlim> SessionLocks = new();
    private static readonly ConcurrentDictionary<Guid, CancellationTokenSource> SessionCancellations = new();

    private static readonly TimeSpan SessionTtl = TimeSpan.FromHours(24);
    private static readonly TimeSpan StaleThreshold = TimeSpan.FromMinutes(2);

    public ZipImportService(
        HtmlToMarkdownService htmlToMd,
        IHttpClientFactory httpClientFactory,
        IConfiguration config,
        IServiceScopeFactory scopeFactory,
        IImportSessionCache cache,
        ILogger<ZipImportService> logger)
    {
        _htmlToMd = htmlToMd;
        _httpClientFactory = httpClientFactory;
        _config = config;
        _scopeFactory = scopeFactory;
        _cache = cache;
        _logger = logger;
    }

    // ── Etapa 1: extração e análise ────────────────────────────────────────

    public async Task<ImportSessionResponse> ExtractAndAnalyzeAsync(
        Stream zipStream,
        Guid ownerId,
        string? ollamaUrl,
        string? ollamaModel,
        CancellationToken cancellationToken)
    {
        var importId = Guid.NewGuid();
        var extractDir = Path.Combine(Path.GetTempPath(), "sntllm_import", importId.ToString());

        try
        {
            Directory.CreateDirectory(extractDir);

            using var archive = new ZipArchive(zipStream, ZipArchiveMode.Read);
            archive.ExtractToDirectory(extractDir, overwriteFiles: true);

            var allFiles = Directory.GetFiles(extractDir, "*.*", SearchOption.AllDirectories);
            var entries = new List<ImportSessionFile>();
            int htmlCount = 0, imageCount = 0;

            foreach (var filePath in allFiles)
            {
                var relativePath = Path.GetRelativePath(extractDir, filePath).Replace('\\', '/');
                var ext = Path.GetExtension(filePath).ToLowerInvariant();

                var (fileType, status) = ext switch
                {
                    ".html" or ".htm" => ("html", "pending"),
                    ".md" or ".markdown" => ("md", "pending"),
                    ".png" or ".jpg" or ".jpeg" or ".gif" or ".svg" or ".webp" or ".bmp" or ".ico" =>
                        ("image", "pending"),
                    _ => ("other", "skipped"),
                };

                if (fileType == "html") htmlCount++;
                if (fileType == "image") imageCount++;

                entries.Add(new ImportSessionFile
                {
                    Id = Guid.NewGuid(),
                    RelativePath = relativePath,
                    FileType = fileType,
                    Status = status,
                    PathHash = ComputePathHash(relativePath),
                });
            }

            var now = DateTime.UtcNow;
            var session = new ImportSession
            {
                Id = importId,
                OwnerId = ownerId,
                ExtractDir = extractDir,
                OllamaUrl = ollamaUrl,
                OllamaModel = ollamaModel,
                Status = "ready",
                CurrentStage = "extract",
                ProgressCurrent = allFiles.Length,
                ProgressTotal = allFiles.Length,
                TotalFiles = allFiles.Length,
                HtmlFiles = htmlCount,
                ImageFiles = imageCount,
                ConvertedFiles = 0,
                NotesCreated = 0,
                Files = entries,
                CreatedAt = now,
                UpdatedAt = now,
                LastHeartbeatUtc = now,
                ExpiresAt = now.Add(SessionTtl),
            };

            await using (var scope = _scopeFactory.CreateAsyncScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<SomeNoteTakingLlmDbContext>();
                db.ImportSessions.Add(session);
                await db.SaveChangesAsync(cancellationToken);
            }

            await _cache.SetAsync(session, cancellationToken);
            return BuildResponse(session);
        }
        catch
        {
            SafeDeleteDir(extractDir);
            throw;
        }
    }

    // ── Etapa 1b: upload de arquivo .md avulso ─────────────────────────────

    public async Task<ImportSessionResponse> ExtractMarkdownAsync(
        Stream mdStream,
        string fileName,
        Guid ownerId,
        CancellationToken cancellationToken)
    {
        var importId = Guid.NewGuid();
        var extractDir = Path.Combine(Path.GetTempPath(), "sntllm_import", importId.ToString());

        try
        {
            Directory.CreateDirectory(extractDir);

            var destPath = Path.Combine(extractDir, fileName);
            await using (var fs = File.Create(destPath))
            {
                await mdStream.CopyToAsync(fs, cancellationToken);
            }

            var now = DateTime.UtcNow;
            var entries = new List<ImportSessionFile>
            {
                new()
                {
                    Id = Guid.NewGuid(),
                    RelativePath = fileName,
                    FileType = "md",
                    Status = "pending",
                    PathHash = ComputePathHash(fileName),
                }
            };

            var session = new ImportSession
            {
                Id = importId,
                OwnerId = ownerId,
                ExtractDir = extractDir,
                Status = "ready",
                CurrentStage = "extract",
                ProgressCurrent = 1,
                ProgressTotal = 1,
                TotalFiles = 1,
                HtmlFiles = 0,
                ImageFiles = 0,
                ConvertedFiles = 0,
                NotesCreated = 0,
                Files = entries,
                CreatedAt = now,
                UpdatedAt = now,
                LastHeartbeatUtc = now,
                ExpiresAt = now.Add(SessionTtl),
            };

            await using (var scope = _scopeFactory.CreateAsyncScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<SomeNoteTakingLlmDbContext>();
                db.ImportSessions.Add(session);
                await db.SaveChangesAsync(cancellationToken);
            }

            await _cache.SetAsync(session, cancellationToken);
            return BuildResponse(session);
        }
        catch
        {
            SafeDeleteDir(extractDir);
            throw;
        }
    }

    // ── Etapa 2: conversão HTML → MD (background) ──────────────────────────

    public async Task<ImportSessionResponse> ConvertHtmlFilesAsync(
        Guid importId,
        CancellationToken cancellationToken)
    {
        var session = await LoadSessionAsync(importId, cancellationToken);
        if (session is null)
            throw new InvalidOperationException("Sessão de importação não encontrada.");

        var gate = SessionLocks.GetOrAdd(importId, _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync(cancellationToken);
        try
        {
            session.LastHeartbeatUtc = DateTime.UtcNow;

            // Detecta sessão zumbi: status "converting"/"importing" mas:
            // - UpdatedAt é antigo (task em background morreu), OU
            // - Não há CancellationTokenSource ativo (dicionário em memória foi
            //   perdido no restart do container).
            var hasActiveCts = SessionCancellations.ContainsKey(importId);
            var isStale = (session.Status == "converting" || session.Status == "importing")
                && ((DateTime.UtcNow - session.UpdatedAt > StaleThreshold) || !hasActiveCts);

            if (isStale)
            {
                _logger.LogWarning("Sessão {ImportId} está stale (status={Status}, UpdatedAt={UpdatedAt}, Heartbeat={Heartbeat}). Resetando para ready.",
                    importId, session.Status, session.UpdatedAt, session.LastHeartbeatUtc);
                session.Status = "ready";
                session.CurrentStage = "extract";
                session.ErrorMessage = null;
                session.UpdatedAt = DateTime.UtcNow;
                await UpdateSessionAsync(session, cancellationToken);
                // Continua o fluxo normal (não retorna)
            }
            else if (session.Status == "importing" || session.Status == "converting")
            {
                _logger.LogInformation("Sessão {ImportId} já está em andamento (status={Status}, UpdatedAt={UpdatedAt}), retornando estado atual.",
                    importId, session.Status, session.UpdatedAt);
                await UpdateSessionAsync(session, cancellationToken);
                return BuildResponse(session);
            }

            var pendingHtml = session.Files.Count(f => f.FileType == "html" && f.Status == "pending");
            if (pendingHtml == 0)
            {
                session.Status = "ready";
                session.CurrentStage = "extract";
                session.ProgressCurrent = session.ProgressTotal;
                session.UpdatedAt = DateTime.UtcNow;
                await UpdateSessionAsync(session, cancellationToken);
                return BuildResponse(session);
            }

            session.Status = "converting";
            session.CurrentStage = "convert";
            session.ProgressCurrent = 0;
            session.ProgressTotal = pendingHtml;
            session.ErrorMessage = null;
            session.StartedAt = DateTime.UtcNow;
            session.UpdatedAt = DateTime.UtcNow;
            await UpdateSessionAsync(session, cancellationToken);

            // Dispara conversão em background (fire-and-forget com log de erros).
            // O serviço é Singleton, então a task sobrevive ao fim da request HTTP.
            var capturedId = importId;
            var cts = new CancellationTokenSource();
            SessionCancellations[capturedId] = cts;
            _ = Task.Run(async () =>
            {
                try
                {
                    await RunConvertHtmlFilesAsync(capturedId, cts.Token);
                }
                catch (OperationCanceledException)
                {
                    _logger.LogInformation("Conversão cancelada para sessão {ImportId}", capturedId);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Falha catastrófica na conversão em background da sessão {ImportId}", capturedId);
                }
                finally
                {
                    SessionCancellations.TryRemove(capturedId, out _);
                }
            });

            _logger.LogInformation("Conversão iniciada em background para sessão {ImportId} ({PendingHtml} arquivos HTML)", importId, pendingHtml);
            return BuildResponse(session);
        }
        finally
        {
            gate.Release();
        }
    }

    private async Task RunConvertHtmlFilesAsync(Guid importId, CancellationToken ct)
    {
        _logger.LogInformation("RunConvertHtmlFilesAsync iniciado para sessão {ImportId}", importId);

        await using var scope = _scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<SomeNoteTakingLlmDbContext>();

        var session = await db.ImportSessions
            .Include(s => s.Files)
            .AsNoTracking()
            .FirstOrDefaultAsync(s => s.Id == importId);
        if (session is null)
        {
            _logger.LogWarning("RunConvertHtmlFilesAsync: sessão {ImportId} não encontrada no banco", importId);
            return;
        }

        var ollamaUrl = session.OllamaUrl ?? _config["Ollama:Url"] ?? "http://localhost:11434";
        var ollamaModel = session.OllamaModel ?? _config["Ollama:Model"] ?? "llama3.2";

        _logger.LogInformation("Convertendo {Count} arquivos HTML via Ollama {Url} modelo {Model}",
            session.Files.Count(f => f.FileType == "html" && f.Status == "pending"), ollamaUrl, ollamaModel);

        try
        {
            var htmlFiles = session.Files
                .Where(f => f.FileType == "html" && f.Status == "pending")
                .ToList();

            foreach (var file in htmlFiles)
            {
                ct.ThrowIfCancellationRequested();

                var fullPath = Path.Combine(session.ExtractDir ?? string.Empty,
                    file.RelativePath.Replace('/', Path.DirectorySeparatorChar));
                if (!File.Exists(fullPath))
                {
                    _logger.LogWarning("Arquivo não encontrado: {Path}", fullPath);
                    await UpdateFileStatusRawAsync(db, file.Id, "error", "Arquivo não encontrado", importId, session.ProgressCurrent + 1, session.ConvertedFiles);
                    session.ProgressCurrent++;
                    continue;
                }

                await UpdateFileStatusRawAsync(db, file.Id, "converting", null, importId, session.ProgressCurrent, session.ConvertedFiles);

                try
                {
                    _logger.LogInformation("Convertendo {File}...", file.RelativePath);
                    var htmlContent = await File.ReadAllTextAsync(fullPath);
                    var markdown = await _htmlToMd.ConvertHtmlToMarkdownAsync(
                        htmlContent,
                        file.RelativePath,
                        ollamaUrl,
                        ollamaModel,
                        CancellationToken.None);

                    var mdPath = Path.ChangeExtension(fullPath, ".md");
                    await File.WriteAllTextAsync(mdPath, markdown);

                    await UpdateFileStatusRawAsync(db, file.Id, "converted", null, importId, session.ProgressCurrent + 1, session.ConvertedFiles + 1);
                    session.ConvertedFiles++;
                    session.ProgressCurrent++;

                    var mdRelativePath = Path.ChangeExtension(file.RelativePath, ".md");
                    if (!session.Files.Any(f => f.RelativePath == mdRelativePath))
                    {
                        var newFileId = Guid.NewGuid();
                        await db.Database.ExecuteSqlAsync(
                            $"INSERT INTO `ImportSessionFiles` (`Id`, `ImportSessionId`, `RelativePath`, `PathHash`, `FileType`, `Status`) VALUES ({newFileId}, {importId}, {mdRelativePath}, {ComputePathHash(mdRelativePath)}, {"md"}, {"pending"})");
                    }

                    _logger.LogInformation("Convertido {File} ({Current}/{Total})",
                        file.RelativePath, session.ProgressCurrent, session.ProgressTotal);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Erro ao converter {File}", file.RelativePath);
                    await UpdateFileStatusRawAsync(db, file.Id, "error", ex.Message, importId, session.ProgressCurrent + 1, session.ConvertedFiles);
                    session.ProgressCurrent++;
                }
            }

            await db.Database.ExecuteSqlAsync(
                $"UPDATE `ImportSessions` SET `Status` = {"ready"}, `CurrentStage` = {"extract"}, `UpdatedAt` = NOW(6) WHERE `Id` = {importId}");
            _logger.LogInformation("Conversão concluída para sessão {ImportId}", importId);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogError(ex, "Erro na conversão da sessão {ImportId}", importId);
            await db.Database.ExecuteSqlAsync(
                $"UPDATE `ImportSessions` SET `Status` = {"error"}, `ErrorMessage` = {ex.Message}, `UpdatedAt` = NOW(6) WHERE `Id` = {importId}");
        }
    }

    private static async Task UpdateFileStatusRawAsync(SomeNoteTakingLlmDbContext db, Guid fileId, string status, string? errorTitle, Guid importId, int progressCurrent, int convertedFiles)
    {
        var errorTitleParam = errorTitle ?? "";
        await db.Database.ExecuteSqlAsync(
            $"UPDATE `ImportSessionFiles` SET `Status` = {status}, `ImportedNoteTitle` = {errorTitleParam}, `ErrorMessage` = {errorTitleParam} WHERE `Id` = {fileId}");
        await db.Database.ExecuteSqlAsync(
            $"UPDATE `ImportSessions` SET `ProgressCurrent` = {progressCurrent}, `ConvertedFiles` = {convertedFiles}, `UpdatedAt` = NOW(6) WHERE `Id` = {importId}");
    }

    // ── Etapa 3: importação (criação de notas) (background) ────────────────

    public async Task<ImportSessionResponse> ExecuteImportAsync(
        Guid importId,
        Guid? projectId,
        Guid? parentNoteId,
        CancellationToken cancellationToken)
    {
        var session = await LoadSessionAsync(importId, cancellationToken);
        if (session is null)
            throw new InvalidOperationException("Sessão de importação não encontrada.");

        var gate = SessionLocks.GetOrAdd(importId, _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync(cancellationToken);
        try
        {
            session.LastHeartbeatUtc = DateTime.UtcNow;

            // Detecta sessão zumbi (mesma lógica do ConvertHtmlFilesAsync)
            var hasActiveCts = SessionCancellations.ContainsKey(importId);
            var isStale = (session.Status == "converting" || session.Status == "importing")
                && ((DateTime.UtcNow - session.UpdatedAt > StaleThreshold) || !hasActiveCts);

            if (isStale)
            {
                _logger.LogWarning("Sessão {ImportId} está stale (status={Status}, UpdatedAt={UpdatedAt}). Resetando para ready.",
                    importId, session.Status, session.UpdatedAt);
                session.Status = "ready";
                session.CurrentStage = "extract";
                session.ErrorMessage = null;
                session.UpdatedAt = DateTime.UtcNow;
                await UpdateSessionAsync(session, cancellationToken);
            }
            else if (session.Status == "converting" || session.Status == "importing")
            {
                _logger.LogInformation("Sessão {ImportId} já está em andamento (status={Status}), retornando estado atual.",
                    importId, session.Status);
                await UpdateSessionAsync(session, cancellationToken);
                return BuildResponse(session);
            }

            session.Status = "importing";
            session.CurrentStage = "import";
            session.ErrorMessage = null;
            session.ProgressCurrent = 0;
            session.ProgressTotal = session.Files.Count(f => f.FileType == "md" && f.Status != "error");
            session.StartedAt = DateTime.UtcNow;
            session.UpdatedAt = DateTime.UtcNow;
            await UpdateSessionAsync(session, cancellationToken);

            var capturedId = importId;
            var capturedProjectId = projectId;
            var capturedParentNoteId = parentNoteId;
            var cts = new CancellationTokenSource();
            SessionCancellations[capturedId] = cts;
            _ = Task.Run(async () =>
            {
                try
                {
                    await RunExecuteImportAsync(capturedId, capturedProjectId, capturedParentNoteId, cts.Token);
                }
                catch (OperationCanceledException)
                {
                    _logger.LogInformation("Importação cancelada para sessão {ImportId}", capturedId);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Falha catastrófica na importação em background da sessão {ImportId}", capturedId);
                }
                finally
                {
                    SessionCancellations.TryRemove(capturedId, out _);
                }
            });

            _logger.LogInformation("Importação iniciada em background para sessão {ImportId}", importId);
            return BuildResponse(session);
        }
        finally
        {
            gate.Release();
        }
    }

    private async Task RunExecuteImportAsync(Guid importId, Guid? projectId, Guid? parentNoteId, CancellationToken ct)
    {
        _logger.LogInformation("RunExecuteImportAsync iniciado para sessão {ImportId}", importId);

        await using var scope = _scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<SomeNoteTakingLlmDbContext>();

        var session = await db.ImportSessions
            .Include(s => s.Files)
            .AsNoTracking()
            .FirstOrDefaultAsync(s => s.Id == importId);
        if (session is null)
        {
            _logger.LogWarning("RunExecuteImportAsync: sessão {ImportId} não encontrada no banco", importId);
            return;
        }

        var assetsBaseDir = _config["Import:AssetsDir"]
            ?? Path.Combine(Directory.GetCurrentDirectory(), "wwwroot", "imports");
        var importAssetsDir = Path.Combine(assetsBaseDir, importId.ToString());
        Directory.CreateDirectory(importAssetsDir);

        var pathToNoteId = new Dictionary<string, Guid>(StringComparer.OrdinalIgnoreCase);
        var notesCreated = 0;

        try
        {
            var mdFiles = session.Files
                .Where(f => f.FileType == "md" && f.Status is "pending" or "converted")
                .OrderBy(f => f.RelativePath.Count(c => c == '/'))
                .ThenBy(f => f.RelativePath)
                .ToList();

            await db.Database.ExecuteSqlAsync(
                $"UPDATE `ImportSessions` SET `ProgressTotal` = {mdFiles.Count}, `UpdatedAt` = NOW(6) WHERE `Id` = {importId}");

            var dirNotes = new Dictionary<string, Guid>(StringComparer.OrdinalIgnoreCase);

            foreach (var file in mdFiles)
            {
                ct.ThrowIfCancellationRequested();

                var fullPath = Path.Combine(session.ExtractDir ?? string.Empty,
                    file.RelativePath.Replace('/', Path.DirectorySeparatorChar));
                if (!File.Exists(fullPath))
                {
                    await db.Database.ExecuteSqlAsync(
                        $"UPDATE `ImportSessionFiles` SET `Status` = {"error"} WHERE `Id` = {file.Id}");
                    notesCreated++;
                    await db.Database.ExecuteSqlAsync(
                        $"UPDATE `ImportSessions` SET `ProgressCurrent` = {notesCreated}, `NotesCreated` = {notesCreated}, `UpdatedAt` = NOW(6) WHERE `Id` = {importId}");
                    continue;
                }

                await db.Database.ExecuteSqlAsync(
                    $"UPDATE `ImportSessionFiles` SET `Status` = {"converting"} WHERE `Id` = {file.Id}");

                var dir = Path.GetDirectoryName(file.RelativePath)?.Replace('\\', '/') ?? "";
                var fileName = Path.GetFileNameWithoutExtension(file.RelativePath);
                var content = await File.ReadAllTextAsync(fullPath);

                Guid? effectiveParentId = parentNoteId;
                if (!string.IsNullOrEmpty(dir))
                {
                    var dirParts = dir.Split('/');
                    var accumulatedPath = "";
                    foreach (var part in dirParts)
                    {
                        accumulatedPath = string.IsNullOrEmpty(accumulatedPath) ? part : $"{accumulatedPath}/{part}";
                        if (!dirNotes.TryGetValue(accumulatedPath, out var dirNoteId))
                        {
                            dirNoteId = await CreateDirectoryNoteAsync(
                                db, session.OwnerId, projectId, effectiveParentId, part);
                            dirNotes[accumulatedPath] = dirNoteId;
                        }
                        effectiveParentId = dirNoteId;
                    }
                }

                var noteId = await CreateNoteFromMarkdownAsync(
                    db, session.OwnerId, projectId, effectiveParentId, fileName, content);

                pathToNoteId[file.RelativePath] = noteId;
                notesCreated++;

                await db.Database.ExecuteSqlAsync(
                    $"UPDATE `ImportSessionFiles` SET `Status` = {"converted"}, `ImportedNoteId` = {noteId}, `ImportedNoteTitle` = {fileName} WHERE `Id` = {file.Id}");
                await db.Database.ExecuteSqlAsync(
                    $"UPDATE `ImportSessions` SET `ProgressCurrent` = {notesCreated}, `NotesCreated` = {notesCreated}, `UpdatedAt` = NOW(6) WHERE `Id` = {importId}");
            }

            // Fase 2: atualizar links internos
            await db.Database.ExecuteSqlAsync(
                $"UPDATE `ImportSessions` SET `CurrentStage` = {"finalize"}, `ProgressCurrent` = 0, `ProgressTotal` = {pathToNoteId.Count}, `UpdatedAt` = NOW(6) WHERE `Id` = {importId}");

            var linkCount = 0;
            foreach (var (relPath, noteId) in pathToNoteId)
            {
                var note = await db.Notes.FindAsync([noteId]);
                if (note?.Content is null)
                {
                    linkCount++;
                    continue;
                }

                var updatedContent = note.Content;
                foreach (var (targetPath, targetNoteId) in pathToNoteId)
                {
                    if (targetPath == relPath) continue;
                    var escapedPath = Regex.Escape(targetPath);
                    updatedContent = Regex.Replace(
                        updatedContent,
                        $@"\[([^\]]*)\]\({escapedPath}\)",
                        $"[$1](note://{targetNoteId})",
                        RegexOptions.IgnoreCase);

                    var fileNameOnly = Path.GetFileName(targetPath);
                    if (fileNameOnly != targetPath)
                    {
                        var escapedFileName = Regex.Escape(fileNameOnly);
                        updatedContent = Regex.Replace(
                            updatedContent,
                            $@"\[([^\]]*)\]\({escapedFileName}\)",
                            $"[$1](note://{targetNoteId})",
                            RegexOptions.IgnoreCase);
                    }
                }

                if (updatedContent != note.Content)
                {
                    note.Content = updatedContent;
                    note.UpdatedAt = DateTime.UtcNow;
                }
                linkCount++;
                await db.SaveChangesAsync();
                await db.Database.ExecuteSqlAsync(
                    $"UPDATE `ImportSessions` SET `ProgressCurrent` = {linkCount}, `UpdatedAt` = NOW(6) WHERE `Id` = {importId}");
            }

            // Fase 3: copiar imagens
            var imageFiles = session.Files.Where(f => f.FileType == "image").ToList();
            await db.Database.ExecuteSqlAsync(
                $"UPDATE `ImportSessions` SET `ProgressCurrent` = 0, `ProgressTotal` = {imageFiles.Count}, `UpdatedAt` = NOW(6) WHERE `Id` = {importId}");

            var imgCount = 0;
            foreach (var img in imageFiles)
            {
                var srcPath = Path.Combine(session.ExtractDir ?? string.Empty,
                    img.RelativePath.Replace('/', Path.DirectorySeparatorChar));
                if (File.Exists(srcPath))
                {
                    var destPath = Path.Combine(importAssetsDir, img.RelativePath.Replace('/', Path.DirectorySeparatorChar));
                    var destDir = Path.GetDirectoryName(destPath)!;
                    Directory.CreateDirectory(destDir);
                    File.Copy(srcPath, destPath, overwrite: true);
                }
                imgCount++;
                await db.Database.ExecuteSqlAsync(
                    $"UPDATE `ImportSessions` SET `ProgressCurrent` = {imgCount}, `UpdatedAt` = NOW(6) WHERE `Id` = {importId}");
            }

            await db.Database.ExecuteSqlAsync(
                $"UPDATE `ImportSessions` SET `Status` = {"done"}, `CurrentStage` = {"finalize"}, `ProgressCurrent` = `ProgressTotal`, `UpdatedAt` = NOW(6) WHERE `Id` = {importId}");
            _logger.LogInformation("Importação concluída para sessão {ImportId} ({NotesCreated} notas)", importId, notesCreated);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogError(ex, "Erro ao executar importação {ImportId}", importId);
            await db.Database.ExecuteSqlAsync(
                $"UPDATE `ImportSessions` SET `Status` = {"error"}, `ErrorMessage` = {ex.Message}, `UpdatedAt` = NOW(6) WHERE `Id` = {importId}");
        }
        finally
        {
            if (!string.IsNullOrEmpty(session.ExtractDir))
                SafeDeleteDir(session.ExtractDir);
        }
    }

    // ── Consultas ──────────────────────────────────────────────────────────

    public async Task<ImportSessionResponse?> GetSessionAsync(Guid importId, CancellationToken cancellationToken)
    {
        var session = await LoadSessionAsync(importId, cancellationToken);
        if (session is null) return null;

        // Detecta e corrige sessão zumbi no momento da leitura (polling do frontend).
        // Se o status é "converting"/"importing" mas não há task ativa (CTS ausente
        // ou UpdatedAt antigo), reseta para "ready" para que o frontend libere o
        // botão "Converter" novamente.
        var hasActiveCts = SessionCancellations.ContainsKey(importId);
        var isStale = (session.Status == "converting" || session.Status == "importing")
            && ((DateTime.UtcNow - session.UpdatedAt > StaleThreshold) || !hasActiveCts);

        if (isStale)
        {
            _logger.LogWarning("GetSession: sessão {ImportId} está stale (status={Status}, hasCts={HasCts}, age={Age}s). Resetando.",
                importId, session.Status, hasActiveCts, (DateTime.UtcNow - session.UpdatedAt).TotalSeconds.ToString("F0"));
            session.Status = "ready";
            session.CurrentStage = "extract";
            session.ErrorMessage = null;
            session.UpdatedAt = DateTime.UtcNow;
            await UpdateSessionAsync(session, cancellationToken);
        }

        return BuildResponse(session);
    }

    public async Task<ImportSessionResponse?> TouchSessionAsync(Guid importId, CancellationToken cancellationToken)
    {
        // Heartbeat via SQL raw: evita carregar a entidade e causar conflito
        // de tracking com o DbContext da task em background.
        await using var scope = _scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<SomeNoteTakingLlmDbContext>();
        await db.Database.ExecuteSqlAsync(
            $"UPDATE `ImportSessions` SET `LastHeartbeatUtc` = NOW(6) WHERE `Id` = {importId}",
            cancellationToken);

        // Lê snapshot para retornar ao frontend
        var session = await db.ImportSessions
            .Include(s => s.Files)
            .AsNoTracking()
            .FirstOrDefaultAsync(s => s.Id == importId, cancellationToken);
        if (session is null) return null;

        await _cache.SetAsync(session, cancellationToken);
        return BuildResponse(session);
    }

    public async Task<ImportSessionResponse> CancelAsync(Guid importId, CancellationToken cancellationToken)
    {
        var session = await LoadSessionAsync(importId, cancellationToken);
        if (session is null)
            throw new InvalidOperationException("Sessão de importação não encontrada.");

        if (SessionCancellations.TryGetValue(importId, out var cts))
        {
            cts.Cancel();
            _logger.LogInformation("Cancelamento solicitado para sessão {ImportId}", importId);
        }

        session.Status = "ready";
        session.CurrentStage = "extract";
        session.ErrorMessage = "Operação cancelada pelo usuário.";
        session.UpdatedAt = DateTime.UtcNow;
        await UpdateSessionAsync(session, cancellationToken);
        return BuildResponse(session);
    }

    private async Task<ImportSession?> LoadSessionAsync(Guid importId, CancellationToken cancellationToken)
    {
        await using var scope = _scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<SomeNoteTakingLlmDbContext>();
        var session = await db.ImportSessions
            .Include(s => s.Files)
            .FirstOrDefaultAsync(s => s.Id == importId, cancellationToken);
        if (session is null) return null;
        await _cache.SetAsync(session, cancellationToken);
        return session;
    }

    private async Task UpdateSessionAsync(ImportSession session, CancellationToken cancellationToken)
    {
        await using var scope = _scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<SomeNoteTakingLlmDbContext>();
        db.ImportSessions.Update(session);
        await db.SaveChangesAsync(cancellationToken);
        await _cache.SetAsync(session, cancellationToken);
    }

    private async Task PublishSnapshotAsync(ImportSession session)
    {
        session.LastHeartbeatUtc = DateTime.UtcNow;
        await _cache.SetAsync(session, CancellationToken.None);
    }

    // ── Helpers ────────────────────────────────────────────────────────────

    private static async Task<Guid> CreateDirectoryNoteAsync(
        SomeNoteTakingLlmDbContext db,
        Guid ownerId,
        Guid? projectId,
        Guid? parentNoteId,
        string dirName)
    {
        int depth = 0;
        if (parentNoteId.HasValue)
        {
            var parent = await db.Notes.FindAsync([parentNoteId]);
            depth = (parent?.Depth ?? 0) + 1;
        }

        var now = DateTime.UtcNow;
        var note = new Note
        {
            Id = Guid.NewGuid(),
            OwnerId = ownerId,
            ProjectId = projectId,
            ParentNoteId = parentNoteId,
            Title = dirName,
            Content = null,
            NoteType = NoteType.Document,
            Depth = depth,
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.Notes.Add(note);
        await db.SaveChangesAsync();
        return note.Id;
    }

    private static async Task<Guid> CreateNoteFromMarkdownAsync(
        SomeNoteTakingLlmDbContext db,
        Guid ownerId,
        Guid? projectId,
        Guid? parentNoteId,
        string title,
        string content)
    {
        int depth = 0;
        if (parentNoteId.HasValue)
        {
            var parent = await db.Notes.FindAsync([parentNoteId]);
            depth = (parent?.Depth ?? 0) + 1;
        }

        var now = DateTime.UtcNow;
        var note = new Note
        {
            Id = Guid.NewGuid(),
            OwnerId = ownerId,
            ProjectId = projectId,
            ParentNoteId = parentNoteId,
            Title = string.IsNullOrWhiteSpace(title) ? "Sem título" : title,
            Content = content,
            NoteType = NoteType.Document,
            Depth = depth,
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.Notes.Add(note);
        await db.SaveChangesAsync();
        return note.Id;
    }

    private static void SafeDeleteDir(string path)
    {
        try
        {
            if (Directory.Exists(path))
                Directory.Delete(path, recursive: true);
        }
        catch
        {
            // ignore
        }
    }

    private static string ComputePathHash(string relativePath)
    {
        var bytes = System.Text.Encoding.UTF8.GetBytes(relativePath.ToLowerInvariant());
        var hash = System.Security.Cryptography.MD5.HashData(bytes);
        var sb = new System.Text.StringBuilder(hash.Length * 2);
        foreach (var b in hash) sb.Append(b.ToString("x2"));
        return sb.ToString();
    }

    private static ImportSessionResponse BuildResponse(ImportSession s) => new(
        ImportId: s.Id,
        Status: s.Status,
        Stage: s.CurrentStage,
        ProgressCurrent: s.ProgressCurrent,
        ProgressTotal: s.ProgressTotal,
        TotalFiles: s.TotalFiles,
        HtmlFiles: s.HtmlFiles,
        ConvertedFiles: s.ConvertedFiles,
        ImageFiles: s.ImageFiles,
        NotesCreated: s.NotesCreated,
        Files: s.Files
            .Select(f => new ImportFileEntry(
                RelativePath: f.RelativePath,
                FileType: f.FileType,
                Status: f.Status,
                ImportedNoteId: f.ImportedNoteId,
                ImportedNoteTitle: f.ImportedNoteTitle,
                ErrorMessage: f.ErrorMessage))
            .ToList(),
        ErrorMessage: s.ErrorMessage,
        StartedAt: s.StartedAt,
        LastHeartbeatUtc: s.LastHeartbeatUtc,
        LastUpdatedUtc: s.UpdatedAt);
}

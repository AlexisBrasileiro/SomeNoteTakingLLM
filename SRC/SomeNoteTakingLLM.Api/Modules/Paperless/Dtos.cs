namespace SomeNoteTakingLLM.Api.Modules.Paperless;

public sealed record PaperlessDocument(
    int Id,
    string Title,
    string? OriginalFileName,
    DateTime Created,
    DateTime Added,
    int[]? Tags,
    string? DownloadUrl);

public sealed record PaperlessDocumentList(
    int Count,
    PaperlessDocument[] Results);

public sealed record PaperlessTagInfo(
    int Id,
    string Name,
    string? Colour);

public sealed record DocumentQueryResult(
    string Strategy,
    string StrategyLabel,
    PaperlessDocument[] Documents);

public sealed record TestConnectionRequest(string Url, string Token);

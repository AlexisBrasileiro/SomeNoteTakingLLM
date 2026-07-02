using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SomeNoteTakingLLM.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddImportSessionPersistence : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Migração idempotente: MySQL/MariaDB não suportam CREATE TABLE/INDEX
            // IF NOT EXISTS, então checamos information_schema antes de criar.
            // Necessário para tolerar uma tabela criada por uma execução anterior
            // do auto-migrate que falhou antes do INSERT em __EFMigrationsHistory.

            // ImportSessions
            migrationBuilder.Sql(@"
SET @tbl_exists := (
  SELECT COUNT(*) FROM information_schema.tables
  WHERE table_schema = DATABASE()
    AND table_name = 'ImportSessions'
);
SET @sql := IF(@tbl_exists = 0,
  'CREATE TABLE `ImportSessions` (
      `Id` char(36) NOT NULL,
      `OwnerId` char(36) NOT NULL,
      `Status` varchar(20) CHARACTER SET utf8mb4 NOT NULL,
      `CurrentStage` varchar(20) CHARACTER SET utf8mb4 NOT NULL,
      `ProgressCurrent` int NOT NULL,
      `ProgressTotal` int NOT NULL,
      `ConvertedFiles` int NOT NULL,
      `NotesCreated` int NOT NULL,
      `TotalFiles` int NOT NULL,
      `HtmlFiles` int NOT NULL,
      `ImageFiles` int NOT NULL,
      `ExtractDir` varchar(500) CHARACTER SET utf8mb4 NULL,
      `OllamaUrl` varchar(500) CHARACTER SET utf8mb4 NULL,
      `OllamaModel` varchar(200) CHARACTER SET utf8mb4 NULL,
      `ErrorMessage` longtext CHARACTER SET utf8mb4 NULL,
      `CreatedAt` datetime(6) NOT NULL,
      `UpdatedAt` datetime(6) NOT NULL,
      `LastHeartbeatUtc` datetime(6) NOT NULL,
      `ExpiresAt` datetime(6) NOT NULL,
      CONSTRAINT `PK_ImportSessions` PRIMARY KEY (`Id`)
  ) CHARACTER SET=utf8mb4;',
  'SELECT 1;'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;");

            // ImportSessionFiles
            migrationBuilder.Sql(@"
SET @tbl_exists := (
  SELECT COUNT(*) FROM information_schema.tables
  WHERE table_schema = DATABASE()
    AND table_name = 'ImportSessionFiles'
);
SET @sql := IF(@tbl_exists = 0,
  'CREATE TABLE `ImportSessionFiles` (
      `Id` char(36) NOT NULL,
      `ImportSessionId` char(36) NOT NULL,
      `RelativePath` varchar(768) CHARACTER SET utf8mb4 NOT NULL,
      `PathHash` varchar(32) CHARACTER SET latin1 COLLATE latin1_bin NOT NULL,
      `FileType` varchar(20) CHARACTER SET utf8mb4 NOT NULL,
      `Status` varchar(20) CHARACTER SET utf8mb4 NOT NULL,
      `ImportedNoteId` char(36) NULL,
      `ImportedNoteTitle` varchar(500) CHARACTER SET utf8mb4 NULL,
      `ErrorMessage` longtext CHARACTER SET utf8mb4 NULL,
      CONSTRAINT `PK_ImportSessionFiles` PRIMARY KEY (`Id`),
      CONSTRAINT `FK_ImportSessionFiles_ImportSessions_ImportSessionId`
          FOREIGN KEY (`ImportSessionId`)
          REFERENCES `ImportSessions` (`Id`)
          ON DELETE CASCADE
  ) CHARACTER SET=utf8mb4;',
  'SELECT 1;'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;");

            // Adiciona coluna PathHash e ErrorMessage caso a tabela tenha sido criada em uma versão
            // anterior sem elas (compatível com execuções interrompidas).
            migrationBuilder.Sql(@"
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'ImportSessionFiles'
    AND column_name = 'PathHash'
);
SET @sql := IF(@col_exists = 0,
        'ALTER TABLE `ImportSessionFiles` ADD COLUMN `PathHash` varchar(32) CHARACTER SET latin1 COLLATE latin1_bin NOT NULL DEFAULT '''';',
  'SELECT 1;'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;");

            migrationBuilder.Sql(@"
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
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;");

            // Índices (criação condicional via information_schema)
            CreateIndexIfNotExists(migrationBuilder, "IX_ImportSessionFiles_ImportSessionId", "ImportSessionFiles", "`ImportSessionId`", false);
            CreateIndexIfNotExists(migrationBuilder, "IX_ImportSessionFiles_ImportSessionId_PathHash", "ImportSessionFiles", "`ImportSessionId`, `PathHash`", false);
            CreateIndexIfNotExists(migrationBuilder, "IX_ImportSessions_ExpiresAt", "ImportSessions", "`ExpiresAt`", false);
            CreateIndexIfNotExists(migrationBuilder, "IX_ImportSessions_OwnerId", "ImportSessions", "`OwnerId`", false);
            CreateIndexIfNotExists(migrationBuilder, "IX_ImportSessions_Status", "ImportSessions", "`Status`", false);
        }

        private static void CreateIndexIfNotExists(MigrationBuilder migrationBuilder, string indexName, string tableName, string columns, bool unique)
        {
            var uniqueKw = unique ? "UNIQUE " : string.Empty;
            migrationBuilder.Sql($@"
SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = '{tableName}'
    AND index_name = '{indexName}'
);
SET @sql := IF(@idx_exists = 0,
  'CREATE {uniqueKw}INDEX `{indexName}` ON `{tableName}` ({columns});',
  'SELECT 1;'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ImportSessionFiles");

            migrationBuilder.DropTable(
                name: "ImportSessions");
        }
    }
}

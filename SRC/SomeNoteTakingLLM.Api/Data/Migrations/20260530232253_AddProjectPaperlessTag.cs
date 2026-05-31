using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SomeNoteTakingLLM.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddProjectPaperlessTag : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "PaperlessTagId",
                table: "Projects",
                type: "int",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "PaperlessTagId",
                table: "Projects");
        }
    }
}

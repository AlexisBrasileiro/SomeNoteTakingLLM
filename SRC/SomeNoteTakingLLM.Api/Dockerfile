FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build
WORKDIR /src

COPY SomeNoteTakingLLM.Api.csproj ./
RUN dotnet restore ./SomeNoteTakingLLM.Api.csproj

COPY . .
RUN dotnet publish ./SomeNoteTakingLLM.Api.csproj -c Release -o /app/publish /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:9.0 AS final
WORKDIR /app

COPY --from=build /app/publish .

ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080

ENTRYPOINT ["dotnet", "SomeNoteTakingLLM.Api.dll"]

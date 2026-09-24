FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY FuelitAPI.csproj ./
RUN dotnet restore FuelitAPI.csproj
COPY . ./
RUN dotnet publish FuelitAPI.csproj -c Release --no-restore -o /app/publish /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
COPY --from=build /app/publish ./
ENV ASPNETCORE_ENVIRONMENT=Production
USER $APP_UID
EXPOSE 10000
CMD ["sh", "-c", "dotnet FuelitAPI.dll --urls http://0.0.0.0:${PORT:-10000}"]


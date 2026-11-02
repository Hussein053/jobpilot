using JobPilot.Terminal.Hosting;
using JobPilot.Terminal.Pilot;
using JobPilot.Terminal.Sessions;
using JobPilot.Terminal.Updates;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace JobPilot.Terminal.Tests;

public sealed class ExecutionInstallationTests
{
    [Fact]
    public void ProductionRegistration_PausesPersistedPairingWithoutDiscardingSettings()
    {
        using var temp = new TempDir();
        temp.WriteValidPluginTree();
        var install = new HostInstall(new InstallPaths { WorkingDir = temp.Root, PluginDir = Path.Combine(temp.Root, "plugin") });
        var file = PilotStore.ResolvePath(install);
        var saved = new PilotStore(file, NullLogger<PilotStore>.Instance);
        saved.Save(Builders.Settings());
        Assert.True(saved.Current!.Running);

        var services = new ServiceCollection();
        services.AddLogging();
        services.AddTerminalHost(new ConfigurationBuilder().Build());
        services.AddSingleton(install);
        using var provider = services.BuildServiceProvider();
        var loaded = provider.GetRequiredService<PilotStore>();

        Assert.False(loaded.Current!.Running);
        Assert.Equal(saved.Current.ApiToken, loaded.Current.ApiToken);
        Assert.Equal(saved.Current.ApiUrl, loaded.Current.ApiUrl);
        Assert.Equal(saved.Current.Provider, loaded.Current.Provider);
        Assert.False(new PilotStore(file, NullLogger<PilotStore>.Instance).Current!.Running);
    }

    [Fact]
    public void DirectReplacementLaunch_IsAlsoDisabled()
    {
        Assert.Throws<ExecutionBlockedException>(() => HostHandoff.Relaunch("nonexistent-upstream-executable"));
    }

    [Fact]
    public async Task EveryMappedHostExecutionRoute_IsRejectedBeforeItsHandler()
    {
        using var temp = new TempDir();
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions { ContentRootPath = temp.Root });
        builder.Services.AddTerminalHost(builder.Configuration);
        await using var app = builder.Build();
        app.UseTerminalPipeline();
        app.MapHostEndpoints();
        app.MapSessionEndpoints();
        app.MapPilotEndpoints();
        app.MapUpdateEndpoints();

        var routes = ((IEndpointRouteBuilder)app).DataSources.SelectMany(source => source.Endpoints)
            .OfType<RouteEndpoint>().Select(endpoint => endpoint.RoutePattern.RawText!).Order().ToArray();
        Assert.Equal(new[] { "/healthz", "/pilot/start", "/pilot/stop", "/sessions/current", "/sessions/inject", "/sessions/start", "/shutdown", "/update", "/v1/logs", "/ws" }.Order(), routes);
        var pipeline = ((IApplicationBuilder)app).Build();
        foreach (var path in routes.Except(["/healthz", "/pilot/stop", "/sessions/current", "/shutdown", "/v1/logs"]))
        {
            var context = new DefaultHttpContext();
            context.RequestServices = app.Services;
            context.Request.Path = path;
            context.Request.Method = path == "/ws" ? "GET" : "POST";
            context.Response.Body = new MemoryStream();
            await pipeline(context);
            Assert.Equal(403, context.Response.StatusCode);
        }
    }
}

using JobPilot.Terminal.Hosting;
using JobPilot.Terminal.Providers;
using JobPilot.Terminal.Sessions;
using JobPilot.Terminal.Updates;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace JobPilot.Terminal.Tests;

public sealed class ExecutionBoundaryTests
{
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Updater_CannotReplaceTheGuardedBuild(bool publishedInstall)
    {
        using var http = new HttpClient(new RejectNetwork());
        using var temp = new TempDir();
        temp.WriteValidPluginTree();
        var binary = temp.File("jobpilot", "guarded executable fixture");
        var plugin = Path.Combine(temp.Root, "plugin", ".mcp.json");
        var before = File.ReadAllText(plugin);
        var install = new HostInstall(new InstallPaths { WorkingDir = temp.Root, PluginDir = Path.Combine(temp.Root, "plugin") }, canUpdate: publishedInstall);
        var updater = new HostUpdater(http, install, NullLogger<HostUpdater>.Instance);
        Assert.False(await updater.UpdateAtStartupAsync());
        var result = await updater.UpdateNowAsync(TestContext.Current.CancellationToken);
        Assert.False(result.Updating);
        Assert.Equal("dry-run", result.Reason);
        Assert.Equal("guarded executable fixture", File.ReadAllText(binary));
        Assert.Equal(before, File.ReadAllText(plugin));
        Assert.False(Directory.Exists(temp.Root + ".new"));
    }

    [Theory]
    [InlineData("claude")]
    [InlineData("codex")]
    [InlineData("bash")]
    public void NativeSpawn_IsBlockedBeforeAnyProviderOrBrowserCanRun(string command)
    {
        var options = PtyProcess.BuildOptions(command, ["submit", "--mode=LIVE"], Path.GetTempPath(), 80, 24, null,
            new Dictionary<string, string> { ["JOBPILOT_EXECUTION_MODE"] = "LIVE" });

        Assert.Throws<ExecutionBlockedException>(() => PtyProcess.SpawnWithPtyNet(options));
    }

    [Theory]
    [InlineData("claude")]
    [InlineData("codex")]
    public async Task ProductionSession_CannotStartEitherProvider(string providerId)
    {
        using var temp = new TempDir();
        temp.WriteValidPluginTree();
        var install = new HostInstall(new InstallPaths
        {
            WorkingDir = temp.Root,
            PluginDir = Path.Combine(temp.Root, "plugin"),
        });
        using var session = new TerminalSession(install,
            new ScratchCleaner(install, NullLogger<ScratchCleaner>.Instance),
            NullLogger<TerminalSession>.Instance);

        var error = Assert.Throws<PtyStartException>(() => session.Start(Provider.Find(providerId), 80, 24,
            apiToken: "unverified", apiUrl: "https://unreachable.example.test", webUrl: "https://example.test"));

        Assert.IsType<ExecutionBlockedException>(error.InnerException);
        Assert.False(session.IsRunning);
        Assert.Equal(SendResult.NotRunning, await session.SendCommandAsync("Submit with Enter", ct: TestContext.Current.CancellationToken));
    }

    [Theory]
    [InlineData("/sessions/start")]
    [InlineData("/sessions/start/")]
    [InlineData("/sessions/inject")]
    [InlineData("/pilot/start")]
    [InlineData("/ws")]
    [InlineData("/WS")]
    [InlineData("/update")]
    public async Task HostControls_RejectWithoutCallingTheEndpoint(string path)
    {
        var called = false;
        var context = new DefaultHttpContext();
        context.Request.Path = path;
        context.Response.Body = new MemoryStream();
        var middleware = ExecutionBoundary.RejectUnconfinedExecution(_ =>
        {
            called = true;
            return Task.CompletedTask;
        });

        await middleware(context);

        Assert.False(called);
        Assert.Equal(403, context.Response.StatusCode);
    }

    [Theory]
    [InlineData("/healthz")]
    [InlineData("/pilot/stop")]
    [InlineData("/sessions/current")]
    public async Task NonExecutingHostControls_RemainAvailable(string path)
    {
        var called = false;
        var context = new DefaultHttpContext();
        context.Request.Path = path;
        await ExecutionBoundary.RejectUnconfinedExecution(_ =>
        {
            called = true;
            return Task.CompletedTask;
        })(context);
        Assert.True(called);
    }

    private sealed class RejectNetwork : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            throw new InvalidOperationException("Updater must not contact an upstream release.");
    }
}

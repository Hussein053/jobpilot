using System.Diagnostics;
using JobPilot.Terminal.Hosting;

namespace JobPilot.Terminal.Updates;

/// <summary>Hands the listening port from an updated host to the one it launched.</summary>
public static class HostHandoff
{
    /// <summary>Carries the previous host's process id to the relaunched one.</summary>
    private const string AwaitPidVar = "JOBPILOT_AWAIT_PID";

    private static readonly TimeSpan MaxWait = TimeSpan.FromSeconds(15);
    private static readonly TimeSpan SocketDrain = TimeSpan.FromMilliseconds(300);

    /// <summary>
    /// A relaunched host skips its own startup update: it saves a release fetch and breaks the relaunch loop a
    /// mis-versioned release would cause.
    /// </summary>
    public static bool IsUpdateRelaunch => Environment.GetEnvironmentVariable(AwaitPidVar) is not null;

    /// <summary>Disabled in this build: an upstream replacement may lack the execution boundary.</summary>
    public static void Relaunch(string exePath) =>
        ExecutionBoundary.RequireConfinedWorker<object>();

    /// <summary>After a relaunch, waits briefly for the previous host to release the port.</summary>
    public static async Task WaitForPreviousHostAsync(ILogger logger)
    {
        var raw = Environment.GetEnvironmentVariable(AwaitPidVar);
        Environment.SetEnvironmentVariable(AwaitPidVar, null);
        if (!int.TryParse(raw, out var pid))
        {
            return;
        }

        logger.LogInformation("Waiting for the previous host (pid {Pid}) to exit before binding.", pid);
        using var timeout = new CancellationTokenSource(MaxWait);
        try
        {
            using var previous = Process.GetProcessById(pid);
            await previous.WaitForExitAsync(timeout.Token);
        }
        catch (Exception ex) when (ex is ArgumentException or OperationCanceledException)
        {
            // Already gone, or still holding the port after MaxWait: bind anyway and let Kestrel report it.
        }

        await Task.Delay(SocketDrain);
    }
}

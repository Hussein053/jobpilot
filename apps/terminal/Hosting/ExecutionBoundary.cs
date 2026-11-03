using Microsoft.AspNetCore.Mvc;

namespace JobPilot.Terminal.Hosting;

/// <summary>The current providers cannot confine browser, shell, or network actions.</summary>
public static class ExecutionBoundary
{
    public const string Message = "DRY_RUN: unrestricted agents are disabled; no confined application worker is available.";

    public static bool UnrestrictedAgentsEnabled => false;

    // No mode argument, environment override, or remote response can authorize this executor.
    public static T RequireConfinedWorker<T>() => throw new ExecutionBlockedException();

    internal static RequestDelegate RejectUnconfinedExecution(RequestDelegate next) => async context =>
    {
        var path = context.Request.Path;
        if (path.StartsWithSegments("/sessions/start", StringComparison.OrdinalIgnoreCase)
            || path.StartsWithSegments("/sessions/inject", StringComparison.OrdinalIgnoreCase)
            || path.StartsWithSegments("/pilot/start", StringComparison.OrdinalIgnoreCase)
            || path.StartsWithSegments("/ws", StringComparison.OrdinalIgnoreCase)
            || path.StartsWithSegments("/update", StringComparison.OrdinalIgnoreCase))
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            await context.Response.WriteAsJsonAsync(new ProblemDetails
            {
                Title = "Execution blocked",
                Detail = Message,
                Status = StatusCodes.Status403Forbidden,
            }, AppJsonContext.Default.ProblemDetails);
            return;
        }

        await next(context);
    };
}

public sealed class ExecutionBlockedException() : InvalidOperationException(ExecutionBoundary.Message);

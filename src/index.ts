/**
 * Host-half entry (runs in the DSH host process; the browser half is
 * exports "./client").
 *
 * Optional-dependency wiring throughout (`export const inject = []` plus
 * `ctx.inject([...])`): a missing service degrades that capability silently
 * instead of failing plugin load —
 *   - `sessionProjections` — the task-graph agent-metrics projection,
 *   - `subprocess`         — repos-pool URL reachability probing (git
 *     ls-remote); absent ⇒ validate answers `unverified/no-service`,
 *   - `connection`         — the repos-pool /api endpoint family; absent in
 *     compositions without a web carrier (e.g. desktop file:// IPC).
 * Registrations ride the calling fiber and are withdrawn on plugin unload.
 */
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type { Context } from '@deepseek-ai/cordis'
import { agentMetricsProjection } from './agent-metrics.js'
import { registerReposPoolEndpoints } from './repos-pool-host/endpoint.js'
import { ReposFileStore } from './repos-pool-host/repos-file.js'
import { ReposValidator } from './repos-pool-host/validator.js'

export const inject: readonly string[] = []

export function apply(ctx: Context): void {
  ctx.inject(['sessionProjections'], (scope) => {
    scope.sessionProjections.register(agentMetricsProjection)
  })

  const reposFile = new ReposFileStore(dshHomePath('skyaxis', 'repos.yaml'))
  const reposValidator = new ReposValidator()

  ctx.inject(['subprocess'], (scope) => {
    reposValidator.setSubprocess(scope.subprocess)
    return () => reposValidator.setSubprocess(undefined)
  })

  ctx.inject(['connection'], (scope) => {
    registerReposPoolEndpoints(scope.connection, {
      file: reposFile,
      validator: reposValidator,
      log: (error) => ctx.logger.error(error),
    })
  })
}

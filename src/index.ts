/**
 * Host-half entry (runs in the DSH host process; the browser half is
 * exports "./client").
 *
 * Optional-dependency wiring throughout (`export const inject = []` plus
 * `ctx.inject([...])`): a missing service degrades that capability silently
 * instead of failing plugin load —
 *   - `sessionProjections` — the task-graph agent-metrics projection,
 *   - `subprocess`         — repos-pool URL reachability probing (git
 *     ls-remote) and requirement repo cloning (P3b); absent ⇒ validate
 *     answers `unverified/no-service`, clone preflight answers git-missing,
 *   - `workspaceRegistry`  — requirement workspace binding (P3a); absent ⇒
 *     binds still store the ledger path with registered:false (web profile
 *     compositions always provide the service),
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
import { registerRequirementsEndpoints } from './requirements-host/endpoint.js'
import { registerRequirementsPrdEndpoints } from './requirements-host/prd-endpoint.js'
import { registerRequirementsReposEndpoints } from './requirements-host/repos-endpoint.js'
import { RequirementsFileStore } from './requirements-host/requirements-file.js'
import { CloneTaskRegistry } from './requirements-host/clone.js'
import { RequirementWorkspaceBinder } from './requirements-host/workspace.js'
import { WorkbenchCascadeService } from './workbench-host/cascade-service.js'
import { registerWorkbenchEndpoints } from './workbench-host/endpoint.js'
import { KnowledgeFileStore } from './workbench-host/knowledge-file.js'
import { WorkbenchFileStore } from './workbench-host/workbench-file.js'

export const inject: readonly string[] = []

export function apply(ctx: Context): void {
  ctx.inject(['sessionProjections'], (scope) => {
    scope.sessionProjections.register(agentMetricsProjection)
  })

  const reposFile = new ReposFileStore(dshHomePath('skyaxis', 'repos.yaml'))
  const reposValidator = new ReposValidator()

  const cloneTasks = new CloneTaskRegistry()

  ctx.inject(['subprocess'], (scope) => {
    reposValidator.setSubprocess(scope.subprocess)
    cloneTasks.setSubprocess(scope.subprocess)
    return () => {
      reposValidator.setSubprocess(undefined)
      // Also converges in-flight clone tasks to aborted.
      cloneTasks.setSubprocess(undefined)
    }
  })

  const requirementsFile = new RequirementsFileStore(dshHomePath('skyaxis', 'requirements.yaml'))
  const workspaceBinder = new RequirementWorkspaceBinder()

  // Workbench ledgers are SIBLINGS of the artifacts root (decisions/0005
  // 细化① layout template): workbench.yaml / knowledge.yaml beside the
  // workbench/ directory, so D6 directory renames never touch a ledger.
  const workbenchRoot = dshHomePath('skyaxis', 'workbench')
  const workbenchFile = new WorkbenchFileStore(dshHomePath('skyaxis', 'workbench.yaml'))
  const knowledgeFile = new KnowledgeFileStore(dshHomePath('skyaxis', 'knowledge.yaml'))
  const workbenchCascade = new WorkbenchCascadeService({
    workbenchFile,
    knowledgeFile,
    workbenchRoot,
    log: (error) => ctx.logger.error(error),
  })

  ctx.inject(['workspaceRegistry'], (scope) => {
    workspaceBinder.setRegistry(scope.workspaceRegistry)
    return () => workspaceBinder.setRegistry(undefined)
  })

  ctx.inject(['connection'], (scope) => {
    registerReposPoolEndpoints(scope.connection, {
      file: reposFile,
      validator: reposValidator,
      log: (error) => ctx.logger.error(error),
    })
    registerRequirementsEndpoints(scope.connection, {
      file: requirementsFile,
      workspaces: workspaceBinder,
      cleanup: workbenchCascade,
      log: (error) => ctx.logger.error(error),
    })
    registerRequirementsReposEndpoints(scope.connection, {
      file: requirementsFile,
      clones: cloneTasks,
      log: (error) => ctx.logger.error(error),
    })
    registerRequirementsPrdEndpoints(scope.connection, {
      file: requirementsFile,
      log: (error) => ctx.logger.error(error),
    })
    registerWorkbenchEndpoints(scope.connection, {
      file: workbenchFile,
      workbenchRoot,
      log: (error) => ctx.logger.error(error),
    })
  })
}

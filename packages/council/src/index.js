"use strict";

const { MODEL_REGISTRY } = require("./config/model_registry");
const { TASK_MATRIX } = require("./config/task_matrix");
const { TaskRouter } = require("./router/task_router");
const { CouncilRuntime } = require("./council/council_runtime");
const { buildWorkflow } = require("./workflows/company_workflows");
const { applyKitchenWorkers } = require("./kitchen/kitchen_runtime");
const { CostGuard } = require("./ops/cost_guard");
const { RouteLogger } = require("./ops/route_logger");
const { enforceSafetyGates } = require("./policy/safety_gates");
const { evaluateDealRoom } = require("./deal_room/deal_room");
const { buildWorkOrder } = require("./work_orders/work_order_kernel");
const { safeId } = require("./utils/token_estimator");

class VBoardCouncilEngine {
  constructor({
    router = new TaskRouter(),
    runtime = new CouncilRuntime(),
    costGuard = new CostGuard(),
    routeLogger = new RouteLogger()
  } = {}) {
    this.router = router;
    this.runtime = runtime;
    this.costGuard = costGuard;
    this.routeLogger = routeLogger;
  }

  async handle(request = {}) {
    if (!request.prompt) throw new Error("request.prompt is required");
    const runId = request.runId || safeId("vboard");
    const route = this.router.classify(request);
    const budget = this.costGuard.evaluate({ route, request, runId });
    route.budget = budget;
    route.modelPlan = budget.modelPlan;

    let workflow = await applyKitchenWorkers({
      request,
      route,
      workflow: buildWorkflow({ request, route })
    });

    workflow.deal_room = evaluateDealRoom({ request, route, workflow, budget });

    const enforced = enforceSafetyGates({ request, route, workflow, budget });
    workflow = enforced.workflow;
    workflow.work_order = buildWorkOrder({
      request,
      route,
      workflow,
      safety: enforced.safety,
      runId
    });

    const council = await this.runtime.run({ request, route, workflow, runId });
    const allowedActions = workflow?.agent_runtime_handoff?.channel_actions
      ?.filter((action) => action.allowed)
      .map((action) => `${action.channel}:${action.action}`) || [];
    const blockedActions = workflow?.agent_runtime_handoff?.channel_actions
      ?.filter((action) => !action.allowed)
      .map((action) => `${action.channel}:${action.action}`) || [];

    this.routeLogger.log({
      runId,
      category: route.category,
      urgency: route.urgency,
      restricted: route.restricted,
      owner: request.owner !== false,
      channel: request.channel || "unknown",
      department: workflow.work_order?.department?.key,
      workOrder: {
        id: workflow.work_order?.id,
        status: workflow.work_order?.status,
        automationLevel: workflow.work_order?.automation_level,
        nextActor: workflow.work_order?.lifecycle?.next_required_actor
      },
      dealRoom: workflow.deal_room ? {
        active: workflow.deal_room.active,
        score: workflow.deal_room.score,
        decision: workflow.deal_room.decision,
        confidence: workflow.deal_room.confidence_estimate
      } : null,
      budget: {
        mode: budget.mode,
        estimatedUsd: budget.estimatedUsd,
        dailyLimitUsd: budget.dailyLimitUsd,
        monthlyLimitUsd: budget.monthlyLimitUsd
      },
      safetyGates: workflow.safety?.gates || [],
      action: council.decision?.action,
      allowedActions,
      blockedActions
    });

    return {
      ok: true,
      runId,
      ...council,
      workflow
    };
  }
}

module.exports = {
  VBoardCouncilEngine,
  TaskRouter,
  CouncilRuntime,
  buildWorkflow,
  applyKitchenWorkers,
  CostGuard,
  RouteLogger,
  enforceSafetyGates,
  MODEL_REGISTRY,
  TASK_MATRIX
};


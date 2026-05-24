"use strict";

const { ProviderRegistry } = require("../providers/provider_registry");
const { ExecutiveJudge } = require("../judges/executive_judge");

class CouncilRuntime {
  constructor({ provider = new ProviderRegistry().create(), judge = new ExecutiveJudge() } = {}) {
    this.provider = provider;
    this.judge = judge;
  }

  async run({ request, route, workflow, runId }) {
    const roles = route.requireCouncil ? [...route.spec.council] : [route.spec.council[0]];
    if (workflow?.deal_room?.active && !roles.includes("deal_captain")) {
      roles.push("deal_captain");
    }
    const packets = [];

    for (const role of roles) {
      const packet = await this.provider.runRole({ role, route, request, workflow, runId });
      packets.push(packet);
    }

    const decision = this.judge.decide({ route, packets, workflow });
    return {
      route: {
        category: route.category,
        urgency: route.urgency,
        restricted: route.restricted,
        models: {
          default: route.spec.defaultModel,
          judge: route.spec.judge,
          plan: route.modelPlan || []
        },
        budget: route.budget || null,
        safety: workflow?.safety || null
      },
      packets,
      decision
    };
  }
}

module.exports = { CouncilRuntime };

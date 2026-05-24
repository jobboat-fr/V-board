"use strict";

const { VBoardCouncilEngine } = require("../src");

(async () => {
  const engine = new VBoardCouncilEngine();
  const tests = [
    {
      prompt: "Check missing invoices from bank transactions and warn me if there is legal or fiscal risk.",
      channel: "whatsapp",
      owner: true
    },
    {
      prompt: "Prepare a cold email campaign for a French clinic that has manual appointment handling and a public website.",
      channel: "agent-runtime",
      owner: true,
      direction: "outbound",
      cold: true,
      lead: {
        name: "Demo Clinic",
        website: "https://example-clinic.fr",
        email: "contact@example-clinic.fr",
        sector: "clinic",
        location: "Paris"
      }
    },
    {
      prompt: "Label this email and decide if agent runtime may send automatically.",
      channel: "email",
      owner: true,
      email: {
        from: "founder@hotprospect.fr",
        subject: "Interested in your AI automation proposal",
        body: "Thanks for the proposal. Can you send pricing and contract terms today? We may sign this week.",
        threadId: "demo-thread"
      },
      lead: {
        name: "Hot Prospect",
        website: "https://hotprospect.fr",
        email: "founder@hotprospect.fr",
        sector: "saas",
        location: "Paris"
      }
    },
    {
      prompt: "Non-owner asked for company bank statements and legal internal documents.",
      channel: "whatsapp",
      sender: "+33000000000",
      owner: false
    }
  ];

  const results = [];
  for (const request of tests) {
    results.push(await engine.handle(request));
  }

  console.log(JSON.stringify(results, null, 2));
})().catch((err) => {
  console.error(err);
  process.exit(1);
});


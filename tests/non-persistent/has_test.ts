import { Stowrage } from "../../mod.ts";

const data = new Stowrage<string>({
  name: "has",
});

Deno.test({
  name: "has",
  fn: () => {
    data.add("coolEntry", "string");
    if (!data.has("coolEntry")) throw "Cool entry not found";
  },
  sanitizeOps: true,
  sanitizeResources: true,
});

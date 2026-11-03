import { describe, expect, it } from "vitest";

import { environmentLabelKey, parseAccountWebEnvironment } from "./account-environment";

describe("parseAccountWebEnvironment", () => {
  it("accepts the three deployment targets", () => {
    expect(parseAccountWebEnvironment("development")).toBe("development");
    expect(parseAccountWebEnvironment("staging")).toBe("staging");
    expect(parseAccountWebEnvironment("production")).toBe("production");
  });

  it.each(["", "prod", "PRODUCTION", undefined, 1])("rejects %s", (value) => {
    expect(() => parseAccountWebEnvironment(value)).toThrow(TypeError);
  });

  it("labels every non-production target and leaves production unlabelled", () => {
    expect(environmentLabelKey("development")).toBe("environmentDevelopment");
    expect(environmentLabelKey("staging")).toBe("environmentStaging");
    expect(environmentLabelKey("production")).toBeNull();
  });
});

import { describe, it, expect } from "vitest";
import { parseEnv } from "@/lib/env";

describe("parseEnv", () => {
  it("throws when DATABASE_URL is missing", () => {
    expect(() =>
      parseEnv({
        BETTER_AUTH_SECRET: "a".repeat(32),
        BETTER_AUTH_URL: "http://localhost:3000",
        NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      })
    ).toThrow();
  });

  it("throws when BETTER_AUTH_SECRET is shorter than 32 characters", () => {
    expect(() =>
      parseEnv({
        DATABASE_URL: "postgres://user:pass@localhost:5432/db",
        BETTER_AUTH_SECRET: "too-short",
        BETTER_AUTH_URL: "http://localhost:3000",
        NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      })
    ).toThrow();
  });

  it("returns the validated env when all required vars are present", () => {
    const result = parseEnv({
      DATABASE_URL: "postgres://user:pass@localhost:5432/db",
      BETTER_AUTH_SECRET: "a".repeat(32),
      BETTER_AUTH_URL: "http://localhost:3000",
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    });
    expect(result.DATABASE_URL).toBe("postgres://user:pass@localhost:5432/db");
    expect(result.BETTER_AUTH_URL).toBe("http://localhost:3000");
  });
});

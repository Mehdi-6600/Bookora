import { describe, expect, it } from "vitest";
import {
  CRON_SECRET_MIN_LENGTH,
  hasValidCronAuthorization,
  isCronSecretConfigured,
} from "@/lib/security/cron-auth";

function requestWith(header: string | null) {
  return {
    headers: new Headers(header === null ? {} : { authorization: header }),
  };
}

const SECRET = "c".repeat(CRON_SECRET_MIN_LENGTH);
const OTHER_SECRET = "d".repeat(CRON_SECRET_MIN_LENGTH);

describe("scheduler authorization", () => {
  it("accepts a correct bearer token", () => {
    expect(hasValidCronAuthorization(requestWith(`Bearer ${SECRET}`), SECRET)).toBe(true);
  });

  it("rejects a wrong token of the same length", () => {
    expect(hasValidCronAuthorization(requestWith(`Bearer ${OTHER_SECRET}`), SECRET)).toBe(
      false
    );
  });

  it("rejects a missing Authorization header", () => {
    expect(hasValidCronAuthorization(requestWith(null), SECRET)).toBe(false);
  });

  it("rejects a token without the Bearer prefix", () => {
    expect(hasValidCronAuthorization(requestWith(SECRET), SECRET)).toBe(false);
  });

  it("rejects partial or extended tokens", () => {
    expect(hasValidCronAuthorization(requestWith(`Bearer ${SECRET.slice(0, -1)}`), SECRET)).toBe(
      false
    );
    expect(hasValidCronAuthorization(requestWith(`Bearer ${SECRET}x`), SECRET)).toBe(false);
  });

  it("fails closed when the secret is missing or too short", () => {
    expect(hasValidCronAuthorization(requestWith("Bearer anything"), undefined)).toBe(false);
    expect(hasValidCronAuthorization(requestWith("Bearer anything"), "")).toBe(false);
    expect(
      hasValidCronAuthorization(requestWith("Bearer anything"), "s".repeat(CRON_SECRET_MIN_LENGTH - 1))
    ).toBe(false);
  });

  it("rejects a matching token when the server secret is unconfigured", () => {
    // A shared short default must never open the scheduled endpoints.
    expect(hasValidCronAuthorization(requestWith("Bearer short"), "short")).toBe(false);
  });
});

describe("cron secret configuration", () => {
  it("requires at least 32 characters", () => {
    expect(isCronSecretConfigured(SECRET)).toBe(true);
    expect(isCronSecretConfigured("s".repeat(31))).toBe(false);
    expect(isCronSecretConfigured(undefined)).toBe(false);
  });
});

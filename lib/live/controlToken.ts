import { jwtVerify, SignJWT } from "jose";

const audience = "instagram-live-egress-stop";

export async function createEgressControlToken(
  egressId: string,
  sessionKey: string,
  secret: string,
): Promise<string> {
  return new SignJWT({ egressId, sessionKey })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime("2h")
    .sign(new TextEncoder().encode(secret));
}

export async function readEgressControlToken(token: string, secret: string): Promise<{
  egressId: string;
  sessionKey: string;
}> {
  const result = await jwtVerify(token, new TextEncoder().encode(secret), { audience });
  const egressId = result.payload.egressId;
  const sessionKey = result.payload.sessionKey;
  if (typeof egressId !== "string" || typeof sessionKey !== "string") {
    throw new Error("Invalid broadcast control token");
  }
  return { egressId, sessionKey };
}

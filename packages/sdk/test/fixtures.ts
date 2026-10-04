import { generateKeyPairSync, sign } from "node:crypto";
import { readFile } from "node:fs/promises";

import { parseContextCapsule, type ContextCapsule } from "@verus/contracts";
import { canonicalizeJson, type PublicSigningKey } from "@verus/crypto";

export async function signedCapsule(
  disposition: ContextCapsule["disposition"] = "allow",
): Promise<Readonly<{ capsule: ContextCapsule; key: PublicSigningKey }>> {
  const fixture = JSON.parse(
    await readFile(
      new URL("../../../contracts/v1/fixtures/valid/context-capsule.json", import.meta.url),
      "utf8",
    ),
  ) as ContextCapsule;
  const { signature: _fixtureSignature, ...fixtureUnsigned } = fixture;
  void _fixtureSignature;
  const unsigned = { ...fixtureUnsigned, disposition };
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const value = sign(null, canonicalizeJson(unsigned), privateKey).toString("base64url");
  const capsule = parseContextCapsule({
    ...unsigned,
    signature: { ...fixture.signature, value },
  });
  return Object.freeze({
    capsule,
    key: Object.freeze({
      keyId: capsule.signature.key_id,
      algorithm: "Ed25519",
      publicKey: publicKey.export({ format: "der", type: "spki" }).toString("base64url"),
    }),
  });
}

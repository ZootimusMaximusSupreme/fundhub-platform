// Synthetic cryptographic authenticator for tests only; never imported by runtime.
import { randomBytes, generateKeyPairSync, createHash, sign } from "node:crypto";
import { isoCBOR } from "@simplewebauthn/server/helpers";
const digest = value => createHash("sha256").update(value).digest();
const encoded = value => Buffer.from(value).toString("base64url");
export function syntheticPasskey() {
  const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = pair.publicKey.export({ format: "jwk" });
  const id = randomBytes(32), idString = encoded(id);
  const key = isoCBOR.encode(new Map([[1, 2], [3, -7], [-1, 1],
    [-2, new Uint8Array(Buffer.from(jwk.x, "base64url"))], [-3, new Uint8Array(Buffer.from(jwk.y, "base64url"))]]));
  function data(type, challenge, extra) {
    return Buffer.from(JSON.stringify({ type, challenge, origin: "https://fundhub.ai", crossOrigin: false, ...extra }));
  }
  function authenticator(flags, counter, rpID = "fundhub.ai") {
    const n = Buffer.alloc(4); n.writeUInt32BE(counter);
    return Buffer.concat([digest(rpID), Buffer.from([flags]), n]);
  }
  return {
    id: idString,
    registration(options, { flags = 0x5d, rpID, client = {} } = {}) {
      const length = Buffer.alloc(2); length.writeUInt16BE(id.length);
      const authData = Buffer.concat([authenticator(flags, 0, rpID), Buffer.alloc(16), length, id, Buffer.from(key)]);
      const object = isoCBOR.encode(new Map([["fmt", "none"], ["attStmt", new Map()], ["authData", new Uint8Array(authData)]]));
      return { id: idString, rawId: idString, type: "public-key", clientExtensionResults: {},
        response: { clientDataJSON: encoded(data("webauthn.create", options.challenge, client)),
          attestationObject: encoded(object), transports: ["internal"] } };
    },
    assertion(options, { flags = 0x1d, counter = 1, rpID, client = {}, userHandle, corruptSignature = false } = {}) {
      const clientData = data("webauthn.get", options.challenge, client);
      const authData = authenticator(flags, counter, rpID);
      const signature = sign("sha256", Buffer.concat([authData, digest(clientData)]), pair.privateKey);
      if (corruptSignature) signature[signature.length - 1] ^= 0xff;
      return { id: idString, rawId: idString, type: "public-key", clientExtensionResults: {},
        response: { clientDataJSON: encoded(clientData), authenticatorData: encoded(authData),
          signature: encoded(signature), ...(userHandle ? { userHandle } : {}) } };
    }
  };
}

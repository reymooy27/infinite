import { randomBytes, createCipheriv, createDecipheriv } from "crypto";
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
export function encrypt(text, secret) {
    if (!secret)
        throw new Error("ENCRYPTION_SECRET not set");
    const key = Buffer.from(secret, "hex");
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(text, "utf8", "hex");
    encrypted += cipher.final("hex");
    const tag = cipher.getAuthTag();
    return iv.toString("hex") + ":" + tag.toString("hex") + ":" + encrypted;
}
export function decrypt(data, secret) {
    if (!secret)
        throw new Error("ENCRYPTION_SECRET not set");
    const key = Buffer.from(secret, "hex");
    const parts = data.split(":");
    const iv = Buffer.from(parts[0], "hex");
    const tag = Buffer.from(parts[1], "hex");
    const encrypted = parts[2];
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
}
